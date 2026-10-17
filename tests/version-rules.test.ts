/**
 * The version, timestamp, range and source rules, tested directly.
 *
 * These four rules live in `src/resolve/version-rules.ts` because the same
 * facts arrive by two routes — a live `package.json` read and a replay from
 * `data/resolve-cache.json` — and a rule enforced on only one route is a rule a
 * stale cache bypasses. `robustness.test.ts` proves the routes agree through the
 * pipeline gate; this suite pins the rules themselves, so a future refactor of
 * either route fails here with an unambiguous message.
 *
 * Every boundary is asserted from both sides. A rule that only reports what it
 * rejects is satisfied by `return 'nope'`; a rule that also accepts exactly the
 * right neighbouring value is not.
 */

import { describe, expect, it } from 'vitest'
import { loadSrc, skipIfMissing } from './helpers/harness.js'

interface VersionRulesModule {
  versionProblem(version: string): string | undefined
  publishTimestampProblem(value: unknown): string | undefined
  dshRangeProblem(range: string | undefined): string | undefined
  sourceProblem(source: unknown): string | undefined
  readonly MAX_PUBLISH_TIMESTAMP: number
}

const rules = await loadSrc<VersionRulesModule>('resolve/version-rules.ts')

describe.skipIf(skipIfMissing(rules))('versionProblem: exact SemVer only', () => {
  const r = rules!

  it.each([
    '1.0.0',
    '0.0.0',
    '10.20.30',
    '1.0.0-rc.1',
    '1.0.0-alpha.beta.1',
    '1.0.0-0',
    '1.0.0+build.1',
    '1.0.0-rc.1+build.2',
    '0.2.1-alpha.2',
  ])('accepts %s', (version) => {
    expect(r.versionProblem(version)).toBeUndefined()
  })

  it.each([
    ['a v prefix', 'v1.0.0'],
    ['a v prefix on a prerelease', 'v1.0.0-rc.1'],
    ['leading whitespace', ' 1.0.0'],
    ['trailing whitespace', '1.0.0 '],
    ['surrounding whitespace', ' 1.0.0 '],
    ['a tab', '\t1.0.0'],
    ['a newline', '1.0.0\n'],
    ['two segments', '1.0'],
    ['four segments', '1.0.0.0'],
    ['a leading zero', '01.0.0'],
    ['a leading zero in the minor', '1.01.0'],
    ['an empty string', ''],
    ['only whitespace', '   '],
    ['a caret range', '^1.0.0'],
    ['a tilde range', '~1.0.0'],
    ['a comparator range', '>=1.0.0'],
    ['an x-range', '1.x'],
    ['a wildcard', '*'],
    ['a dist-tag', 'latest'],
    ['a workspace protocol', 'workspace:*'],
    ['a git url', 'git+https://github.com/o/r.git'],
  ])('rejects %s', (_label, version) => {
    expect(r.versionProblem(version)).toBeDefined()
  })

  /**
   * The regression this module exists for.
   *
   * `semver.valid` is lenient in two ways the format is not, and lenient in a
   * third way that means `semver.valid(v) === v` is not a correct strict test
   * either. If this suite ever changes to use `semver.valid`, these assertions
   * are what will catch it.
   */
  it('is stricter than semver.valid where the format is stricter', async () => {
    const semver = (await import('semver')).default
    // semver tolerates a v prefix and surrounding whitespace; the format does not.
    expect(semver.valid('v1.0.0')).toBe('1.0.0')
    expect(semver.valid(' 1.0.0 ')).toBe('1.0.0')
    expect(r.versionProblem('v1.0.0')).toBeDefined()
    expect(r.versionProblem(' 1.0.0 ')).toBeDefined()
  })

  it('is NOT stricter than semver.valid about build metadata, which is legal', async () => {
    const semver = (await import('semver')).default
    // semver.valid strips build metadata from its return value...
    expect(semver.valid('1.0.0+build')).toBe('1.0.0')
    // ...so `valid(v) === v` would wrongly reject a legal version. The rule
    // must not copy that mistake.
    expect(r.versionProblem('1.0.0+build')).toBeUndefined()
  })

  /**
   * The range/malformed distinction, which was reported as a diagnostic defect
   * and has since been fixed.
   *
   * The probe used to be `semver.validRange`, which is lenient in the same way
   * `semver.valid` is: it accepts a `v` prefix and a partial version. So
   * `v1.0.0` and `1.0` — neither of them a range — were explained as
   * "must be an exact SemVer version, not a range", sending the reader looking
   * for a range that was not there. The rule now tests for actual range syntax
   * instead, and this suite pins that distinction.
   *
   * The `semver.validRange` demonstrations are kept on purpose: they are the
   * clearest justification for why the probe is hand-written rather than
   * delegated to node-semver.
   */
  it('does not mislabel a v-prefixed or partial version as a range', async () => {
    const semver = (await import('semver')).default

    // Ranges, in the forms an operator actually writes.
    for (const range of ['^1.0.0', '~1.0.0', '>=1.0.0', '*', '1.0.0 - 2.0.0']) {
      expect(r.versionProblem(range), `${range} is a range`).toMatch(/not a range/i)
    }

    // Not ranges, even though `semver.validRange` accepts them — this is the
    // exact leniency that produced the mislabel.
    for (const version of ['v1.0.0', '1.0']) {
      expect(semver.validRange(version), `${version} parses as a range to semver`).not.toBeNull()
      expect(r.versionProblem(version), `${version} is not a range`)
        .not.toMatch(/not a range/i)
      expect(r.versionProblem(version), `${version} is still rejected`)
        .toMatch(/not an exact SemVer/i)
    }

    // `latest` is malformed to both `validRange` and the rule.
    expect(semver.validRange('latest')).toBeNull()
    expect(r.versionProblem('latest')).not.toMatch(/not a range/i)
    expect(r.versionProblem('latest')).toMatch(/not an exact SemVer/i)

    // Whitespace has its own, earlier check, so it is never called a range.
    expect(r.versionProblem(' 1.0.0 ')).toMatch(/whitespace/i)
    expect(r.versionProblem(' 1.0.0 ')).not.toMatch(/not a range/i)
  })
})

describe.skipIf(skipIfMissing(rules))('publishTimestampProblem: [0, 1e11)', () => {
  const r = rules!

  it('declares the bound the format uses', () => {
    expect(r.MAX_PUBLISH_TIMESTAMP).toBe(1e11)
  })

  it.each([0, 1, 1_700_000_000, 99_999_999_999])('accepts %s', (value) => {
    expect(r.publishTimestampProblem(value)).toBeUndefined()
  })

  it('accepts the exact upper boundary minus one', () => {
    expect(r.publishTimestampProblem(r.MAX_PUBLISH_TIMESTAMP - 1)).toBeUndefined()
  })

  // The 1e11 upper bound was the missing half of this rule: each of these was
  // accepted before, reached the document, and aborted the whole run.
  it.each([1e11, 1e11 + 1, Number.MAX_SAFE_INTEGER, 1e15])('rejects %s', (value) => {
    expect(r.publishTimestampProblem(value)).toBeDefined()
  })

  it.each([-1, -0.5, 1.5, NaN, Infinity, -Infinity])('rejects %s', (value) => {
    expect(r.publishTimestampProblem(value)).toBeDefined()
  })

  it.each([undefined, null, '1700000000', {}, []])('rejects the non-number %s', (value) => {
    // The parameter is typed as a number, but a value arriving from JSON.parse
    // is not: the rule must survive being handed something else.
    expect(r.publishTimestampProblem(value as unknown as number)).toBeDefined()
  })

  it('states the bound in its rejection message', () => {
    expect(r.publishTimestampProblem(1e11)).toContain('100000000000')
  })
})

describe.skipIf(skipIfMissing(rules))('dshRangeProblem: a non-workspace SemVer range', () => {
  const r = rules!

  it('accepts an absent range', () => {
    expect(r.dshRangeProblem(undefined)).toBeUndefined()
  })

  it.each(['^1.0.0', '~1.0.0', '>=0.1.0 <2', '*', '1.0.0 - 2.0.0', '>=0.1.2-alpha.2 <0.3.0-0'])(
    'accepts %s',
    (range) => {
      expect(r.dshRangeProblem(range)).toBeUndefined()
    },
  )

  it.each([
    ['the workspace protocol', 'workspace:*'],
    ['a workspace caret', 'workspace:^1.0.0'],
    ['an empty string', ''],
    ['only whitespace', '   '],
    ['a malformed range', 'not a range'],
    ['an arbitrary word', 'nonsense'],
  ])('rejects %s', (_label, range) => {
    expect(r.dshRangeProblem(range)).toBeDefined()
  })

  it('names the workspace protocol in its message, because it is the common case', () => {
    expect(r.dshRangeProblem('workspace:*')).toMatch(/workspace/i)
  })
})

describe.skipIf(skipIfMissing(rules))('sourceProblem: a canonical https git source', () => {
  const r = rules!
  const commit = 'a'.repeat(40)

  function git(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return { type: 'git', url: 'https://github.com/o/r', commit, ...overrides }
  }

  it('accepts a clean git source, with or without a .git suffix', () => {
    expect(r.sourceProblem(git())).toBeUndefined()
    expect(r.sourceProblem(git({ url: 'https://github.com/o/r.git' }))).toBeUndefined()
  })

  it('accepts a package path inside the repository', () => {
    expect(r.sourceProblem(git({ path: 'packages/x' }))).toBeUndefined()
    expect(r.sourceProblem(git({ path: 'a/b/c' }))).toBeUndefined()
  })

  it('accepts an npm source', () => {
    expect(r.sourceProblem({ type: 'npm' })).toBeUndefined()
    expect(r.sourceProblem({ type: 'npm', registry: 'https://registry.npmjs.org' })).toBeUndefined()
  })

  it.each([
    ['a query string', 'https://github.com/o/r?tab=readme'],
    ['a fragment', 'https://github.com/o/r#readme'],
    ['both', 'https://github.com/o/r?a=1#b'],
  ])('rejects a url carrying %s', (_label, url) => {
    expect(r.sourceProblem(git({ url }))).toBeDefined()
  })

  it.each([
    ['uppercase', 'A'.repeat(40)],
    ['too short', 'abc123'],
    ['39 characters', 'a'.repeat(39)],
    ['41 characters', 'a'.repeat(41)],
    ['non-hex', 'z'.repeat(40)],
    ['missing', undefined],
  ])('rejects a commit that is %s', (_label, value) => {
    expect(r.sourceProblem(git({ commit: value }))).toBeDefined()
  })

  it.each([
    ['no url', { type: 'git', commit }],
    ['an http url', git({ url: 'http://github.com/o/r' })],
    ['a non-canonical url', git({ url: 'https://github.com/o/r/' })],
    ['credentials', git({ url: 'https://user:pw@github.com/o/r' })],
    ['a single path segment', git({ url: 'https://github.com/o' })],
    ['a tarball', git({ url: 'https://github.com/o/r.tgz' })],
    ['a gzipped tarball', git({ url: 'https://github.com/o/r.tar.gz' })],
    ['an unknown type', { type: 'svn', url: 'https://github.com/o/r' }],
    ['no type', { url: 'https://github.com/o/r' }],
  ])('rejects %s', (_label, source) => {
    expect(r.sourceProblem(source as { type: 'npm' | 'git' })).toBeDefined()
  })

  it('ignores `path`: that rule belongs to the renderer, not the source', () => {
    // Documented boundary. `sourceProblem` judges the install source; the
    // safety of `path` as a POSIX directory is `safePath`'s job in render/.
    expect(r.sourceProblem(git({ path: '../etc' }))).toBeUndefined()
    expect(r.sourceProblem(git({ path: '' }))).toBeUndefined()
  })
})
