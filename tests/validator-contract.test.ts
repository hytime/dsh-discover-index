/**
 * Format-1 rule controls, asserted through the REAL validator.
 *
 * This suite depends on nothing in `src/`, so it runs from the first commit.
 * Its purpose is to prove that the five adversarial cases are *observable*:
 * for every rule the pipeline is supposed to respect, there is a hand-crafted
 * document here that the real `parseMarketIndex` rejects, and a minimally
 * different document it accepts. Without that, a passing render test would only
 * prove that the validator was never actually consulted.
 *
 * The controls also measure the validator's blind spots. Format 1 cannot see
 * that `https://github.com/o/r/tree/main/packages/x` is not a clonable
 * repository — it has enough path segments to look like one — so that bug class
 * is only detectable by decomposing the URL, which `resolve.test.ts` covers.
 */

import { describe, expect, it } from 'vitest'
import {
  MarketIndexError,
  marketInstallTarget,
  parseMarketIndex,
  type MarketIndex,
} from '@deepseek-ai/dsh-plugin-market-index'
import { TEST_INDEX_URL } from './helpers/harness.js'

/** A minimal document that the validator accepts; each test perturbs one field. */
function baseDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format: 1,
    title: { en: 'DSH Plugin Index' },
    metadata: {},
    plugins: [npmPlugin('dsh-example')],
    ...overrides,
  }
}

/** A minimal npm-source plugin. */
function npmPlugin(name: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name,
    metadata: {},
    versions: [{ version: '1.0.0', publishTimestamp: 1_700_000_000, source: { type: 'npm' } }],
    ...overrides,
  }
}

/** Rejection path, or a sentinel when the document unexpectedly parsed. */
function rejectAt(value: unknown): string {
  try {
    parseMarketIndex(value, TEST_INDEX_URL)
    return '<ACCEPTED>'
  } catch (error) {
    if (error instanceof MarketIndexError) return error.path
    return `<${String(error)}>`
  }
}

describe('validator control: the harness accepts a well-formed document', () => {
  it('accepts the minimal document and fills absent groups', () => {
    const parsed = parseMarketIndex(baseDoc(), TEST_INDEX_URL)
    expect(parsed.format).toBe(1)
    expect(parsed.plugins).toHaveLength(1)
    expect(parsed.metadata).toEqual({ categories: {}, labels: {}, sortKeys: {} })
    expect(parsed.plugins[0]?.metadata).toEqual({ keywords: [], labels: [], sortKeys: {} })
  })

  it('sorts each plugin versions by descending SemVer precedence', () => {
    const parsed = parseMarketIndex(
      baseDoc({
        plugins: [
          npmPlugin('dsh-example', {
            versions: [
              { version: '0.9.0', publishTimestamp: 1, source: { type: 'npm' } },
              { version: '1.0.0-rc.1', publishTimestamp: 2, source: { type: 'npm' } },
              { version: '1.0.0', publishTimestamp: 3, source: { type: 'npm' } },
            ],
          }),
        ],
      }),
      TEST_INDEX_URL,
    )
    expect(parsed.plugins[0]?.versions.map((version) => version.version)).toEqual([
      '1.0.0',
      '1.0.0-rc.1',
      '0.9.0',
    ])
  })
})

describe('validator control: case 1 — plugin name must be unique (271 cross-owner duplicate basenames)', () => {
  it('rejects two plugins sharing a name', () => {
    const doc = baseDoc({
      plugins: [npmPlugin('dsh-engram'), npmPlugin('dsh-engram')],
    })
    expect(rejectAt(doc)).toBe('$.plugins[1].name')
  })

  it('reports the rejection as a MarketIndexError naming the duplicate', () => {
    const doc = baseDoc({ plugins: [npmPlugin('dsh-engram'), npmPlugin('dsh-engram')] })
    expect(() => parseMarketIndex(doc, TEST_INDEX_URL)).toThrow(MarketIndexError)
    expect(() => parseMarketIndex(doc, TEST_INDEX_URL)).toThrow(/duplicates dsh-engram/)
  })

  it('accepts the same repository basename when the package names differ', () => {
    // The real fix for the duplicate-basename case: two owners shipping
    // `dsh-engram` must be listed under distinct package names.
    const parsed = parseMarketIndex(
      baseDoc({ plugins: [npmPlugin('@kenz1117/dsh-engram'), npmPlugin('dsh-engram')] }),
      TEST_INDEX_URL,
    )
    expect(parsed.plugins.map((plugin) => plugin.name).sort()).toEqual([
      '@kenz1117/dsh-engram',
      'dsh-engram',
    ])
  })
})

describe('validator control: case 2 — name must be a valid npm package name (225 uppercase repos)', () => {
  it.each(['DragView', 'dsh-TUI', 'DSH-Plugin_awl', 'DeepSeek-Balance-Whale-Widget'])(
    'rejects repository name %s as a plugin name',
    (name) => {
      expect(rejectAt(baseDoc({ plugins: [npmPlugin(name)] }))).toBe('$.plugins[0].name')
    },
  )

  it('rejects an uppercase scope', () => {
    expect(rejectAt(baseDoc({ plugins: [npmPlugin('@Kenz/dsh-engram')] }))).toBe(
      '$.plugins[0].name',
    )
  })

  it('rejects a name longer than 214 characters', () => {
    expect(rejectAt(baseDoc({ plugins: [npmPlugin('d'.repeat(215))] }))).toBe('$.plugins[0].name')
  })

  it('accepts the real package names those repositories publish', () => {
    const parsed = parseMarketIndex(
      baseDoc({
        plugins: [
          npmPlugin('dsh-dragview'), // anzhaohao/DragView
          npmPlugin('@deepseek-harness-tui/dsh-tui'), // ccch1mneyyy/dsh-TUI
          npmPlugin('dsh-type-tune'), // AWL-MC2/DSH-Plugin_awl
          npmPlugin('dsh-whale-widget'), // MeteorNOX/DeepSeek-Balance-Whale-Widget
        ],
      }),
      TEST_INDEX_URL,
    )
    expect(parsed.plugins).toHaveLength(4)
  })
})

describe('validator control: case 3 — the validator cannot see a monorepo subpath', () => {
  // Documented blind spot, asserted so it stays known: format 1 checks only
  // that a git URL is canonical https with >= 2 path segments, so a /tree/
  // URL passes validation and fails at install time. The URL must therefore be
  // decomposed by the pipeline, not caught here.
  it('ACCEPTS a /tree/ URL as a git source url — the bug is invisible to the validator', () => {
    const doc = baseDoc({
      plugins: [
        npmPlugin('dsh-proactive', {
          versions: [
            {
              version: '0.3.1',
              publishTimestamp: 1_700_000_000,
              source: {
                type: 'git',
                url: 'https://github.com/john-walks-slow/dsh-proactive/tree/main/packages/dsh-proactive',
                commit: 'a'.repeat(40),
              },
            },
          ],
        }),
      ],
    })
    expect(rejectAt(doc)).toBe('<ACCEPTED>')
  })

  it('accepts the decomposed form: repository url plus source.path', () => {
    const parsed = parseMarketIndex(
      baseDoc({
        plugins: [
          npmPlugin('dsh-proactive', {
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
      }),
      TEST_INDEX_URL,
    )
    expect(parsed.plugins[0]?.versions[0]?.source).toEqual({
      type: 'git',
      url: 'https://github.com/john-walks-slow/dsh-proactive',
      commit: 'a'.repeat(40),
      path: 'packages/dsh-proactive',
    })
  })

  it('rejects an empty path, so /tree/main must decompose to no directory at all', () => {
    expect(
      rejectAt(
        baseDoc({
          plugins: [
            npmPlugin('dsh-proactive', {
              versions: [
                {
                  version: '0.3.1',
                  publishTimestamp: 1_700_000_000,
                  source: {
                    type: 'git',
                    url: 'https://github.com/o/r',
                    commit: 'a'.repeat(40),
                    path: '',
                  },
                },
              ],
            }),
          ],
        }),
      ),
    ).toBe('$.plugins[0].versions[0].source.path')
  })

  it('produces pnpm path: install arguments for the decomposed form', () => {
    const target = marketInstallTarget('dsh-proactive', {
      version: '0.3.1',
      source: {
        type: 'git',
        url: 'https://github.com/john-walks-slow/dsh-proactive',
        commit: 'a'.repeat(40),
        path: 'packages/dsh-proactive',
      },
    })
    expect(target.spec).toBe(
      `git+https://github.com/john-walks-slow/dsh-proactive.git#${'a'.repeat(40)}&path:/packages/dsh-proactive`,
    )
  })
})

describe('validator control: case 4 — versions must be a non-empty array', () => {
  it('rejects an empty versions array', () => {
    expect(rejectAt(baseDoc({ plugins: [npmPlugin('dsh-empty', { versions: [] })] }))).toBe(
      '$.plugins[0].versions',
    )
  })

  it('rejects a missing versions member', () => {
    expect(
      rejectAt(
        baseDoc({ plugins: [{ name: 'dsh-empty', metadata: {} }] }),
      ),
    ).toBe('$.plugins[0].versions')
  })

  it('rejects a duplicate version inside one plugin', () => {
    expect(
      rejectAt(
        baseDoc({
          plugins: [
            npmPlugin('dsh-dup', {
              versions: [
                { version: '1.0.0', publishTimestamp: 1, source: { type: 'npm' } },
                { version: '1.0.0', publishTimestamp: 2, source: { type: 'npm' } },
              ],
            }),
          ],
        }),
      ),
    ).toBe('$.plugins[0].versions[1].version')
  })

  it.each([
    ['not a semver', 'v1.0.0'],
    ['a range', '^1.0.0'],
    ['a leading zero', '01.0.0'],
  ])('rejects a version that is %s', (_label, version) => {
    expect(
      rejectAt(
        baseDoc({
          plugins: [
            npmPlugin('dsh-bad', {
              versions: [{ version, publishTimestamp: 1, source: { type: 'npm' } }],
            }),
          ],
        }),
      ),
    ).toBe('$.plugins[0].versions[0].version')
  })

  it('rejects a publishTimestamp outside [0, 1e11)', () => {
    expect(
      rejectAt(
        baseDoc({
          plugins: [
            npmPlugin('dsh-ts', {
              versions: [{ version: '1.0.0', publishTimestamp: 1e11, source: { type: 'npm' } }],
            }),
          ],
        }),
      ),
    ).toBe('$.plugins[0].versions[0].publishTimestamp')
  })

  it('rejects a non-integer publishTimestamp', () => {
    expect(
      rejectAt(
        baseDoc({
          plugins: [
            npmPlugin('dsh-ts', {
              versions: [{ version: '1.0.0', publishTimestamp: 1.5, source: { type: 'npm' } }],
            }),
          ],
        }),
      ),
    ).toBe('$.plugins[0].versions[0].publishTimestamp')
  })
})

describe('validator control: further format-1 rules the renderer must satisfy', () => {
  it('rejects format other than 1', () => {
    expect(rejectAt(baseDoc({ format: 2 }))).toBe('$.format')
  })

  it('rejects an index whose title has no en', () => {
    expect(rejectAt(baseDoc({ title: { zh: '索引' } }))).toBe('$.title')
  })

  it('rejects a plugin category that the index does not declare', () => {
    expect(
      rejectAt(
        baseDoc({
          plugins: [npmPlugin('dsh-cat', { metadata: { category: 'ui' } })],
        }),
      ),
    ).toBe('$.plugins[0].metadata.category')
  })

  it('accepts a category the index declares', () => {
    const parsed: MarketIndex = parseMarketIndex(
      baseDoc({
        metadata: { categories: { ui: { title: { en: 'UI' } } } },
        plugins: [npmPlugin('dsh-cat', { metadata: { category: 'ui' } })],
      }),
      TEST_INDEX_URL,
    )
    expect(parsed.plugins[0]?.metadata.category).toBe('ui')
  })

  it('rejects a repeated label', () => {
    expect(
      rejectAt(
        baseDoc({
          metadata: { labels: { featured: { title: { en: 'Featured' } } } },
          plugins: [npmPlugin('dsh-lab', { metadata: { labels: ['featured', 'featured'] } })],
        }),
      ),
    ).toBe('$.plugins[0].metadata.labels')
  })

  it('rejects a git commit that is not lowercase 40-hex', () => {
    expect(
      rejectAt(
        baseDoc({
          plugins: [
            npmPlugin('dsh-commit', {
              versions: [
                {
                  version: '1.0.0',
                  publishTimestamp: 1,
                  source: { type: 'git', url: 'https://github.com/o/r', commit: 'A'.repeat(40) },
                },
              ],
            }),
          ],
        }),
      ),
    ).toBe('$.plugins[0].versions[0].source.commit')
  })

  it('rejects an engines.dsh workspace: range', () => {
    expect(
      rejectAt(
        baseDoc({
          plugins: [
            npmPlugin('dsh-ws', {
              versions: [
                {
                  version: '1.0.0',
                  publishTimestamp: 1,
                  source: { type: 'npm' },
                  engines: { dsh: 'workspace:*' },
                },
              ],
            }),
          ],
        }),
      ),
    ).toBe('$.plugins[0].versions[0].engines.dsh')
  })

  it('rejects a repository url that is not canonical https', () => {
    expect(
      rejectAt(
        baseDoc({
          plugins: [npmPlugin('dsh-repo', { repository: { url: 'git+https://github.com/o/r.git' } })],
        }),
      ),
    ).toBe('$.plugins[0].repository.url')
  })

  it('drops undefined members rather than failing on them', () => {
    const parsed = parseMarketIndex(
      baseDoc({ plugins: [npmPlugin('dsh-extra', { futureField: 'ignored' })] }),
      TEST_INDEX_URL,
    )
    expect(Object.hasOwn(parsed.plugins[0] as object, 'futureField')).toBe(false)
  })
})
