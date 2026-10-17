/**
 * Selection policy: which candidates reach the index, and which one wins when
 * several describe the same package.
 *
 * Pure by construction — it takes candidates and configuration and returns
 * candidates plus per-entry reasons. No network, no filesystem, so every rule
 * here is tested directly.
 */
import type { Candidate, ProjectConfig, Rejection } from '../types.js'
import { repoIdentity } from '../resolve/urls.js'

/** Highest star count a candidate carries, or 0 when it carries none. */
function stars(candidate: Candidate): number {
  return candidate.sortKeys['stars'] ?? 0
}

/**
 * Every repository identity a candidate can be recognised by.
 *
 * A deny rule must be answerable from whatever the source actually said, so
 * this collects identities from every URL the candidate carries rather than
 * from `repository` alone. That distinction is the whole point: `repository` is
 * a display field format 1 constrains to canonical https URLs, so a resolver
 * facing npm's `git+https://github.com/o/r.git` form, an SSH URL, or a
 * non-GitHub host leaves it unset — and a rule reading only `repository` would
 * then see nothing and let the entry through. Fail-open is the wrong default
 * for the one entry a visitor would recognise as not being a plugin.
 *
 * @param candidate - candidate to identify.
 * @returns every distinct lowercase `owner/repo` identity its URLs yield.
 */
export function repositoryIdentities(candidate: Candidate): string[] {
  const identities = new Set<string>()
  for (const url of [candidate.sourceUrl, candidate.repository?.url, candidate.homepage]) {
    if (url === undefined) continue
    const identity = repoIdentity(url)
    if (identity !== undefined) identities.add(identity.toLowerCase())
  }
  return [...identities]
}

/**
 * Drop entries that are not plugins at all, and packages excluded by hand.
 *
 * Identity is matched from every URL the candidate carries, not from
 * `repository` alone, so a URL shape the resolver declined to decompose cannot
 * slip past the rule.
 *
 * @param candidates - candidates to filter.
 * @param config - project configuration carrying the deny lists.
 * @returns the survivors and one rejection per dropped candidate.
 */
export function applyDenyLists(
  candidates: readonly Candidate[],
  config: ProjectConfig,
): { candidates: Candidate[]; rejections: Rejection[] } {
  const denyRepos = new Set(config.denyRepos.map((entry) => entry.toLowerCase()))
  const denyPackages = new Set(config.denyPackages)
  const kept: Candidate[] = []
  const rejections: Rejection[] = []

  for (const candidate of candidates) {
    const denied = repositoryIdentities(candidate).find((identity) => denyRepos.has(identity))
    if (denied !== undefined) {
      rejections.push({ id: denied, stage: 'policy', reason: 'repository is on the deny list (not a plugin)' })
      continue
    }
    if (denyPackages.has(candidate.name)) {
      rejections.push({ id: candidate.name, stage: 'policy', reason: 'package is on the deny list' })
      continue
    }
    kept.push(candidate)
  }
  return { candidates: kept, rejections }
}

/**
 * Collapse candidates that name the same package.
 *
 * Format 1 requires each plugin `name` to be unique within an index, and
 * duplicates are real: 271 repository names in the current list are shared by
 * two or more owners, and a monorepo can expose the same package through more
 * than one entry. The winner is decided by configured source priority first —
 * an explicitly curated source should outrank a discovery sweep — and by star
 * count second, so the better-known of two otherwise-equal entries survives.
 *
 * Provenance is merged rather than discarded, so the run report can still say
 * every source that produced the package.
 *
 * @param candidates - candidates to deduplicate.
 * @param priorityOf - source id to priority, higher wins.
 * @returns one candidate per package name, in first-seen order.
 */
export function dedupeByName(
  candidates: readonly Candidate[],
  priorityOf: ReadonlyMap<string, number>,
): { candidates: Candidate[]; rejections: Rejection[] } {
  const best = new Map<string, Candidate>()
  const order: string[] = []
  const rejections: Rejection[] = []

  const rank = (candidate: Candidate): number => {
    let top = 0
    for (const source of candidate.provenance) top = Math.max(top, priorityOf.get(source) ?? 0)
    return top
  }

  for (const candidate of candidates) {
    const existing = best.get(candidate.name)
    if (!existing) {
      best.set(candidate.name, candidate)
      order.push(candidate.name)
      continue
    }
    const challengerRank = rank(candidate)
    const incumbentRank = rank(existing)
    const challengerWins =
      challengerRank > incumbentRank || (challengerRank === incumbentRank && stars(candidate) > stars(existing))

    if (challengerWins) {
      best.set(candidate.name, {
        ...candidate,
        provenance: [...new Set([...candidate.provenance, ...existing.provenance])],
      })
      rejections.push({
        id: candidate.name,
        stage: 'policy',
        reason: `duplicate package name — kept a higher-ranked entry (priority ${challengerRank} vs ${incumbentRank}, stars ${stars(candidate)} vs ${stars(existing)})`,
      })
    } else {
      best.set(candidate.name, {
        ...existing,
        provenance: [...new Set([...existing.provenance, ...candidate.provenance])],
      })
      rejections.push({
        id: candidate.name,
        stage: 'policy',
        reason: `duplicate package name — kept the earlier higher-ranked entry (priority ${incumbentRank} vs ${challengerRank}, stars ${stars(existing)} vs ${stars(candidate)})`,
      })
    }
  }

  return { candidates: order.map((name) => best.get(name) as Candidate), rejections }
}

/**
 * Apply the star floor.
 * @param candidates - candidates to filter.
 * @param minStars - inclusive floor; 0 keeps everything.
 * @param sourceId - provenance used in the rejection reason.
 * @returns survivors and one rejection per dropped candidate.
 */
export function applyStarFloor(
  candidates: readonly Candidate[],
  minStars: number,
  sourceId: string,
): { candidates: Candidate[]; rejections: Rejection[] } {
  if (minStars <= 0) return { candidates: [...candidates], rejections: [] }
  const kept: Candidate[] = []
  const rejections: Rejection[] = []
  for (const candidate of candidates) {
    if (stars(candidate) < minStars) {
      rejections.push({
        id: candidate.name,
        stage: 'policy',
        reason: `below the star floor (${stars(candidate)} < ${minStars})`,
      })
      continue
    }
    kept.push(candidate)
  }
  void sourceId
  return { candidates: kept, rejections }
}

/**
 * The full selection pass, in the order the rules must apply.
 *
 * Denies run first so a denied repository is never the reason a legitimate
 * duplicate loses, then dedupe, then the star floor — a floor applied before
 * dedupe could promote a low-star entry over a high-star one that the floor
 * would have kept.
 *
 * @param candidates - every candidate the sources produced.
 * @param config - project configuration.
 * @param minStars - the active profile's floor.
 * @returns the selection and every rejection with its reason.
 */
export function applyPolicy(
  candidates: readonly Candidate[],
  config: ProjectConfig,
  minStars: number,
): { candidates: Candidate[]; rejections: Rejection[] } {
  const priorityOf = new Map(config.sources.map((source) => [source.id, source.priority]))
  const denied = applyDenyLists(candidates, config)
  const deduped = dedupeByName(denied.candidates, priorityOf)
  const floored = applyStarFloor(deduped.candidates, minStars, 'policy')
  return {
    candidates: floored.candidates,
    rejections: [...denied.rejections, ...deduped.rejections, ...floored.rejections],
  }
}
