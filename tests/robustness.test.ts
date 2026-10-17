/**
 * Defense in depth: what happens when one candidate is malformed.
 *
 * `unrenderableReason` is the pipeline's last line of defence. A document that
 * reaches `validateIndex` with a bad member fails as a whole, so a single
 * repository with an unusual manifest can take down the entire index, and the
 * failure surfaces as "the build broke", not "this one entry is odd".
 *
 * Three bands, and the tests say which is which:
 *
 *   - GATE — the input is dropped by `unrenderableReason`, so the run continues
 *     and the report names the entry. This is the required behaviour.
 *   - BACKSTOP — the gate misses it, but `renderIndex` refuses to build a
 *     document from it. No invalid index is published, but the run still aborts.
 *   - GAP — the input reaches `parseMarketIndex` and fails there, taking every
 *     other plugin down with it. These are written as RED assertions so they
 *     fail the moment the rule is tightened.
 */

import { describe, expect, it } from 'vitest'
import { MarketIndexError, parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index'
import {
  TEST_INDEX_URL,
  fixtureJson,
  lazySrc,
  loadSrc,
  skipIfMissing,
  type RenderModule,
  type TestCandidate,
  type TestProfile,
} from './helpers/harness.js'

const render = await loadSrc<RenderModule>('render/index.ts')

const profile: TestProfile = {
  id: 'index',
  title: { en: 'T' },
  sources: ['s'],
  minStars: 0,
  output: 'index.json',
}

function candidate(name: string, overrides: Partial<TestCandidate> = {}): TestCandidate {
  return {
    name,
    keywords: [],
    labels: [],
    sortKeys: {},
    versions: [{ version: '1.0.0', publishTimestamp: 1_700_000_000, source: { type: 'npm' } }],
    provenance: ['s'],
    ...overrides,
  }
}

/** A candidate whose single version carries the given override. */
function withVersion(
  version: Partial<TestCandidate['versions'][number]>,
  overrides: Partial<TestCandidate> = {},
): TestCandidate {
  return candidate('dsh-x', {
    versions: [
      { version: '1.0.0', publishTimestamp: 1_700_000_000, source: { type: 'npm' }, ...version },
    ],
    ...overrides,
  })
}

interface Assessment {
  /** The gate's reason, when it dropped the candidate. */
  readonly dropped?: string
  /** What `renderIndex` did, when the gate let the candidate through. */
  readonly render?: string
  /** What the format's own validator said, when a document was produced. */
  readonly validator?: string
}

/**
 * Run the exact sequence the pipeline runs: gate, then render, then validate.
 * Names the band the input fell into rather than collapsing everything into
 * "an error happened".
 */
function assess(cand: TestCandidate): Assessment {
  const reason = render!.unrenderableReason(cand)
  if (reason !== undefined) return { dropped: reason }

  let document: unknown
  try {
    document = render!.renderIndex([cand], profile)
  } catch (error) {
    return { render: `${(error as Error).constructor.name}: ${(error as Error).message}` }
  }

  try {
    parseMarketIndex(document, TEST_INDEX_URL)
    return { validator: 'ACCEPTED' }
  } catch (error) {
    if (error instanceof MarketIndexError) return { validator: `${error.path} ${error.reason}` }
    throw error
  }
}

describe.skipIf(skipIfMissing(render))('GATE: the pipeline drops what would break the index', () => {
  it.each([
    ['uppercase repository name', 'DragView'],
    ['scope with uppercase', '@Scope/pkg'],
    ['a space', 'has space'],
    ['a leading dot', '.dot'],
    ['an over-long name', 'd'.repeat(215)],
  ])('drops %s', (_label, name) => {
    const result = assess(candidate(name))
    expect(result.dropped, 'the gate must drop this').toBeDefined()
    expect(result.validator).toBeUndefined()
  })

  it('drops an empty versions array', () => {
    expect(assess(candidate('dsh-x', { versions: [] })).dropped).toBeDefined()
  })

  it.each([-1, -0.5, NaN, 1.5, Infinity, 1e11, 1e11 + 1])(
    'drops publishTimestamp %s',
    (ts) => {
      expect(assess(withVersion({ publishTimestamp: ts })).dropped).toBeDefined()
    },
  )

  it('drops an empty author', () => {
    expect(assess(candidate('dsh-author', { author: '' })).dropped).toMatch(/author/i)
  })

  it('drops an empty homepage', () => {
    expect(assess(candidate('dsh-home', { homepage: '' })).dropped).toMatch(/homepage/i)
  })

  it('drops a non-string keyword', () => {
    const result = assess(candidate('dsh-kw', { keywords: ['ok', 42 as unknown as string] }))
    expect(result.dropped).toMatch(/keyword/i)
  })

  it('drops an empty-string label', () => {
    expect(assess(candidate('dsh-label', { labels: [''] })).dropped).toMatch(/label/i)
  })

  it('drops a non-string label', () => {
    expect(
      assess(candidate('dsh-label2', { labels: [7 as unknown as string] })).dropped,
    ).toMatch(/label/i)
  })

  it.each(['1.0', 'workspace:*', 'latest', '1.0.0.0', '01.0.0'])(
    'drops the non-exact-SemVer version %s',
    (version) => {
      const result = assess(withVersion({ version }))
      expect(result.dropped, `${version} must be dropped`).toBeDefined()
      expect(result.validator).toBeUndefined()
    },
  )

  it('drops a workspace: engines.dsh range', () => {
    const result = assess(withVersion({ dshRange: 'workspace:*' }))
    expect(result.dropped).toMatch(/workspace/i)
  })

  it('drops an unparseable engines.dsh range', () => {
    expect(assess(withVersion({ dshRange: 'not a range' })).dropped).toMatch(/SemVer range/i)
  })

  it('drops an empty-string engines.dsh range', () => {
    expect(assess(withVersion({ dshRange: '' })).dropped).toBeDefined()
  })

  it.each(['^1.0.0', '>=0.1.0 <2', '*', '1.0.0 - 2.0.0'])(
    'keeps the valid engines.dsh range %s',
    (dshRange) => {
      expect(assess(withVersion({ dshRange })).validator).toBe('ACCEPTED')
    },
  )

  it('keeps a plain candidate and a .git-suffixed git URL', async () => {
    expect(assess(candidate('dsh-plain')).validator).toBe('ACCEPTED')
    expect(
      assess(
        withVersion({
          source: { type: 'git', url: 'https://github.com/o/r.git', commit: 'a'.repeat(40) },
        }),
      ).validator,
    ).toBe('ACCEPTED')
  })
})

describe.skipIf(skipIfMissing(render))('BACKSTOP: renderIndex refuses to build a bad document', () => {
  it('throws rather than returning a document the format rejects', () => {
    const bad = withVersion({ version: '1.0' })
    expect(() => render!.renderIndex([bad], profile)).toThrow()
  })

  it('names the offending candidate in the error, so the report is actionable', () => {
    const bad = withVersion({ version: '1.0' })
    let message = ''
    try {
      render!.renderIndex([bad], profile)
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toContain('dsh-x')
  })

  it('does not throw MarketIndexError — that is the gate, and it never ran', () => {
    // The distinction matters for the CLI: a MarketIndexError is reported as
    // "REFUSING TO PUBLISH"; a backstop failure is a bug in this project.
    const bad = withVersion({ version: '1.0' })
    let thrown: unknown
    try {
      render!.renderIndex([bad], profile)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(TypeError)
    expect(thrown).not.toBeInstanceOf(MarketIndexError)
  })

  it('shows the blast radius if it had NOT thrown: one candidate fails the whole document', () => {
    // Not a gap in this project — it is what the format demands — but it is why
    // the gate must be exhaustive rather than best-effort.
    const document = {
      format: 1,
      title: { en: 'T' },
      metadata: {},
      plugins: [
        { name: 'dsh-good', metadata: {}, versions: [
          { version: '1.0.0', publishTimestamp: 1, source: { type: 'npm' } },
        ] },
        { name: 'dsh-bad', metadata: {}, versions: [
          { version: '1.0', publishTimestamp: 1, source: { type: 'npm' } },
        ] },
      ],
    }
    let path = ''
    try {
      parseMarketIndex(document, TEST_INDEX_URL)
    } catch (error) {
      path = (error as MarketIndexError).path
    }
    expect(path).toBe('$.plugins[1].versions[0].version')
  })
})

/**
 * The `v`-prefix and whitespace divergences, now closed.
 *
 * These were the last gaps: `semver.valid('v1.0.0')` returns `'1.0.0'` and
 * `semver.valid(' 1.0.0 ')` returns `'1.0.0'`, because node-semver deliberately
 * tolerates both. Format 1 anchors its own grammar and refuses both, so a gate
 * built on `semver.valid` alone would have let them through and lost the whole
 * index. `versionProblem` now tests an anchored SemVer 2.0.0 pattern instead.
 */
describe.skipIf(skipIfMissing(render))('GATE: version grammar edge cases (was GAP A and B, now closed)', () => {
  it.each([
    ['a v prefix', 'v1.0.0'],
    ['a v prefix on a prerelease', 'v1.0.0-rc.1'],
    ['leading whitespace', ' 1.0.0'],
    ['trailing whitespace', '1.0.0 '],
    ['surrounding whitespace', ' 1.0.0 '],
    ['a tab', '\t1.0.0'],
    ['a newline', '1.0.0\n'],
  ])('drops %s', (_label, version) => {
    const result = assess(withVersion({ version }))
    expect(result.dropped, `${JSON.stringify(version)} must be dropped by the gate`).toBeDefined()
    expect(result.render, 'the backstop must not be needed').toBeUndefined()
    expect(result.validator).toBeUndefined()
  })

  it('records why semver.valid is not a sufficient test', async () => {
    const semver = (await import('semver')).default
    // Lenient in exactly the two ways the format is not.
    expect(semver.valid('v1.0.0')).toBe('1.0.0')
    expect(semver.valid(' 1.0.0 ')).toBe('1.0.0')
    // And it strips build metadata from its RETURN value, even though the
    // format accepts it — so `valid(v) === v` would be wrong in the other
    // direction. Only the format's own anchored grammar is authoritative.
    expect(semver.valid('1.0.0+build')).toBe('1.0.0')
    expect(assess(withVersion({ version: '1.0.0+build' })).validator).toBe('ACCEPTED')
  })

  it('keeps every version shape the format accepts', () => {
    for (const version of ['1.0.0', '0.0.0', '1.0.0-rc.1', '1.0.0+build.1', '1.0.0-rc.1+b']) {
      const result = assess(withVersion({ version }))
      expect(result.dropped, `${version} must be accepted`).toBeUndefined()
      expect(result.validator, `${version} must validate`).toBe('ACCEPTED')
    }
  })
})

/**
 * Deny-list coverage: `deepseek-ai/deepseek-harness` must never be listed.
 *
 * These cases are the ones that caught a real defect. The deny rule used to
 * read `candidate.repository`, a display field format 1 constrains to canonical
 * `https://github.com/…` URLs. A candidate derived from npm's `git+https://…`
 * form, an SSH URL, or a non-GitHub host therefore carried no `repository` at
 * all, so the rule saw nothing and let the entry through — it failed OPEN, in
 * the direction where the surviving entry is the one a visitor would notice.
 *
 * The fix: `Candidate.sourceUrl` keeps the URL exactly as the source published
 * it, and the rule derives identity from every URL the candidate carries. The
 * assertions below previously documented the fail-open behaviour as a known
 * gap; they now assert that the gap is closed, and would fail if it reopened.
 */

const policyModule = await loadSrc<any>('policy/filter.ts')
const upstreamModule = await loadSrc<any>('sources/upstream-catalog.ts')

describe.skipIf(skipIfMissing(policyModule))('denyRepos: which URL shapes the rule can see', () => {
  const policy = lazySrc(policyModule, 'policy/filter.ts')
  const upstream = lazySrc(upstreamModule, 'sources/upstream-catalog.ts')

  function config(denyRepos: string[]) {
    return {
      sources: [{ id: 's', kind: 'upstream-catalog', enabled: true, minStars: 0, priority: 1 }],
      profiles: [{ id: 'p', title: { en: 'P' }, sources: ['s'], minStars: 0, output: 'p.json' }],
      denyRepos,
      denyPackages: [],
    }
  }

  /**
   * Build the candidate exactly as the pipeline does: through the real upstream
   * transform + npm resolver. That matters because the resolved `repository`
   * field is what `applyDenyLists` inspects, and `npmCandidate` only sets it
   * when the URL decomposes as a GitHub repository.
   */
  function candidateFor(url: string) {
    const raw = {
      plugins: [
        {
          name: 'deepseek-harness',
          owner: 'deepseek-ai',
          url,
          npm: 'deepseek-harness',
          version: '1.0.0',
          added: '2026-01-01',
        },
      ],
    }
    const source = upstream.parseUpstreamCatalog(raw, { sourceId: 's', minStars: 0 })
    expect(source.candidates, `fixture entry for ${url} must convert`).toHaveLength(1)
    return source.candidates[0]
  }

  const DENY = ['deepseek-ai/deepseek-harness']

  it.each([
    ['exact GitHub URL', 'https://github.com/deepseek-ai/deepseek-harness'],
    ['different case', 'https://github.com/DeepSeek-AI/DeepSeek-Harness'],
    ['monorepo subpath', 'https://github.com/deepseek-ai/deepseek-harness/tree/main/packages/x'],
    ['a trailing slash', 'https://github.com/deepseek-ai/deepseek-harness/'],
  ])('denies %s', (_label, url) => {
    const result = policy.applyPolicy([candidateFor(url)], config(DENY), 0)
    expect(result.candidates).toEqual([])
    expect(result.rejections).toHaveLength(1)
  })

  it('denies a non-GitHub host', () => {
    const url = 'https://gitlab.com/deepseek-ai/deepseek-harness'
    const result = policy.applyPolicy([candidateFor(url)], config(DENY), 0)
    // The candidate carries no `repository` field for this URL shape, which is
    // precisely what used to make the rule fail open. Identity now comes from
    // the source URL too.
    expect(candidateFor(url).repository).toBeUndefined()
    expect(result.candidates).toEqual([])
    expect(result.rejections).toHaveLength(1)
  })

  it("denies npm's git+https URL form", () => {
    const url = 'git+https://github.com/deepseek-ai/deepseek-harness.git'
    const result = policy.applyPolicy([candidateFor(url)], config(DENY), 0)
    expect(result.candidates).toEqual([])
    expect(result.rejections).toHaveLength(1)
  })

  it('denies the SCP-like SSH form, which `new URL` cannot parse', () => {
    const url = 'git@github.com:deepseek-ai/deepseek-harness.git'
    const result = policy.applyPolicy([candidateFor(url)], config(DENY), 0)
    expect(result.candidates).toEqual([])
    expect(result.rejections).toHaveLength(1)
  })

  it('keeps a third-party plugin whose repository merely starts with the denied name', () => {
    // The deny list is an exact `owner/repo` match, not a prefix match: 45 live
    // entries mention deepseek-harness in their URL and all are third-party.
    const url = 'https://github.com/pengyue-polaron/deepseek-harness-genui'
    const result = policy.applyPolicy([candidateFor(url)], config(DENY), 0)
    expect(result.candidates).toHaveLength(1)
    expect(result.rejections).toEqual([])
  })

  it('records that the live catalog is all github.com, so the gap was latent', () => {
    // Verified in RECON.md: every one of the 5,704 recorded entries is a plain
    // https://github.com/owner/repo URL, and none is owned by deepseek-ai. The
    // defect needed a differently-shaped source URL to become active — which is
    // why it had to be fixed before a second source adapter landed.
    const meta = fixtureJson<{ reconCounts: Record<string, number> }>('meta.json')
    expect(meta.reconCounts['entriesOwnedBy_deepseek_ai']).toBe(0)
    expect(meta.reconCounts['uniqueOwnerRepoPairs']).toBe(5505)
  })
})
