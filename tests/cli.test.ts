/**
 * The command line, exercised offline.
 *
 * `main` is imported rather than spawned, so the tests assert exit codes and
 * error routing directly. Anything that would write to `dist/` is deliberately
 * not run: `tests/` is the verifier's write scope, and a test that mutated the
 * publishable artifact would make the build's output unattributable.
 *
 * The one thing worth checking here is the publish gate: `build` must exit
 * non-zero and write nothing when the rendered document fails format 1, because
 * the alternative is deploying an index that DSH refuses to load.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fixturePath, loadSrc, skipIfMissing } from './helpers/harness.js'

const cli = await loadSrc<{ main(argv?: readonly string[]): Promise<number> }>('cli.ts')

/** Capture what a command writes to stdout/stderr. */
async function capture(argv: string[]): Promise<{ code: number; out: string; err: string }> {
  const outChunks: string[] = []
  const errChunks: string[] = []
  const originalOut = process.stdout.write.bind(process.stdout)
  const originalErr = process.stderr.write.bind(process.stderr)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(process.stdout as any).write = (chunk: unknown): boolean => { outChunks.push(String(chunk)); return true }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(process.stderr as any).write = (chunk: unknown): boolean => { errChunks.push(String(chunk)); return true }
  try {
    const code = await cli!.main(argv)
    return { code, out: outChunks.join(''), err: errChunks.join('') }
  } finally {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(process.stdout as any).write = originalOut
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(process.stderr as any).write = originalErr
  }
}

describe.skipIf(skipIfMissing(cli))('cli: dispatch and exit codes', () => {
  it('prints usage and exits 0 with no arguments', async () => {
    const { code, out } = await capture([])
    expect(code).toBe(0)
    expect(out).toContain('build')
    expect(out).toContain('doctor')
    expect(out).toContain('sources')
  })

  it.each([['--help'], ['help']])('prints usage for %s', async (flag) => {
    const { code, out } = await capture([flag])
    expect(code).toBe(0)
    expect(out).toContain('dsh-discover-index')
  })

  it('exits 2 for an unknown command, and says so on stderr', async () => {
    const { code, err } = await capture(['not-a-command'])
    expect(code).toBe(2)
    expect(err).toContain('unknown command')
  })

  it('exits 1 with a configuration error for a missing config file', async () => {
    const { code, err } = await capture(['doctor', '--config', '/nonexistent/config.yml'])
    expect(code).toBe(1)
    expect(err).toMatch(/configuration/i)
  })

  it('rejects a negative --limit rather than clamping it', async () => {
    const { code, err } = await capture([
      'doctor',
      '--config',
      fixturePath('config.fixture.yml'),
      '--limit',
      '-1',
    ])
    expect(code).toBe(1)
    expect(err).toMatch(/limit/i)
  })

  it('rejects a non-integer --limit', async () => {
    const { code, err } = await capture([
      'doctor',
      '--config',
      fixturePath('config.fixture.yml'),
      '--limit',
      'many',
    ])
    expect(code).toBe(1)
    expect(err).toMatch(/limit/i)
  })
})

describe.skipIf(skipIfMissing(cli))('cli: build is a publish gate', () => {
  const sandbox = path.join(tmpdir(), `dsh-discover-index-verifier-${String(process.pid)}`)
  const originalCwd = process.cwd()

  beforeAll(() => {
    // Run in a scratch directory so any accidental write is visible and
    // contained, rather than landing in the project's dist/.
    mkdirSync(sandbox, { recursive: true })
    const configDir = path.join(sandbox, 'config')
    mkdirSync(configDir, { recursive: true })
    // A config whose source cannot be reached: the run must fail before writing.
    writeFileSync(
      path.join(configDir, 'config.yml'),
      [
        'sources:',
        '  - id: unreachable',
        '    kind: upstream-catalog',
        '    enabled: true',
        '    url: http://127.0.0.1:9/plugins.json',
        '    minStars: 0',
        '    priority: 1',
        'profiles:',
        '  - id: index',
        '    title: {en: Index}',
        '    sources: [unreachable]',
        '    minStars: 0',
        '    output: index.json',
        '',
      ].join('\n'),
    )
    process.chdir(sandbox)
  })

  afterAll(() => {
    process.chdir(originalCwd)
    rmSync(sandbox, { recursive: true, force: true })
  })

  it('writes nothing and exits non-zero when the source cannot be read', async () => {
    const { code } = await capture(['build'])
    expect(code).not.toBe(0)
    // No dist/index.json may exist: a failed run must not leave a stale or
    // partial artifact behind for the workflow to upload.
    expect(existsSync(path.join(sandbox, 'dist', 'index.json'))).toBe(false)
  }, 30_000)

  it('leaves the previous artifact untouched on failure', () => {
    expect(existsSync(path.join(sandbox, 'dist', 'index.json'))).toBe(false)
  })
})

describe('the shipped package is configured to test itself', () => {
  it('package.json runs vitest for `npm test`', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts?: Record<string, string>
    }
    expect(pkg.scripts?.['test']).toContain('vitest')
  })

  it('the validator this project targets is a declared dependency', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      dependencies?: Record<string, string>
    }
    expect(pkg.dependencies?.['@deepseek-ai/dsh-plugin-market-index']).toBeTruthy()
  })
})
