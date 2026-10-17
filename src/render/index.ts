/**
 * Rendering: candidates in, a validated format-1 document out.
 *
 * This is the only module that knows the published shape. It does not
 * re-implement the format's rules — it builds the document and then hands it to
 * `parseMarketIndex` from `@deepseek-ai/dsh-plugin-market-index`, the same
 * validator DSH itself runs. A document that fails that call is a bug in this
 * project, and the caller is expected to abort rather than publish.
 *
 * Two rules of the format shape everything here and are easy to get wrong:
 *
 *   - Every id a plugin references — its category, its labels, each sort key —
 *     must be DECLARED in the index metadata first. An undeclared id is a
 *     validation failure, not a warning.
 *   - `versions` must be non-empty. A plugin with no installable version cannot
 *     be represented, so it must be absent rather than present and empty.
 */
import {
  MarketIndexError,
  parseMarketIndex,
  type MarketIndex,
} from '@deepseek-ai/dsh-plugin-market-index'
import type { Candidate, Profile } from '../types.js'
import { labelTitle } from '../resolve/discovery.js'

/** The document this project writes; the validator is what proves it well-formed. */
export interface MarketIndexDocument {
  readonly format: 1
  readonly title: Readonly<Record<string, string>>
  readonly description?: Readonly<Record<string, string>>
  readonly metadata: {
    readonly categories: Readonly<Record<string, { title: Readonly<Record<string, string>> }>>
    readonly labels: Readonly<Record<string, { title: Readonly<Record<string, string>> }>>
    readonly sortKeys: Readonly<Record<string, { title: Readonly<Record<string, string>>; order: 'asc' | 'desc' }>>
  }
  readonly plugins: readonly unknown[]
}

/**
 * Category titles.
 *
 * Upstream maintains this vocabulary and keeps splitting categories as they
 * grow, so the titles are carried here rather than inferred from the ids: an
 * index that declared `agi` as "AGI" would render worse than one that says what
 * upstream says. `agi` and `wsl` are absent from older upstream documents and
 * present in the current one; an id with no title here falls back to its own
 * name, which is legible but not translated.
 */
const CATEGORY_TITLES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  agi: { en: 'AGI Architecture Exploration', zh: 'AGI 架构探索' },
  ui: { en: 'UI Enhancements', zh: 'UI 增强' },
  usage: { en: 'Usage & Billing', zh: '用量与计费' },
  theme: { en: 'Themes & Appearance', zh: '主题与外观' },
  model: { en: 'Models & Providers', zh: '模型与账号接入' },
  identity: { en: 'Identity & Communication', zh: '身份与通信' },
  session: { en: 'Sessions & Messages', zh: '会话与消息' },
  memory: { en: 'Memory', zh: '记忆' },
  tools: { en: 'Tools', zh: '工具' },
  wsl: { en: 'WSL', zh: 'WSL' },
  browser: { en: 'Browser', zh: '浏览器' },
  vision: { en: 'Vision', zh: '视觉' },
  voice: { en: 'Voice', zh: '语音' },
  docs: { en: 'Documents', zh: '文档' },
  skill: { en: 'Skills', zh: '技能' },
  workflow: { en: 'Workflow', zh: '工作流' },
  git: { en: 'Git', zh: 'Git' },
  notify: { en: 'Notifications', zh: '通知' },
  dev: { en: 'Development', zh: '开发' },
  security: { en: 'Security', zh: '安全' },
  remote: { en: 'Remote', zh: '远程' },
  market: { en: 'Marketplace', zh: '插件市场' },
  fun: { en: 'Fun', zh: '娱乐' },
}

/** Sort keys this index declares, and the direction each opens in. */
const SORT_KEY_TITLES: Readonly<Record<string, { title: Readonly<Record<string, string>>; order: 'asc' | 'desc' }>> = {
  stars: { title: { en: 'Stars', zh: '星标' }, order: 'desc' },
  downloads: { title: { en: 'Downloads', zh: '下载量' }, order: 'desc' },
  added: { title: { en: 'Date added', zh: '收录时间' }, order: 'desc' },
}

/** `_`-free fallback title for a category upstream added without telling us. */
function fallbackTitle(id: string): Record<string, string> {
  const words = id.split(/[-_]/).filter(Boolean)
  const text = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
  return { en: text === '' ? id : text }
}

/** Format 1 rejects a `name` that is not a valid npm package name. */
export { packageNameProblem } from '../resolve/package-name.js'
import { packageNameProblem } from '../resolve/package-name.js'
import * as versionRules from '../resolve/version-rules.js'
import { requiredTextProblem } from '../resolve/version-rules.js'

/**
 * Whether a candidate can be represented at all.
 *
 * Checked here as well as by the validator because dropping a bad candidate is
 * a routing decision — it belongs in the report as a rejection — whereas the
 * validator's job is to prove the whole document sound.
 *
 * @param candidate - candidate to test.
 * @returns the reason it cannot be rendered, or `undefined` when it can.
 */
export function unrenderableReason(candidate: Candidate): string | undefined {
  const nameProblem = packageNameProblem(candidate.name)
  if (nameProblem !== undefined) return nameProblem

  // Fields the format types as non-empty strings. An empty `author` is not a
  // cosmetic problem: it fails validation and takes the whole document down,
  // and an empty string is exactly what a partly-filled manifest produces.
  for (const [what, value] of [['author', candidate.author], ['homepage', candidate.homepage]] as const) {
    const problem = requiredTextProblem(value, what)
    if (problem !== undefined) return problem
  }
  for (const keyword of candidate.keywords) {
    const problem = requiredTextProblem(keyword, 'keyword')
    if (problem !== undefined) return problem
  }
  for (const label of candidate.labels) {
    const problem = requiredTextProblem(label, 'label')
    if (problem !== undefined) return problem
  }

  if (candidate.versions.length === 0) return 'no installable version'
  for (const version of candidate.versions) {
    const timestampProblem = versionRules.publishTimestampProblem(version.publishTimestamp)
    if (timestampProblem !== undefined) return `version ${version.version}: ${timestampProblem}`
    // Both of these arrive from the manifest on a live resolution and from the
    // cache on a replay, so both routes must be gated identically — a cached
    // `1.0` or a `workspace:` range would otherwise reach the document unchecked
    // and abort the entire run.
    const versionProblem = versionRules.versionProblem(version.version)
    if (versionProblem !== undefined) return versionProblem
    const rangeProblem = versionRules.dshRangeProblem(version.dshRange)
    if (rangeProblem !== undefined) return rangeProblem
    // The install source, gated for the same reason and by the same rule on
    // both the live and the cached route.
    const sourceIssue = versionRules.sourceProblem(version.source)
    if (sourceIssue !== undefined) return sourceIssue
  }
  return undefined
}

/** Only the localized languages the format accepts are emitted. */
const LANGUAGE_ID = /^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/u

function cleanLocalized(
  text: Readonly<Record<string, string>> | undefined,
): Record<string, string> | undefined {
  if (!text) return undefined
  const out: Record<string, string> = {}
  for (const [language, value] of Object.entries(text)) {
    if (!LANGUAGE_ID.test(language)) continue
    if (typeof value !== 'string' || value.trim() === '') continue
    out[language] = value
  }
  // `en` is mandatory for any localized member the format carries.
  if (!Object.hasOwn(out, 'en')) return undefined
  return out
}

/**
 * A `repository.url` must be a plain absolute http(s) URL with no query or
 * fragment, and `directory` must be made of path-safe segments.
 */
const PATH_SEGMENT = /^[A-Za-z0-9._@+-]+$/u

function safePath(directory: string | undefined): string | undefined {
  if (directory === undefined || directory === '') return undefined
  const segments = directory.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..' || !PATH_SEGMENT.test(segment))) {
    return undefined
  }
  return directory
}

function safeHttpUrl(url: string | undefined): string | undefined {
  if (url === undefined) return undefined
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return undefined
    if (parsed.username !== '' || parsed.password !== '') return undefined
    parsed.hash = ''
    parsed.search = ''
    return parsed.href
  } catch {
    return undefined
  }
}

/** Render one candidate into the shape the format defines. */
function renderPlugin(
  candidate: Candidate,
  declaredSortKeys: ReadonlySet<string>,
): Record<string, unknown> {
  const versions = candidate.versions.map((version) => ({
    version: version.version,
    publishTimestamp: version.publishTimestamp,
    source: version.source.type === 'npm'
      ? { type: 'npm' as const }
      : {
        type: 'git' as const,
        url: version.source.url,
        commit: version.source.commit,
        ...(safePath(version.source.path) === undefined ? {} : { path: safePath(version.source.path) as string }),
      },
    ...(version.dshRange === undefined ? {} : { engines: { dsh: version.dshRange } }),
  }))

  // Sort keys are intersected with what the index declares: an undeclared key
  // fails validation outright, so an unknown one is dropped here rather than
  // allowed to break the whole document. The set is passed in rather than read
  // from the constant table, because a source may contribute its own key (a
  // score, a rating) and that key is declared by the same derivation that this
  // check consults — reading the constant here would declare a key and then
  // silently drop every value for it.
  const sortKeys: Record<string, number> = {}
  for (const [id, value] of Object.entries(candidate.sortKeys)) {
    if (!declaredSortKeys.has(id)) continue
    if (!Number.isFinite(value)) continue
    sortKeys[id] = value
  }

  const title = cleanLocalized(candidate.title)
  const description = cleanLocalized(candidate.description)
  const homepage = safeHttpUrl(candidate.homepage)
  const repoUrl = candidate.repository ? safeHttpUrl(candidate.repository.url) : undefined
  const directory = safePath(candidate.repository?.directory)
  const icon = safeHttpUrl(candidate.icon)

  return {
    name: candidate.name,
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description }),
    ...(icon === undefined ? {} : { icon }),
    ...(candidate.author === undefined ? {} : { author: candidate.author }),
    ...(homepage === undefined ? {} : { homepage }),
    ...(repoUrl === undefined
      ? {}
      : { repository: directory === undefined ? { url: repoUrl } : { url: repoUrl, directory } }),
    metadata: {
      ...(candidate.category === undefined ? {} : { category: candidate.category }),
      keywords: [...candidate.keywords],
      labels: [...candidate.labels],
      sortKeys,
    },
    versions,
  }
}

/**
 * Assemble the document for one profile.
 *
 * Metadata is derived from the candidates actually present, so the index never
 * declares a category with no plugins in it and never references one it forgot
 * to declare. An unpublished category is invisible in the UI and a referenced
 * undeclared one is a hard failure; deriving the set from the data avoids both.
 *
 * @param candidates - the selected candidates, already policy-filtered.
 * @param profile - the profile whose title and description the document carries.
 * @returns an unvalidated format-1 document.
 * @throws {TypeError} when a candidate cannot be represented — rendering is
 *   assembly, not selection, so a candidate that reaches here and cannot be
 *   expressed is a bug in the caller's filtering rather than something to paper
 *   over with a shell document. The pipeline drops such candidates first.
 */
export function renderIndex(candidates: readonly Candidate[], profile: Profile): MarketIndexDocument {
  for (const candidate of candidates) {
    const reason = unrenderableReason(candidate)
    if (reason !== undefined) {
      throw new TypeError(
        `renderIndex received an unrenderable candidate ${JSON.stringify(candidate.name)}: ${reason}. `
        + 'Drop it in the pipeline (unrenderableReason) rather than rendering a document the format rejects.',
      )
    }
  }

  const usedCategories = new Set<string>()
  for (const candidate of candidates) {
    if (candidate.category !== undefined) usedCategories.add(candidate.category)
  }

  const categories: Record<string, { title: Record<string, string> }> = {}
  for (const id of [...usedCategories].sort()) {
    categories[id] = { title: { ...(CATEGORY_TITLES[id] ?? fallbackTitle(id)) } }
  }

  const labels = new Set<string>()
  for (const candidate of candidates) {
    for (const label of candidate.labels) labels.add(label)
  }

  // Declared unconditionally: a sort key with no values is merely inert, while
  // one that appears in a plugin and not here is a validation failure.
  const sortKeys: Record<string, { title: Record<string, string>; order: 'asc' | 'desc' }> = {}
  for (const [id, declaration] of Object.entries(SORT_KEY_TITLES)) {
    sortKeys[id] = { title: { ...declaration.title }, order: declaration.order }
  }
  // A source may publish its own numeric key (stars on another host, a rating,
  // a score). Declare every one a candidate actually carries: an id a plugin
  // references but the index does not declare fails the whole document, and a
  // declared id with no values is only inert, so deriving is the safe direction.
  for (const candidate of candidates) {
    for (const id of Object.keys(candidate.sortKeys)) {
      if (Object.hasOwn(sortKeys, id)) continue
      sortKeys[id] = { title: fallbackTitle(id), order: 'desc' }
    }
  }
  const labelDeclarations: Record<string, { title: Record<string, string> }> = {}
  for (const label of [...labels].sort()) {
    // `labelTitle` is total and owns the vocabulary: capabilities, risk
    // classes, and popularity buckets all get their localized title from there,
    // and an id it has never seen falls back to itself rather than becoming a
    // validator failure. Sorting keeps the published document stable across
    // runs, since the set is built by set-membership rather than insertion.
    labelDeclarations[label] = { title: { ...labelTitle(label) } }
  }

  const description = cleanLocalized(profile.description)
  return {
    format: 1,
    title: { ...cleanLocalized(profile.title) },
    ...(description === undefined ? {} : { description }),
    metadata: { categories, labels: labelDeclarations, sortKeys },
    plugins: candidates.map((candidate) => renderPlugin(candidate, new Set(Object.keys(sortKeys)))),
  }
}

/**
 * Validate a document with the format's own validator.
 * @param document - a rendered index.
 * @param indexUrl - absolute URL the document will be served from; relative
 *   icon references resolve against it, and the value decides whether an icon
 *   URL is acceptable.
 * @returns the validated index, with versions sorted by descending SemVer.
 * @throws {MarketIndexError} naming the JSON path of the first violated rule.
 */
export function validateIndex(document: unknown, indexUrl: string): MarketIndex {
  return parseMarketIndex(document, indexUrl)
}

export { MarketIndexError }
export type { MarketIndex }
