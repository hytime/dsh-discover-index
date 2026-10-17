/**
 * The upstream-catalog source: the live `plugins.json` that awesome-dsh-plugin
 * publishes.
 *
 * Two deliberate choices here.
 *
 * First, the LIVE document only. A local clone of that repository is a fork
 * that trails main by weeks — the copy available while this was written held
 * 2,059 entries against the live 5,704 — so reading it would silently drop
 * two-thirds of the list. This module never touches the filesystem.
 *
 * Second, the conversion is split into a pure transform and a thin fetcher.
 * `parseUpstreamCatalog` takes the parsed JSON and returns candidates with no
 * network at all, which is what makes every mapping rule testable offline.
 * Entries that need a network lookup to name themselves are returned
 * separately by `extractGitEntries`, so the pipeline — not this module — owns
 * the decision about how much network to spend.
 */
import type { Candidate, FieldMapping, Rejection, SourceContext, SourceConfig, SourceResult } from '../types.js'
import { npmCandidate, type UpstreamEntry } from '../resolve/npm.js'

/** Where the curated list is published, when configuration does not override it. */
export const UPSTREAM_CATALOG_URL = 'https://awesome-dsh-plugin.com/plugins.json'

/** Shape of one entry in upstream's `plugins.json`. Only the fields read here. */
export interface UpstreamCatalog {
  readonly name?: unknown
  readonly updated?: unknown
  readonly count?: unknown
  readonly categories?: unknown
  readonly plugins?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** Upstream's `description` is `{en, zh}`; keep every language it publishes. */
function asLocalized(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined
  const out: Record<string, string> = {}
  for (const [locale, text] of Object.entries(value)) {
    const string = asString(text)
    if (string !== undefined) out[locale] = string
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** A list of non-empty strings, or `undefined` when nothing usable is there. */
function asStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out = value.filter((member): member is string => typeof member === 'string' && member.trim() !== '')
  return out.length > 0 ? out : undefined
}

/**
 * Where the upstream catalog keeps the fields the pipeline reads.
 *
 * These are the defaults because this adapter was written for that document;
 * another catalog that calls its trust scan something else points at it from
 * `config/config.yml` and reuses every rule downstream.
 */
export const DEFAULT_FIELD_MAPPING: FieldMapping = {
  capabilities: 'capabilities',
  redLines: 'capabilityRedLines',
}

/**
 * Read a dot-separated member path, tolerating any missing segment.
 * @param value - the record to read.
 * @param path - dot-separated path such as `meta.trust.capabilities`.
 * @returns the value at the path, or `undefined`.
 */
function readPath(value: unknown, path: string | undefined): unknown {
  if (path === undefined) return undefined
  let cursor: unknown = value
  for (const segment of path.split('.')) {
    if (!isRecord(cursor) || !Object.hasOwn(cursor, segment)) return undefined
    cursor = cursor[segment]
  }
  return cursor
}

/**
 * Normalize one raw upstream entry. Exported for tests and for any future
 * adapter that speaks the same shape.
 * @param raw - one member of upstream's `plugins` array.
 * @param fields - where this source keeps its capabilities and red lines. The
 *   upstream catalog's own member names are the default, so a source that
 *   publishes trust data under different keys can point at them from
 *   configuration instead of needing a new adapter.
 * @returns the entry, or `undefined` when it lacks the minimum identity.
 */
export function toUpstreamEntry(
  raw: unknown,
  fields: FieldMapping = DEFAULT_FIELD_MAPPING,
): UpstreamEntry | undefined {
  if (!isRecord(raw)) return undefined
  const url = asString(raw.url)
  const name = asString(raw.name)
  const owner = asString(raw.owner)
  if (!url || !name || !owner) return undefined
  const capabilities = readPath(raw, fields.capabilities)
  const redLines = readPath(raw, fields.redLines)
  const keywords = readPath(raw, fields.keywords)
  const sortKey = fields.sortKey === undefined ? undefined : asNumber(readPath(raw, fields.sortKey.path))
  return {
    url,
    name,
    owner,
    ...(asString(raw.category) === undefined ? {} : { category: asString(raw.category) as string }),
    ...(asLocalized(raw.description) === undefined ? {} : { description: asLocalized(raw.description) as Record<string, string> }),
    ...(asString(raw.npm) === undefined ? {} : { npm: asString(raw.npm) as string }),
    ...(asString(raw.version) === undefined ? {} : { version: asString(raw.version) as string }),
    ...(asNumber(raw.stars) === undefined ? {} : { stars: asNumber(raw.stars) as number }),
    ...(asNumber(raw.downloads) === undefined ? {} : { downloads: asNumber(raw.downloads) as number }),
    ...(sortKey === undefined ? {} : { customSortKey: sortKey }),
    ...(asString(raw.added) === undefined ? {} : { added: asString(raw.added) as string }),
    ...(asString(raw.tarball) === undefined ? {} : { tarball: asString(raw.tarball) as string }),
    ...(asStringList(capabilities) === undefined
      ? {}
      : { capabilities: asStringList(capabilities) as string[] }),
    ...(asStringList(redLines) === undefined ? {} : { redLines: asStringList(redLines) as string[] }),
    ...(asStringList(keywords) === undefined ? {} : { keywords: asStringList(keywords) as string[] }),
  }
}

/** Every entry upstream publishes, normalized and in published order. */
export function upstreamEntries(raw: unknown): UpstreamEntry[] {
  if (!isRecord(raw)) return []
  const plugins = raw.plugins
  if (!Array.isArray(plugins)) return []
  const out: UpstreamEntry[] = []
  for (const member of plugins) {
    const entry = toUpstreamEntry(member)
    if (entry) out.push(entry)
  }
  return out
}

export interface ParseUpstreamOptions {
  readonly sourceId: string
  /** Applied to the entry's star count; 0 keeps everything. */
  readonly minStars: number
  /** Upstream's declared category titles, reused so descriptions stay localized. */
}

/**
 * Convert the upstream document into candidates, with no network calls.
 *
 * Only entries that already name an npm package and version become candidates
 * here. Everything else is reported as needing Git resolution — those entries
 * cannot be named without reading their `package.json`, and guessing a name
 * from the repository name is wrong twice over: repository names are not
 * unique across owners, and 225 of them carry uppercase letters that an npm
 * package name may not contain.
 *
 * @param raw - the parsed upstream document.
 * @param options - source identity and the star floor.
 * @returns candidates and the reasons other entries were not converted.
 */
export function parseUpstreamCatalog(raw: unknown, options: ParseUpstreamOptions): SourceResult {
  const candidates: Candidate[] = []
  const rejections: Rejection[] = []
  const entries = upstreamEntries(raw)

  if (entries.length === 0) {
    rejections.push({ id: '(whole document)', stage: 'source', reason: 'upstream document carried no readable plugins array' })
    return { candidates, rejections }
  }

  for (const entry of entries) {
    const identity = `${entry.owner}/${entry.name}`
    if (options.minStars > 0 && (entry.stars ?? 0) < options.minStars) continue
    const candidate = npmCandidate(entry, options.sourceId)
    if (candidate) candidates.push(candidate)
  }
  return { candidates, rejections }
}

/**
 * The entries that still need a network lookup to become candidates.
 *
 * Returned in published order so the pipeline can cap how many it resolves and
 * still cover the list predictably.
 * @param raw - the parsed upstream document.
 * @param options - source identity and the star floor.
 * @returns entries with no usable npm identity.
 */
export function extractGitEntries(raw: unknown, options: ParseUpstreamOptions): UpstreamEntry[] {
  const out: UpstreamEntry[] = []
  for (const entry of upstreamEntries(raw)) {
    if (options.minStars > 0 && (entry.stars ?? 0) < options.minStars) continue
    if (entry.npm && entry.version) continue
    out.push(entry)
  }
  return out
}

/** Resolve the catalog URL: explicit source config, then env override, then the default. */
export function catalogUrl(config: SourceConfig): string {
  return config.url ?? process.env['DSH_DISCOVER_UPSTREAM_URL'] ?? UPSTREAM_CATALOG_URL
}

/**
 * Fetch and convert the live catalog.
 * @param ctx - source context carrying configuration and the HTTP client.
 * @returns npm-derived candidates plus the entries needing Git resolution.
 */
export async function loadUpstreamCatalog(ctx: SourceContext): Promise<SourceResult> {
  const url = catalogUrl(ctx.config)
  ctx.log(`fetching ${url}`)
  const raw = await ctx.fetchJson<UpstreamCatalog>(url)
  return parseUpstreamCatalog(raw, { sourceId: ctx.config.id, minStars: ctx.config.minStars })
}
