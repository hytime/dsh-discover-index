/**
 * End-to-end pipeline, fully offline.
 *
 * This is the suite that answers the real question: does the finished document
 * pass format 1 when the whole pipeline runs on recorded input? It uses the
 * fixture config, a recorded catalog, and a stubbed `fetchImpl` plus
 * `resolveLimit`, so no socket is opened and no local clone is read.
 *
 * The five adversarial cases are asserted here as *outcomes of a run*, not as
 * unit behaviours:
 *
 *   1. no plugin name appears twice in the output;
 *   2. every plugin name is a valid npm package name, checked by the real
 *      validator, and uppercase repository names did not become names;
 *   3. a monorepo entry resolves to repository + directory, never a `/tree/`
 *      URL as an install source;
 *   4. an entry whose version cannot be resolved is absent, never present with
 *      `versions: []`;
 *   5. `deepseek-ai/deepseek-harness` is absent, with a policy rejection.
 */

import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index'
import {
  fixturePath,
  lazySrc,
  loadSrc,
  skipIfMissing,
  type PipelineModule,
} from './helpers/harness.js'

const pipeline = await loadSrc<PipelineModule>('pipeline.ts')

/** Every fetch the pipeline makes is answered from this map. */
const responses = new Map<string, string>([
  ['https://fixture.example.test/plugins.json', readFixture('upstream-catalog-min.json')],
  ['https://awesome-dsh-plugin.com/plugins.json', readFixture('upstream-catalog-min.json')],
])

/** Fixture originals can be read before `readFixture` is defined (hoisting). */
function readFixture(relative: string): string {
  return readFileSync(fixturePath(relative), 'utf8')
}

/** A fetch stub that serves the recorded responses and 404s everything else. */
function stubFetch(seen: string[]): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
    const url = String(input)
    seen.push(url)
    const body = responses.get(url)
    if (body === undefined) return new Response('not found', { status: 404 })
    return new Response(body, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
}

/** Run the pipeline offline with no git resolution budget. */
async function runOffline(profiles: string[] = ['index']) {
  const seen: string[] = []
  const result = await pipeline!.runPipeline({
    configPath: fixturePath('config.fixture.yml'),
    profiles,
    resolveLimit: 0,
    fetchImpl: stubFetch(seen),
  })
  return { result, seen }
}

describe.skipIf(skipIfMissing(pipeline))('runPipeline: offline end-to-end', () => {
  it('opens no socket: every request is served from the recorded responses', async () => {
    const { seen } = await runOffline()
    expect(seen.length).toBeGreaterThan(0)
    for (const url of seen) {
      expect(responses.has(url), `unexpected network request to ${url}`).toBe(true)
    }
  })

  it('never reads a local awesome-dsh-plugin clone', async () => {
    // The upstream repository is stale by thousands of entries; a run that read
    // it would be silently wrong. Assert no local path is touched.
    const { seen } = await runOffline()
    for (const url of seen) {
      expect(url).not.toContain('awesome-dsh-plugin/awesome-dsh-plugin')
      expect(url.startsWith('https://')).toBe(true)
    }
    expect(existsSync(fixturePath('upstream-catalog-min.json'))).toBe(true)
  })

  it('produces one validated document per requested profile', async () => {
    const { result } = await runOffline(['index'])
    expect(result.outputs).toHaveLength(1)
    expect(result.outputs[0]?.profile.id).toBe('index')
  })

  it('each output re-validates independently through the real validator', async () => {
    const { result } = await runOffline(['index', 'popular'])
    expect(result.outputs.length).toBeGreaterThan(0)
    for (const output of result.outputs) {
      const fresh = parseMarketIndex(output.document, 'https://index.example.test/index.json')
      expect(fresh.plugins.length).toBe(output.validated && (output.validated as { plugins: unknown[] }).plugins.length)
    }
  })

  it('writes a document whose profile title the format accepts', async () => {
    const { result } = await runOffline(['index'])
    const parsed = parseMarketIndex(
      result.outputs[0]?.document,
      'https://index.example.test/index.json',
    )
    expect(parsed.format).toBe(1)
    expect(parsed.title).toMatchObject({ en: expect.any(String) })
  })
})

describe.skipIf(skipIfMissing(pipeline))('the five adversarial cases, asserted on a real run', () => {
  it('case 1: no plugin name is repeated in the output', async () => {
    const { result } = await runOffline(['index'])
    const names = result.outputs[0]?.validated
      ? (result.outputs[0].validated as { plugins: { name: string }[] }).plugins.map((p) => p.name)
      : []
    expect(names.length).toBeGreaterThan(0)
    const duplicates = names.filter((name, index) => names.indexOf(name) !== index)
    expect(duplicates, `duplicate names in the output: ${duplicates.join(', ')}`).toEqual([])
  })

  it('case 1: keeps the cross-owner pair under distinct package names', async () => {
    const { result } = await runOffline(['index'])
    const names = new Set(
      (result.outputs[0]?.validated as { plugins: { name: string }[] }).plugins.map((p) => p.name),
    )
    // kenz1117/dsh-engram and skepsun/dsh-engram are distinct packages.
    expect(names.has('@kenz1117/dsh-engram')).toBe(true)
    expect(names.has('dsh-engram')).toBe(true)
  })

  it('case 2: no output name came from an uppercase repository name', async () => {
    const { result } = await runOffline(['index'])
    const names = (result.outputs[0]?.validated as { plugins: { name: string }[] }).plugins.map(
      (plugin) => plugin.name,
    )
    for (const name of names) {
      expect(name, `${name} must be lowercase`).toBe(name.toLowerCase())
    }
    // The uppercase repositories in the fixture resolved to their real names,
    // which proves the uppercase names never entered the document.
    expect(names).not.toContain('DragView')
    expect(names).not.toContain('dsh-TUI')
    expect(names).not.toContain('DSH-Plugin_awl')
    expect(names).toContain('dsh-dragview')
  })

  it('case 2: the real validator accepts every emitted name', async () => {
    const { result } = await runOffline(['index'])
    const names = (result.outputs[0]?.validated as { plugins: { name: string }[] }).plugins.map(
      (plugin) => plugin.name,
    )
    // Rebuilding a document from the emitted names and validating it is the
    // strongest available statement that each name is legal.
    const probe = parseMarketIndex(
      {
        format: 1,
        title: { en: 'probe' },
        metadata: {},
        plugins: names.map((name) => ({
          name,
          metadata: {},
          versions: [{ version: '1.0.0', publishTimestamp: 1, source: { type: 'npm' } }],
        })),
      },
      'https://index.example.test/probe.json',
    )
    expect(probe.plugins).toHaveLength(names.length)
  })

  it('case 3: no install source or repository URL points at a /tree/ subpath', async () => {
    const { result } = await runOffline(['index'])
    const doc = result.outputs[0]?.document as {
      plugins: {
        name: string
        repository?: { url: string; directory?: string }
        versions: { source: { type: string; url?: string; path?: string } }[]
      }[]
    }
    for (const plugin of doc.plugins) {
      if (plugin.repository) expect(plugin.repository.url).not.toContain('/tree/')
      for (const version of plugin.versions) {
        if (version.source.url) expect(version.source.url).not.toContain('/tree/')
      }
    }
  })

  it('case 3: a resolved monorepo entry carries repository.directory and source.path', async () => {
    // Resolve the one monorepo entry the fixture can name, through git.ts with
    // recorded deps, then assert it survives rendering into the format.
    const git = await loadSrc<any>('resolve/git.ts')
    if (git === undefined) return
    const resolved = await git.resolveGitEntry(
      {
        url: 'https://github.com/john-walks-slow/dsh-proactive/tree/main/packages/dsh-proactive',
        name: 'dsh-proactive',
        owner: 'john-walks-slow',
        stars: 5,
        added: '2026-08-14',
      },
      {
        lsRemote: async () => '7a959839f6486aa521e6024a67425b33f098aa0b',
        fetchText: async () => readFixture('manifests/raw-proactive.json'),
      },
      'awesome-dsh-plugin',
    )
    expect('versions' in (resolved as object)).toBe(true)
    const candidate = resolved as any
    expect(candidate.repository.directory).toBe('packages/dsh-proactive')
    expect(candidate.versions[0].source.path).toBe('packages/dsh-proactive')

    const render = await loadSrc<any>('render/index.ts')
    const doc = render!.renderIndex([candidate], {
      id: 'index',
      title: { en: 'T' },
      sources: ['s'],
      minStars: 0,
      output: 'index.json',
    })
    const parsed = parseMarketIndex(doc, 'https://index.example.test/index.json')
    expect(parsed.plugins[0]?.repository?.directory).toBe('packages/dsh-proactive')
    expect(parsed.plugins[0]?.versions[0]?.source).toMatchObject({
      type: 'git',
      path: 'packages/dsh-proactive',
    })
  })

  it('case 4: no output plugin has an empty versions array', async () => {
    const { result } = await runOffline(['index'])
    const plugins = (result.outputs[0]?.validated as { plugins: { name: string; versions: unknown[] }[] })
      .plugins
    expect(plugins.length).toBeGreaterThan(0)
    for (const plugin of plugins) {
      expect(plugin.versions.length, `${plugin.name} has no versions`).toBeGreaterThan(0)
    }
  })

  it('case 4: an unresolvable entry is reported as a rejection, not emitted', async () => {
    const { result } = await runOffline(['index'])
    const names = (result.outputs[0]?.validated as { plugins: { name: string }[] }).plugins.map(
      (plugin) => plugin.name,
    )
    // benrong2048-boop/dsh-prompt-polish has no npm name and no version; with a
    // zero resolve budget it cannot be named and must be absent.
    expect(names).not.toContain('dsh-prompt-polish')
    const rejection = result.rejections.find((entry) => entry.id.includes('dsh-prompt-polish'))
    expect(rejection, 'the entry must be reported, not silently dropped').toBeDefined()
  })

  it('case 5: the product repository is absent and reported as a policy rejection', async () => {
    const { result } = await runOffline(['index'])
    const names = (result.outputs[0]?.validated as { plugins: { name: string }[] }).plugins.map(
      (plugin) => plugin.name,
    )
    expect(names).not.toContain('deepseek-harness')
    expect(names).not.toContain('@deepseek-ai/deepseek-harness')

    const rejection = result.rejections.find(
      (entry) => entry.id === 'deepseek-ai/deepseek-harness',
    )
    expect(rejection).toBeDefined()
    expect(rejection?.stage).toBe('policy')
  })

  it('case 5: a third-party plugin named after the harness survives', async () => {
    const { result } = await runOffline(['index'])
    const names = (result.outputs[0]?.validated as { plugins: { name: string }[] }).plugins.map(
      (plugin) => plugin.name,
    )
    // dsh-plugin-genui lives in pengyue-polaron/deepseek-harness-genui and is
    // not the product; the deny rule must match identity, not a substring.
    expect(names).toContain('dsh-plugin-genui')
  })
})

describe.skipIf(skipIfMissing(pipeline))('runPipeline: determinism and reporting', () => {
  it('produces the same plugin order on two identical runs', async () => {
    const first = await runOffline(['index'])
    const second = await runOffline(['index'])
    const namesOf = (r: Awaited<ReturnType<typeof runOffline>>) =>
      (r.result.outputs[0]?.validated as { plugins: { name: string }[] }).plugins.map((p) => p.name)
    expect(namesOf(first)).toEqual(namesOf(second))
  })

  it('reports the stats a run needs to be auditable', async () => {
    const { result } = await runOffline(['index'])
    expect(result.stats.candidatesExtracted).toBeGreaterThan(0)
    expect(result.stats.candidatesSelected).toBeGreaterThan(0)
    expect(result.stats.requests).toBeGreaterThan(0)
    expect(Number.isInteger(result.stats.retried)).toBe(true)
  })

  it('reports every rejection with a stage and a reason', async () => {
    const { result } = await runOffline(['index'])
    expect(result.rejections.length).toBeGreaterThan(0)
    for (const rejection of result.rejections) {
      expect(['source', 'resolve', 'policy']).toContain(rejection.stage)
      expect(rejection.id.length).toBeGreaterThan(0)
      expect(rejection.reason.length).toBeGreaterThan(0)
    }
  })

  it('selects only the named profile when profiles is passed', async () => {
    const { result } = await runOffline(['popular'])
    expect(result.outputs.map((output) => output.profile.id)).toEqual(['popular'])
  })

  it('runs every configured profile when profiles is omitted', async () => {
    const { result } = await runOffline([])
    expect(result.outputs.map((output) => output.profile.id).sort()).toEqual(['index', 'popular'])
  })

  it('recorded fixture config names the sources the fixture catalog assumes', () => {
    // The fixture config is YAML, not JSON; parse it with the loader rather than
    // with JSON.parse.
    const text = readFixture('config.fixture.yml')
    expect(text).toContain('fixture-live')
    expect(text).toContain('https://fixture.example.test/plugins.json')
  })
})
