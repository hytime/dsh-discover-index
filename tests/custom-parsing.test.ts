/**
 * Configurable source parsing.
 *
 * The premise of this project is that a second catalog should be a
 * configuration change, not a new adapter. That claim is only true if four
 * things hold, and each is asserted here:
 *
 *   1. `config.yml` can point a source at its own member names
 *      (`security.permissions` instead of `capabilities`) and a dot path is
 *      resolved through nesting;
 *   2. the mapping survives into what the pipeline actually produces — labels,
 *      keywords, and a sort key — rather than being parsed and ignored;
 *   3. a source that declares no mapping still works, with the upstream
 *      catalog's own names as defaults;
 *   4. a custom sort key is declared in the index, because a plugin that
 *      references an undeclared id fails the whole document.
 *
 * The failure mode this guards against is the quiet one: a mapping that parses
 * but is never threaded through would look configured and produce nothing new,
 * and the run would still succeed.
 */

import { describe, expect, it } from 'vitest'
import { parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index'
import {
  TEST_INDEX_URL,
  fixtureText,
  loadSrc,
} from './helpers/harness.js'

const configModule = await loadSrc<any>('config.ts')
const upstreamModule = await loadSrc<any>('sources/upstream-catalog.ts')
const renderModule = await loadSrc<any>('render/index.ts')

/** A catalog that names everything differently from the upstream one. */
const FOREIGN_DOCUMENT = {
  plugins: [
    {
      name: 'thing',
      owner: 'o',
      url: 'https://github.com/o/thing',
      npm: 'dsh-thing',
      version: '1.0.0',
      added: '2026-01-01',
      security: {
        permissions: ['shell', 'network'],
        warnings: ['runs code at install time (postinstall)'],
      },
      topics: ['widget'],
      score: 42,
    },
  ],
}

const CONFIG = `
sources:
  - id: other
    kind: upstream-catalog
    url: https://example.test/catalog.json
    priority: 1
    fields:
      capabilities: security.permissions
      redLines: security.warnings
      keywords: topics
      sortKey:
        path: score
        id: score
profiles:
  - id: index
    title: {en: T}
    sources: [other]
    output: index.json
`

describe('configurable parsing: the documented example actually loads', () => {
  it('parses the two-source, two-profile example from the README', () => {
    // The example in the README is a claim about this code, so it is loaded from
    // a fixture rather than copied by hand: a documented config that does not
    // parse is worse than no documentation.
    const text = fixtureText('config.with-fields.yml')
    const config = configModule.parseConfig(text)
    expect(config.sources).toHaveLength(2)
    expect(config.profiles.map((profile: { output: string }) => profile.output)).toEqual(['index.json', 'curated.json'])
    expect(config.sources[1].fields).toEqual({
      capabilities: 'security.permissions',
      redLines: 'security.warnings',
      keywords: 'topics',
      sortKey: { path: 'score', id: 'score' },
    })
    // The curated profile keeps a star floor and both sources.
    expect(config.profiles[1].minStars).toBe(100)
    expect(config.profiles[1].sources).toEqual(['awesome-dsh-plugin', 'example-catalog'])
  })
})

describe('configurable parsing: a second catalog names its own members', () => {
  it('parses a dot path into a mapping', () => {
    const config = configModule.parseConfig(CONFIG)
    expect(config.sources[0].fields).toEqual({
      capabilities: 'security.permissions',
      redLines: 'security.warnings',
      keywords: 'topics',
      sortKey: { path: 'score', id: 'score' },
    })
  })

  it('leaves fields undefined when a source declares none', () => {
    const config = configModule.parseConfig(`
sources:
  - id: a
    kind: upstream-catalog
    url: https://example.test/a.json
profiles:
  - id: p
    title: {en: T}
    sources: [a]
    output: p.json
`)
    expect(config.sources[0].fields).toBeUndefined()
  })

  it('rejects an empty path segment, which would silently read nothing', () => {
    expect(() => configModule.parseConfig(`
sources:
  - id: a
    kind: upstream-catalog
    fields:
      capabilities: security..permissions
profiles:
  - id: p
    title: {en: T}
    sources: [a]
    output: p.json
`)).toThrow(/dot-separated/)
  })

  it('rejects a sort key without an id, which could not be referenced', () => {
    expect(() => configModule.parseConfig(`
sources:
  - id: a
    kind: upstream-catalog
    fields:
      sortKey:
        path: score
profiles:
  - id: p
    title: {en: T}
    sources: [a]
    output: p.json
`)).toThrow()
  })

  it('reads the mapped members instead of the upstream names', () => {
    const config = configModule.parseConfig(CONFIG)
    const fields = config.sources[0].fields
    const result = upstreamModule.parseUpstreamCatalog(FOREIGN_DOCUMENT, {
      sourceId: 'other', minStars: 0, fields,
    })
    const candidate = result.candidates[0]
    // `security.permissions` became capabilities, so the risk class derived from
    // `security.warnings` and the capability labels both appear.
    expect(candidate.labels).toContain('risk:install-time-code')
    expect(candidate.labels).toContain('shell')
    expect(candidate.labels).toContain('network')
    // `topics` became keywords.
    expect(candidate.keywords).toContain('widget')
    // `score` became a sort key under its configured id.
    expect(candidate.sortKeys.score).toBe(42)
  })

  it('falls back to the upstream names when no mapping is configured', () => {
    // The same entry, but with the upstream catalog's member names.
    const upstreamShaped = {
      plugins: [{
        name: 'thing', owner: 'o', url: 'https://github.com/o/thing',
        npm: 'dsh-thing', version: '1.0.0', added: '2026-01-01',
        capabilities: ['shell'],
        capabilityRedLines: ['runs code at install time (install)'],
      }],
    }
    const result = upstreamModule.parseUpstreamCatalog(upstreamShaped, { sourceId: 's', minStars: 0 })
    const candidate = result.candidates[0]
    expect(candidate.labels).toContain('shell')
    expect(candidate.labels).toContain('risk:install-time-code')
  })

  it('produces nothing extra when a mapping points at members that are absent', () => {
    // A plausible mistake: the path is wrong. It must degrade to "no labels",
    // never to a crash, because the run would otherwise fail for one bad path.
    const result = upstreamModule.parseUpstreamCatalog(FOREIGN_DOCUMENT, {
      sourceId: 'other',
      minStars: 0,
      fields: { capabilities: 'nope.missing', redLines: 'also.missing' },
    })
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0].labels).toEqual([])
  })

  it('declares a custom sort key, so the document validates', () => {
    const config = configModule.parseConfig(CONFIG)
    const result = upstreamModule.parseUpstreamCatalog(FOREIGN_DOCUMENT, {
      sourceId: 'other', minStars: 0, fields: config.sources[0].fields,
    })
    const doc = renderModule.renderIndex(result.candidates, config.profiles[0])
    // Declared, or the plugin's reference to it would fail validation.
    expect(Object.hasOwn(doc.metadata.sortKeys, 'score')).toBe(true)
    const parsed = parseMarketIndex(doc, TEST_INDEX_URL)
    expect(parsed.plugins[0]?.metadata.sortKeys.score).toBe(42)
  })
})
