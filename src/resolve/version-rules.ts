/**
 * Version and engine-range rules, in one place.
 *
 * Format 1 is strict about both, and both are reachable from a repository's own
 * `package.json`: `version` must be an EXACT SemVer (`1.0` and `v1.0.0` are
 * both refused), and `engines.dsh` must be a SemVer range without a
 * `workspace:` protocol — which is what a package developed inside a monorepo
 * naturally declares, and which means nothing to a user installing from npm.
 *
 * Why this needs its own module rather than a check at the point of use: the
 * same two facts arrive by two routes. Live resolution reads them from the
 * manifest; a cached resolution replays them from `data/resolve-cache.json`.
 * A rule enforced on only one route is a rule that a stale cache can bypass,
 * and the failure is total — the format rejects the whole document, not the
 * entry — so both routes call this.
 */
import semver from 'semver'

/**
 * The SemVer 2.0.0 grammar, anchored.
 *
 * Deliberately not `semver.valid()`, which is lenient in two ways that matter
 * here: it accepts a `v` prefix and surrounding whitespace, returning the
 * cleaned version rather than rejecting the input. Format 1 anchors its own
 * pattern, so `v1.0.0` and ` 1.0.0` are both refused — and because the failure
 * is a whole-document validation error, one lenient acceptance costs the entire
 * index rather than one entry.
 */
const EXACT_SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:(?:0|[1-9]\d*)|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:(?:0|[1-9]\d*)|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/u

/**
 * Test a version string.
 * @param version - the candidate version.
 * @returns `undefined` when it is exact SemVer, otherwise why it is not.
 */
export function versionProblem(version: string): string | undefined {
  if (version.trim() === '') return 'version is empty'
  if (version !== version.trim()) return `version has surrounding whitespace: ${JSON.stringify(version)}`
  if (!EXACT_SEMVER.test(version)) {
    // `validRange` is a poor "is this a range?" probe on its own: it tolerates
    // the same `v` prefix this rule exists to reject, so it reports `v1.0.0` —
    // a version, not a range — as a range and sends the reader looking for a
    // range that is not there. A range comparison operator in the string is the
    // signal that actually distinguishes the two, and it is the one an operator
    // debugging a manifest will recognise.
    const looksLikeRange = /[\s^~<>=*|]|^\d+(\.\d+)*\s*-\s*/u.test(version) || /^[xX*]$/u.test(version)
    return looksLikeRange
      ? `must be an exact SemVer version, not a range: ${JSON.stringify(version)}`
      : `not an exact SemVer version: ${JSON.stringify(version)}`
  }
  return undefined
}

/** The format rejects a publish time at or beyond this bound, in Unix seconds. */
export const MAX_PUBLISH_TIMESTAMP = 1e11

/**
 * Test a publish timestamp.
 * @param value - Unix seconds.
 * @returns `undefined` when usable, otherwise why it is not.
 */
export function publishTimestampProblem(value: number): string | undefined {
  if (!Number.isInteger(value)) return `publish timestamp must be an integer number of Unix seconds (got ${String(value)})`
  if (value < 0) return `publish timestamp must not be negative (got ${String(value)})`
  if (value >= MAX_PUBLISH_TIMESTAMP) {
    return `publish timestamp must be below ${String(MAX_PUBLISH_TIMESTAMP)} (got ${String(value)})`
  }
  return undefined
}

/**
 * Test a declared DSH version range.
 * @param range - the `engines.dsh` value, or `undefined` when absent.
 * @returns `undefined` when usable or absent, otherwise why it is not.
 */
export function dshRangeProblem(range: string | undefined): string | undefined {
  if (range === undefined) return undefined
  if (range.trim() === '') return 'engines.dsh is present but empty'
  // The format refuses this outright, and it is the common monorepo idiom.
  if (range.startsWith('workspace:')) return 'engines.dsh must not be a workspace: range'
  if (semver.validRange(range) === null) {
    return `engines.dsh is not a SemVer range: ${JSON.stringify(range)}`
  }
  return undefined
}

/**
 * Test a value that the format requires to be a non-empty string.
 * @param value - the value to test.
 * @param what - field name for the message.
 * @returns `undefined` when usable, otherwise why it is not.
 */
export function requiredTextProblem(value: unknown, what: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') return `${what} must be a string`
  if (value.trim() === '') return `${what} is empty`
  return undefined
}

/** A Git commit, exactly as the format spells it. */
const COMMIT_SHA = /^[0-9a-f]{40}$/u

/**
 * Test one install source.
 *
 * The Git rules are worth spelling out because a Git source reaches the
 * document by two routes — freshly resolved from a repository, or replayed from
 * the resolution cache — and only the first of those is in this project's
 * control. A cache written by an older build, or edited by hand, is exactly the
 * kind of input that would otherwise carry a `?ref=` fragment or a short commit
 * straight into a published index and take the whole document down.
 *
 * @param source - the version's install source.
 * @returns `undefined` when usable, otherwise why it is not.
 */
export function sourceProblem(source: {
  readonly type: 'npm' | 'git'
  readonly url?: string
  readonly commit?: string
}): string | undefined {
  if (source.type === 'npm') return undefined

  const url = source.url
  if (url === undefined || url.trim() === '') return 'git source is missing a url'
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return `git source url is not an absolute URL: ${JSON.stringify(url)}`
  }
  if (parsed.protocol !== 'https:') return 'git source url must use https'
  if (parsed.username !== '' || parsed.password !== '') return 'git source url must not contain credentials'
  if (parsed.search !== '' || parsed.hash !== '') return 'git source url must not contain a query or fragment'
  // The format compares against the serialization, so anything the URL parser
  // would rewrite — a trailing slash, uppercase host, default port — breaks it.
  if (parsed.href !== url) return `git source url must be canonical (got ${JSON.stringify(url)}, canonical is ${JSON.stringify(parsed.href)})`
  if (!/^(?:\/[^/]+){2,}$/u.test(parsed.pathname)) {
    return 'git source url must name a repository with at least two path segments'
  }
  if (/\.(?:tgz|tar\.gz)$/iu.test(parsed.pathname)) {
    return 'git source url must name a repository, not a tarball'
  }

  const commit = source.commit
  if (commit === undefined || !COMMIT_SHA.test(commit)) {
    return `git source commit must be a lowercase 40-hex-digit SHA (got ${JSON.stringify(commit ?? null)})`
  }
  return undefined
}
