/**
 * Configuration loading and validation.
 *
 * Configuration is data, not code: which sources to read, how to combine them,
 * and which output documents to publish. Everything the pipeline does is
 * decided here, so adding a source later is an edit to `config/config.yml` plus
 * one adapter module — never a change to the pipeline.
 */
import fs from 'node:fs'
import path from 'node:path'
import { load as parseYaml } from 'js-yaml'
import type { Profile, ProjectConfig, SourceConfig } from './types.js'

/** Path used when the caller does not name one, relative to the working directory. */
export const DEFAULT_CONFIG_PATH = 'config/config.yml'

/** Source kinds this build knows how to read. */
export const KNOWN_SOURCE_KINDS = new Set(['upstream-catalog'])

/** Raised for a configuration file that cannot be used as written. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

function asRecord(value: unknown, at: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ConfigError(`${at} must be a mapping`)
  }
  return value as Record<string, unknown>
}

function asString(value: unknown, at: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ConfigError(`${at} must be a non-empty string`)
  }
  return value
}

function asStringArray(value: unknown, at: string): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new ConfigError(`${at} must be a list`)
  return value.map((member, index) => asString(member, `${at}[${index}]`))
}

/** Localized text as upstream stores it: at least English. */
function asLocalized(value: unknown, at: string): Record<string, string> {
  const record = asRecord(value, at)
  const out: Record<string, string> = {}
  for (const [locale, text] of Object.entries(record)) {
    out[locale] = asString(text, `${at}.${locale}`)
  }
  if (Object.keys(out).length === 0) throw new ConfigError(`${at} must carry at least one language`)
  return out
}

function asNumber(value: unknown, at: string, fallback: number): number {
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new ConfigError(`${at} must be a number`)
  return value
}

/**
 * Parse a configuration document.
 *
 * @param text - YAML source.
 * @param at - where the text came from, used in messages.
 * @returns the validated configuration.
 * @throws {ConfigError} naming the first rule the document breaks.
 */
export function parseConfig(text: string, at = DEFAULT_CONFIG_PATH): ProjectConfig {
  let raw: unknown
  try {
    raw = parseYaml(text)
  } catch (error) {
    throw new ConfigError(`${at}: invalid YAML — ${error instanceof Error ? error.message : String(error)}`)
  }
  const root = asRecord(raw, at)

  const sourceRecords = root.sources
  if (!Array.isArray(sourceRecords) || sourceRecords.length === 0) {
    throw new ConfigError(`${at}: "sources" must be a non-empty list`)
  }
  const sources: SourceConfig[] = sourceRecords.map((member, index) => {
    const record = asRecord(member, `sources[${index}]`)
    const id = asString(record.id, `sources[${index}].id`)
    const kind = asString(record.kind, `sources[${index}].kind`)
    if (!KNOWN_SOURCE_KINDS.has(kind)) {
      throw new ConfigError(
        `sources[${index}] "${id}": unknown kind ${JSON.stringify(kind)} — known kinds are ${[...KNOWN_SOURCE_KINDS].join(', ')}`,
      )
    }
    return {
      id,
      kind,
      enabled: record.enabled === undefined ? true : record.enabled === true,
      minStars: asNumber(record.minStars, `sources[${index}].minStars`, 0),
      ...(record.url === undefined ? {} : { url: asString(record.url, `sources[${index}].url`) }),
      ...(record.queries === undefined
        ? {}
        : { queries: asStringArray(record.queries, `sources[${index}].queries`) }),
      priority: asNumber(record.priority, `sources[${index}].priority`, 0),
    }
  })

  const byId = new Map(sources.map((source) => [source.id, source]))
  if (byId.size !== sources.length) throw new ConfigError(`${at}: source ids must be unique`)

  const profileRecords = root.profiles
  if (!Array.isArray(profileRecords) || profileRecords.length === 0) {
    throw new ConfigError(`${at}: "profiles" must be a non-empty list`)
  }
  const profiles: Profile[] = profileRecords.map((member, index) => {
    const record = asRecord(member, `profiles[${index}]`)
    const id = asString(record.id, `profiles[${index}].id`)
    const names = asStringArray(record.sources, `profiles[${index}].sources`)
    if (names.length === 0) throw new ConfigError(`profiles[${index}] "${id}": must name at least one source`)
    for (const name of names) {
      if (!byId.has(name)) {
        throw new ConfigError(`profiles[${index}] "${id}": unknown source ${JSON.stringify(name)}`)
      }
    }
    const output = asString(record.output, `profiles[${index}].output`)
    if (!output.endsWith('.json') || output.includes('/') || output.includes('..')) {
      throw new ConfigError(`profiles[${index}] "${id}": output must be a bare *.json filename (got ${JSON.stringify(output)})`)
    }
    return {
      id,
      title: asLocalized(record.title, `profiles[${index}].title`),
      ...(record.description === undefined
        ? {}
        : { description: asLocalized(record.description, `profiles[${index}].description`) }),
      sources: names,
      minStars: asNumber(record.minStars, `profiles[${index}].minStars`, 0),
      output,
    }
  })

  if (new Set(profiles.map((profile) => profile.id)).size !== profiles.length) {
    throw new ConfigError(`${at}: profile ids must be unique`)
  }
  if (new Set(profiles.map((profile) => profile.output)).size !== profiles.length) {
    throw new ConfigError(`${at}: profile outputs must be unique, or two profiles would overwrite each other`)
  }

  return {
    sources,
    profiles,
    denyRepos: asStringArray(root.denyRepos, `${at}: denyRepos`),
    denyPackages: asStringArray(root.denyPackages, `${at}: denyPackages`),
  }
}

/**
 * Read and validate the configuration file.
 * @param configPath - path to the YAML file; defaults to `config/config.yml`.
 * @returns the validated configuration.
 * @throws {ConfigError} when the file is missing or unusable.
 */
export function loadConfig(configPath: string = DEFAULT_CONFIG_PATH): ProjectConfig {
  const resolved = path.resolve(configPath)
  if (!fs.existsSync(resolved)) throw new ConfigError(`configuration not found: ${resolved}`)
  return parseConfig(fs.readFileSync(resolved, 'utf8'), configPath)
}
