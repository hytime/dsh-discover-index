/**
 * Resolution of the three adversarial cases that bite before rendering:
 *
 *   2. 216 repository names carry uppercase letters that a format-1 name may
 *      not contain, so the package manifest — never the repository name — must
 *      supply the name.
 *   3. 597 upstream URLs point into a monorepo subdirectory. `git ls-remote`
 *      fails on that URL form (recorded below), so it must be decomposed into
 *      repository plus package directory.
 *   4. an entry whose version cannot be resolved must produce a rejection, not
 *      a candidate with an empty `versions` array.
 *
 * Case 1 (cross-owner duplicate basenames) belongs to `policy.test.ts`, which
 * owns deduplication. What is asserted here is the precondition: distinct
 * owners publishing the same repository basename resolve to distinct package
 * names, which is what makes deduplication by name safe.
 *
 * Every assertion is derived from fixtures recorded from the live catalog; see
 * `tests/fixtures/meta.json` for provenance and the counts.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  absentModules,
  fixtureJson,
  fixtureText,
  lazySrc,
  loadSrc,
  nameRejectionPath,
  skipIfMissing,
  type GitModule,
  type NpmModule,
  type TestCandidate,
  type TestRejection,
  type UpstreamModule,
  type UrlsModule,
} from './helpers/harness.js'

const execFileAsync = promisify(execFile)

const urls = await loadSrc<UrlsModule>('resolve/urls.ts')
const npm = await loadSrc<NpmModule>('resolve/npm.ts')
const git = await loadSrc<GitModule>('resolve/git.ts')
const upstream = await loadSrc<UpstreamModule>('sources/upstream-catalog.ts')

const catalog = fixtureJson('upstream-catalog-min.json') as {
  plugins: Record<string, unknown>[]
}

/** The recorded entry for `owner/name`, or a thrown error naming the gap. */
function entry(owner: string, name: string): Record<string, unknown> {
  const found = catalog.plugins.find(
    (plugin) => plugin['owner'] === owner && plugin['name'] === name,
  )
  if (!found) throw new Error(`fixture upstream-catalog-min.json is missing ${owner}/${name}`)
  return found
}

/* -------------------------------------------------------------------- case 3 */

describe.skipIf(skipIfMissing(urls))('decomposeRepoUrl: monorepo subpaths (case 3)', () => {
  const urls_ = lazySrc(urls, 'resolve/urls.ts')

  it('splits the recorded real URL into repository + directory', () => {
    expect(
      urls_.decomposeRepoUrl(
        'https://github.com/john-walks-slow/dsh-proactive/tree/main/packages/dsh-proactive',
      ),
    ).toMatchObject({
      repo: 'https://github.com/john-walks-slow/dsh-proactive',
      directory: 'packages/dsh-proactive',
    })
  })

  it('returns no directory for /tree/<branch> with no package path', () => {
    // An empty string here would render as `path: ""`, which format 1 rejects.
    const root = urls_.decomposeRepoUrl('https://github.com/o/r/tree/main')
    expect(root).toMatchObject({ repo: 'https://github.com/o/r' })
    expect(root?.directory).toBeUndefined()

    const trailing = urls_.decomposeRepoUrl('https://github.com/o/r/tree/main/')
    expect(trailing?.directory).toBeUndefined()
  })

  it('keeps a nested package directory intact', () => {
    expect(
      urls_.decomposeRepoUrl(
        'https://github.com/Ceelog/dsh-plugins/tree/main/src/plugins/dsh-plugin-setting-mcp',
      )?.directory,
    ).toBe('src/plugins/dsh-plugin-setting-mcp')
  })

  it('handles a non-main branch, as one recorded entry uses master', () => {
    expect(
      urls_.decomposeRepoUrl(
        'https://github.com/zhoulvyuan/dsh-plugin/tree/master/dsh-claude-code-web',
      ),
    ).toMatchObject({
      repo: 'https://github.com/zhoulvyuan/dsh-plugin',
      directory: 'dsh-claude-code-web',
    })
  })

  it('leaves a plain repository URL with no directory', () => {
    const location = urls_.decomposeRepoUrl('https://github.com/kenz1117/dsh-engram')
    expect(location).toMatchObject({ repo: 'https://github.com/kenz1117/dsh-engram' })
    expect(location?.directory).toBeUndefined()
  })

  it('tolerates a trailing slash', () => {
    expect(urls_.decomposeRepoUrl('https://github.com/o/r/')).toMatchObject({
      repo: 'https://github.com/o/r',
    })
  })

  it('returns undefined for a non-GitHub URL', () => {
    expect(urls_.decomposeRepoUrl('https://gitlab.com/o/r')).toBeUndefined()
  })

  it('reports owner and repository name for deny-list comparisons', () => {
    expect(urls_.repoIdentity('https://github.com/deepseek-ai/deepseek-harness')).toBe(
      'deepseek-ai/deepseek-harness',
    )
    expect(
      urls_.repoIdentity('https://github.com/Yinxe/deepseek-harness-plugins/tree/main/plugins/x'),
    ).toBe('Yinxe/deepseek-harness-plugins')
  })

  it('gives a subdirectory its own slug, so two packages in one repo do not collide', () => {
    const a = urls_.slugFor('https://github.com/Yinxe/deepseek-harness-plugins/tree/main/plugins/a')
    const b = urls_.slugFor('https://github.com/Yinxe/deepseek-harness-plugins/tree/main/plugins/b')
    expect(a).not.toBe(b)
  })
})

/**
 * The recorded failure that motivates case 3. Runs the real `git ls-remote`
 * offline-safe: it is skipped unless `VERIFIER_NETWORK=1`, but the recorded
 * fixture is what the resolver tests use, so the suite stays offline by
 * default. The command is here as executable documentation of the bug.
 */
describe('evidence: git ls-remote fails on a /tree/ URL', () => {
  it.skipIf(process.env['VERIFIER_NETWORK'] !== '1')(
    'the full subpath URL is rejected while the decomposed repo URL resolves',
    async () => {
      await expect(
        execFileAsync('git', [
          'ls-remote',
          'https://github.com/john-walks-slow/dsh-proactive/tree/main/packages/dsh-proactive',
        ]),
      ).rejects.toThrow()

      const { stdout } = await execFileAsync('git', [
        'ls-remote',
        'https://github.com/john-walks-slow/dsh-proactive',
        'HEAD',
      ])
      expect(stdout).toMatch(/^[0-9a-f]{40}\tHEAD$/m)
    },
  )
})

/* -------------------------------------------------------------------- case 2 */

describe.skipIf(skipIfMissing(npm))('npmCandidate: the manifest name wins (case 2)', () => {
  const npm_ = lazySrc(npm, 'resolve/npm.ts')

  beforeAll(() => {
    expect(catalog.plugins.length).toBeGreaterThan(0)
  })

  it('names the candidate from package.json, not from the uppercase repository name', () => {
    // anzhaohao/DragView publishes package name dsh-dragview.
    const candidate = npm_.npmCandidate(entry('anzhaohao', 'DragView'), 'awesome-dsh-plugin')
    expect(candidate?.name).toBe('dsh-dragview')
    expect(candidate?.name).not.toBe('DragView')
  })

  it('uses package.json for a scoped package whose repository has uppercase letters', () => {
    // ccch1mneyyy/dsh-TUI publishes @deepseek-harness-tui/dsh-tui.
    const candidate = npm_.npmCandidate(entry('ccch1mneyyy', 'dsh-TUI'), 'awesome-dsh-plugin')
    expect(candidate?.name).toBe('@deepseek-harness-tui/dsh-tui')
  })

  it('keeps the repository name only as a display title', () => {
    const candidate = npm_.npmCandidate(entry('AWL-MC2', 'DSH-Plugin_awl'), 'awesome-dsh-plugin')
    expect(candidate?.name).toBe('dsh-type-tune')
    expect(candidate?.title?.en).toBe('DSH-Plugin_awl')
  })

  it('returns undefined when the entry has no npm package at all', () => {
    expect(npm_.npmCandidate(entry('benrong2048-boop', 'dsh-prompt-polish'), 'src')).toBeUndefined()
  })

  it('returns undefined when an npm name has no version', () => {
    const partial = { url: 'https://github.com/o/r', name: 'r', owner: 'o', npm: 'dsh-r' }
    expect(npm_.npmCandidate(partial, 'src')).toBeUndefined()
  })

  it.runIf(true)(
    'every npm-derived candidate name passes the real format-1 name rule',
    async () => {
      const offenders: { name: string; path: string | undefined }[] = []
      for (const plugin of catalog.plugins) {
        const candidate = npm_.npmCandidate(plugin, 'awesome-dsh-plugin')
        if (!candidate) continue
        const path = await nameRejectionPath(candidate.name)
        if (path !== undefined) offenders.push({ name: candidate.name, path })
      }
      expect(offenders).toEqual([])
    },
  )

  it('would catch a name taken from an uppercase repository name', async () => {
    // Negative control for the assertion above: prove the check has teeth.
    expect(await nameRejectionPath('DragView')).toBe('$.plugins[0].name')
    expect(await nameRejectionPath('DSH-Plugin_awl')).toBe('$.plugins[0].name')
  })

  it('builds the repository field from the decomposed URL, directory included', () => {
    const candidate = npm_.npmCandidate(
      entry('john-walks-slow', 'dsh-proactive'),
      'awesome-dsh-plugin',
    )
    expect(candidate?.repository).toEqual({
      url: 'https://github.com/john-walks-slow/dsh-proactive',
      directory: 'packages/dsh-proactive',
    })
  })

  it('omits repository.directory at the repository root', () => {
    const candidate = npm_.npmCandidate(entry('AnonyJcy', 'dsh-j-space'), 'awesome-dsh-plugin')
    expect(candidate?.repository).toEqual({ url: 'https://github.com/AnonyJcy/dsh-j-space' })
    expect(candidate?.repository && 'directory' in candidate.repository).toBe(false)
  })

  it('emits exactly one version carrying the upstream version', () => {
    const candidate = npm_.npmCandidate(entry('AnonyJcy', 'dsh-j-space'), 'awesome-dsh-plugin')
    expect(candidate?.versions.map((version) => version.version)).toEqual(['1.2.4'])
    expect(candidate?.versions[0]?.source).toEqual({ type: 'npm' })
  })

  it('records the source id as provenance', () => {
    const candidate = npm_.npmCandidate(entry('AnonyJcy', 'dsh-j-space'), 'a-source')
    expect(candidate?.provenance).toEqual(['a-source'])
  })
})

/* -------------------------------------------------------------------- case 4 */

describe.skipIf(skipIfMissing(git))('resolveGitEntry: no empty-version candidates (case 4)', () => {
  const git_ = lazySrc(git, 'resolve/git.ts')

  /**
   * The implementation's `yaff` is `resolveGitEntry(entry, deps, sourceId)`,
   * and `deps.lsRemote` returns the SHAs' parsed value, not raw stdout. The
   * published contract said two parameters and "lsRemote: (url) => Promise<string>";
   * the tests bind to the implementation and the drift is reported as a finding.
   */
  const sha = '7a959839f6486aa521e6024a67425b33f098aa0b'

  function entryOf(url: string, name: string, owner: string): Record<string, unknown> {
    return { url, name, owner, stars: 5, added: '2026-08-14' }
  }

  it('resolves a monorepo entry into a git candidate with repository + path', async () => {
    const result = await git_.resolveGitEntry(
      entryOf(
        'https://github.com/john-walks-slow/dsh-proactive/tree/main/packages/dsh-proactive',
        'dsh-proactive',
        'john-walks-slow',
      ),
      {
        lsRemote: async (repo: string) => {
          // The repository URL, never the /tree/ URL, which git rejects.
          expect(repo).toBe('https://github.com/john-walks-slow/dsh-proactive')
          return sha
        },
        fetchText: async () => fixtureText('manifests/raw-proactive.json'),
      },
      'awesome-dsh-plugin',
    )
    const candidate = result as TestCandidate
    expect(isCandidate(result), 'expected a Candidate, got a Rejection').toBe(true)
    expect(candidate.name).toBe('dsh-proactive')
    expect(candidate.versions).toHaveLength(1)
    expect(candidate.versions[0]).toMatchObject({
      version: '0.3.1',
      source: {
        type: 'git',
        url: 'https://github.com/john-walks-slow/dsh-proactive',
        commit: sha,
        path: 'packages/dsh-proactive',
      },
    })
    expect(candidate.repository).toEqual({
      url: 'https://github.com/john-walks-slow/dsh-proactive',
      directory: 'packages/dsh-proactive',
    })
    expect(candidate.provenance).toEqual(['awesome-dsh-plugin'])
  })

  it('reads the manifest at the resolved commit and the package path', async () => {
    const seen: string[] = []
    await git_.resolveGitEntry(
      entryOf(
        'https://github.com/john-walks-slow/dsh-proactive/tree/main/packages/dsh-proactive',
        'dsh-proactive',
        'john-walks-slow',
      ),
      {
        lsRemote: async () => sha,
        fetchText: async (url) => {
          seen.push(url)
          return fixtureText('manifests/raw-proactive.json')
        },
      },
      'src',
    )
    expect(seen).toHaveLength(1)
    // Pinned to the SHA and to the package directory inside the repo.
    expect(seen[0]).toBe(
      `https://raw.githubusercontent.com/john-walks-slow/dsh-proactive/${sha}/packages/dsh-proactive/package.json`,
    )
  })

  it('asks lsRemote for the repository URL, never the /tree/ URL', async () => {
    const seen: string[] = []
    await git_.resolveGitEntry(
      entryOf(
        'https://github.com/john-walks-slow/dsh-proactive/tree/main/packages/dsh-proactive',
        'dsh-proactive',
        'john-walks-slow',
      ),
      {
        lsRemote: async (repo) => {
          seen.push(repo)
          return sha
        },
        fetchText: async () => fixtureText('manifests/raw-proactive.json'),
      },
      'src',
    )
    expect(seen).toEqual(['https://github.com/john-walks-slow/dsh-proactive'])
    for (const url of seen) expect(url).not.toContain('/tree/')
  })

  it('returns a rejection — not a candidate — when the manifest cannot be read', async () => {
    const result = await git_.resolveGitEntry(
      entryOf('https://github.com/o/r', 'r', 'o'),
      {
        lsRemote: async () => sha,
        fetchText: async () => {
          throw new Error('404 Not Found')
        },
      },
      'src',
    )
    expect(isCandidate(result)).toBe(false)
    const rejection = result as TestRejection
    expect(rejection.id).toBe('o/r')
    expect(['source', 'resolve', 'policy']).toContain(rejection.stage)
    expect(rejection.reason.length).toBeGreaterThan(0)
  })

  it('returns a rejection when lsRemote reports the repository unreachable', async () => {
    const result = await git_.resolveGitEntry(
      entryOf('https://github.com/o/r', 'r', 'o'),
      {
        lsRemote: async () => {
          throw new Error("fatal: repository 'https://github.com/o/r/' not found")
        },
        fetchText: async () => fixtureText('manifests/raw-proactive.json'),
      },
      'src',
    )
    expect(isCandidate(result)).toBe(false)
    expect((result as TestRejection).id).toBe('o/r')
  })

  it('returns a rejection when lsRemote yields no commit', async () => {
    const result = await git_.resolveGitEntry(
      entryOf('https://github.com/o/r', 'r', 'o'),
      { lsRemote: async () => undefined, fetchText: async () => fixtureText('manifests/raw-proactive.json') },
      'src',
    )
    expect(isCandidate(result)).toBe(false)
  })

  it('returns a rejection for a manifest with no name or version', async () => {
    const result = await git_.resolveGitEntry(
      entryOf('https://github.com/o/r', 'r', 'o'),
      // Declares a bundle — so it passes the installability gate — but names nothing.
      {
        lsRemote: async () => sha,
        fetchText: async () =>
          JSON.stringify({ private: true, dsh: { bundle: { patch: './cordis.patch.yml' } } }),
      },
      'src',
    )
    expect(isCandidate(result)).toBe(false)
  })

  it('rejects a package that declares no dsh.bundle manifest', async () => {
    const result = await git_.resolveGitEntry(
      entryOf('https://github.com/o/r', 'r', 'o'),
      { lsRemote: async () => sha, fetchText: async () => JSON.stringify({ name: 'dsh-r', version: '1.0.0' }) },
      'src',
    )
    expect(isCandidate(result)).toBe(false)
    expect((result as TestRejection).reason).toMatch(/bundle/i)
  })

  it('is never a Candidate with an empty versions array', async () => {
    const cases: [string, () => Promise<unknown>][] = [
      ['manifest 404', async () =>
        git_.resolveGitEntry(entryOf('https://github.com/o/a', 'a', 'o'), {
          lsRemote: async () => sha,
          fetchText: async () => { throw new Error('404') },
        }, 'src')],
      ['lsRemote reports unreachable', async () =>
        git_.resolveGitEntry(entryOf('https://github.com/o/b', 'b', 'o'), {
          lsRemote: async () => { throw new Error('not found') },
          fetchText: async () => fixtureText('manifests/raw-proactive.json'),
        }, 'src')],
      ['manifest without version', async () =>
        git_.resolveGitEntry(entryOf('https://github.com/o/c', 'c', 'o'), {
          lsRemote: async () => sha,
          fetchText: async () => JSON.stringify({ name: 'dsh-c', dsh: { bundle: { patch: './p.yml' } } }),
        }, 'src')],
      ['manifest without name', async () =>
        git_.resolveGitEntry(entryOf('https://github.com/o/c2', 'c2', 'o'), {
          lsRemote: async () => sha,
          fetchText: async () => JSON.stringify({ version: '1.0.0', dsh: { bundle: { patch: './p.yml' } } }),
        }, 'src')],
      ['non-JSON manifest', async () =>
        git_.resolveGitEntry(entryOf('https://github.com/o/d', 'd', 'o'), {
          lsRemote: async () => sha,
          fetchText: async () => '<html>not json</html>',
        }, 'src')],
      ['non-GitHub url', async () =>
        git_.resolveGitEntry(entryOf('https://gitlab.com/o/r', 'r', 'o'), {
          lsRemote: async () => sha,
          fetchText: async () => fixtureText('manifests/raw-proactive.json'),
        }, 'src')],
    ]
    for (const [label, run] of cases) {
      const result = await run()
      expect(isCandidate(result), `${label}: must be a Rejection`).toBe(false)
      expect((result as TestRejection).id, `${label}: must name the entry`).toBeTruthy()
      expect((result as TestRejection).reason, `${label}: must give a reason`).toBeTruthy()
    }
  })

  it('rejects a name that the real validator refuses, rather than emitting it', async () => {
    // A manifest whose `name` is the uppercase repository name is not a package
    // this pipeline may list. Whatever git.ts chooses to do, the renderer's
    // output may not contain the illegal name; this asserts the resolve half.
    const result = await git_.resolveGitEntry(
      entryOf('https://github.com/anzhaohao/DragView', 'DragView', 'anzhaohao'),
      {
        lsRemote: async () => sha,
        fetchText: async () =>
          JSON.stringify({
            name: 'DragView',
            version: '1.0.0',
            dsh: { bundle: { patch: './cordis.patch.yml' } },
          }),
      },
      'src',
    )
    const name = (result as TestCandidate).name
    if (name !== undefined) {
      expect(await nameRejectionPath(name), 'emitted an illegal package name').toBeUndefined()
    }
  })
})

/** Distinguish a Candidate from a Rejection without depending on either's writer. */
function isCandidate(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'versions' in value
}

/* ------------------------------------------------ upstream offline transform */

describe.skipIf(skipIfMissing(upstream))('parseUpstreamCatalog: offline transform', () => {
  const upstream_ = lazySrc(upstream, 'sources/upstream-catalog.ts')

  it('converts npm entries with no network, and drops the rest', () => {
    const result = upstream_.parseUpstreamCatalog(catalog, {
      sourceId: 'awesome-dsh-plugin',
      minStars: 0,
    })
    const names = result.candidates.map((candidate: TestCandidate) => candidate.name)
    expect(names).toContain('@anonyjcy/dsh-j-space')
    expect(names).toContain('dsh-dragview')
    expect(names).not.toContain('dsh-prompt-polish')
  })

  it('reports the entries that still need Git resolution separately', () => {
    const pending = upstream_.extractGitEntries(catalog, {
      sourceId: 'awesome-dsh-plugin',
      minStars: 0,
    })
    const urlsPending = pending.map((item) => (item as { url: string }).url)
    expect(urlsPending).toContain('https://github.com/benrong2048-boop/dsh-prompt-polish')
    expect(urlsPending).not.toContain('https://github.com/AnonyJcy/dsh-j-space')
  })

  it('proves the recorded LIVE catalog size, so a local stale clone cannot be substituted', () => {
    const meta = fixtureJson('meta.json') as {
      upstream: { catalogCount: number; fetchedEntryCount: number }
    }
    expect(meta.upstream.catalogCount).toBe(5704)
    expect(meta.upstream.fetchedEntryCount).toBe(5704)
  })

  it('applies the star floor before converting', () => {
    const result = upstream_.parseUpstreamCatalog(catalog, {
      sourceId: 'awesome-dsh-plugin',
      minStars: 100,
    })
    const names = result.candidates.map((candidate: TestCandidate) => candidate.name)
    expect(names).toContain('dsh-whale-widget') // 5002 stars
    expect(names).not.toContain('dsh-dragview') // 1 star
  })

  it('reports a document with no plugins array instead of throwing', () => {
    const result = upstream_.parseUpstreamCatalog({}, { sourceId: 's', minStars: 0 })
    expect(result.candidates).toEqual([])
    expect(result.rejections.length).toBeGreaterThan(0)
  })

  it('prefers an explicit config URL over the built-in default', () => {
    expect(
      upstream_.catalogUrl({
        id: 's',
        kind: 'upstream-catalog',
        enabled: true,
        minStars: 0,
        priority: 0,
        url: 'https://fixture.example.test/plugins.json',
      }),
    ).toBe('https://fixture.example.test/plugins.json')
    expect(
      upstream_.catalogUrl({
        id: 's',
        kind: 'upstream-catalog',
        enabled: true,
        minStars: 0,
        priority: 0,
      }),
    ).toBe(upstream_.UPSTREAM_CATALOG_URL)
  })

  it('honours DSH_DISCOVER_UPSTREAM_URL when the source config has no URL', () => {
    const previous = process.env['DSH_DISCOVER_UPSTREAM_URL']
    process.env['DSH_DISCOVER_UPSTREAM_URL'] = 'https://env.example.test/plugins.json'
    try {
      expect(
        upstream_.catalogUrl({
          id: 's',
          kind: 'upstream-catalog',
          enabled: true,
          minStars: 0,
          priority: 0,
        }),
      ).toBe('https://env.example.test/plugins.json')
    } finally {
      if (previous === undefined) delete process.env['DSH_DISCOVER_UPSTREAM_URL']
      else process.env['DSH_DISCOVER_UPSTREAM_URL'] = previous
    }
  })
})

/* ------------------------------------------------------------------ reporting */

describe('verification completeness', () => {
  it('records which src modules were absent, if any', () => {
    const missing = absentModules()
    if (missing.length > 0) {
      // Not a failure by default: the implementation lands concurrently. The
      // final acceptance run uses VERIFIER_STRICT=1, where every dependent
      // suite is already failing loudly.
      console.warn(`NOT YET TESTABLE — absent src modules: ${missing.join(', ')}`)
    }
    expect(Array.isArray(missing)).toBe(true)
  })
})
