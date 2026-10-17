/**
 * Configuration loading, and the shipped `config/config.yml` itself.
 *
 * The shipped file is covered because it is the one input that is not a
 * fixture: if it stops parsing, every profile disappears at once, and the
 * failure would otherwise only surface in CI. The fixture config is what the
 * offline pipeline tests read.
 */

import { describe, expect, it } from 'vitest'
import {
  fixtureJson,
  fixturePath,
  fixtureText,
  lazySrc,
  loadSrc,
  skipIfMissing,
  srcPath,
  type ConfigModule,
} from './helpers/harness.js'
import { existsSync, readFileSync } from 'node:fs'

const configModule = await loadSrc<ConfigModule>('config.ts')

describe('shipped config/config.yml', () => {
  it('exists and is readable', () => {
    expect(existsSync(srcPath('../config/config.yml'))).toBe(true)
    expect(readFileSync(srcPath('../config/config.yml'), 'utf8').length).toBeGreaterThan(0)
  })

  it.skipIf(skipIfMissing(configModule))('parses into a config the pipeline can use', () => {
    const config = lazySrc(configModule, 'config.ts').loadConfig('config/config.yml')
    expect(config.sources.length).toBeGreaterThan(0)
    expect(config.profiles.length).toBeGreaterThan(0)
  })

  it.skipIf(skipIfMissing(configModule))('points at the LIVE catalog, not a local clone', () => {
    const config = lazySrc(configModule, 'config.ts').loadConfig('config/config.yml')
    const upstream = config.sources.find((source) => source.kind === 'upstream-catalog')
    expect(upstream).toBeDefined()
    expect(upstream?.url).toBe('https://awesome-dsh-plugin.com/plugins.json')
  })

  it.skipIf(skipIfMissing(configModule))('denies the product repository', () => {
    const config = lazySrc(configModule, 'config.ts').loadConfig('config/config.yml')
    expect(config.denyRepos).toContain('deepseek-ai/deepseek-harness')
  })

  it.skipIf(skipIfMissing(configModule))('names the upstream source in every profile that uses it', () => {
    const config = lazySrc(configModule, 'config.ts').loadConfig('config/config.yml')
    const ids = new Set(config.sources.map((source) => source.id))
    for (const profile of config.profiles) {
      expect(profile.sources.length).toBeGreaterThan(0)
      for (const id of profile.sources) expect(ids.has(id)).toBe(true)
    }
  })

  it.skipIf(skipIfMissing(configModule))('records the converter repository in every profile description', () => {
    // Provenance has to travel with the document, not only live in this
    // repository: a user who finds the market in Discover sees the profile
    // description and nothing else. DSH truncates that text at 300 UTF-16 code
    // units when it hands it to the model, so the URL must be present and the
    // whole string short enough not to be clipped.
    //
    // Deliberately not asserted against this repository's own URL: a fork
    // republishes the same converter under its own name, and a hardcoded
    // assertion here would fail every fork on the first push. What must hold is
    // that the description names *a* repository, so the check is for the shape.
    const config = lazySrc(configModule, 'config.ts').loadConfig('config/config.yml')
    for (const profile of config.profiles) {
      for (const language of ['en', 'zh']) {
        const text = profile.description?.[language]
        expect(text, `${profile.id} has no ${language} description`).toBeTruthy()
        expect(text, `${profile.id}.${language} must name the source repository`)
          .toMatch(/https:\/\/github\.com\/[^\s/]+\/[^\s/]+/u)
        expect(text!.length, `${profile.id}.${language} exceeds DSH's 300-unit clip`)
          .toBeLessThanOrEqual(300)
      }
    }
  })

  it.skipIf(skipIfMissing(configModule))('gives every profile a distinct bare *.json output', () => {
    const config = lazySrc(configModule, 'config.ts').loadConfig('config/config.yml')
    const outputs = config.profiles.map((profile) => profile.output)
    expect(new Set(outputs).size).toBe(outputs.length)
    for (const output of outputs) {
      expect(output).toMatch(/^[^/]+\.json$/)
      expect(output).not.toContain('..')
    }
  })

  it.skipIf(skipIfMissing(configModule))('uses the default path when none is given', () => {
    const module_ = lazySrc(configModule, 'config.ts')
    expect(module_.DEFAULT_CONFIG_PATH).toBe('config/config.yml')
    expect(() => module_.loadConfig()).not.toThrow()
  })
})

describe.skipIf(skipIfMissing(configModule))('parseConfig: rejection of unusable configurations', () => {
  const config_ = lazySrc(configModule, 'config.ts')

  it('parses the offline fixture config', () => {
    const config = config_.parseConfig(fixtureText('config.fixture.yml'), 'config.fixture.yml')
    expect(config.sources.map((source) => source.id)).toEqual(['fixture-live', 'fixture-secondary'])
    expect(config.profiles.map((profile) => profile.id)).toEqual(['index', 'popular'])
    expect(config.denyRepos).toContain('deepseek-ai/deepseek-harness')
    expect(config.denyPackages).toContain('dsh-banned-package')
    expect(config.sources[0]?.url).toBe('https://fixture.example.test/plugins.json')
    expect(config.sources[0]?.priority).toBe(10)
    expect(config.sources[1]?.minStars).toBe(5)
  })

  it('loads the fixture config from disk by path, so tests need no network', () => {
    const config = config_.loadConfig(fixturePath('config.fixture.yml'))
    expect(config.profiles).toHaveLength(2)
  })

  it('rejects invalid YAML', () => {
    expect(() => config_.parseConfig('sources: [:::', 'x.yml')).toThrow()
  })

  it('rejects a document with no sources', () => {
    expect(() => config_.parseConfig('profiles:\n  - id: p\n    title: {en: P}\n    sources: [a]\n    output: a.json\n')).toThrow()
  })

  it('rejects a document with no profiles', () => {
    expect(() => config_.parseConfig('sources:\n  - id: a\n    kind: upstream-catalog\n')).toThrow()
  })

  it('rejects an unknown source kind', () => {
    expect(() =>
      config_.parseConfig(
        'sources:\n  - id: a\n    kind: not-a-kind\nprofiles:\n  - id: p\n    title: {en: P}\n    sources: [a]\n    output: a.json\n',
      ),
    ).toThrow()
  })

  it('rejects duplicate source ids', () => {
    expect(() =>
      config_.parseConfig(
        'sources:\n  - {id: a, kind: upstream-catalog}\n  - {id: a, kind: upstream-catalog}\n' +
          'profiles:\n  - id: p\n    title: {en: P}\n    sources: [a]\n    output: a.json\n',
      ),
    ).toThrow()
  })

  it('rejects a profile naming an unknown source', () => {
    expect(() =>
      config_.parseConfig(
        'sources:\n  - {id: a, kind: upstream-catalog}\n' +
          'profiles:\n  - id: p\n    title: {en: P}\n    sources: [ghost]\n    output: a.json\n',
      ),
    ).toThrow()
  })

  it('rejects an output path that is not a bare *.json filename', () => {
    // Two profiles writing the same file, or writing outside dist/, would mean
    // one document silently replacing another at publish time.
    for (const output of ['../escape.json', 'sub/dir.json', 'index.txt']) {
      expect(() =>
        config_.parseConfig(
          `sources:\n  - {id: a, kind: upstream-catalog}\n` +
            `profiles:\n  - id: p\n    title: {en: P}\n    sources: [a]\n    output: ${output}\n`,
        ),
        `output ${output} must be rejected`,
      ).toThrow()
    }
  })

  it('rejects two profiles writing the same output', () => {
    expect(() =>
      config_.parseConfig(
        'sources:\n  - {id: a, kind: upstream-catalog}\n' +
          'profiles:\n' +
          '  - {id: p1, title: {en: P1}, sources: [a], output: same.json}\n' +
          '  - {id: p2, title: {en: P2}, sources: [a], output: same.json}\n',
      ),
    ).toThrow()
  })

  it('rejects a title with no language', () => {
    expect(() =>
      config_.parseConfig(
        'sources:\n  - {id: a, kind: upstream-catalog}\n' +
          'profiles:\n  - {id: p, title: {}, sources: [a], output: a.json}\n',
      ),
    ).toThrow()
  })

  it('reports a missing file rather than returning an empty config', () => {
    expect(() => config_.loadConfig('/nonexistent/config.yml')).toThrow()
  })

  it('defaults enabled to true and minStars to 0', () => {
    const config = config_.parseConfig(
      'sources:\n  - {id: a, kind: upstream-catalog}\n' +
        'profiles:\n  - {id: p, title: {en: P}, sources: [a], output: a.json}\n',
    )
    expect(config.sources[0]?.enabled).toBe(true)
    expect(config.sources[0]?.minStars).toBe(0)
    expect(config.sources[0]?.priority).toBe(0)
    expect(config.denyRepos).toEqual([])
    expect(config.denyPackages).toEqual([])
  })
})

describe('fixtures: provenance', () => {
  it('records the live upstream hash and the adversarial counts', () => {
    const meta = fixtureJson<{
      upstream: { sha256: string; catalogCount: number; fetchedEntryCount: number }
      reconCounts: Record<string, number>
      reconDefinitions: Record<string, string>
    }>('meta.json')
    expect(meta.upstream.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(meta.upstream.catalogCount).toBe(5704)
    expect(meta.upstream.fetchedEntryCount).toBe(5704)
    expect(meta.reconCounts['duplicateBasenames_caseInsensitive_rootLevelRepos']).toBe(271)
    expect(meta.reconCounts['entriesWithUppercaseInUpstreamNameField']).toBe(225)
    expect(meta.reconCounts['entriesOwnedBy_deepseek_ai']).toBe(0)
    for (const key of Object.keys(meta.reconCounts)) {
      if (key.startsWith('upstream')) continue
      expect(meta.reconDefinitions[key], `${key} needs a recorded definition`).toBeTruthy()
    }
  })

  it('carries every adversarial case inside the recorded subset', () => {
    const catalog = fixtureJson<{ plugins: Record<string, unknown>[] }>('upstream-catalog-min.json')
    const names = catalog.plugins.map((plugin) => String(plugin['name']))

    // case 1: the same basename from two owners
    expect(names.filter((name) => name === 'dsh-engram')).toHaveLength(2)
    // case 2: a repository name with uppercase, resolved to a lowercase package
    expect(names).toContain('DragView')
    expect(names).toContain('dsh-TUI')
    // case 3: a monorepo subpath URL
    expect(
      catalog.plugins.some((plugin) => String(plugin['url']).includes('/tree/')),
    ).toBe(true)
    // case 4: an entry with no resolvable version
    expect(catalog.plugins.some((plugin) => plugin['npm'] == null)).toBe(true)
    // case 5: the deny-list control
    expect(catalog.plugins.some((plugin) => plugin['owner'] === 'deepseek-ai')).toBe(true)
  })

  it('records npm and manifest fixtures whose names differ from repository names', () => {
    const manifest = fixtureJson<{ name: string; version: string }>('manifests/raw-dragview.json')
    expect(manifest.name).toBe('dsh-dragview')
    expect(manifest.version).toBe('0.1.1')

    const packument = fixtureJson<{ name: string; 'dist-tags': { latest: string } }>(
      'npm/dsh-proactive.json',
    )
    expect(packument.name).toBe('dsh-proactive')
    expect(packument['dist-tags'].latest).toBe('0.3.1')
  })
})
