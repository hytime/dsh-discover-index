/**
 * Discovery labels and keywords derived from upstream's trust facts.
 *
 * The catalog already carries two things that format 1 can express and the
 * pipeline was throwing away:
 *
 *   - `capabilities`: what the plugin's code can reach (`fs-write`, `network`,
 *     `shell`, `credentials`, …), on 4,409 of 5,704 entries;
 *   - `capabilityRedLines`: findings from the upstream trust scan, on 592.
 *
 * Both become `labels`, which is the only per-plugin vocabulary Discover
 * actually renders: a tag on the card, a row on the plugin page, and — the part
 * that earns the work — an entry in the toolbar's Labels filter. That filter is
 * the one way a user can ask a question the market could not answer before,
 * such as "show me plugins that never touch my credentials".
 *
 * Why these are derived here instead of copied verbatim:
 *
 *   - Capability ids are already a stable closed vocabulary, so they map
 *     one-to-one. Their `title` is ours to write, because upstream publishes
 *     only the ids.
 *   - Red-line strings are prose sentences about a *specific* finding, and
 *     there are 86 distinct ones, most of them naming a single domain or IP.
 *     Publishing those as labels would create a filter menu of one-off
 *     sentences. They are normalised into a handful of classes instead; the
 *     detail is deliberately dropped, because a label is a filter, not a report.
 *
 * A label id must be referenced by `metadata.labels` and declared, or the whole
 * document fails validation, so every id produced here also has a declaration
 * in `labelTitle`.
 */

/** One upstream capability id and the label title to publish for it. */
interface CapabilityLabel {
  readonly title: Readonly<Record<string, string>>
}

/**
 * The capability vocabulary.
 *
 * Titles are written for a reader deciding whether to install, not for a
 * security auditor: "Writes files" answers "what will this do to my machine?"
 * in a way `fs-write` does not. Any id upstream adds later still becomes a
 * label — `labelTitle` falls back to the id — so a new capability degrades to
 * an untranslated tag rather than disappearing.
 */
const CAPABILITY_LABELS: Readonly<Record<string, CapabilityLabel>> = {
  'fs-read': { title: { en: 'Reads files', zh: '读取文件' } },
  'fs-write': { title: { en: 'Writes files', zh: '写入文件' } },
  network: { title: { en: 'Network access', zh: '访问网络' } },
  shell: { title: { en: 'Runs shell commands', zh: '执行 Shell 命令' } },
  env: { title: { en: 'Reads environment', zh: '读取环境变量' } },
  credentials: { title: { en: 'Touches credentials', zh: '涉及凭据' } },
  llm: { title: { en: 'Calls an LLM', zh: '调用 LLM' } },
  'host-runtime': { title: { en: 'Accesses host runtime', zh: '访问宿主运行时' } },
  'dynamic-code': { title: { en: 'Generates code at runtime', zh: '运行时生成代码' } },
  subagent: { title: { en: 'Spawns subagents', zh: '创建子智能体' } },
}

/**
 * Red-line classes, most to least severe.
 *
 * The ids are prefixed `risk:` so they are visibly a different axis from a
 * capability in a flat filter menu, and so a future capability named e.g.
 * `plaintext-http` cannot collide with a risk class.
 */
const RISK_LABELS: Readonly<Record<string, CapabilityLabel>> = {
  'risk:credentials-and-network': {
    title: { en: '⚠ Reads secrets and has network', zh: '⚠ 读取密钥且联网' },
  },
  'risk:install-time-code': {
    title: { en: '⚠ Runs code on install', zh: '⚠ 安装时执行代码' },
  },
  'risk:dynamic-code': {
    title: { en: '⚠ Dynamic code execution', zh: '⚠ 动态执行代码' },
  },
  'risk:plaintext-http': {
    title: { en: '⚠ Uses plaintext http', zh: '⚠ 使用明文 http' },
  },
  'risk:literal-ip': {
    title: { en: '⚠ Contacts a bare IP address', zh: '⚠ 直连 IP 地址' },
  },
}

/**
 * Fold one upstream red-line sentence into a stable risk class id.
 *
 * Order matters where a sentence matches twice: the credential-plus-network
 * finding is the one worth surfacing when a plugin also merely uses plaintext
 * http, so the more severe class is tested first.
 *
 * @param finding - one `capabilityRedLines` member.
 * @returns the class id, or `undefined` when the sentence names no known class.
 */
export function riskClassFor(finding: string): string | undefined {
  const text = finding.toLowerCase()
  if (text.includes('reads credentials/secrets and has network access')) return 'risk:credentials-and-network'
  if (text.includes('runs code at install time')) return 'risk:install-time-code'
  // `dynamic-code` is a capability upstream reports; a red line about it is
  // phrased as code that is generated or evaluated at runtime.
  if (text.includes('dynamic') || text.includes('eval') || text.includes('code at runtime')) return 'risk:dynamic-code'
  if (text.includes('plaintext http://')) return 'risk:plaintext-http'
  if (text.includes('literal ip')) return 'risk:literal-ip'
  return undefined
}

/**
 * Popularity buckets, from highest to lowest.
 *
 * A bucket rather than the exact number, and that is a format constraint, not a
 * simplification. A label id is declared once in the index and *referenced* by
 * plugins, so there is no such thing as a per-plugin label value: publishing
 * the exact count would require one declared label per distinct number. Measured
 * on the live catalog that is 235 labels for stars and 1,690 for downloads,
 * which turns the Discover label menu into an unusable list.
 *
 * Buckets also answer the question a reader actually has. Nobody filters for
 * "exactly 939 stars"; they want to see the well-established plugins and skip
 * the abandoned ones. The thresholds are round for the same reason.
 *
 * The exact numbers remain available where they were always read: `sortKeys`
 * keeps them for sorting, and DSH returns them to the model through the
 * `plugin_market` tool.
 */
const STAR_BUCKETS: readonly { readonly min: number; readonly id: string; readonly title: Readonly<Record<string, string>> }[] = [
  { min: 1000, id: 'stars:1k+', title: { en: '★ 1k+ stars', zh: '★ 1k+ 星标' } },
  { min: 100, id: 'stars:100+', title: { en: '★ 100+ stars', zh: '★ 100+ 星标' } },
  { min: 10, id: 'stars:10+', title: { en: '★ 10+ stars', zh: '★ 10+ 星标' } },
  { min: 1, id: 'stars:1+', title: { en: '★ 1+ stars', zh: '★ 1+ 星标' } },
  { min: 0, id: 'stars:0', title: { en: '★ No stars yet', zh: '★ 暂无星标' } },
]

/** Download buckets. Deliberately coarser than the star buckets. */
const DOWNLOAD_BUCKETS: readonly { readonly min: number; readonly id: string; readonly title: Readonly<Record<string, string>> }[] = [
  { min: 10_000, id: 'downloads:10k+', title: { en: '⤓ 10k+ downloads', zh: '⤓ 1 万+ 下载' } },
  { min: 1_000, id: 'downloads:1k+', title: { en: '⤓ 1k+ downloads', zh: '⤓ 1k+ 下载' } },
  { min: 100, id: 'downloads:100+', title: { en: '⤓ 100+ downloads', zh: '⤓ 100+ 下载' } },
  { min: 1, id: 'downloads:1+', title: { en: '⤓ Few downloads', zh: '⤓ 少量下载' } },
  { min: 0, id: 'downloads:0', title: { en: '⤓ No downloads yet', zh: '⤓ 暂无下载' } },
]

/**
 * The bucket label for a popularity value.
 *
 * Returns only the highest matching bucket, so the buckets partition the range
 * instead of nesting: a plugin with 1,200 stars is `stars:1k+` and not also
 * `stars:100+`. Nesting them would let a filter for `stars:1+` return the whole
 * market, which reads as a broken filter rather than a broad one.
 *
 * @param buckets - the bucket table to use.
 * @param value - the measured value, or `undefined` when unmeasured.
 * @returns the bucket id, or `undefined` when there is no value to place.
 */
function bucketLabel(
  buckets: readonly { readonly min: number; readonly id: string }[],
  value: number | undefined,
): string | undefined {
  if (value === undefined) return undefined
  for (const bucket of buckets) {
    if (value >= bucket.min) return bucket.id
  }
  return undefined
}

/**
 * Labels for one entry: its capabilities, plus one per red-line class.
 *
 * Risk classes sort before capabilities so the filter menu leads with the
 * warnings; within each group the order is upstream's, which is stable across
 * runs and therefore keeps the published document byte-identical when nothing
 * changed.
 *
 * @param capabilities - upstream's capability ids.
 * @param redLines - upstream's red-line sentences.
 * @returns label ids, deduplicated and ordered.
 */
export function labelsFor(
  capabilities: readonly string[],
  redLines: readonly string[],
): string[] {
  const risks = new Set<string>()
  for (const finding of redLines) {
    const risk = riskClassFor(finding)
    if (risk !== undefined) risks.add(risk)
  }
  const labels = Object.keys(RISK_LABELS).filter((id) => risks.has(id))
  const seen = new Set<string>()
  for (const capability of capabilities) {
    const id = capability.trim()
    if (id === '' || seen.has(id) || Object.hasOwn(RISK_LABELS, id)) continue
    seen.add(id)
    labels.push(id)
  }
  return labels
}

/**
 * Popularity bucket labels for one entry.
 *
 * Kept separate from `labelsFor` because the inputs come from different places:
 * capabilities are trust facts the source publishes, while these are measured
 * values the resolver carries as sort keys. Merging them would make one
 * function depend on both shapes for no gain.
 *
 * @param stars - the entry's star count, when it has one.
 * @param downloads - the entry's download count, when it has one.
 * @returns the bucket label ids, stars first, or an empty array when neither is known.
 */
export function popularityLabels(
  stars: number | undefined,
  downloads: number | undefined,
): string[] {
  const out: string[] = []
  const starBucket = bucketLabel(STAR_BUCKETS, stars)
  if (starBucket !== undefined) out.push(starBucket)
  const downloadBucket = bucketLabel(DOWNLOAD_BUCKETS, downloads)
  if (downloadBucket !== undefined) out.push(downloadBucket)
  return out
}

/**
 * The published title for a label id.
 *
 * Total on purpose: a capability upstream adds before this file knows it still
 * becomes a declared label, titled with its own id. An undeclared id would fail
 * the whole document, and an undeclared *reference* would too, so returning
 * `undefined` is not an option.
 *
 * @param id - label id.
 * @returns its localized title.
 */
export function labelTitle(id: string): Readonly<Record<string, string>> {
  const declared: CapabilityLabel | undefined = Object.hasOwn(RISK_LABELS, id)
    ? RISK_LABELS[id]
    : Object.hasOwn(CAPABILITY_LABELS, id) ? CAPABILITY_LABELS[id] : undefined
  if (declared !== undefined) return declared.title
  for (const bucket of [...STAR_BUCKETS, ...DOWNLOAD_BUCKETS]) {
    if (bucket.id === id) return bucket.title
  }
  return { en: id }
}

/**
 * Keywords for discovery, beyond the constant identity tags.
 *
 * Format 1 documents `metadata.keywords` as free-form strings for discovery and
 * expects generators to supply them. The search engine indexes this field, so
 * it is the one place a market can improve recall without DSH knowing what the
 * words mean. Here that means the capability ids spelled the way a person
 * types, plus the upstream category: someone searching "shell" or "memory"
 * should match a plugin that never repeats those words in its description.
 *
 * Identity keywords come first because they are true of every entry, then the
 * derived ones, deduplicated — the search index does not care, but a human
 * reading the document does.
 *
 * @param identity - keywords true of every plugin in this market.
 * @param category - upstream's category id, when it has one.
 * @param capabilities - upstream's capability ids.
 * @param upstreamKeywords - keywords the source itself published, if any.
 * @returns the keyword list.
 */
export function keywordsFor(
  identity: readonly string[],
  category: string | undefined,
  capabilities: readonly string[],
  upstreamKeywords: readonly string[] = [],
): string[] {
  const out = new Set<string>()
  for (const keyword of [...identity, ...upstreamKeywords]) {
    const text = keyword.trim()
    if (text !== '') out.add(text)
  }
  if (category !== undefined) out.add(category)
  for (const capability of capabilities) {
    const text = capability.trim()
    if (text === '') continue
    out.add(text)
    // `fs-write` is also searched as its words; a reader types "write".
    for (const word of text.split(/[-_]/)) {
      if (word.length > 2) out.add(word)
    }
  }
  return [...out]
}
