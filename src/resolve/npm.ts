/**
 * npm-published candidates.
 *
 * An entry that names an npm package is the cheapest and most reliable thing
 * in the whole pipeline: the package name is authoritative (it is the name the
 * registry actually serves), the version is exact, and installing from a
 * registry needs no build step on the user's machine. It is converted with no
 * network call at all.
 */
import type { Candidate } from '../types.js'
import { avatarUrl, decomposeRepoUrl, repoIdentity } from './urls.js'

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
}

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
    ...(location === undefined
      ? {}
      : {
        repository: location.directory === undefined
          ? { url: location.repo }
          : { url: location.repo, directory: location.directory },
      }),
    ...(entry.category === undefined ? {} : { category: entry.category }),
    keywords: ['dsh', 'dsh-plugin', 'deepseek-harness'],
    labels: [],
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
