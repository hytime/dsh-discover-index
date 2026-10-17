/**
 * Policy: the rules that decide which resolved candidates reach the document.
 *
 *   case 1 — two candidates carrying the same package name. Format 1 requires
 *            the name to be unique across the index, so exactly one may
 *            survive, chosen by source priority and then by stars. The live
 *            catalog has 283 repository basenames shared across owners, 268 of
 *            them between root-level repositories, so this is not theoretical.
 *   case 5 — `deepseek-ai/deepseek-harness` is the product, not a plugin. The
 *            live catalog contained zero such entries on 2026-10-17, so the
 *            deny-list rule is exercised with a synthetic control entry.
 *
 * Star floors, deny lists and deterministic ordering are covered here too.
 * Every duplicate-name assertion is additionally run through the real
 * validator, because "unique name" is format 1's rule and not ours to restate.
 */

import { describe, expect, it } from 'vitest'
import {
  fixtureJson,
  lazySrc,
  loadSrc,
  nameRejectionPath,
  skipIfMissing,
  type PolicyModule,
  type TestCandidate,
  type TestProjectConfig,
  type TestRejection,
} from './helpers/harness.js'

const policy = await loadSrc<PolicyModule>('policy/filter.ts')

/** A candidate with sensible defaults; `name` is the only required input. */
function candidate(name: string, overrides: Partial<TestCandidate> = {}): TestCandidate {
  return {
    name,
    keywords: [],
    labels: [],
    sortKeys: {},
    versions: [
      { version: '1.0.0', publishTimestamp: 1_700_000_000, source: { type: 'npm' } },
    ],
    provenance: ['a-source'],
    ...overrides,
  }
}

/** A configuration with one source, no floors and no denies. */
function config(overrides: Partial<TestProjectConfig> = {}): TestProjectConfig {
  return {
    sources: [
      { id: 'a-source', kind: 'upstream-catalog', enabled: true, minStars: 0, priority: 10 },
    ],
    profiles: [
      {
        id: 'index',
        title: { en: 'Index' },
        sources: ['a-source'],
        minStars: 0,
        output: 'index.json',
      },
    ],
    denyRepos: [],
    denyPackages: [],
    ...overrides,
  }
}

/** Config carrying two sources at different priorities. */
function twoSources(): TestProjectConfig {
  return config({
    sources: [
      { id: 'low', kind: 'upstream-catalog', enabled: true, minStars: 0, priority: 20 },
      { id: 'high', kind: 'upstream-catalog', enabled: true, minStars: 0, priority: 5 },
    ],
  })
}

describe.skipIf(skipIfMissing(policy))('applyPolicy: duplicate package names (case 1)', () => {
  const policy_ = lazySrc(policy, 'policy/filter.ts')

  it('keeps exactly one candidate per package name', () => {
    const result = policy_.applyPolicy(
      [candidate('dsh-engram'), candidate('dsh-engram')],
      config(),
      0,
    )
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.name).toBe('dsh-engram')
  })

  it('reports the loser as a rejection rather than dropping it silently', () => {
    const result = policy_.applyPolicy(
      [
        candidate('dsh-engram', { sortKeys: { stars: 3 } }),
        candidate('dsh-engram', { sortKeys: { stars: 9 } }),
      ],
      config(),
      0,
    )
    expect(result.rejections.length).toBe(1)
    const rejection = result.rejections[0] as TestRejection
    expect(['source', 'resolve', 'policy']).toContain(rejection.stage)
    expect(rejection.reason.length).toBeGreaterThan(0)
  })

  it('lets the higher-priority source win over a more popular one', () => {
    const result = policy_.applyPolicy(
      [
        candidate('dsh-dup', { provenance: ['low'], sortKeys: { stars: 9000 } }),
        candidate('dsh-dup', { provenance: ['high'], sortKeys: { stars: 1 } }),
      ],
      twoSources(),
      0,
    )
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.provenance).toContain('high')
  })

  it('breaks a priority tie by stars, and a star tie deterministically', () => {
    const byStars = policy_.applyPolicy(
      [
        candidate('dsh-tie', { provenance: ['a-source'], sortKeys: { stars: 1 } }),
        candidate('dsh-tie', { provenance: ['a-source'], sortKeys: { stars: 500 } }),
      ],
      config(),
      0,
    )
    expect(byStars.candidates).toHaveLength(1)
    expect(byStars.candidates[0]?.sortKeys['stars']).toBe(500)

    // Same priority, same stars: the result must still be stable between runs.
    const first = policy_.applyPolicy(
      [candidate('dsh-x', { author: 'one' }), candidate('dsh-x', { author: 'two' })],
      config(),
      0,
    )
    const second = policy_.applyPolicy(
      [candidate('dsh-x', { author: 'one' }), candidate('dsh-x', { author: 'two' })],
      config(),
      0,
    )
    expect(first.candidates[0]?.author).toBe(second.candidates[0]?.author)
  })

  it('treats candidates with no stars as zero rather than crashing', () => {
    const result = policy_.applyPolicy(
      [
        candidate('dsh-nostars', { provenance: ['a-source'] }),
        candidate('dsh-nostars', { provenance: ['a-source'], sortKeys: { stars: 2 } }),
      ],
      config(),
      0,
    )
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.sortKeys['stars']).toBe(2)
  })

  it('keeps distinct names that share a repository basename, as the live catalog does', () => {
    // The real dsh-engram pair: kenz1117 publishes @kenz1117/dsh-engram,
    // skepsun publishes dsh-engram. Both are legal and both must survive.
    const result = policy_.applyPolicy(
      [candidate('@kenz1117/dsh-engram'), candidate('dsh-engram')],
      config(),
      0,
    )
    expect(result.candidates.map((entry) => entry.name).sort()).toEqual([
      '@kenz1117/dsh-engram',
      'dsh-engram',
    ])
    expect(result.rejections).toEqual([])
  })

  it('produces a plugin list the real validator accepts, for a duplicate-heavy input', async () => {
    // The end-to-end statement of case 1: after policy, a document built from
    // the survivors passes format 1. Building it here with the validator's own
    // shape keeps this assertion independent of the renderer.
    const input = [
      candidate('dsh-engram'),
      candidate('dsh-engram'),
      candidate('@kenmicheng/dsh-pua'),
      candidate('@panando/dsh-pua'),
      candidate('dsh-pua'),
      candidate('dsh-pua'),
    ]
    const result = policy_.applyPolicy(input, config(), 0)
    const names = result.candidates.map((entry) => entry.name)
    expect(new Set(names).size).toBe(names.length)

    for (const name of names) {
      expect(await nameRejectionPath(name)).toBeUndefined()
    }

    // Reconstruct a document and let the authority confirm uniqueness.
    const { parseMarketIndex } = await import('@deepseek-ai/dsh-plugin-market-index')
    const parsed = parseMarketIndex(
      {
        format: 1,
        title: { en: 'Index' },
        metadata: {},
        plugins: result.candidates.map((entry) => ({
          name: entry.name,
          metadata: {},
          versions: entry.versions.map((version) => ({
            version: version.version,
            publishTimestamp: version.publishTimestamp,
            source: { type: 'npm' },
          })),
        })),
      },
      'https://index.example.test/index.json',
    )
    expect(parsed.plugins).toHaveLength(result.candidates.length)
  })

  it('exceeds the recorded duplicate-group count without emitting a duplicate name', () => {
    // Synthetic stress on top of the real shape: 300 duplicate pairs.
    const input: TestCandidate[] = []
    for (let index = 0; index < 300; index += 1) {
      input.push(candidate(`dsh-dup-${String(index)}`, { sortKeys: { stars: index } }))
      input.push(candidate(`dsh-dup-${String(index)}`, { sortKeys: { stars: index + 1 } }))
    }
    const result = policy_.applyPolicy(input, config(), 0)
    const names = result.candidates.map((entry) => entry.name)
    expect(names).toHaveLength(300)
    expect(new Set(names).size).toBe(300)
  })
})

describe.skipIf(skipIfMissing(policy))('applyPolicy: the product is not a plugin (case 5)', () => {
  const policy_ = lazySrc(policy, 'policy/filter.ts')

  const harnessEntry = candidate('deepseek-harness', {
    repository: { url: 'https://github.com/deepseek-ai/deepseek-harness' },
    provenance: ['a-source'],
  })

  it('drops an entry whose repository is on denyRepos', () => {
    const result = policy_.applyPolicy([harnessEntry], config({ denyRepos: ['deepseek-ai/deepseek-harness'] }), 0)
    expect(result.candidates).toEqual([])
    expect(result.rejections).toHaveLength(1)
    expect(result.rejections[0]?.stage).toBe('policy')
  })

  it('drops it when only the repository directory is nested', () => {
    const nested = candidate('deepseek-harness', {
      repository: {
        url: 'https://github.com/deepseek-ai/deepseek-harness',
        directory: 'packages/bundle/base',
      },
    })
    const result = policy_.applyPolicy([nested], config({ denyRepos: ['deepseek-ai/deepseek-harness'] }), 0)
    expect(result.candidates).toEqual([])
  })

  it('matches denyRepos case-insensitively, since GitHub owners are', () => {
    const oddCase = candidate('deepseek-harness', {
      repository: { url: 'https://github.com/DeepSeek-AI/DeepSeek-Harness' },
    })
    const result = policy_.applyPolicy([oddCase], config({ denyRepos: ['deepseek-ai/deepseek-harness'] }), 0)
    expect(result.candidates).toEqual([])
  })

  it('does not punish a third-party plugin merely named after the harness', () => {
    // 45 live entries mention deepseek-harness in their URL; only the
    // first-party repository is denied.
    const thirdParty = candidate('dsh-plugin-genui', {
      repository: { url: 'https://github.com/pengyue-polaron/deepseek-harness-genui' },
    })
    const result = policy_.applyPolicy(
      [thirdParty],
      config({ denyRepos: ['deepseek-ai/deepseek-harness'] }),
      0,
    )
    expect(result.candidates).toHaveLength(1)
  })

  it('drops an entry whose package name is on denyPackages', () => {
    const result = policy_.applyPolicy(
      [candidate('dsh-banned')],
      config({ denyPackages: ['dsh-banned'] }),
      0,
    )
    expect(result.candidates).toEqual([])
    expect(result.rejections[0]?.stage).toBe('policy')
  })

  it('denies the synthetic control entry recorded in the fixture', () => {
    const catalog = fixtureJson<{ plugins: Record<string, unknown>[] }>('upstream-catalog-min.json')
    const control = catalog.plugins.find((plugin) => plugin['owner'] === 'deepseek-ai')
    expect(control, 'fixture must carry the deny-list control').toBeDefined()

    const entry = candidate(String(control?.['npm']), {
      repository: { url: String(control?.['url']) },
    })
    const result = policy_.applyPolicy([entry], config({ denyRepos: ['deepseek-ai/deepseek-harness'] }), 0)
    expect(result.candidates).toEqual([])
  })
})

describe.skipIf(skipIfMissing(policy))('applyPolicy: star floor and pass-through', () => {
  const policy_ = lazySrc(policy, 'policy/filter.ts')

  it('applies no floor when minStars is 0', () => {
    const input = [candidate('dsh-a'), candidate('dsh-b', { sortKeys: { stars: 0 } })]
    expect(policy_.applyPolicy(input, config(), 0).candidates).toHaveLength(2)
  })

  it('applies the passed star floor', () => {
    const input = [candidate('dsh-a', { sortKeys: { stars: 3 } }), candidate('dsh-b', { sortKeys: { stars: 0 } })]
    const result = policy_.applyPolicy(input, config(), 1)
    expect(result.candidates.map((entry) => entry.name)).toEqual(['dsh-a'])
    expect(result.rejections).toHaveLength(1)
  })

  it('treats a candidate with no stars as zero against the floor', () => {
    const input = [candidate('dsh-nostars')]
    expect(policy_.applyPolicy(input, config(), 1).candidates).toEqual([])
  })

  it('emits no name more than once even when inputs are shuffled', () => {
    const input = [
      candidate('dsh-a'),
      candidate('dsh-b'),
      candidate('dsh-a'),
      candidate('dsh-c'),
      candidate('dsh-b'),
    ]
    const result = policy_.applyPolicy(input, config(), 0)
    const names = result.candidates.map((entry) => entry.name)
    expect(new Set(names).size).toBe(names.length)
    expect(names).toHaveLength(3)
  })

  it('leaves an empty input empty', () => {
    const result = policy_.applyPolicy([], config(), 0)
    expect(result.candidates).toEqual([])
    expect(result.rejections).toEqual([])
  })

  it('preserves the candidate payload it keeps', () => {
    const original = candidate('@scope/dsh-a', {
      author: 'someone',
      keywords: ['dsh'],
      labels: [],
      sortKeys: { stars: 7 },
      provenance: ['a-source'],
    })
    const result = policy_.applyPolicy([original], config(), 0)
    expect(result.candidates[0]).toEqual(original)
  })
})
