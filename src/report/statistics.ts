/**
 * Statistics over one rendered profile.
 *
 * The published index answers "which plugins exist"; it does not answer "how
 * much is in here, and how trustworthy is each dimension". Those are different
 * questions, and the second one is what a visitor deciding whether to add this
 * market actually needs: how many entries carry a version history rather than a
 * single version, how many declare a DSH range, how many were never rated, how
 * many carry a risk finding.
 *
 * Deliberately derived from the document that was just validated, never from
 * the run's intermediate state. A stat that disagrees with the published file is
 * worse than no stat, and deriving from the file makes that impossible.
 */

/** Named totals, ordered so the page can render them without a ranking step. */
export interface CoverageStat {
  /** Stable id, used as the DOM anchor and the metric name in JSON. */
  readonly id: string
  readonly label: Readonly<Record<string, string>>
  /** Entries counted. */
  readonly count: number
  /** Entries the denominator covers. */
  readonly total: number
  /** One line explaining what the number means, including its denominator. */
  readonly note: Readonly<Record<string, string>>
}

/** One histogram row. */
export interface Bucket {
  readonly id: string
  readonly label: Readonly<Record<string, string>>
  readonly count: number
}

/** Everything the statistics page displays. */
export interface IndexStatistics {
  /** Plugins in the document. */
  readonly plugins: number
  /** Sum of every plugin's installable versions. */
  readonly versions: number
  /** Plugins listing more than one version. */
  readonly pluginsWithHistory: number
  readonly categories: number
  readonly labels: number
  readonly sortKeys: readonly string[]
  /** Coverage ratios, each with its own denominator. */
  readonly coverage: readonly CoverageStat[]
  /** Distribution of versions per plugin. */
  readonly versionBuckets: readonly Bucket[]
  /** Plugins per category, descending. */
  readonly categoryBuckets: readonly Bucket[]
  /** Presence per label id, descending. */
  readonly labelBuckets: readonly Bucket[]
}

/** The slice of a plugin this module reads. */
interface StatsPlugin {
  readonly metadata: {
    readonly category?: string
    readonly labels: readonly string[]
    readonly sortKeys: Readonly<Record<string, number>>
  }
  readonly versions: readonly { readonly engines?: { readonly dsh?: string } }[]
}

/** The slice of a document this module reads. */
export interface StatsDocument {
  readonly metadata: {
    readonly categories: Readonly<Record<string, unknown>>
    readonly labels: Readonly<Record<string, unknown>>
    readonly sortKeys: Readonly<Record<string, unknown>>
  }
  readonly plugins: readonly StatsPlugin[]
}

/** Version-count buckets, coarse enough to read at a glance. */
const VERSION_BUCKETS: readonly { readonly id: string; readonly min: number; readonly max: number; readonly en: string; readonly zh: string }[] = [
  { id: '1', min: 1, max: 1, en: '1 version', zh: '1 个版本' },
  { id: '2-3', min: 2, max: 3, en: '2–3 versions', zh: '2–3 个版本' },
  { id: '4-5', min: 4, max: 5, en: '4–5 versions', zh: '4–5 个版本' },
  { id: '6+', min: 6, max: Number.POSITIVE_INFINITY, en: '6 or more', zh: '6 个及以上' },
]

/**
 * Compute the page's statistics from a validated document.
 *
 * Every ratio reports its own denominator. A single "coverage" number would be
 * wrong on its face here: stars are known for one subset of plugins, DSH ranges
 * for another, and phrasing both against one total would quietly invent a fact.
 *
 * @param document - a format-1 document, as published.
 * @returns the statistics the page renders.
 */
export function computeStatistics(document: StatsDocument): IndexStatistics {
  const plugins = document.plugins
  const total = plugins.length
  const versions = plugins.reduce((sum, plugin) => sum + plugin.versions.length, 0)

  const withStars = plugins.filter((plugin) => plugin.metadata.sortKeys['stars'] !== undefined).length
  const withDownloads = plugins.filter((plugin) => plugin.metadata.sortKeys['downloads'] !== undefined).length
  const withHistory = plugins.filter((plugin) => plugin.versions.length > 1).length
  const withDshRange = plugins.filter((plugin) =>
    plugin.versions.some((version) => version.engines?.dsh !== undefined)).length
  const withCategory = plugins.filter((plugin) => plugin.metadata.category !== undefined).length
  const withLabels = plugins.filter((plugin) => plugin.metadata.labels.length > 0).length
  const withRisk = plugins.filter((plugin) =>
    plugin.metadata.labels.some((label) => label.startsWith('risk:'))).length

  const coverage: CoverageStat[] = [
    {
      id: 'stars',
      label: { en: 'Has a star count', zh: '有星标数' },
      count: withStars,
      total,
      note: {
        en: 'Upstream publishes a star count for these; the rest are unmeasured, not zero.',
        zh: '上游为这些条目提供了星标数；其余是「未测量」，不是 0。',
      },
    },
    {
      id: 'downloads',
      label: { en: 'Has a download count', zh: '有下载量' },
      count: withDownloads,
      total,
      note: {
        en: 'npm download counts, where the registry reports one.',
        zh: 'npm 下载量，仅包含 registry 会报告的那些。',
      },
    },
    {
      id: 'history',
      label: { en: 'Lists a version history', zh: '列出了版本历史' },
      count: withHistory,
      total,
      note: {
        en: 'More than one installable version. The rest are git-pinned entries or packages with a single release.',
        zh: '拥有一个以上可安装版本。其余是固定提交的 git 条目或只发过一版的包。',
      },
    },
    {
      id: 'dsh-range',
      label: { en: 'Declares engines.dsh', zh: '声明了 engines.dsh' },
      count: withDshRange,
      total,
      note: {
        en: 'A version states which DSH versions it runs on. The rest are checked only at install time.',
        zh: '某个版本声明了它支持的 DSH 版本范围。其余只能在安装时检查。',
      },
    },
    {
      id: 'category',
      label: { en: 'Has a category', zh: '有分类' },
      count: withCategory,
      total,
      note: {
        en: 'Category ids come from the upstream catalog and are declared in this index.',
        zh: '分类 id 来自上游目录，并在本索引中声明。',
      },
    },
    {
      id: 'labels',
      label: { en: 'Carries a label', zh: '带有标签' },
      count: withLabels,
      total,
      note: {
        en: 'At least one capability, risk, or popularity label — the filterable vocabulary.',
        zh: '至少一个能力、风险或热度标签——即筛选用的词表。',
      },
    },
    {
      id: 'risk',
      label: { en: 'Has a risk finding', zh: '带有风险标记' },
      count: withRisk,
      total,
      note: {
        en: 'Upstream\'s trust scan flagged something: credentials with network, install-time code, plaintext http, or a bare IP.',
        zh: '上游信任扫描发现了问题：凭据配合联网、安装时执行代码、明文 http，或直连 IP。',
      },
    },
  ]

  const versionBuckets: Bucket[] = VERSION_BUCKETS.map((bucket) => ({
    id: bucket.id,
    label: { en: bucket.en, zh: bucket.zh },
    count: plugins.filter((plugin) =>
      plugin.versions.length >= bucket.min && plugin.versions.length <= bucket.max).length,
  })).filter((bucket) => bucket.count > 0)

  // Categories are declared with their own localized titles; the bucket label
  // reuses that title rather than inventing a second name for the same id.
  const categories = document.metadata.categories as Readonly<Record<string, { title?: Record<string, string> }>>
  const categoryCounts = new Map<string, number>()
  for (const plugin of plugins) {
    const category = plugin.metadata.category
    if (category === undefined) continue
    categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1)
  }
  const categoryBuckets: Bucket[] = [...categoryCounts.entries()]
    .map(([id, count]) => ({
      id,
      label: categories[id]?.title ?? { en: id },
      count,
    }))
    .sort((left, right) => right.count - left.count || left.id.localeCompare(right.id))

  const labels = document.metadata.labels as Readonly<Record<string, { title?: Record<string, string> }>>
  const labelCounts = new Map<string, number>()
  for (const plugin of plugins) {
    for (const label of plugin.metadata.labels) {
      labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1)
    }
  }
  const labelBuckets: Bucket[] = [...labelCounts.entries()]
    .map(([id, count]) => ({
      id,
      label: labels[id]?.title ?? { en: id },
      count,
    }))
    .sort((left, right) => right.count - left.count || left.id.localeCompare(right.id))

  return {
    plugins: total,
    versions,
    pluginsWithHistory: withHistory,
    categories: Object.keys(document.metadata.categories).length,
    labels: Object.keys(document.metadata.labels).length,
    sortKeys: Object.keys(document.metadata.sortKeys),
    coverage,
    versionBuckets,
    categoryBuckets,
    labelBuckets,
  }
}
