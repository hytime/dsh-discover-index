/**
 * Command line entry point.
 *
 * Three subcommands, deliberately few:
 *
 *   build    the scheduled job — fetch, convert, select, validate, write
 *   doctor   the same read, but reporting instead of writing
 *   sources  what this checkout would read, without reading it
 *
 * `build` validates before it writes anything. The scheduled workflow re-checks
 * the artifact afterwards from outside, so a validator change in a newer DSH
 * cannot be masked by this process having produced the file.
 */
import fs from 'node:fs'
import path from 'node:path'
import { ConfigError, loadConfig, DEFAULT_CONFIG_PATH } from './config.js'
import { runPipeline, type RunResult, type ResolvedGitEntry } from './pipeline.js'
import { HttpClient } from './util/http.js'
import { catalogUrl } from './sources/upstream-catalog.js'

/** Where build output lands. Ignored by git; published as a CI artifact. */
const DIST = 'dist'

/** The Git-resolution cache, so a daily run re-fetches only what changed. */
const CACHE_FILE = path.join('data', 'resolve-cache.json')

/** Read the resolution cache, tolerating a missing or damaged file. */
function readCache(): Map<string, ResolvedGitEntry> {
  try {
    const raw = fs.readFileSync(CACHE_FILE, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return new Map()
    return new Map(Object.entries(parsed as Record<string, ResolvedGitEntry>))
  } catch {
    // A cache is an optimisation. A corrupt one must cost time, never fail the
    // build, or a bad write would wedge the scheduled job until someone
    // deleted the file by hand.
    return new Map()
  }
}

function writeCache(cache: Map<string, ResolvedGitEntry>): void {
  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true })
  fs.writeFileSync(CACHE_FILE, `${JSON.stringify(Object.fromEntries(cache), null, 2)}\n`)
}

function usage(): void {
  process.stdout.write(
    `dsh-discover-index — convert plugin catalogs into a DSH Discover index\n`
    + `\n`
    + `  build [--profile <id>] [--config <path>] [--limit <n>] [--cache-ttl-days <n>] [--no-cache]\n`
    + `      Fetch every enabled source, convert to plugin market index format 1,\n`
    + `      validate each document, and write it to ${DIST}/<profile>.json.\n`
    + `      --cache-ttl-days re-resolves git entries older than N days (default 7).\n`
    + `\n`
    + `  doctor [--config <path>] [--limit <n>]\n`
    + `      The same read and conversion, but report every rejection and write\n`
    + `      nothing. Use this to see WHY entries are missing.\n`
    + `\n`
    + `  sources [--config <path>]\n`
    + `      List the configured sources and the URL each one reads.\n`
    + `\n`
    + `Environment:\n`
    + `  GITHUB_TOKEN             raises the GitHub API rate limit when set\n`
    + `  DSH_DISCOVER_UPSTREAM_URL overrides the catalog URL of every source\n`,
  )
}

/** Parse `--flag value` pairs, with a bare `--flag` treated as boolean true. */
function parseArgs(argv: readonly string[]): Map<string, string | true> {
  const out = new Map<string, string | true>()
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === undefined || !token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[index + 1]
    if (next === undefined || next.startsWith('--')) {
      out.set(key, true)
    } else {
      out.set(key, next)
      index += 1
    }
  }
  return out
}

function stringFlag(args: Map<string, string | true>, key: string): string | undefined {
  const value = args.get(key)
  return typeof value === 'string' ? value : undefined
}

function numberFlag(args: Map<string, string | true>, key: string): number | undefined {
  const value = stringFlag(args, key)
  if (value === undefined) return undefined
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new ConfigError(`--${key} must be a non-negative integer (got ${JSON.stringify(value)})`)
  }
  return parsed
}

/** Group rejections by reason, most frequent first, for a readable report. */
function summarizeRejections(result: RunResult): void {
  const byReason = new Map<string, number>()
  const byStage = new Map<string, number>()
  for (const rejection of result.rejections) {
    byStage.set(rejection.stage, (byStage.get(rejection.stage) ?? 0) + 1)
    // Normalize the variants that differ only by the numbers in them, so the
    // report lists causes rather than one line per entry.
    const key = rejection.reason.replace(/\(.*?\)/g, '(...)').replace(/\d+/g, 'N')
    byReason.set(key, (byReason.get(key) ?? 0) + 1)
  }

  if (byStage.size > 0) {
    process.stdout.write('\nRejections by stage:\n')
    for (const [stage, count] of [...byStage].sort((a, b) => b[1] - a[1])) {
      process.stdout.write(`  ${stage.padEnd(8)} ${String(count)}\n`)
    }
  }
  if (byReason.size > 0) {
    process.stdout.write('\nReasons:\n')
    for (const [reason, count] of [...byReason].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
      process.stdout.write(`  ${String(count).padStart(5)}  ${reason}\n`)
    }
    if (byReason.size > 25) process.stdout.write(`  ... and ${String(byReason.size - 25)} more distinct reasons\n`)
  }
}

async function commandBuild(args: Map<string, string | true>): Promise<number> {
  const configPath = stringFlag(args, 'config') ?? DEFAULT_CONFIG_PATH
  const profile = stringFlag(args, 'profile')
  const limit = numberFlag(args, 'limit')
  const cacheTtlDays = numberFlag(args, 'cache-ttl-days')
  const useCache = args.get('no-cache') !== true

  const cache = useCache ? readCache() : new Map<string, ResolvedGitEntry>()
  const log = (message: string): void => { process.stdout.write(`  ${message}\n`) }

  const result = await runPipeline({
    configPath,
    ...(profile === undefined ? {} : { profiles: [profile] }),
    ...(limit === undefined ? {} : { resolveLimit: limit }),
    ...(cacheTtlDays === undefined ? {} : { cacheTtlDays }),
    gitCache: cache,
    token: process.env['GITHUB_TOKEN'],
    log,
  })

  fs.mkdirSync(DIST, { recursive: true })
  for (const output of result.outputs) {
    const target = path.join(DIST, output.profile.output)
    fs.writeFileSync(target, `${JSON.stringify(output.document, null, 2)}\n`)
    process.stdout.write(
      `\nwrote ${target}: ${String(output.validated.plugins.length)} plugins, `
      + `${String(Math.round(output.starCoverage * 100))}% with a star count\n`,
    )
  }

  if (useCache) writeCache(cache)

  process.stdout.write(
    `\nrequests ${String(result.stats.requests)} (${String(result.stats.retried)} retried), `
    + `candidates ${String(result.stats.candidatesExtracted)}\n`,
  )
  summarizeRejections(result)
  return 0
}

async function commandDoctor(args: Map<string, string | true>): Promise<number> {
  const configPath = stringFlag(args, 'config') ?? DEFAULT_CONFIG_PATH
  const limit = numberFlag(args, 'limit')

  const result = await runPipeline({
    configPath,
    ...(limit === undefined ? {} : { resolveLimit: limit }),
    gitCache: new Map(),
    token: process.env['GITHUB_TOKEN'],
    log: (message: string) => { process.stdout.write(`  ${message}\n`) },
  })

  for (const output of result.outputs) {
    process.stdout.write(
      `\nprofile ${output.profile.id}: ${String(output.validated.plugins.length)} plugins would be published\n`,
    )
  }
  summarizeRejections(result)
  process.stdout.write('\ndoctor wrote nothing.\n')
  return 0
}

async function commandSources(args: Map<string, string | true>): Promise<number> {
  const config = loadConfig(stringFlag(args, 'config') ?? DEFAULT_CONFIG_PATH)
  const http = new HttpClient({ token: process.env['GITHUB_TOKEN'] })

  process.stdout.write('sources:\n')
  for (const source of config.sources) {
    const url = catalogUrl(source)
    process.stdout.write(
      `  ${source.id} [${source.kind}] ${source.enabled ? 'enabled' : 'DISABLED'} priority=${String(source.priority)}\n`
      + `    ${url}\n`,
    )
    if (!source.enabled) continue
    try {
      const head = await http.raw(url, { method: 'HEAD' })
      process.stdout.write(`    reachable: ${String(head.status)} ${head.headers.get('content-type') ?? ''}\n`)
    } catch (error) {
      process.stdout.write(`    UNREACHABLE: ${error instanceof Error ? error.message : String(error)}\n`)
    }
  }

  process.stdout.write('\nprofiles:\n')
  for (const profile of config.profiles) {
    process.stdout.write(
      `  ${profile.id} -> ${DIST}/${profile.output}  sources=${profile.sources.join(',')} minStars=${String(profile.minStars)}\n`,
    )
  }
  return 0
}

/** Dispatch. Returns the process exit code rather than calling `exit`. */
export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const [command, ...rest] = argv
  const args = parseArgs(rest)

  try {
    switch (command) {
      case 'build': return await commandBuild(args)
      case 'doctor': return await commandDoctor(args)
      case 'sources': return await commandSources(args)
      case undefined:
      case '--help':
      case 'help':
        usage()
        return 0
      default:
        process.stderr.write(`unknown command: ${command}\n\n`)
        usage()
        return 2
    }
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`configuration error: ${error.message}\n`)
      return 1
    }
    if (error instanceof Error && error.name === 'MarketIndexError') {
      // The publish gate. Something in the conversion produced a document the
      // format refuses; say so plainly, because the alternative is shipping it.
      process.stderr.write(`REFUSING TO PUBLISH — the rendered index is not valid format 1:\n  ${error.message}\n`)
      return 1
    }
    process.stderr.write(`error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`)
    return 1
  }
}

// Run when invoked as a program, stay quiet when imported by a test.
const invokedDirectly = process.argv[1] !== undefined
  && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href
if (invokedDirectly) {
  main().then((code) => { process.exitCode = code }, (error: unknown) => {
    process.stderr.write(`${String(error)}\n`)
    process.exitCode = 1
  })
}
