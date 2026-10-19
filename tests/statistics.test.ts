/**
 * Statistics and the page that shows them.
 *
 * The page exists so a visitor can judge whether this market is worth adding:
 * how much of it is measured, how much carries a version history, how much
 * upstream's trust scan flagged. That makes two properties worth testing:
 *
 *   1. the numbers are computed from the published document, so the page cannot
 *      describe a market that differs from the one being served;
 *   2. every ratio is reported against its own denominator. A single
 *      "coverage %" would be a fabricated fact here — stars are known for one
 *      subset of plugins and DSH ranges for another, and dividing both by the
 *      same total would invent a number nobody measured.
 */

import { describe, expect, it } from 'vitest'
import {
  computeStatistics,
  type StatsDocument,
} from '../src/report/statistics.js'
import { renderStatisticsPage } from '../src/report/page.js'
import { findReferences } from '../src/report/references.js'

/** A document shaped like a real one, small enough to reason about. */
function document(overrides: Partial<StatsDocument> = {}): StatsDocument {
  return {
    metadata: {
      categories: {
        ui: { title: { en: 'UI', zh: '界面' } },
        tools: { title: { en: 'Tools', zh: '工具' } },
      },
      labels: {
        shell: { title: { en: 'Runs shell commands', zh: '执行 Shell 命令' } },
        'risk:literal-ip': { title: { en: 'Bare IP', zh: '直连 IP' } },
      },
      sortKeys: { stars: {}, downloads: {} },
    },
    plugins: [
      {
        metadata: { category: 'ui', labels: ['shell'], sortKeys: { stars: 10, downloads: 5 } },
        versions: [{ engines: { dsh: '>=0.2.0' } }, {}],
      },
      {
        metadata: { category: 'tools', labels: ['risk:literal-ip'], sortKeys: { stars: 1 } },
        versions: [{}],
      },
      {
        // No category, no labels, no sort keys: the unmeasured case.
        metadata: { labels: [], sortKeys: {} },
        versions: [{}, {}, {}],
      },
    ],
    ...overrides,
  }
}

describe('computeStatistics', () => {
  it('counts plugins and versions from the document', () => {
    const stats = computeStatistics(document())
    expect(stats.plugins).toBe(3)
    expect(stats.versions).toBe(6)
    expect(stats.pluginsWithHistory).toBe(2)
  })

  it('reports each coverage figure against the plugin total, not a shared denominator', () => {
    const stats = computeStatistics(document())
    const byId = new Map(stats.coverage.map((stat) => [stat.id, stat]))
    // Two plugins carry stars, one carries downloads, two carry categories.
    expect(byId.get('stars')).toMatchObject({ count: 2, total: 3 })
    expect(byId.get('downloads')).toMatchObject({ count: 1, total: 3 })
    expect(byId.get('category')).toMatchObject({ count: 2, total: 3 })
    for (const stat of stats.coverage) expect(stat.total).toBe(stats.plugins)
  })

  it('treats an absent star count as unmeasured rather than zero', () => {
    const stats = computeStatistics(document())
    const stars = stats.coverage.find((stat) => stat.id === 'stars')
    // The third plugin has no stars key; counting it as 0 would claim a
    // measurement that upstream never made.
    expect(stars?.count).toBe(2)
  })

  it('counts a plugin as having a DSH range when any version declares one', () => {
    const stats = computeStatistics(document())
    expect(stats.coverage.find((stat) => stat.id === 'dsh-range')?.count).toBe(1)
  })

  it('counts risk labels by prefix, not by a fixed id', () => {
    const stats = computeStatistics(document())
    expect(stats.coverage.find((stat) => stat.id === 'risk')?.count).toBe(1)
  })

  it('buckets versions so every plugin lands in exactly one bucket', () => {
    const stats = computeStatistics(document())
    const total = stats.versionBuckets.reduce((sum, bucket) => sum + bucket.count, 0)
    expect(total).toBe(3)
    expect(stats.versionBuckets.map((bucket) => bucket.id)).toEqual(['1', '2-3'])
  })

  it('orders category and label distributions by count, descending', () => {
    // Two categories with one plugin each: the tie breaks on id, so `tools`
    // precedes `ui`. Asserting the tie-break keeps the order deterministic
    // across runs rather than depending on insertion order.
    const stats = computeStatistics(document())
    expect(stats.categoryBuckets.map((bucket) => bucket.id)).toEqual(['tools', 'ui'])
    expect(stats.categoryBuckets.every((bucket) => bucket.count === 1)).toBe(true)
    expect(stats.labelBuckets.map((bucket) => bucket.id)).toEqual(['risk:literal-ip', 'shell'])
  })

  it('reuses the declared title for a bucket instead of inventing one', () => {
    const stats = computeStatistics(document())
    const ui = stats.categoryBuckets.find((bucket) => bucket.id === 'ui')
    expect(ui?.label).toEqual({ en: 'UI', zh: '界面' })
  })

  it('handles a document with no plugins without dividing by zero', () => {
    const stats = computeStatistics(document({ plugins: [] }))
    expect(stats.plugins).toBe(0)
    for (const stat of stats.coverage) {
      expect(stat.count).toBe(0)
      expect(stat.total).toBe(0)
    }
    expect(stats.versionBuckets).toEqual([])
  })
})

describe('renderStatisticsPage', () => {
  const options = {
    title: { en: 'Test Market', zh: '测试市场' },
    indexUrl: 'https://example.test/index.json',
    siteUrl: 'https://example.test',
    generatedAt: '2026-10-19T00:00:00.000Z',
    repositoryUrl: 'https://github.com/example/market',
  }

  it('renders every summary number into the HTML', () => {
    const stats = computeStatistics(document())
    const html = renderStatisticsPage(stats, options)
    expect(html).toContain('>3<')          // plugins
    expect(html).toContain('>6<')          // versions
    expect(html).toContain('data-stat="plugins"')
  })

  it('carries no external script, so the page cannot load a third-party tracker', () => {
    const html = renderStatisticsPage(computeStatistics(document()), options)
    const scripts = [...html.matchAll(/<script[^>]*src=/gu)]
    expect(scripts).toHaveLength(0)
    // The only remote hosts are this project's own.
    const hosts = new Set([...html.matchAll(/https?:\/\/[^"'<\s]+/gu)].map((match) => {
      try { return new URL(match[0]).host } catch { return 'invalid' }
    }))
    // `github.com` appears only as the source link passed in by the caller; the
    // point of the assertion is that no host is reached by the page itself.
    expect([...hosts].sort()).toEqual(['example.test', 'github.com'])
  })

  it('ships the numbers in the markup, not behind a script', () => {
    // A visitor with JavaScript disabled must still read every figure.
    const html = renderStatisticsPage(computeStatistics(document()), options)
    const withoutScripts = html.replace(/<script[\s\S]*?<\/script>/gu, '')
    expect(withoutScripts).toContain('data-stat="plugins"')
    expect(withoutScripts).toContain('Runs shell commands')
  })

  it('escapes user-visible text rather than interpolating it raw', () => {
    const hostile = document({
      metadata: {
        categories: { ui: { title: { en: '<img src=x onerror=alert(1)>' } } },
        labels: {},
        sortKeys: {},
      },
    })
    const html = renderStatisticsPage(computeStatistics(hostile), options)
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x')
  })

  it('includes both languages for every label', () => {
    const html = renderStatisticsPage(computeStatistics(document()), options)
    expect(html).toContain('class="en"')
    expect(html).toContain('class="zh"')
    expect(html).toContain('市场统计')
    expect(html).toContain('Market statistics')
  })
})

describe('findReferences', () => {
  /** A fetch stub that answers the two search queries with fixed hits. */
  function stubFetch(byQuery: Record<string, { total?: number; items: unknown[] }>): {
    fetchImpl: never
    seen: string[]
  } {
    const seen: string[] = []
    const fetchImpl = (async (url: string) => {
      seen.push(url)
      // The query value arrives percent-encoded; decode it exactly once, which
      // is what the API does, so the stub matches the logical query rather than
      // the wire form.
      const raw = /[?&]q=([^&]*)/u.exec(url)?.[1] ?? ''
      const q = decodeURIComponent(raw)
      // A URL query contains the host and a slash; a name query does not. That
      // distinction is what the two queries actually differ by.
      const wantsUrl = q.includes('/')
      const match = Object.entries(byQuery)
        .filter(([needle]) => q.includes(needle))
        .find(([needle]) => (wantsUrl ? needle.includes('.') : !needle.includes('.')))
      if (match === undefined) return { ok: false, status: 404, json: async () => ({}) }
      const response = match[1]
      return {
        ok: true,
        status: 200,
        json: async () => ({ total_count: response.total ?? response.items.length, items: response.items }),
      }
    }) as never
    return { fetchImpl, seen }
  }

  const base = {
    indexUrl: 'https://hytime.github.io/dsh-discover-index/index.json',
    self: 'hytime/dsh-discover-index',
    apiBase: 'https://api.github.test',
  }

  it('collects repositories from both the name and the URL query', async () => {
    const { fetchImpl } = stubFetch({
      'dsh-discover-index': {
        items: [{ repository: { full_name: 'a/one' }, path: 'README.md' }],
      },
      'hytime.github.io': {
        items: [{ repository: { full_name: 'b/two' }, path: 'market.json' }],
      },
    })
    const report = await findReferences({ ...base, fetchImpl })
    expect(report.references.map((reference) => reference.repository)).toEqual(['a/one', 'b/two'])
    expect(report.urlCitations).toBe(1)
    expect(report.incomplete).toBe(false)
  })

  it('excludes this repository from its own count', async () => {
    const { fetchImpl } = stubFetch({
      'dsh-discover-index': { items: [{ repository: { full_name: 'hytime/dsh-discover-index' }, path: 'README.md' }] },
      'index.json': { items: [] },
    })
    const report = await findReferences({ ...base, fetchImpl })
    expect(report.references).toEqual([])
  })

  it('marks the sweep incomplete when a query fails, instead of reporting zero', async () => {
    const fetchImpl = (async () => ({ ok: false, status: 503, json: async () => ({}) })) as never
    const report = await findReferences({ ...base, fetchImpl })
    // Never throws: a monitoring step must not fail the build that produces the index.
    expect(report.incomplete).toBe(true)
    expect(report.references).toEqual([])
  })

  it('marks the sweep incomplete when the result was truncated', async () => {
    const { fetchImpl } = stubFetch({
      'dsh-discover-index': { total: 500, items: [{ repository: { full_name: 'a/one' }, path: 'x.md' }] },
      'index.json': { total: 0, items: [] },
    })
    const report = await findReferences({ ...base, fetchImpl })
    expect(report.incomplete).toBe(true)
  })

  it('merges several files from one repository into one reference', async () => {
    const { fetchImpl } = stubFetch({
      'dsh-discover-index': {
        items: [
          { repository: { full_name: 'a/one' }, path: 'docs/a.md' },
          { repository: { full_name: 'a/one' }, path: 'docs/b.md' },
        ],
      },
      'index.json': { items: [] },
    })
    const report = await findReferences({ ...base, fetchImpl })
    expect(report.references).toHaveLength(1)
    expect(report.references[0]?.paths).toEqual(['docs/a.md', 'docs/b.md'])
  })
})

describe('renderStatisticsPage: references are distinguished from zero', () => {
  const options = {
    title: { en: 'Test Market', zh: '测试市场' },
    indexUrl: 'https://example.test/index.json',
    siteUrl: 'https://example.test',
    generatedAt: '2026-10-19T00:00:00.000Z',
    repositoryUrl: 'https://github.com/example/market',
  }

  it('says "not measured" when no sweep ran, rather than showing zero', () => {
    const html = renderStatisticsPage(computeStatistics(document()), options)
    expect(html).toContain('Not measured on this build')
    expect(html).not.toContain('No repository names this project yet')
  })

  it('lists references and marks the ones citing the URL', () => {
    const html = renderStatisticsPage(computeStatistics(document()), {
      ...options,
      references: {
        references: [{ repository: 'a/one', paths: ['README.md'], usesIndexUrl: true }],
        urlCitations: 1,
        queries: 2,
        incomplete: false,
        failures: [],
      },
    })
    expect(html).toContain('a/one')
    expect(html).toContain('cites the URL')
  })

  it('distinguishes a measured zero from an unmeasured one', () => {
    const html = renderStatisticsPage(computeStatistics(document()), {
      ...options,
      references: { references: [], urlCitations: 0, queries: 2, incomplete: false, failures: [] },
    })
    expect(html).toContain('No repository names this project yet')
    expect(html).not.toContain('Not measured on this build')
  })

  it('does not claim "nobody references this" when the sweep failed', () => {
    // A rate-limited sweep returns no rows. Rendering that as "no repository
    // names this project" states a fact we do not have; the two cases must read
    // differently.
    const html = renderStatisticsPage(computeStatistics(document()), {
      ...options,
      references: { references: [], urlCitations: 0, queries: 2, incomplete: true, failures: ['rate limited'] },
    })
    expect(html).not.toContain('No repository names this project yet')
    expect(html).toContain('the sweep did not complete')
  })

  it('says a truncated sweep is a floor when it did find something', () => {
    const html = renderStatisticsPage(computeStatistics(document()), {
      ...options,
      references: {
        references: [{ repository: 'a/one', paths: ['README.md'], usesIndexUrl: false }],
        urlCitations: 0,
        queries: 2,
        incomplete: true,
        failures: [],
      },
    })
    expect(html).toContain('Incomplete')
  })
})
