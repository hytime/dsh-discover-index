/**
 * npm-published candidates.
 *
 * An entry that names an npm package is the cheapest and most reliable thing
 * in the whole pipeline: the package name is authoritative (it is the name the
 * registry actually serves), the version is exact, and installing from a
 * registry needs no build step on the user's machine. It is converted with no
 * network call at all.
 */
import semver from 'semver'
import type { Candidate, ResolvedVersion } from '../types.js'
import { avatarUrl, decomposeRepoUrl, repoIdentity } from './urls.js'
import { keywordsFor, labelsFor, popularityLabels } from './discovery.js'
import { MAX_PUBLISH_TIMESTAMP, dshRangeProblem, versionProblem } from './version-rules.js'

/** One normalized upstream entry. */
export interface UpstreamEntry {
  /** Repository URL, possibly pointing at a monorepo subdirectory. */
  readonly url: string
  /** Repository name as upstream displays it — NOT necessarily a package name. */
  readonly name: string
  readonly owner: string
  readonly category?: string
  readonly description?: Readonly<Record<string, string>>
  /** npm package name, when upstream resolved one. */
  readonly npm?: string
  readonly version?: string
  readonly stars?: number
  readonly downloads?: number
  /** ISO date the entry joined the list, used as a fallback publish time. */
  readonly added?: string
  /** Prebuilt release tarball, when the project publishes one. */
  readonly tarball?: string
  /**
   * Permission capabilities the upstream trust scan found, such as `fs-write`
   * or `network`. Upstream publishes these as a closed vocabulary of ids.
   */
  readonly capabilities?: readonly string[]
  /**
   * Trust findings from the same scan, as prose sentences. Normalised into
   * risk labels rather than published verbatim; see `resolve/discovery.ts`.
   */
  readonly redLines?: readonly string[]
  /** Discovery keywords the source itself published, when it has any. */
  readonly keywords?: readonly string[]
}

/**
 * Keywords true of every plugin in this market.
 *
 * Format 1 treats `metadata.keywords` as free text for discovery, and the
 * search engine indexes it. The identifier of the runtime is the useful
 * constant: a reader searching "dsh" or "harness" should match every entry.
 */
export const IDENTITY_KEYWORDS: readonly string[] = ['dsh', 'dsh-plugin', 'deepseek-harness']


/**
 * Upstream's date-only `added` field as Unix seconds.
 *
 * Format 1 wants an integer publish time and rejects anything outside
 * [0, 1e11). Upstream gives a calendar date, so midnight UTC is the best
 * available reading; the caller is expected to overwrite this with the real
 * registry time when it has one.
 *
 * @param added - ISO date such as `2026-08-14`.
 * @returns Unix seconds, or `undefined` when the date is unusable.
 */
export function fallbackTimestamp(added: string | undefined): number | undefined {
  if (!added) return undefined
  const parsed = Date.parse(added.length === 10 ? `${added}T00:00:00Z` : added)
  if (Number.isNaN(parsed)) return undefined
  const seconds = Math.floor(parsed / 1000)
  return seconds >= 0 && seconds < 1e11 ? seconds : undefined
}

/**
 * Numeric sort keys, which become the sort options Discover offers.
 *
 * Only present values are emitted: format 1 wants a numeric map, and writing
 * `0` for an unmeasured star count would sort unmeasured plugins below
 * genuinely unpopular ones and read as a fact rather than an absence.
 */
function sortKeys(entry: UpstreamEntry): Record<string, number> {
  const keys: Record<string, number> = {}
  if (entry.stars !== undefined) keys.stars = entry.stars
  if (entry.downloads !== undefined) keys.downloads = entry.downloads
  const added = fallbackTimestamp(entry.added)
  if (added !== undefined) keys.added = added
  return keys
}

/** Entry icon: the owner's GitHub avatar, which is an absolute https URL. */
function iconFor(entry: UpstreamEntry): string | undefined {
  const identity = repoIdentity(entry.url)
  return identity ? avatarUrl(entry.owner) : undefined
}

/**
 * Convert an entry that names an npm package.
 * @param entry - normalized upstream entry.
 * @param sourceId - which configured source produced it, recorded as provenance.
 * @returns the candidate, or `undefined` when the entry is not npm-installable.
 */
export function npmCandidate(entry: UpstreamEntry, sourceId: string): Candidate | undefined {
  if (!entry.npm || !entry.version) return undefined
  const publishTimestamp = fallbackTimestamp(entry.added) ?? 0
  const location = decomposeRepoUrl(entry.url)
  return {
    name: entry.npm,
    title: { en: entry.name, zh: entry.name },
    ...(entry.description === undefined ? {} : { description: entry.description }),
    author: entry.owner,
    homepage: entry.url,
    icon: iconFor(entry),
    // The URL the source published, kept verbatim for policy decisions. It is
    // deliberately separate from `repository` below, which format 1 constrains
    // to canonical https URLs and which is therefore absent for shapes such as
    // npm's `git+https://…` form. A deny rule that could only see `repository`
    // would fail open on exactly those shapes.
    sourceUrl: entry.url,
    ...(location === undefined
      ? {}
      : {
        repository: location.directory === undefined
          ? { url: location.repo }
          : { url: location.repo, directory: location.directory },
      }),
    ...(entry.category === undefined ? {} : { category: entry.category }),
    keywords: keywordsFor(IDENTITY_KEYWORDS, entry.category, entry.capabilities ?? [], entry.keywords ?? []),
    labels: [...labelsFor(entry.capabilities ?? [], entry.redLines ?? []), ...popularityLabels(entry.stars, entry.downloads)],
    sortKeys: sortKeys(entry),
    versions: [
      {
        version: entry.version,
        publishTimestamp,
        source: { type: 'npm' },
      },
    ],
    provenance: [sourceId],
  }
}

/**
 * Correct a candidate's publish timestamp from the registry's own `time` map.
 *
 * The registry is the authority on when a version was published; upstream's
 * `added` records when the *entry* joined the list, which is a different fact
 * and can trail the release by weeks. Applied as an enrichment so the pipeline
 * can run without registry access and still be correct when it has it.
 *
 * @param candidate - an npm candidate.
 * @param times - the packument's `time` map.
 * @returns a candidate whose versions carry registry publish times where known.
 */
export function withRegistryTimes(
  candidate: Candidate,
  times: Readonly<Record<string, string>> | undefined,
): Candidate {
  if (!times) return candidate
  const versions = candidate.versions.map((version) => {
    const published = times[version.version]
    if (!published) return version
    const seconds = Math.floor(Date.parse(published) / 1000)
    if (Number.isNaN(seconds) || seconds < 0 || seconds >= 1e11) return version
    return { ...version, publishTimestamp: seconds }
  })
  return { ...candidate, versions }
}

/**
 * The registry this project reads by default.
 *
 * The public registry, because the catalog's entries are public packages: the
 * `npm {}` registry field of a version only has to be recorded when it differs
 * from this one. Pointing it elsewhere is a configuration change, which is why
 * `runPipeline` takes it as an option.
 */
export const DEFAULT_REGISTRY = 'https://registry.npmjs.org/'

/**
 * The registry document URL for one package.
 *
 * A scoped name's `/` must be encoded but its `@` must not: the registry routes
 * `@scope%2Fname` and rejects `%40scope%2Fname` outright, which is the subtle
 * half of this otherwise boring function.
 *
 * @param registry - registry base URL, with or without a trailing slash.
 * @param name - exact npm package name.
 * @returns the absolute packument URL.
 */
export function packumentUrl(registry: string, name: string): string {
  const base = registry.endsWith('/') ? registry : `${registry}/`
  const encoded = name.startsWith('@')
    ? `@${encodeURIComponent(name.slice(1))}`
    : encodeURIComponent(name)
  return `${base}${encoded}`
}

/** The slice of a packument this module reads. */
interface Packument {
  readonly versions?: unknown
  readonly time?: unknown
  readonly 'dist-tags'?: unknown
}

/**
 * Every installable version of one npm package, newest first.
 *
 * Upstream's `plugins.json` names exactly one version per entry — the one its
 * own submitter picked — so a market built from it alone offers no version
 * history. That costs more than it looks: DSH's plugin page lists every version
 * it can install, refuses versions the running DSH does not satisfy through
 * `engines.dsh`, and falls back to a prerelease only when no plain version is
 * compatible. All three need more than one version to mean anything.
 *
 * The registry document carries the versions together with the two facts needed
 * to judge each: whether the version declares `dsh.bundle` at all (a version
 * without one is not installable and is skipped), and its publish time.
 *
 * Ordering is left to the caller's sort rather than fixed here: the validator
 * sorts each plugin's versions by descending SemVer precedence anyway, so this
 * returns them in document order and lets that rule own the guarantee.
 *
 * @param packument - the registry document for the package.
 * @param declaresBundle - whether a manifest declares `dsh.bundle`. Injected
 *   rather than imported because the check lives in `git.ts`, which already
 *   imports this module; importing it back would make the two cyclic.
 * @returns the installable versions, or an empty array when none qualify.
 */
export function versionsFromPackument(
  packument: unknown,
  declaresBundle: (manifest: unknown) => boolean,
): ResolvedVersion[] {
  if (typeof packument !== 'object' || packument === null || Array.isArray(packument)) return []
  const document = packument as Packument
  if (typeof document.versions !== 'object' || document.versions === null) return []
  const times = typeof document.time === 'object' && document.time !== null
    ? document.time as Record<string, unknown>
    : {}

  const out: ResolvedVersion[] = []
  for (const [version, manifest] of Object.entries(document.versions as Record<string, unknown>)) {
    // The version must be exact SemVer and carry a bundle declaration; anything
    // else is not a thing `dsh plugin add` can install, and format 1 would
    // reject the whole document over one bad entry.
    if (versionProblem(version) !== undefined) continue
    if (typeof manifest !== 'object' || manifest === null) continue
    const record = manifest as Record<string, unknown>
    if (!declaresBundle(manifest)) continue
    // A deprecated version still installs, but the maintainer has said it
    // should not be chosen; listing it in the version menu suggests otherwise.
    if (record['deprecated'] !== undefined) continue

    const published = times[version]
    const seconds = typeof published === 'string' ? Math.floor(Date.parse(published) / 1000) : Number.NaN
    if (Number.isNaN(seconds) || seconds < 0 || seconds >= MAX_PUBLISH_TIMESTAMP) continue

    const range = declaredDshRange(record)
    out.push({
      version,
      publishTimestamp: seconds,
      source: { type: 'npm' },
      ...(range === undefined ? {} : { dshRange: range }),
    })
  }
  return out
}

/** `engines.dsh` from a raw manifest record, when it is a usable range. */
function declaredDshRange(manifest: Readonly<Record<string, unknown>>): string | undefined {
  const engines = manifest['engines']
  if (typeof engines !== 'object' || engines === null || Array.isArray(engines)) return undefined
  const range = (engines as Record<string, unknown>)['dsh']
  if (typeof range !== 'string' || range.trim() === '') return undefined
  return dshRangeProblem(range) === undefined ? range.trim() : undefined
}

/**
 * Replace a candidate's single upstream version with the registry's full list.
 *
 * The upstream version is kept when the registry has nothing usable: an entry
 * whose package is unpublished, renamed, or temporarily unreachable is still a
 * real plugin, and dropping it would turn a registry hiccup into a missing
 * market entry. It is also kept when the registry document does not mention it,
 * because upstream may legitimately pin a version the registry no longer serves
 * and silently replacing it would change what the market installs.
 *
 * @param candidate - an npm candidate carrying one upstream version.
 * @param packument - the registry document, or `undefined` when unavailable.
 * @returns the candidate with every installable version, newest first.
 */
export function withPackument(
  candidate: Candidate,
  packument: unknown,
  declaresBundle: (manifest: unknown) => boolean,
): Candidate {
  const versions = versionsFromPackument(packument, declaresBundle)
  if (versions.length === 0) return candidate
  const upstream = candidate.versions[0]
  const complete = upstream !== undefined && !versions.some((version) => version.version === upstream.version)
    ? [...versions, upstream]
    : versions
  // Newest first, so the document reads the way the version menu shows it.
  // `semver.rcompare` is total over exact versions; a version it cannot parse
  // keeps its position rather than being dropped here — validation owns that.
  const sorted = [...complete].sort((left, right) => semver.rcompare(left.version, right.version))
  return { ...candidate, versions: sorted }
}
