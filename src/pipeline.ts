/**
 * The pipeline: read every enabled source, resolve what they could not name,
 * select, render, validate.
 *
 * The stage boundaries are the point of the design. Each stage is a plain
 * function over data with a narrow signature, and every effect — HTTP, git, the
 * clock, the filesystem — enters through `RunOptions` or `SourceContext`. That
 * is what makes the whole run reproducible in a test and what lets a failure at
 * one stage be attributed to that stage rather than to "the build".
 *
 *   extract  — sources are untrusted; anything malformed is dropped with a reason
 *   resolve  — network effects happen here, and only when a name is unavailable
 *   select   — pure: deny lists, dedupe, star floor
 *   render   — pure: candidates to a format-1 document
 *   validate — the format's own validator decides whether we may publish
 */
import type { MarketIndex } from '@deepseek-ai/dsh-plugin-market-index'
import type { Candidate, Profile, ProjectConfig, Rejection, SourceContext } from './types.js'
import { ConfigError, DEFAULT_CONFIG_PATH, loadConfig } from './config.js'
import { catalogUrl, extractGitEntries, parseUpstreamCatalog } from './sources/upstream-catalog.js'
import { gitCandidate, resolveGitEntry, type GitDeps, type UpstreamEntry } from './resolve/git.js'
import { applyPolicy } from './policy/filter.js'
import { renderIndex, validateIndex, type MarketIndexDocument } from './render/index.js'
import { unrenderableReason } from './render/index.js'
import { HttpClient, HttpError, mapLimit } from './util/http.js'
import { DEFAULT_REGISTRY, packumentUrl, withPackument } from './resolve/npm.js'
import { declaresBundle } from './resolve/git.js'

/** A remembered git resolution, so a daily run pays only for what changed. */
export interface ResolvedGitEntry {
  readonly sha: string
  readonly packageName: string
  readonly version: string
  readonly directory?: string
  readonly dshRange?: string
  readonly checkedAt: string
}

/**
 * How long a remembered resolution stays usable.
 *
 * Seven days, chosen against how the data behaves rather than for roundness: a
 * plugin that releases weekly would be at most one release stale in the index,
 * while a plugin that has gone dormant costs nothing after its first week
 * because the re-resolve returns the same commit. Anything much longer and a
 * quiet repository's pinned commit ages past the point where "install this and
 * get a working plugin" still holds.
 */
export const DEFAULT_CACHE_TTL_DAYS = Number(process.env['DSH_DISCOVER_CACHE_TTL_DAYS'] ?? 7)

/** One profile's finished document, with the validator's verdict already applied. */
export interface ProfileOutput {
  readonly profile: Profile
  readonly document: MarketIndexDocument
  readonly validated: MarketIndex
  /** Fraction of plugins whose star count is known, for the run report. */
  readonly starCoverage: number
}

/** Everything one run produced. */
export interface RunResult {
  readonly outputs: readonly ProfileOutput[]
  readonly rejections: readonly Rejection[]
  readonly stats: {
    readonly candidatesExtracted: number
    readonly candidatesResolved: number
    readonly candidatesSelected: number
    readonly requests: number
    readonly retried: number
  }
}

export interface RunOptions {
  readonly config?: ProjectConfig
  readonly configPath?: string
  readonly profiles?: readonly string[]
  readonly fetchImpl?: typeof fetch
  readonly token?: string | undefined
  readonly log?: (message: string) => void
  /** Remembered git resolutions, keyed `owner/repo`. Mutated in place. */
  readonly gitCache?: Map<string, ResolvedGitEntry>
  /** Cap on entries resolved over the network in one run. */
  readonly resolveLimit?: number
  /**
   * Days a remembered git resolution stays usable. `0` never expires.
   *
   * The cache exists to make a daily run cheap, but a resolution records a
   * commit SHA and a version — both of which change when a repository releases.
   * Without an expiry the index would slowly freeze on whatever each plugin
   * looked like the first time it was seen, and the staleness would be silent
   * because the entry still resolves and still installs.
   */
  readonly cacheTtlDays?: number
  /** Injected clock, so cache expiry is testable. */
  readonly now?: Date
  /** Concurrency for git resolution; git and raw.githubusercontent tolerate more than the REST API. */
  readonly gitConcurrency?: number
  /**
   * Whether to read each npm package's registry document for its full version
   * history. Default true. Tests and offline runs turn it off, and so does
   * anyone who wants the upstream single version exactly as published.
   */
  readonly registryVersions?: boolean
  /** npm registry base URL, ending in `/`. */
  readonly registry?: string
  /** Registry documents read at once. */
  readonly registryConcurrency?: number
}

/**
 * The effects git resolution needs, built over the shared HTTP client.
 *
 * Kept here rather than inside the resolver so the resolver stays free of any
 * concrete transport, and so the failure of a missing file is decided in one
 * place: a 404 means "this repository has no manifest where we looked", which
 * is an ordinary outcome, while any other error is a real one.
 */
function gitDeps(http: HttpClient): GitDeps {
  return {
    lsRemote: async (repo: string): Promise<string | undefined> => {
      const { execFile } = await import('node:child_process')
      const { promisify } = await import('node:util')
      const run = promisify(execFile)
      try {
        const { stdout } = await run('git', ['ls-remote', repo, 'HEAD'], { timeout: 30_000 })
        const first = stdout.trim().split('\n')[0]
        return first?.split(/\s+/)[0] || undefined
      } catch {
        return undefined
      }
    },
    fetchText: async (url: string): Promise<string | undefined> => {
      try {
        return await http.text(url)
      } catch (error) {
        if (error instanceof HttpError && error.status === 404) return undefined
        throw error
      }
    },
  }
}

/** Rebuild a candidate from a remembered resolution, without touching the network. */
function fromCache(entry: UpstreamEntry, cached: ResolvedGitEntry, sourceId: string): Candidate | undefined {
  return gitCandidate(
    entry,
    {
      sha: cached.sha,
      packageName: cached.packageName,
      version: cached.version,
      ...(cached.directory === undefined ? {} : { directory: cached.directory }),
      ...(cached.dshRange === undefined ? {} : { dshRange: cached.dshRange }),
    },
    sourceId,
  )
}

function toCache(candidate: Candidate): ResolvedGitEntry {
  const version = candidate.versions[0]
  const source = version?.source
  return {
    sha: source?.type === 'git' ? source.commit : '',
    packageName: candidate.name,
    version: version?.version ?? '0.0.0',
    ...(source?.type === 'git' && source.path !== undefined ? { directory: source.path } : {}),
    ...(version?.dshRange === undefined ? {} : { dshRange: version.dshRange }),
    checkedAt: new Date().toISOString().slice(0, 10),
  }
}

/**
 * Run the whole pipeline.
 * @param options - configuration and injected effects.
 * @returns every profile's validated document, plus all rejections and counters.
 * @throws {MarketIndexError} when a rendered document fails format validation.
 * @throws {ConfigError} when the configuration is unusable.
 */
export async function runPipeline(options: RunOptions = {}): Promise<RunResult> {
  const config = options.config ?? loadConfig(options.configPath ?? DEFAULT_CONFIG_PATH)
  const log = options.log ?? ((): void => undefined)
  const http = new HttpClient({
    token: options.token,
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
  })
  const gitCache = options.gitCache ?? new Map<string, ResolvedGitEntry>()
  const resolveLimit = options.resolveLimit ?? Number.POSITIVE_INFINITY
  const cacheTtlDays = options.cacheTtlDays ?? DEFAULT_CACHE_TTL_DAYS
  const now = options.now ?? new Date()

  /**
   * Whether a remembered resolution is still trustworthy.
   *
   * An entry with an unreadable `checkedAt` is treated as stale rather than
   * fresh: the safe direction is to re-resolve, because a re-resolve costs two
   * requests while a frozen entry silently misreports a plugin's version.
   */
  const isFresh = (cached: ResolvedGitEntry | undefined): cached is ResolvedGitEntry => {
    if (!cached) return false
    if (cacheTtlDays <= 0) return true
    const checked = Date.parse(cached.checkedAt)
    if (Number.isNaN(checked)) return false
    return now.getTime() - checked < cacheTtlDays * 86_400_000
  }

  const rejections: Rejection[] = []
  const bySource = new Map<string, Candidate[]>()
  const enabled = config.sources.filter((source) => source.enabled)

  // ---- extract, then resolve what carries no npm identity -----------------
  for (const source of enabled) {
    const ctx: SourceContext = {
      config: source,
      fetchJson: (url, init) => http.json(url, init),
      fetchText: (url, init) => http.text(url, init),
      log,
    }

    const url = catalogUrl(source)
    log(`source ${source.id}: reading ${url}`)
    // The upstream catalog is ~7 MB of JSON and responds in well over the
    // default deadline on a cold connection, so this one call gets its own.
    const raw = await http.json<unknown>(url, {}, { timeoutMs: 120_000 })

    const extracted = parseUpstreamCatalog(raw, {
      sourceId: source.id,
      minStars: source.minStars,
      ...(source.fields === undefined ? {} : { fields: source.fields }),
    })
    rejections.push(...extracted.rejections)
    const candidates = [...extracted.candidates]

    const untitled = extractGitEntries(raw, {
      sourceId: source.id,
      minStars: source.minStars,
      ...(source.fields === undefined ? {} : { fields: source.fields }),
    })
    const keyOf = (entry: UpstreamEntry): string => `${entry.owner}/${entry.name}`
    // Split before fetching: entries already remembered are rebuilt from the
    // cache, never re-fetched; the rest are budgeted and the remainder deferred.
    const remembered = untitled.filter((entry) => isFresh(gitCache.get(keyOf(entry))))
    const unknown = untitled.filter((entry) => !isFresh(gitCache.get(keyOf(entry))))
    const budgeted = Number.isFinite(resolveLimit) ? unknown.slice(0, resolveLimit) : unknown
    const deferred = unknown.slice(budgeted.length)

    log(
      `source ${source.id}: ${String(extracted.candidates.length)} npm entries, `
      + `${String(untitled.length)} needing git resolution `
      + `(${String(remembered.length)} cached, ${String(budgeted.length)} to fetch this run)`,
    )

    // Cached entries first: they cost nothing and must appear regardless of how
    // much of the network budget this run spends.
    for (const entry of remembered) {
      const cached = gitCache.get(keyOf(entry))
      if (!cached) continue
      const candidate = fromCache(entry, cached, source.id)
      if (candidate) candidates.push(candidate)
    }

    const deps = gitDeps(http)
    const settled = await mapLimit(
      budgeted,
      async (entry) => ({ entry, outcome: await resolveGitEntry(entry, deps, source.id) }),
      options.gitConcurrency ?? 8,
    )
    for (const { entry, outcome } of settled) {
      if ('stage' in outcome) {
        rejections.push(outcome)
        continue
      }
      candidates.push(outcome)
      // Remembered under the upstream key, so the next run reads it from the
      // cache instead of spending two more requests on an unchanged repository.
      gitCache.set(keyOf(entry), toCache(outcome))
    }

    for (const entry of deferred) {
      rejections.push({
        id: `${entry.owner}/${entry.name}`,
        stage: 'resolve',
        reason: 'not resolved this run (resolve limit reached) — a later run picks it up',
      })
    }
    bySource.set(source.id, candidates)
    log(`source ${source.id}: ${String(candidates.length)} candidates`)
  }

  // ---- expand npm candidates to every installable version -----------------
  // Upstream names one version per entry; the registry knows them all. This
  // stage runs after resolution and before selection, so its cost and its
  // failures are attributable to one step.
  //
  // Best-effort by design: a package whose registry document cannot be read
  // keeps its single upstream version. Turning a registry outage into a market
  // that lists fewer plugins would be a worse failure than listing one version.
  if (options.registryVersions !== false) {
    const registry = options.registry ?? DEFAULT_REGISTRY
    let gainedPlugins = 0
    let gainedVersions = 0
    for (const [sourceId, candidates] of bySource) {
      const npmOnes = candidates.filter((candidate) =>
        candidate.versions.length === 1 && candidate.versions[0]?.source.type === 'npm')
      if (npmOnes.length === 0) continue
      log(`source ${sourceId}: reading ${String(npmOnes.length)} registry documents for version history`)
      const enriched = await mapLimit(
        npmOnes,
        async (candidate) => {
          const url = packumentUrl(registry, candidate.name)
          const packument = await http.jsonOr404<unknown>(url).catch(() => undefined)
          return packument === undefined ? candidate : withPackument(candidate, packument, (manifest) => declaresBundle(manifest as Parameters<typeof declaresBundle>[0]))
        },
        options.registryConcurrency ?? 12,
      )
      const byName = new Map(enriched.map((candidate) => [candidate.name, candidate]))
      for (let index = 0; index < candidates.length; index += 1) {
        const current = candidates[index] as Candidate
        const replacement = byName.get(current.name)
        if (replacement === undefined) continue
        if (replacement.versions.length > current.versions.length) {
          gainedPlugins += 1
          gainedVersions += replacement.versions.length - current.versions.length
        }
        candidates[index] = replacement
      }
    }
    log(`version history: ${String(gainedPlugins)} plugins gained ${String(gainedVersions)} further versions`)
  }

  // ---- select, render, validate ------------------------------------------
  const wanted = options.profiles && options.profiles.length > 0 ? new Set(options.profiles) : undefined
  const outputs: ProfileOutput[] = []
  let selectedTotal = 0

  for (const profile of config.profiles) {
    if (wanted && !wanted.has(profile.id)) continue

    const pool: Candidate[] = []
    for (const sourceId of profile.sources) pool.push(...(bySource.get(sourceId) ?? []))

    const floor = Math.max(
      profile.minStars,
      ...profile.sources.map((id) => config.sources.find((source) => source.id === id)?.minStars ?? 0),
    )
    const selected = applyPolicy(pool, config, floor)
    rejections.push(...selected.rejections)

    const renderable: Candidate[] = []
    for (const candidate of selected.candidates) {
      const reason = unrenderableReason(candidate)
      if (reason !== undefined) {
        rejections.push({ id: candidate.name, stage: 'policy', reason })
        continue
      }
      renderable.push(candidate)
    }

    const document = renderIndex(renderable, profile)
    // The gate. A document that fails here must not be published; the caller is
    // expected to let this throw and leave the previous version live.
    const validated = validateIndex(document, `https://hytime.github.io/dsh-discover-index/${profile.output}`)

    const withStars = renderable.filter((candidate) => candidate.sortKeys['stars'] !== undefined).length
    outputs.push({
      profile,
      document,
      validated,
      starCoverage: renderable.length === 0 ? 0 : withStars / renderable.length,
    })
    selectedTotal = Math.max(selectedTotal, renderable.length)
    log(`profile ${profile.id}: ${String(validated.plugins.length)} plugins -> ${profile.output}`)
  }

  return {
    outputs,
    rejections,
    stats: {
      candidatesExtracted: [...bySource.values()].reduce((sum, list) => sum + list.length, 0),
      candidatesResolved: gitCache.size,
      candidatesSelected: selectedTotal,
      requests: http.requests,
      retried: http.retried,
    },
  }
}

export { ConfigError }
