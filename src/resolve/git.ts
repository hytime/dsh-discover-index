/**
 * Git-resolved candidates.
 *
 * Entries that publish no npm package still have to name themselves, and the
 * only honest source of that name is the package manifest in the repository.
 * Guessing from the repository name is wrong twice over: repository names are
 * not unique across owners, and 225 of them in the current list carry uppercase
 * letters that an npm package name may not contain.
 *
 * Resolution costs two quota-free lookups per entry:
 *
 *   1. `git ls-remote <repo> HEAD` — the exact commit, which format 1 requires
 *      as a full 40-hex SHA. This is the Git protocol, not the GitHub API, so
 *      it spends none of the 5,000/hour REST budget the whole pipeline shares.
 *   2. `raw.githubusercontent.com/<owner>/<repo>/<sha>/<path>/package.json` —
 *      the manifest, read at that exact commit so the name, the version and the
 *      pinned SHA can never disagree with each other.
 *
 * Deliberately not done here: fetching the commit date. It would cost a third
 * request per entry to refine one sort key, and upstream already publishes the
 * date the entry joined the list. The caller passes that as the fallback.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Candidate, Rejection, ResolvedVersion } from '../types.js'
import { avatarUrl, decomposeRepoUrl, repoIdentity } from './urls.js'
import { packageNameProblem } from './package-name.js'
import { dshRangeProblem, versionProblem as versionProblemFor } from './version-rules.js'
import { fallbackTimestamp, type UpstreamEntry } from './npm.js'

// Re-exported because a caller resolving a git entry necessarily holds one of
// these, and making it import from two sibling modules to say so is noise.
export type { UpstreamEntry }

const run = promisify(execFile)

/** Injectable effects, so the resolver can be tested without a network or git. */
export interface GitDeps {
  /** Default-branch commit SHA, or `undefined` when the repository is unreachable. */
  readonly lsRemote: (repo: string) => Promise<string | undefined>
  /** File contents at an exact ref, or `undefined` on 404. */
  readonly fetchText: (url: string) => Promise<string | undefined>
}

/** The slice of a package manifest this resolver reads. */
interface Manifest {
  readonly name?: unknown
  readonly version?: unknown
  readonly dsh?: unknown
  readonly engines?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A `dsh.bundle` declaration is what makes a package installable at all. */
export function declaresBundle(manifest: Manifest): boolean {
  const dsh = manifest.dsh
  if (!isRecord(dsh)) return false
  const bundle = dsh.bundle
  if (!isRecord(bundle)) return false
  // `{ patch: './cordis.patch.yml' }` is the documented shape; a patch path is
  // the one member that has to be there for `dsh plugin add` to find the row.
  return typeof bundle.patch === 'string' && bundle.patch.trim() !== ''
}

/** `engines.dsh`, the version range the plugin declares it runs on. */
function dshRange(manifest: Manifest): string | undefined {
  const engines = manifest.engines
  if (!isRecord(engines)) return undefined
  const range = engines.dsh
  return typeof range === 'string' && range.trim() !== '' ? range : undefined
}

/**
 * Read the package name and version from a manifest.
 * @param manifest - parsed `package.json`.
 * @returns the identity, or `undefined` when either field is unusable.
 */
export function manifestIdentity(manifest: Manifest): { name: string; version: string } | undefined {
  const name = manifest.name
  const version = manifest.version
  if (typeof name !== 'string' || name.trim() === '') return undefined
  if (typeof version !== 'string' || version.trim() === '') return undefined
  return { name: name.trim(), version: version.trim() }
}

/**
 * Build a candidate from an already-resolved Git entry.
 * @param entry - normalized upstream entry.
 * @param resolved - the pinned SHA and the manifest identity read at it.
 * @param sourceId - provenance.
 * @returns the candidate, or `undefined` when the entry cannot be named.
 */
export function gitCandidate(
  entry: UpstreamEntry,
  resolved: { sha: string; packageName: string; version: string; directory?: string; dshRange?: string },
  sourceId: string,
): Candidate | undefined {
  const location = decomposeRepoUrl(entry.url)
  if (!location) return undefined
  if (!/^[0-9a-f]{40}$/.test(resolved.sha)) return undefined
  if (resolved.packageName.trim() === '' || resolved.version.trim() === '') return undefined
  // A manifest can declare any name it likes, including the repository's own
  // uppercase one. Format 1 requires a valid npm package name, so an illegal
  // name is refused HERE, at the point where it would enter the pipeline —
  // emitting it would fail validation later and take the whole index down.
  if (packageNameProblem(resolved.packageName) !== undefined) return undefined

  const directory = resolved.directory ?? location.directory
  const version: ResolvedVersion = {
    version: resolved.version,
    publishTimestamp: fallbackTimestamp(entry.added) ?? 0,
    source: {
      type: 'git',
      url: location.repo,
      commit: resolved.sha,
      ...(directory === undefined ? {} : { path: directory }),
    },
    ...(resolved.dshRange === undefined ? {} : { dshRange: resolved.dshRange }),
  }

  const sortKeys: Record<string, number> = {}
  if (entry.stars !== undefined) sortKeys.stars = entry.stars
  if (entry.downloads !== undefined) sortKeys.downloads = entry.downloads
  const added = fallbackTimestamp(entry.added)
  if (added !== undefined) sortKeys.added = added

  return {
    name: resolved.packageName,
    title: { en: entry.name, zh: entry.name },
    ...(entry.description === undefined ? {} : { description: entry.description }),
    author: entry.owner,
    homepage: entry.url,
    repository: directory === undefined ? { url: location.repo } : { url: location.repo, directory },
    // Kept for policy, which must see the URL the source published rather than
    // the canonical form above.
    sourceUrl: entry.url,
    ...(entry.category === undefined ? {} : { category: entry.category }),
    keywords: ['dsh', 'dsh-plugin', 'deepseek-harness'],
    labels: [],
    sortKeys,
    versions: [version],
    provenance: [sourceId],
  }
}

/** The manifest path inside the repository for an entry's package directory. */
export function manifestPath(directory: string | undefined): string {
  return directory === undefined ? 'package.json' : `${directory}/package.json`
}

/**
 * Resolve one entry that has no npm identity.
 *
 * Every failure is a `Rejection` rather than an empty candidate: format 1
 * requires a non-empty `versions` array, so a plugin whose version cannot be
 * established must be absent from the index, not present and uninstallable.
 *
 * @param entry - normalized upstream entry.
 * @param deps - injected git and HTTP effects.
 * @param sourceId - provenance.
 * @returns a candidate, or the reason it could not be built.
 */
export async function resolveGitEntry(
  entry: UpstreamEntry,
  deps: GitDeps,
  sourceId: string,
): Promise<Candidate | Rejection> {
  const identity = `${entry.owner}/${entry.name}`
  const location = decomposeRepoUrl(entry.url)
  if (!location) {
    return { id: identity, stage: 'resolve', reason: `not a GitHub repository URL: ${entry.url}` }
  }

  let sha: string | undefined
  try {
    sha = await deps.lsRemote(location.repo)
  } catch (error) {
    return { id: identity, stage: 'resolve', reason: `git ls-remote failed: ${error instanceof Error ? error.message : String(error)}` }
  }
  if (!sha || !/^[0-9a-f]{40}$/.test(sha)) {
    return { id: identity, stage: 'resolve', reason: 'repository unreachable, or HEAD did not resolve to a commit' }
  }

  const manifestUrl = `https://raw.githubusercontent.com/${location.owner}/${location.name}/${sha}/${manifestPath(location.directory)}`
  let text: string | undefined
  try {
    text = await deps.fetchText(manifestUrl)
  } catch (error) {
    return { id: identity, stage: 'resolve', reason: `manifest fetch failed: ${error instanceof Error ? error.message : String(error)}` }
  }
  if (text === undefined) {
    return {
      id: identity,
      stage: 'resolve',
      reason: `no package.json at ${location.directory ?? '<root>'} — cannot establish a package name`,
    }
  }

  let manifest: Manifest
  try {
    manifest = JSON.parse(text) as Manifest
  } catch {
    return { id: identity, stage: 'resolve', reason: 'package.json is not valid JSON' }
  }

  // The installability gate, checked for free because the manifest is already
  // in hand. Upstream vets this at submission; a repository can drop the
  // declaration later, and an index entry that cannot be installed is worse
  // than a missing one.
  if (!declaresBundle(manifest)) {
    return { id: identity, stage: 'resolve', reason: 'package.json declares no dsh.bundle manifest' }
  }

  const identityFields = manifestIdentity(manifest)
  if (!identityFields) {
    return { id: identity, stage: 'resolve', reason: 'package.json declares no usable name/version' }
  }

  // Named explicitly rather than left to the candidate builder, so the report
  // says which rule the repository broke instead of "did not form a candidate".
  const nameProblem = packageNameProblem(identityFields.name)
  if (nameProblem !== undefined) {
    return {
      id: identity,
      stage: 'resolve',
      reason: `package.json name is unusable: ${nameProblem}`,
    }
  }

  const range = dshRange(manifest)
  // Refused here as well as in the render gate, so the run report names the
  // repository and the field instead of a bare "unrenderable candidate". A
  // manifest version of `1.0` or an `engines.dsh` of `workspace:*` is common in
  // a monorepo and would otherwise abort the entire index.
  const versionProblem = versionProblemFor(identityFields.version)
  if (versionProblem !== undefined) {
    return { id: identity, stage: 'resolve', reason: `package.json version is unusable: ${versionProblem}` }
  }
  const rangeProblem = dshRangeProblem(range)
  if (rangeProblem !== undefined) {
    return { id: identity, stage: 'resolve', reason: `package.json ${rangeProblem}` }
  }
  const candidate = gitCandidate(
    entry,
    {
      sha,
      packageName: identityFields.name,
      version: identityFields.version,
      ...(location.directory === undefined ? {} : { directory: location.directory }),
      ...(range === undefined ? {} : { dshRange: range }),
    },
    sourceId,
  )
  if (!candidate) {
    return { id: identity, stage: 'resolve', reason: 'resolved facts did not form a valid candidate' }
  }
  return candidate
}

/**
 * Default effects: the Git protocol for the commit, plain HTTP for the file.
 * @param fetchText - fetch returning `undefined` on 404.
 * @returns the effects `resolveGitEntry` needs.
 */
export function defaultGitDeps(fetchText: (url: string) => Promise<string | undefined>): GitDeps {
  return {
    lsRemote: async (repo: string): Promise<string | undefined> => {
      // `--exit-code` is deliberately absent: a missing repository already
      // exits non-zero and is caught, and adding it would change nothing here.
      const { stdout } = await run('git', ['ls-remote', repo, 'HEAD'], { timeout: 30_000 })
      const first = stdout.trim().split('\n')[0]
      return first?.split(/\s+/)[0] || undefined
    },
    fetchText,
  }
}

/** Re-exported so callers can build repository display links consistently. */
export { avatarUrl, repoIdentity }
