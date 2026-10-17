/**
 * Rendering: candidates in, a format-1 document out, and the authority's
 * verdict on it.
 *
 * The layering matters for what this suite may claim. `renderIndex` is pure
 * assembly: it does not drop anything and does not validate. The guarantee that
 * no bad plugin reaches a published document comes from `runPipeline`, which
 * drops unrenderable candidates through `unrenderableReason` before rendering,
 * and from `validateIndex`, which refuses the whole document. So:
 *
 *   - here, every document built from *renderable* candidates must pass the
 *     real validator, and every document the validator would reject must be
 *     rejected by `validateIndex` rather than published;
 *   - `pipeline.test.ts` asserts the drop behaviour end to end, offline.
 *
 * Nothing here restates a format rule; every "valid" claim is `parseMarketIndex`
 * accepting, every "invalid" claim is it rejecting. The negative controls are in
 * `validator-contract.test.ts`.
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
  title: { en: 'DSH Plugin Index', zh: 'DSH 插件索引' },
  description: { en: 'Converted from awesome-dsh-plugin.', zh: '由 awesome-dsh-plugin 转换。' },
  sources: ['awesome-dsh-plugin'],
  minStars: 0,
  output: 'index.json',
}

function candidate(name: string, overrides: Partial<TestCandidate> = {}): TestCandidate {
  return {
    name,
    keywords: ['dsh', 'dsh-plugin'],
    labels: [],
    sortKeys: { stars: 1 },
    versions: [
      { version: '1.0.0', publishTimestamp: 1_700_000_000, source: { type: 'npm' } },
    ],
    provenance: ['awesome-dsh-plugin'],
    ...overrides,
  }
}

describe.skipIf(skipIfMissing(render))('renderIndex: a document the validator accepts', () => {
  const render_ = lazySrc(render, 'render/index.ts')

  it('renders an empty candidate list into a valid empty index', () => {
    const doc = render_.renderIndex([], profile)
    const parsed = parseMarketIndex(doc, TEST_INDEX_URL)
    expect(parsed.format).toBe(1)
    expect(parsed.plugins).toEqual([])
  })

  it('renders one npm candidate and passes the real validator', () => {
    const doc = render_.renderIndex([candidate('@anonyjcy/dsh-j-space')], profile)
    const parsed = parseMarketIndex(doc, TEST_INDEX_URL)
    expect(parsed.plugins).toHaveLength(1)
    expect(parsed.plugins[0]?.name).toBe('@anonyjcy/dsh-j-space')
    expect(parsed.plugins[0]?.versions).toHaveLength(1)
  })

  it('emits format 1 and the profile title, localized', () => {
    const doc = render_.renderIndex([], profile) as { format: unknown; title: unknown }
    expect(doc.format).toBe(1)
    expect(parseMarketIndex(doc, TEST_INDEX_URL).title).toEqual({
      en: 'DSH Plugin Index',
      zh: 'DSH 插件索引',
    })
  })

  it('round-trips a git candidate with repository.directory and source.path', () => {
    const doc = render_.renderIndex(
      [
        candidate('dsh-proactive', {
          repository: {
            url: 'https://github.com/john-walks-slow/dsh-proactive',
            directory: 'packages/dsh-proactive',
          },
          versions: [
            {
              version: '0.3.1',
              publishTimestamp: 1_700_000_000,
              source: {
                type: 'git',
                url: 'https://github.com/john-walks-slow/dsh-proactive',
                commit: 'a'.repeat(40),
                path: 'packages/dsh-proactive',
              },
            },
          ],
        }),
      ],
      profile,
    )
    const parsed = parseMarketIndex(doc, TEST_INDEX_URL)
    expect(parsed.plugins[0]?.repository).toEqual({
      url: 'https://github.com/john-walks-slow/dsh-proactive',
      directory: 'packages/dsh-proactive',
    })
    expect(parsed.plugins[0]?.versions[0]?.source).toEqual({
      type: 'git',
      url: 'https://github.com/john-walks-slow/dsh-proactive',
      commit: 'a'.repeat(40),
      path: 'packages/dsh-proactive',
    })
  })

  it('omits source.path when the package sits at the repository root', () => {
    const doc = render_.renderIndex(
      [
        candidate('dsh-root', {
          repository: { url: 'https://github.com/o/r' },
          versions: [
            {
              version: '1.0.0',
              publishTimestamp: 1_700_000_000,
              source: { type: 'git', url: 'https://github.com/o/r', commit: 'b'.repeat(40) },
            },
          ],
        }),
      ],
      profile,
    )
    const source = parseMarketIndex(doc, TEST_INDEX_URL).plugins[0]?.versions[0]?.source
    expect(source && 'path' in source).toBe(false)
  })

  it('maps a candidate dshRange into engines.dsh', () => {
    const doc = render_.renderIndex(
      [
        candidate('dsh-ranged', {
          versions: [
            {
              version: '1.0.0',
              publishTimestamp: 1_700_000_000,
              source: { type: 'npm' },
              dshRange: '>=0.1.2-alpha.2 <0.3.0-0',
            },
          ],
        }),
      ],
      profile,
    )
    const parsed = parseMarketIndex(doc, TEST_INDEX_URL)
    expect(parsed.plugins[0]?.versions[0]?.engines.dsh).toBe('>=0.1.2-alpha.2 <0.3.0-0')
  })

  it('declares every category and label a plugin references', () => {
    const doc = render_.renderIndex(
      [
        candidate('dsh-ui', { category: 'ui', labels: ['featured'] }),
        candidate('dsh-agi', { category: 'agi' }),
      ],
      profile,
    )
    // An undeclared category or label is a hard validation failure, so
    // acceptance is the whole assertion.
    const parsed = parseMarketIndex(doc, TEST_INDEX_URL)
    expect(parsed.plugins).toHaveLength(2)
    expect(parsed.plugins[0]?.metadata.category).toBe('ui')
    expect(parsed.plugins[0]?.metadata.labels).toEqual(['featured'])
  })

  it('declares a category upstream invented, rather than referencing it undeclared', () => {
    const doc = render_.renderIndex([candidate('dsh-new', { category: 'some-new-category' })], profile)
    const parsed = parseMarketIndex(doc, TEST_INDEX_URL)
    expect(parsed.metadata.categories['some-new-category']).toBeDefined()
  })

  it('declares a sort key a source contributed, rather than dropping its value', () => {
    // A source may publish its own numeric key (a score, a rating) under an id
    // this project has never heard of. Declaring it and keeping the value is the
    // only consistent pair of choices: declaring without keeping would render a
    // sort option that orders nothing, and keeping without declaring would fail
    // validation. What must NOT happen is the value disappearing while the key
    // is advertised.
    const doc = render_.renderIndex(
      [candidate('dsh-keys', { sortKeys: { stars: 3, sourceScore: 1 } })],
      profile,
    )
    expect(Object.hasOwn((doc as any).metadata.sortKeys, 'sourceScore')).toBe(true)
    const parsed = parseMarketIndex(doc, TEST_INDEX_URL)
    expect(parsed.plugins[0]?.metadata.sortKeys).toEqual({ stars: 3, sourceScore: 1 })
  })

  it('drops a non-finite sort key value instead of breaking the document', () => {
    const doc = render_.renderIndex(
      [candidate('dsh-keys', { sortKeys: { stars: 3, broken: Number.POSITIVE_INFINITY } })],
      profile,
    )
    const parsed = parseMarketIndex(doc, TEST_INDEX_URL)
    expect(parsed.plugins[0]?.metadata.sortKeys).toEqual({ stars: 3 })
  })

  it('sorts versions within a plugin by descending precedence', () => {
    const doc = render_.renderIndex(
      [
        candidate('dsh-multi', {
          versions: [
            { version: '0.9.0', publishTimestamp: 1, source: { type: 'npm' } },
            { version: '1.1.0', publishTimestamp: 3, source: { type: 'npm' } },
            { version: '1.0.0', publishTimestamp: 2, source: { type: 'npm' } },
          ],
        }),
      ],
      profile,
    )
    const parsed = parseMarketIndex(doc, TEST_INDEX_URL)
    expect(parsed.plugins[0]?.versions.map((version) => version.version)).toEqual([
      '1.1.0',
      '1.0.0',
      '0.9.0',
    ])
  })

  it('only emits icon URLs that the validator accepts', () => {
    const doc = render_.renderIndex(
      [candidate('dsh-icon', { homepage: 'https://example.test/p' })],
      profile,
    )
    const parsed = parseMarketIndex(doc, TEST_INDEX_URL)
    const icon = parsed.plugins[0]?.icon
    if (icon !== undefined) {
      expect(icon.startsWith('https://') || icon.startsWith('data:')).toBe(true)
    }
  })

  it('drops a localized field with no en, which the format requires', () => {
    const doc = render_.renderIndex(
      [candidate('dsh-zh-only', { title: { zh: '只有中文' } })],
      profile,
    )
    const parsed = parseMarketIndex(doc, TEST_INDEX_URL)
    // `en` is mandatory in any localized member the format carries, so a
    // title without one cannot be emitted at all — the field is dropped and
    // the rest of the plugin survives.
    expect(parsed.plugins[0]?.title).toBeUndefined()
    expect(parsed.plugins[0]?.name).toBe('dsh-zh-only')
  })

  it('keeps a localized field once it carries en', () => {
    const doc = render_.renderIndex(
      [candidate('dsh-both', { title: { en: 'Both', zh: '都有' } })],
      profile,
    )
    expect(parseMarketIndex(doc, TEST_INDEX_URL).plugins[0]?.title).toEqual({
      en: 'Both',
      zh: '都有',
    })
  })

  it('renders only the languages the format accepts', () => {
    const doc = render_.renderIndex(
      [candidate('dsh-locale', { title: { en: 'T', 'not a locale': 'x' } })],
      profile,
    )
    const parsed = parseMarketIndex(doc, TEST_INDEX_URL)
    expect(parsed.plugins[0]?.title).toEqual({ en: 'T' })
  })

  it('carries no query or fragment into repository.url', () => {
    const doc = render_.renderIndex(
      [candidate('dsh-clean', { repository: { url: 'https://github.com/o/r?tab=readme#x' } })],
      profile,
    )
    const parsed = parseMarketIndex(doc, TEST_INDEX_URL)
    expect(parsed.plugins[0]?.repository?.url).toBe('https://github.com/o/r')
  })
})

describe.skipIf(skipIfMissing(render))('unrenderableReason: what must be dropped before rendering', () => {
  const render_ = lazySrc(render, 'render/index.ts')

  // These candidates cannot be represented in format 1. `renderIndex` would
  // faithfully copy them and `validateIndex` would reject the whole document,
  // so the pipeline must drop them first. The rule list is asserted here; the
  // drop itself is asserted in pipeline.test.ts.
  it('reports an uppercase repository name', () => {
    expect(render_.unrenderableReason(candidate('DragView'))).toBeDefined()
  })

  it.each(['DragView', 'DSH-Plugin_awl', '@Scope/pkg', 'has space', '.dot', 'UPPER'])(
    'reports %s as an unusable package name',
    (name) => {
      expect(render_.unrenderableReason(candidate(name))).toBeDefined()
    },
  )

  it('reports a name longer than 214 characters', () => {
    expect(render_.unrenderableReason(candidate('d'.repeat(215)))).toBeDefined()
  })

  it('reports an empty versions array', () => {
    expect(render_.unrenderableReason(candidate('dsh-empty', { versions: [] }))).toBeDefined()
  })

  it('reports a negative publish timestamp', () => {
    expect(
      render_.unrenderableReason(
        candidate('dsh-neg', {
          versions: [{ version: '1.0.0', publishTimestamp: -1, source: { type: 'npm' } }],
        }),
      ),
    ).toBeDefined()
  })

  it('reports a non-integer publish timestamp', () => {
    expect(
      render_.unrenderableReason(
        candidate('dsh-frac', {
          versions: [{ version: '1.0.0', publishTimestamp: 1.5, source: { type: 'npm' } }],
        }),
      ),
    ).toBeDefined()
  })

  it('accepts a renderable candidate', () => {
    expect(render_.unrenderableReason(candidate('@scope/dsh-ok'))).toBeUndefined()
  })

  it.each([
    '@anonyjcy/dsh-j-space',
    'dsh-engram',
    'dsh-dragview',
    '@deepseek-harness-tui/dsh-tui',
    'dsh-whale-widget',
  ])('accepts the real package name %s', (name) => {
    expect(render_.unrenderableReason(candidate(name))).toBeUndefined()
  })
})

describe.skipIf(skipIfMissing(render))('validateIndex: the publish gate', () => {
  const render_ = lazySrc(render, 'render/index.ts')

  it('returns the parsed index for a good document', () => {
    const doc = render_.renderIndex([candidate('dsh-self')], profile)
    const parsed = render_.validateIndex(doc, TEST_INDEX_URL) as { format: number }
    expect(parsed.format).toBe(1)
  })

  it('throws MarketIndexError for a document the format rejects, never returning it', () => {
    expect(() =>
      render_.validateIndex(
        {
          format: 1,
          title: { en: 'x' },
          metadata: {},
          plugins: [{ name: 'DragView', metadata: {}, versions: [] }],
        },
        TEST_INDEX_URL,
      ),
    ).toThrow(MarketIndexError)
  })

  it('agrees with a direct parseMarketIndex call on a valid document', () => {
    const doc = render_.renderIndex([candidate('@scope/dsh-agree')], profile)
    expect(JSON.stringify(render_.validateIndex(doc, TEST_INDEX_URL))).toBe(
      JSON.stringify(parseMarketIndex(doc, TEST_INDEX_URL)),
    )
  })

  it('is the same function the validator package exports, not a re-implementation', () => {
    // If this project ever hand-rolled validation, the two would diverge.
    const probe = { format: 1, title: { en: 'x' }, metadata: {}, plugins: [] }
    expect(JSON.stringify(render_.validateIndex(probe, TEST_INDEX_URL))).toBe(
      JSON.stringify(parseMarketIndex(probe, TEST_INDEX_URL)),
    )
  })
})

describe.skipIf(skipIfMissing(render))('renderIndex: real recorded entries', () => {
  const render_ = lazySrc(render, 'render/index.ts')

  it('renders the real npm entries from the recorded subset into a valid document', () => {
    const catalog = fixtureJson<{ plugins: Record<string, unknown>[] }>('upstream-catalog-min.json')
    const real = catalog.plugins.filter(
      (plugin) =>
        typeof plugin['npm'] === 'string' &&
        typeof plugin['version'] === 'string' &&
        // The synthetic deny-list control is deliberately excluded: renderIndex
        // is pure assembly and does not apply deny lists — that is policy's job,
        // asserted in policy.test.ts and pipeline.test.ts.
        plugin['owner'] !== 'deepseek-ai',
    )
    expect(real.length).toBeGreaterThan(0)

    const candidates: TestCandidate[] = real.map((plugin) => ({
      name: String(plugin['npm']),
      title: { en: String(plugin['name']) },
      keywords: ['dsh'],
      labels: [],
      sortKeys: { stars: Number(plugin['stars'] ?? 0) },
      versions: [
        {
          version: String(plugin['version']),
          publishTimestamp: 1_700_000_000,
          source: { type: 'npm' },
        },
      ],
      provenance: ['awesome-dsh-plugin'],
    }))

    // Every one must be renderable, otherwise the test would be exercising the
    // drop path by accident instead of the render path.
    for (const entry of candidates) {
      expect(render_.unrenderableReason(entry), `${entry.name} must be renderable`).toBeUndefined()
    }

    const doc = render_.renderIndex(candidates, profile)
    const parsed = parseMarketIndex(doc, TEST_INDEX_URL)
    expect(parsed.plugins.map((plugin) => plugin.name).sort()).toEqual(
      candidates.map((entry) => entry.name).sort(),
    )
  })
})
