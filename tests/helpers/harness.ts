/**
 * Shared test harness.
 *
 * Two jobs.
 *
 * 1. Load `src/` modules *without* breaking a build while the implementation is
 *    still landing. `tests/` is owned by the verifier and `src/` by the lead,
 *    concurrently, so a literal `import '../src/render/index.js'` would be a
 *    compile-time error until that file exists and would fail the whole run at
 *    collection time. Each module is therefore probed with `existsSync` and
 *    imported through a non-literal specifier; modules that do not exist yet
 *    are recorded by name.
 *
 * 2. Make "not yet testable" impossible to mistake for "verified". A module
 *    that is absent causes `skipIfMissing` to return true, so its suite is
 *    reported as skipped, never as passing. Setting `VERIFIER_STRICT=1` turns
 *    every such skip into a hard failure, so the final acceptance run proves
 *    that nothing was skipped.
 *
 * Types here mirror `src/types.ts` on purpose rather than importing it: the
 * tests must fail when the implementation drifts from the published contract,
 * not silently follow it.
 */

import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/* ------------------------------------------------------------ contract types */

export interface TestInstallSource {
  readonly type: 'npm' | 'git'
  readonly registry?: string
  readonly url?: string
  readonly commit?: string
  readonly path?: string
}

export interface TestResolvedVersion {
  readonly version: string
  readonly publishTimestamp: number
  readonly source: TestInstallSource
  readonly dshRange?: string
}

export interface TestCandidate {
  readonly name: string
  readonly title?: Readonly<Record<string, string>>
  readonly description?: Readonly<Record<string, string>>
  readonly author?: string
  readonly homepage?: string
  readonly repository?: { readonly url: string; readonly directory?: string }
  readonly category?: string
  readonly keywords: readonly string[]
  readonly labels: readonly string[]
  readonly sortKeys: Readonly<Record<string, number>>
  readonly versions: readonly TestResolvedVersion[]
  readonly provenance: readonly string[]
}

export interface TestRejection {
  readonly id: string
  readonly stage: 'source' | 'resolve' | 'policy'
  readonly reason: string
}

export interface TestSourceResult {
  readonly candidates: readonly TestCandidate[]
  readonly rejections: readonly TestRejection[]
}

export interface TestSourceConfig {
  readonly id: string
  readonly kind: string
  readonly enabled: boolean
  readonly minStars: number
  readonly queries?: readonly string[]
  readonly url?: string
  readonly priority: number
}

export interface TestProfile {
  readonly id: string
  readonly title: Readonly<Record<string, string>>
  readonly description?: Readonly<Record<string, string>>
  readonly sources: readonly string[]
  readonly minStars: number
  readonly output: string
}

export interface TestProjectConfig {
  readonly sources: readonly TestSourceConfig[]
  readonly profiles: readonly TestProfile[]
  readonly denyRepos: readonly string[]
  readonly denyPackages: readonly string[]
}

/** `src/resolve/urls.ts` */
export interface UrlsModule {
  decomposeRepoUrl(url: string):
    | { repo: string; directory?: string; owner: string; name: string }
    | undefined
  slugFor(url: string): string
  repoIdentity(url: string): string | undefined
  avatarUrl(owner: string): string
}

/** `src/resolve/npm.ts` */
export interface NpmModule {
  npmCandidate(entry: unknown, sourceId: string): TestCandidate | undefined
  fallbackTimestamp(added: string | undefined): number | undefined
  withRegistryTimes(
    candidate: TestCandidate,
    times: Readonly<Record<string, string>> | undefined,
  ): TestCandidate
}

/** `src/resolve/git.ts` */
export interface GitResolution {
  readonly sha: string
  readonly packageName: string
  readonly version: string
  readonly directory?: string
}

export interface GitDeps {
  /** Default-branch commit SHA, or undefined when the repository is unreachable. */
  lsRemote(repo: string): Promise<string | undefined>
  /** File contents at an exact ref, or undefined on 404. */
  fetchText(url: string): Promise<string | undefined>
}

export interface GitModule {
  gitCandidate(
    entry: unknown,
    resolved: GitResolution,
    sourceId: string,
  ): TestCandidate | undefined
  resolveGitEntry(
    entry: unknown,
    deps: GitDeps,
    sourceId: string,
  ): Promise<TestCandidate | TestRejection>
  declaresBundle(manifest: unknown): boolean
  manifestIdentity(manifest: unknown): { name: string; version: string } | undefined
  manifestPath(directory: string | undefined): string
}

/** `src/sources/upstream-catalog.ts` */
export interface UpstreamModule {
  readonly UPSTREAM_CATALOG_URL: string
  parseUpstreamCatalog(
    raw: unknown,
    options: { sourceId: string; minStars: number },
  ): TestSourceResult
  extractGitEntries(
    raw: unknown,
    options: { sourceId: string; minStars: number },
  ): unknown[]
  upstreamEntries(raw: unknown): unknown[]
  toUpstreamEntry(raw: unknown): unknown
  catalogUrl(config: TestSourceConfig): string
  loadUpstreamCatalog(ctx: unknown): Promise<TestSourceResult>
}

/** `src/policy/filter.ts` */
export interface PolicyModule {
  applyPolicy(
    candidates: readonly TestCandidate[],
    config: TestProjectConfig,
    minStars: number,
  ): { candidates: TestCandidate[]; rejections: TestRejection[] }
  applyDenyLists(
    candidates: readonly TestCandidate[],
    config: TestProjectConfig,
  ): { candidates: TestCandidate[]; rejections: TestRejection[] }
  dedupeByName(
    candidates: readonly TestCandidate[],
    priorityOf: ReadonlyMap<string, number>,
  ): { candidates: TestCandidate[]; rejections: TestRejection[] }
  applyStarFloor(
    candidates: readonly TestCandidate[],
    minStars: number,
    sourceId: string,
  ): { candidates: TestCandidate[]; rejections: TestRejection[] }
}

/** `src/render/index.ts` */
export interface RenderModule {
  renderIndex(candidates: readonly TestCandidate[], profile: TestProfile): unknown
  unrenderableReason(candidate: TestCandidate): string | undefined
  validateIndex(doc: unknown, indexUrl: string): unknown
}

/** `src/config.ts` */
export interface ConfigModule {
  readonly DEFAULT_CONFIG_PATH: string
  parseConfig(text: string, at?: string): TestProjectConfig
  loadConfig(path?: string): TestProjectConfig
}

/** `src/pipeline.ts` */
export interface PipelineRunResult {
  readonly outputs: readonly {
    readonly profile: TestProfile
    readonly document: unknown
    readonly validated: unknown
    readonly starCoverage: number
  }[]
  readonly rejections: readonly TestRejection[]
  readonly stats: {
    readonly candidatesExtracted: number
    readonly candidatesResolved: number
    readonly candidatesSelected: number
    readonly requests: number
    readonly retried: number
  }
}

export interface PipelineModule {
  runPipeline(options?: {
    config?: TestProjectConfig
    configPath?: string
    profiles?: readonly string[]
    fetchImpl?: typeof fetch
    log?: (message: string) => void
    resolveLimit?: number
    gitConcurrency?: number
    /** Whether to read each npm package's registry document for its full version history. */
    registryVersions?: boolean
    /** npm registry base URL, ending in `/`. */
    registry?: string
    registryConcurrency?: number
  }): Promise<PipelineRunResult>
}

/* --------------------------------------------------------------- path helpers */

const ROOT = new URL('../../', import.meta.url)

/** Absolute path of a module under `src/`. */
export function srcPath(relative: string): string {
  return fileURLToPath(new URL(`src/${relative}`, ROOT))
}

/** Absolute path of a file under `tests/fixtures/`. */
export function fixturePath(relative: string): string {
  return fileURLToPath(new URL(`tests/fixtures/${relative}`, ROOT))
}

/* ----------------------------------------------------- missing-module tracking */

export const STRICT = process.env['VERIFIER_STRICT'] === '1'

const cache = new Map<string, unknown>()
const absent: string[] = []

/**
 * Import a module under `src/` when it exists.
 * @param relative - path relative to `src/`, including the `.ts` extension.
 * @returns the module namespace, or `undefined` when the file has not been written yet.
 */
export async function loadSrc<T>(relative: string): Promise<T | undefined> {
  const file = srcPath(relative)
  if (cache.has(file)) return cache.get(file) as T | undefined
  if (!existsSync(file)) {
    if (!absent.includes(relative)) absent.push(relative)
    cache.set(file, undefined)
    return undefined
  }
  // Non-literal specifier on purpose: TypeScript cannot resolve it, so a module
  // that lands later still typechecks and a module that is missing never breaks
  // a build. Vite resolves the absolute path at runtime.
  const specifier = `${file}?verifier=${String(process.hrtime.bigint())}`
  const namespace = (await import(/* @vite-ignore */ specifier)) as T
  cache.set(file, namespace)
  return namespace
}

/** `src/` modules this run could not load because the files are absent. */
export function absentModules(): readonly string[] {
  return absent
}

/**
 * Whether a suite whose module is missing must be skipped.
 * @param mod - the loaded module, or `undefined`.
 * @returns true when the suite should be reported as skipped.
 */
export function skipIfMissing(mod: unknown): boolean {
  return mod === undefined && !STRICT
}

/**
 * Narrow a possibly-missing module inside a test body, with a message that
 * names the file instead of throwing a property access on `undefined`.
 */
export function require_<T>(mod: T | undefined, relative: string): T {
  if (mod === undefined) {
    throw new Error(
      `NOT YET TESTABLE: src/${relative} does not exist, so this assertion has never executed. ` +
        'Run with VERIFIER_STRICT=1 to turn this skip into a failure.',
    )
  }
  return mod
}

/**
 * A lazily-resolved view of a possibly-missing module.
 *
 * `describe` callbacks always run, even for a skipped suite, so a module must
 * not be dereferenced while the suite is being declared. Every property read
 * goes through `require_`, which means the "not yet testable" error is raised
 * only when a test body actually tries to use the module — at which point the
 * suite was either skipped (module absent) or is expected to fail loudly.
 *
 * @param mod - the loaded module, or `undefined`.
 * @param relative - its path relative to `src/`, for the error message.
 * @returns a stand-in with the module's type.
 */
export function lazySrc<T extends object>(mod: T | undefined, relative: string): T {
  return new Proxy({} as T, {
    get(_target, property) {
      const resolved = require_(mod, relative) as Record<PropertyKey, unknown>
      return resolved[property]
    },
    has(_target, property) {
      const resolved = require_(mod, relative) as object
      return property in resolved
    },
    ownKeys() {
      return Reflect.ownKeys(require_(mod, relative) as object)
    },
    getOwnPropertyDescriptor(_target, property) {
      return Reflect.getOwnPropertyDescriptor(require_(mod, relative) as object, property)
    },
  })
}

/* ------------------------------------------------------------- fixture access */

/** Read a fixture as UTF-8 text. */
export function fixtureText(relative: string): string {
  return readFileSync(fixturePath(relative), 'utf8')
}

/** Parse a JSON fixture. */
export function fixtureJson<T = any>(relative: string): T {
  return JSON.parse(fixtureText(relative)) as T
}

/** Index URL used for rendering and validating in tests. */
export const TEST_INDEX_URL = 'https://index.example.test/market/index.json'

/**
 * Assert through the REAL validator that `name` is usable as a format-1 plugin
 * name, without involving the renderer.
 *
 * Resolve- and policy-level tests need this: they produce candidates, not
 * documents, and the rule they most often break — "name must be a valid npm
 * package name" — is the validator's, not ours. Wrapping one name in a minimal
 * document is the only way to ask the authority directly instead of
 * re-implementing its regex.
 *
 * @param name - the candidate name to test.
 * @returns the validator's rejection path, or `undefined` when it accepts.
 * @throws when the validator is unavailable, so a missing dependency cannot
 *   silently turn every name check into a pass.
 */
export async function nameRejectionPath(name: string): Promise<string | undefined> {
  const mod = await import('@deepseek-ai/dsh-plugin-market-index')
  const doc = {
    format: 1,
    title: { en: 'name probe' },
    metadata: {},
    plugins: [
      {
        name,
        metadata: {},
        versions: [{ version: '1.0.0', publishTimestamp: 1, source: { type: 'npm' } }],
      },
    ],
  }
  try {
    mod.parseMarketIndex(doc, TEST_INDEX_URL)
    return undefined
  } catch (error) {
    if (error instanceof mod.MarketIndexError) return error.path
    throw error
  }
}
