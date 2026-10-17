/**
 * Version history and discovery labels.
 *
 * Two capabilities that only matter because of how DSH reads a market:
 *
 *   - **Version history.** Upstream names one version per entry. DSH lists
 *     every version it can install, refuses ones the running DSH does not
 *     satisfy via `engines.dsh`, and only falls back to a prerelease when no
 *     plain version is compatible. With one version per plugin all three are
 *     moot, so the registry document is read to recover the rest.
 *   - **Labels.** Format 1 lets a market declare its own vocabulary and attach
 *     it to plugins, and the label menu is the one Discover control that can
 *     express a question the market could not answer before — "no shell
 *     access", "reads credentials and has network", "1k+ stars".
 *
 * Everything here runs against recorded registry documents, so a rule that
 * regresses fails offline rather than in a scheduled run.
 */

import { describe, expect, it } from 'vitest'
import { parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index'
import {
  TEST_INDEX_URL,
  fixtureJson,
  lazySrc,
  loadSrc,
  skipIfMissing,
  type TestCandidate,
} from './helpers/harness.js'

const npmModule = await loadSrc<any>('resolve/npm.ts')
const discoveryModule = await loadSrc<any>('resolve/discovery.ts')
const gitModule = await loadSrc<any>('resolve/git.ts')
const renderModule = await loadSrc<any>('render/index.ts')

/** The recorded registry document for one package. */
function packument(name: string): unknown {
  return fixtureJson(`npm/${name}.json`)
}

/** An upstream-shaped entry, as the source adapter would hand it to the resolver. */
function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    url: 'https://github.com/o/r',
    name: 'r',
    owner: 'o',
    npm: 'dsh-engram',
    version: '0.5.0',
    stars: 12,
    added: '2026-08-20',
    ...overrides,
  }
}

describe.skipIf(skipIfMissing(npmModule))('versionsFromPackument: the installable history', () => {
  const npm = lazySrc(npmModule, 'resolve/npm.ts')
  const { declaresBundle } = lazySrc(gitModule, 'resolve/git.ts')

  it('lists every version that declares a bundle, with its publish time', () => {
    const versions = npm.versionsFromPackument(packument('dsh-engram'), declaresBundle)
    // The recorded document holds ten versions and all declare dsh.bundle.
    expect(versions).toHaveLength(10)
    expect(versions.map((version: any) => version.version)).toContain('0.2.0')
    expect(versions.map((version: any) => version.version)).toContain('0.5.0')
    for (const version of versions) {
      expect(Number.isInteger(version.publishTimestamp)).toBe(true)
      expect(version.publishTimestamp).toBeGreaterThan(0)
      expect(version.source).toEqual({ type: 'npm' })
    }
  })

  it('carries engines.dsh only for the versions that declare one', () => {
    const versions = npm.versionsFromPackument(packument('dsh-engram'), declaresBundle)
    const withRange = versions.filter((version: any) => version.dshRange !== undefined)
    // Recorded: 0.3.7, 0.4.0 and 0.5.0 declare engines.dsh.
    expect(withRange).toHaveLength(3)
    for (const version of withRange) expect(typeof version.dshRange).toBe('string')
  })

  it('skips a version with no bundle declaration, because it cannot be installed', () => {
    const document = {
      time: { '1.0.0': '2026-01-01T00:00:00.000Z', '1.1.0': '2026-02-01T00:00:00.000Z' },
      versions: {
        '1.0.0': { name: 'x', version: '1.0.0', dsh: { bundle: { patch: './p.yml' } } },
        '1.1.0': { name: 'x', version: '1.1.0' },
      },
    }
    const versions = npm.versionsFromPackument(document, declaresBundle)
    expect(versions.map((version: any) => version.version)).toEqual(['1.0.0'])
  })

  it('skips a deprecated version, because the maintainer already said not to pick it', () => {
    const document = {
      time: { '1.0.0': '2026-01-01T00:00:00.000Z', '1.1.0': '2026-02-01T00:00:00.000Z' },
      versions: {
        '1.0.0': { name: 'x', version: '1.0.0', dsh: { bundle: { patch: './p.yml' } } },
        '1.1.0': { name: 'x', version: '1.1.0', dsh: { bundle: { patch: './p.yml' } }, deprecated: 'use 1.0.0' },
      },
    }
    const versions = npm.versionsFromPackument(document, declaresBundle)
    expect(versions.map((version: any) => version.version)).toEqual(['1.0.0'])
  })

  it.each([
    ['not a document', null],
    ['an array', []],
    ['no versions member', { time: {} }],
    ['versions not an object', { versions: 'x' }],
  ])('returns nothing for %s rather than throwing', (_label, document) => {
    expect(npm.versionsFromPackument(document, declaresBundle)).toEqual([])
  })

  it('skips a version whose publish time is missing or out of range', () => {
    const document = {
      // 1.0.0 has no time entry; 1.1.0 has an unparseable one; 1.2.0 is valid.
      time: { '1.1.0': 'not a date', '1.2.0': '2026-03-01T00:00:00.000Z' },
      versions: {
        '1.0.0': { dsh: { bundle: { patch: './p.yml' } } },
        '1.1.0': { dsh: { bundle: { patch: './p.yml' } } },
        '1.2.0': { dsh: { bundle: { patch: './p.yml' } } },
      },
    }
    const versions = npm.versionsFromPackument(document, declaresBundle)
    expect(versions.map((version: any) => version.version)).toEqual(['1.2.0'])
  })
})

describe.skipIf(skipIfMissing(npmModule))('withPackument: keeping what upstream said', () => {
  const npm = lazySrc(npmModule, 'resolve/npm.ts')
  const { declaresBundle } = lazySrc(gitModule, 'resolve/git.ts')

  function candidateFor(overrides: Record<string, unknown> = {}): TestCandidate {
    return npm.npmCandidate(entry(overrides), 'a-source')
  }

  it('replaces the single upstream version with the full history, newest first', () => {
    const before = candidateFor()
    expect(before.versions).toHaveLength(1)
    const after = npm.withPackument(before, packument('dsh-engram'), declaresBundle)
    expect(after.versions.length).toBeGreaterThan(1)
    expect(after.versions[0].version).toBe('0.5.0')
    expect(after.versions.at(-1).version).toBe('0.2.0')
  })

  it('keeps the upstream version when the registry does not list it', () => {
    // Upstream pins a version the registry no longer serves. Silently replacing
    // it would change what the market installs.
    const before = candidateFor({ version: '9.9.9' })
    const after = npm.withPackument(before, packument('dsh-engram'), declaresBundle)
    expect(after.versions.map((version: any) => version.version)).toContain('9.9.9')
  })

  it('keeps the single version when the registry document is unusable', () => {
    const before = candidateFor()
    const after = npm.withPackument(before, undefined, declaresBundle)
    expect(after.versions).toEqual(before.versions)
  })

  it('preserves every other field of the candidate', () => {
    const before = candidateFor()
    const after = npm.withPackument(before, packument('dsh-engram'), declaresBundle)
    expect(after.name).toBe(before.name)
    expect(after.labels).toEqual(before.labels)
    expect(after.keywords).toEqual(before.keywords)
    expect(after.sortKeys).toEqual(before.sortKeys)
    expect(after.provenance).toEqual(before.provenance)
  })

  it('produces a version list the real validator accepts, sorted by precedence', () => {
    const before = candidateFor()
    const after = npm.withPackument(before, packument('dsh-engram'), declaresBundle)
    const doc = {
      format: 1,
      title: { en: 'T' },
      metadata: {},
      plugins: [{ name: after.name, versions: after.versions }],
    }
    const parsed = parseMarketIndex(doc, TEST_INDEX_URL)
    expect(parsed.plugins[0]?.versions.length).toBe(after.versions.length)
    // The validator sorts by descending SemVer precedence; assert it did.
    const versions = parsed.plugins[0]?.versions.map((version) => version.version) ?? []
    expect(versions[0]).toBe('0.5.0')
  })
})

describe.skipIf(skipIfMissing(discoveryModule))('discovery labels', () => {
  const discovery = lazySrc(discoveryModule, 'resolve/discovery.ts')

  it('turns capability ids into labels, in upstream order', () => {
    expect(discovery.labelsFor(['fs-read', 'network'], [])).toEqual(['fs-read', 'network'])
  })

  it('normalises the 86 red-line sentences into a handful of stable classes', () => {
    expect(discovery.riskClassFor('reads credentials/secrets AND has network access'))
      .toBe('risk:credentials-and-network')
    expect(discovery.riskClassFor('runs code at install time (postinstall)'))
      .toBe('risk:install-time-code')
    expect(discovery.riskClassFor('runs code at install time (install)'))
      .toBe('risk:install-time-code')
    expect(discovery.riskClassFor('uses literal IP 169.254.169.254 for network access'))
      .toBe('risk:literal-ip')
    expect(discovery.riskClassFor('uses plaintext http:// to api.bilibili.com'))
      .toBe('risk:plaintext-http')
    expect(discovery.riskClassFor('something nobody classified')).toBeUndefined()
  })

  it('puts risk classes before capabilities, so the menu leads with warnings', () => {
    const labels = discovery.labelsFor(['shell', 'network'], ['reads credentials/secrets AND has network access'])
    expect(labels[0]).toBe('risk:credentials-and-network')
    expect(labels).toContain('shell')
    expect(labels).toContain('network')
  })

  it('does not duplicate a label or a risk class', () => {
    const labels = discovery.labelsFor(
      ['shell', 'shell', 'network'],
      ['reads credentials/secrets AND has network access', 'reads credentials/secrets AND has network access'],
    )
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('gives every label id a title, including ids it has never seen', () => {
    for (const id of discovery.labelsFor(['fs-write', 'some-future-capability'], ['uses literal IP 1.2.3.4 for network access'])) {
      const title = discovery.labelTitle(id)
      expect(Object.keys(title).length).toBeGreaterThan(0)
      expect(title.en).toBeTruthy()
    }
    // An unknown id is titled with itself rather than becoming a failure.
    expect(discovery.labelTitle('some-future-capability').en).toBe('some-future-capability')
  })

  it('buckets popularity so the filter menu stays a closed vocabulary', () => {
    // Four buckets for stars plus the zero bucket; measured against the live
    // catalog this is the whole scale. Exact values would need 235 labels.
    expect(discovery.popularityLabels(1200, undefined)).toEqual(['stars:1k+'])
    expect(discovery.popularityLabels(150, undefined)).toEqual(['stars:100+'])
    expect(discovery.popularityLabels(12, undefined)).toEqual(['stars:10+'])
    expect(discovery.popularityLabels(1, undefined)).toEqual(['stars:1+'])
    expect(discovery.popularityLabels(0, undefined)).toEqual(['stars:0'])
  })

  it('puts a value in exactly one star bucket, so a filter cannot return everything', () => {
    // Nesting the buckets would make `stars:1+` match the whole market.
    for (const stars of [0, 1, 9, 10, 99, 100, 999, 1000, 5000]) {
      const labels = discovery.popularityLabels(stars, undefined)
      expect(labels).toHaveLength(1)
    }
  })

  it('omits the bucket when the value is unknown rather than reporting zero', () => {
    // 624 live entries carry no star count. Writing 0 would assert a fact we do
    // not have, and would put them in the "no stars yet" bucket.
    expect(discovery.popularityLabels(undefined, undefined)).toEqual([])
  })

  it('adds a downloads bucket alongside the star bucket', () => {
    expect(discovery.popularityLabels(500, 20_000)).toEqual(['stars:100+', 'downloads:10k+'])
  })
})

describe.skipIf(skipIfMissing(renderModule))('renderIndex: labels are declared and referenced consistently', () => {
  const render = lazySrc(renderModule, 'render/index.ts')

  const profile = {
    id: 'index',
    title: { en: 'T', zh: 'T' },
    sources: ['s'],
    minStars: 0,
    output: 'index.json',
  }

  function candidate(labels: string[]): TestCandidate {
    return {
      name: 'dsh-labels',
      keywords: ['dsh'],
      labels,
      sortKeys: {},
      versions: [{ version: '1.0.0', publishTimestamp: 1_700_000_000, source: { type: 'npm' } }],
      provenance: ['s'],
    }
  }

  it('declares every label a plugin references, so the document validates', () => {
    const labels = ['risk:credentials-and-network', 'shell', 'stars:1k+', 'downloads:100+']
    const doc = render.renderIndex([candidate(labels)], profile)
    const parsed = parseMarketIndex(doc, TEST_INDEX_URL)
    expect(parsed.plugins[0]?.metadata.labels).toEqual(labels)
    for (const id of labels) {
      expect(Object.hasOwn(parsed.metadata.labels, id), `${id} must be declared`).toBe(true)
    }
  })

  it('titles a known label in both languages and an unknown one with its id', () => {
    const doc = render.renderIndex([candidate(['stars:1k+', 'mystery-label'])], profile) as any
    expect(doc.metadata.labels['stars:1k+'].title).toMatchObject({ en: expect.stringContaining('1k+') })
    expect(doc.metadata.labels['stars:1k+'].title.zh).toBeTruthy()
    expect(doc.metadata.labels['mystery-label'].title.en).toBe('mystery-label')
  })

  it('declares no label when no plugin carries one', () => {
    const doc = render.renderIndex([candidate([])], profile) as any
    expect(doc.metadata.labels).toEqual({})
  })
})
