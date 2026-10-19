/**
 * The statistics page.
 *
 * A static HTML document generated at build time from the same validated JSON the
 * market publishes. Three constraints shaped it:
 *
 *   - **No client-side computation.** The numbers are already known when the
 *     build runs, so the page ships finished text and a visitor with JavaScript
 *     off still reads every number. It also means the site cannot disagree with
 *     the index, because both come from one object.
 *   - **No third-party scripts.** This is a page about a plugin market; loading
 *     someone else's tracker into it would be a poor advertisement. The only
 *     external requests are to this origin.
 *   - **Bilingual without a framework.** Every user-visible string carries both
 *     languages and a single `lang` attribute on `<html>` selects one, so the
 *     page is correct for a screen reader either way.
 */
import type { Bucket, CoverageStat, IndexStatistics } from './statistics.js'
import type { ReferenceReport } from './references.js'

/** What the page needs besides the statistics. */
export interface PageOptions {
  /** Document title, localized. */
  readonly title: Readonly<Record<string, string>>
  /** The index file this page describes, as published. */
  readonly indexUrl: string
  /** Where the page itself will be served, for canonical links. */
  readonly siteUrl: string
  /** ISO date the page was generated. */
  readonly generatedAt: string
  /** Repository URL, so a reader can see how the numbers are produced. */
  readonly repositoryUrl: string
  /**
   * Who references this project, when the sweep ran. Absent on a build without a
   * token — the page then says the count was not measured rather than showing 0,
   * because "we did not look" and "nobody uses it" are different facts.
   */
  readonly references?: ReferenceReport | undefined
}

const HTML_ESCAPE: Readonly<Record<string, string>> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}

/** Escape text for HTML. Every interpolated string goes through this. */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => HTML_ESCAPE[character] ?? character)
}

/** Both languages of a string, escaped, as two inline spans the CSS toggles. */
function bilingual(text: Readonly<Record<string, string>>): string {
  const en = escapeHtml(text['en'] ?? Object.values(text)[0] ?? '')
  const zh = text['zh'] ?? text['en'] ?? Object.values(text)[0] ?? ''
  return `<span class="en">${en}</span><span class="zh">${escapeHtml(zh)}</span>`
}

/** A number with thousands separators, so six digits stay readable. */
function num(value: number): string {
  return value.toLocaleString('en-US')
}

/** One percentage, rounded, never a misleading decimal. */
function percent(count: number, total: number): number {
  return total === 0 ? 0 : Math.round((count / total) * 100)
}

/** A horizontal bar whose width is the ratio, with the number beside it. */
function coverageRow(stat: CoverageStat): string {
  const pct = percent(stat.count, stat.total)
  return `<li class="row">
      <div class="row-head">
        <span class="row-label">${bilingual(stat.label)}</span>
        <span class="row-value"><strong>${num(stat.count)}</strong><span class="of">/ ${num(stat.total)}</span><span class="pct">${String(pct)}%</span></span>
      </div>
      <div class="bar" role="img" aria-label="${String(pct)}%"><span style="width:${String(pct)}%"></span></div>
      <p class="note">${bilingual(stat.note)}</p>
    </li>`
}

/**
 * The references section.
 *
 * A missing sweep and a zero count are rendered differently on purpose. The
 * sweep needs a token, and a build without one would otherwise publish "0
 * references" — a claim about the world derived from not having looked.
 */
function referencesSection(report: ReferenceReport | undefined): string {
  const heading = `<h2>${bilingual({ en: 'Who references this project', zh: '谁引用了本项目' })}</h2>`

  if (report === undefined) {
    return `<section>
  ${heading}
  <p class="note">${bilingual({
    en: 'Not measured on this build: the sweep needs a GitHub token, which this run did not have. This is not a count of zero.',
    zh: '本次构建未测量：该扫描需要 GitHub token，而本次运行没有。这不代表数量为 0。',
  })}</p>
</section>`
  }

  // An empty list means one of two different things, and they must not read the
  // same: the sweep looked and found nothing, or the sweep could not look. The
  // second case is what a rate-limited CI run produces, and rendering it as
  // "nobody references this" would state a fact we do not have.
  const list = report.references.length === 0
    ? `<p class="note">${report.incomplete
      ? bilingual({
        en: 'No references found, but the sweep did not complete — so this says nothing about whether any exist.',
        zh: '未发现引用，但本次扫描并未完成——因此这不能说明是否真的没有。',
      })
      : bilingual({
        en: 'No repository names this project yet.',
        zh: '目前还没有仓库提到本项目。',
      })}</p>`
    : `<ul>
${report.references.map((reference) => `  <li class="ref">
      <a href="https://github.com/${escapeHtml(reference.repository)}">${escapeHtml(reference.repository)}</a>
      ${reference.usesIndexUrl
        ? '<span class="tag">' + bilingual({ en: 'cites the URL', zh: '引用了索引地址' }) + '</span>'
        : ''}
      <span class="ref-path">${escapeHtml(reference.paths.slice(0, 2).join(', '))}${reference.paths.length > 2 ? ' …' : ''}</span>
    </li>`).join('\n')}
  </ul>`

  const caveat = report.incomplete && report.references.length > 0
    ? `<p class="note">${bilingual({
      en: 'Incomplete: at least one search failed or was truncated, so this is a floor, not a total.',
      zh: '不完整：至少一次搜索失败或被截断，因此这是下限而非总数。',
    })}</p>`
    : ''

  // Traffic measures visits to the repository page, not loads of the index, and
  // it is only readable with a token that has push access. Absent is shown as
  // absent rather than as zero.
  const traffic = report.traffic === undefined
    ? ''
    : `<h3 class="subhead">${bilingual({ en: 'Repository traffic (14 days)', zh: '仓库流量（14 天）' })}</h3>
  <ul class="traffic">
    <li><strong>${num(report.traffic.views)}</strong> ${bilingual({ en: 'views', zh: '次浏览' })} · <strong>${num(report.traffic.uniqueVisitors)}</strong> ${bilingual({ en: 'unique visitors', zh: '位独立访客' })}</li>
    <li><strong>${num(report.traffic.clones)}</strong> ${bilingual({ en: 'clones', zh: '次克隆' })} · <strong>${num(report.traffic.uniqueCloners)}</strong> ${bilingual({ en: 'unique cloners', zh: '位独立克隆者' })}</li>
  </ul>`

  return `<section>
  ${heading}
  <p class="lead">${bilingual({
    en: 'Repositories whose public files name this project, found by GitHub code search. The search index lags by minutes to hours, so a reference made today may not appear yet.',
    zh: '公开文件中提到本项目的仓库，由 GitHub 代码搜索得出。搜索索引有数分钟到数小时的延迟，因此今天刚产生的引用可能尚未出现。',
  })}</p>
  ${list}
  <p class="note">${bilingual({
    en: 'This is a reference count, not a visitor count: GitHub Pages keeps no access log, so how many people loaded the index is not recorded anywhere.',
    zh: '这是「引用数」，不是「访客数」：GitHub Pages 不保留访问日志，因此有多少人加载过索引在任何地方都没有记录。',
  })}</p>
  ${caveat}
  ${traffic}
</section>`
}

/** A bucket row: label, bar relative to the largest bucket, count. */
function bucketRow(bucket: Bucket, largest: number): string {
  const pct = largest === 0 ? 0 : Math.round((bucket.count / largest) * 100)
  return `<li class="bucket">
      <span class="bucket-label">${bilingual(bucket.label)}</span>
      <span class="bucket-bar"><span style="width:${String(pct)}%"></span></span>
      <span class="bucket-count">${num(bucket.count)}</span>
    </li>`
}

/**
 * Render the page.
 * @param statistics - computed from the validated document.
 * @param options - title, URLs, and generation time.
 * @returns a complete HTML document.
 */
export function renderStatisticsPage(statistics: IndexStatistics, options: PageOptions): string {
  const largestCategory = Math.max(1, ...statistics.categoryBuckets.map((bucket) => bucket.count))
  const largestLabel = Math.max(1, ...statistics.labelBuckets.map((bucket) => bucket.count))
  const largestVersion = Math.max(1, ...statistics.versionBuckets.map((bucket) => bucket.count))

  const summary = [
    { id: 'plugins', value: statistics.plugins, label: { en: 'plugins', zh: '个插件' } },
    { id: 'versions', value: statistics.versions, label: { en: 'installable versions', zh: '个可安装版本' } },
    { id: 'categories', value: statistics.categories, label: { en: 'categories', zh: '个分类' } },
    { id: 'labels', value: statistics.labels, label: { en: 'labels', zh: '个标签' } },
  ]

  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${bilingual(options.title)} · Statistics</title>
<link rel="canonical" href="${escapeHtml(options.siteUrl)}/stats.html">
<meta name="description" content="Coverage and distribution statistics for this DSH plugin market index.">
<style>
:root {
  color-scheme: light dark;
  --bg: #ffffff; --fg: #1a1a1a; --muted: #666; --line: #e5e5e5;
  --card: #fafafa; --accent: #2563eb; --accent-soft: #dbeafe;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #0b0f19; --fg: #e8e8e8; --muted: #9aa0aa; --line: #232936;
          --card: #121724; --accent: #60a5fa; --accent-soft: #1e293b; }
}
* { box-sizing: border-box; }
body { margin: 0; padding: 2rem 1rem 4rem; background: var(--bg); color: var(--fg);
       font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", sans-serif; }
main { max-width: 860px; margin: 0 auto; }
header { margin-bottom: 2rem; }
h1 { font-size: 1.6rem; margin: 0 0 .35rem; letter-spacing: -.01em; }
.sub { color: var(--muted); font-size: .9rem; margin: 0; }
.sub a { color: var(--accent); text-decoration: none; }
.sub a:hover { text-decoration: underline; }
h2 { font-size: 1.05rem; margin: 2.5rem 0 .35rem; }
.lead { color: var(--muted); font-size: .87rem; margin: 0 0 1rem; }
.summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: .75rem; margin: 1.5rem 0 0; }
.summary div { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: .9rem 1rem; }
.summary strong { display: block; font-size: 1.5rem; font-variant-numeric: tabular-nums; letter-spacing: -.02em; }
.summary span { color: var(--muted); font-size: .8rem; }
ul { list-style: none; margin: 0; padding: 0; }
.row { border: 1px solid var(--line); border-radius: 10px; padding: .85rem 1rem; margin-bottom: .6rem; background: var(--card); }
.row-head { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; }
.row-label { font-weight: 600; }
.row-value { font-variant-numeric: tabular-nums; white-space: nowrap; }
.row-value .of { color: var(--muted); font-size: .82rem; margin-left: .15rem; }
.row-value .pct { display: inline-block; min-width: 2.6rem; text-align: right; color: var(--accent); font-weight: 600; margin-left: .4rem; }
.bar { height: 6px; background: var(--accent-soft); border-radius: 999px; margin: .55rem 0 .4rem; overflow: hidden; }
.bar span { display: block; height: 100%; background: var(--accent); border-radius: 999px; }
.note { margin: 0; color: var(--muted); font-size: .8rem; }
.bucket { display: grid; grid-template-columns: minmax(120px, 1.1fr) 2fr auto; gap: .75rem; align-items: center; padding: .3rem 0; font-size: .88rem; }
.bucket-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bucket-bar { height: 6px; background: var(--accent-soft); border-radius: 999px; overflow: hidden; }
.bucket-bar span { display: block; height: 100%; background: var(--accent); }
.bucket-count { font-variant-numeric: tabular-nums; color: var(--muted); min-width: 4rem; text-align: right; }
footer { margin-top: 3rem; padding-top: 1.25rem; border-top: 1px solid var(--line); color: var(--muted); font-size: .82rem; }
.ref { display: flex; align-items: baseline; gap: .6rem; flex-wrap: wrap; padding: .35rem 0;
       border-bottom: 1px solid var(--line); font-size: .88rem; }
.ref:last-child { border-bottom: 0; }
.ref a { color: var(--accent); text-decoration: none; font-weight: 600; }
.ref a:hover { text-decoration: underline; }
.tag { background: var(--accent-soft); color: var(--accent); border-radius: 999px;
       padding: .05rem .5rem; font-size: .72rem; }
.subhead { font-size: .92rem; margin: 1.5rem 0 .5rem; }
.traffic { font-size: .88rem; color: var(--muted); }
.traffic li { padding: .15rem 0; }
.traffic strong { color: var(--fg); font-variant-numeric: tabular-nums; }
.ref-path { color: var(--muted); font-size: .78rem; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.zh { display: none; }
html[lang="zh"] .zh { display: inline; }
html[lang="zh"] .en { display: none; }
.lang { background: none; border: 1px solid var(--line); color: var(--fg); border-radius: 999px;
        padding: .2rem .7rem; font-size: .78rem; cursor: pointer; margin-top: .8rem; }
@media (max-width: 520px) {
  .bucket { grid-template-columns: 1fr auto; }
  .bucket-bar { display: none; }
}
</style>
</head>
<body>
<main>
<header>
  <h1>${bilingual({ en: 'Market statistics', zh: '市场统计' })}</h1>
  <p class="sub">
    ${bilingual({ en: 'Computed from the published index', zh: '由已发布的索引计算' })} ·
    <a href="${escapeHtml(options.indexUrl)}">index.json</a> ·
    <a href="${escapeHtml(options.repositoryUrl)}">source</a>
  </p>
  <button class="lang" id="lang" type="button">English / 中文</button>
</header>

<section class="summary">
${summary.map((item) => `  <div><strong data-stat="${item.id}">${num(item.value)}</strong><span>${bilingual(item.label)}</span></div>`).join('\n')}
</section>

<section>
  <h2>${bilingual({ en: 'Coverage', zh: '覆盖率' })}</h2>
  <p class="lead">${bilingual({
    en: 'Each row counts its own subset. Where upstream publishes nothing, the entry is unmeasured — not zero.',
    zh: '每一行统计的是各自的子集。上游没有提供的数据是「未测量」，不是 0。',
  })}</p>
  <ul>
${statistics.coverage.map((stat) => coverageRow(stat)).join('\n')}
  </ul>
</section>

<section>
  <h2>${bilingual({ en: 'Versions per plugin', zh: '每个插件的版本数' })}</h2>
  <p class="lead">${bilingual({
    en: 'The market keeps the most recent five versions per plugin, plus the highest version and the highest stable one.',
    zh: '市场为每个插件保留最近的五个版本，外加最高版本与最高稳定版。',
  })}</p>
  <ul>
${statistics.versionBuckets.map((bucket) => bucketRow(bucket, largestVersion)).join('\n')}
  </ul>
</section>

<section>
  <h2>${bilingual({ en: 'Plugins per category', zh: '各分类的插件数' })}</h2>
  <ul>
${statistics.categoryBuckets.map((bucket) => bucketRow(bucket, largestCategory)).join('\n')}
  </ul>
</section>

<section>
  <h2>${bilingual({ en: 'Plugins per label', zh: '各标签的插件数' })}</h2>
  <p class="lead">${bilingual({
    en: 'Labels are the filterable vocabulary: capabilities, risk findings, and popularity buckets.',
    zh: '标签即筛选词表：能力、风险发现与热度分档。',
  })}</p>
  <ul>
${statistics.labelBuckets.map((bucket) => bucketRow(bucket, largestLabel)).join('\n')}
  </ul>
</section>

${referencesSection(options.references)}

<footer>
  <p>${bilingual({
    en: 'Generated',
    zh: '生成于',
  })}: <time datetime="${escapeHtml(options.generatedAt)}">${escapeHtml(options.generatedAt)}</time></p>
  <p>${bilingual({
    en: 'This page is a statistical view of third-party catalog data. It is not a security review.',
    zh: '本页是第三方目录数据的统计视图，不构成安全审查。',
  })}</p>
  <p>${bilingual({
    en: 'Sort keys declared by this index',
    zh: '本索引声明的排序键',
  })}: ${statistics.sortKeys.map((key) => `<code>${escapeHtml(key)}</code>`).join(', ')}</p>
</footer>
</main>
<script>
  // The only script on the page: a language toggle. Every number is already in
  // the HTML, so this changes presentation and nothing else.
  (function () {
    var root = document.documentElement
    var button = document.getElementById('lang')
    try {
      var saved = localStorage.getItem('stats-lang')
      if (saved === 'en' || saved === 'zh') root.setAttribute('lang', saved)
    } catch (error) {}
    button.addEventListener('click', function () {
      var next = root.getAttribute('lang') === 'zh' ? 'en' : 'zh'
      root.setAttribute('lang', next)
      try { localStorage.setItem('stats-lang', next) } catch (error) {}
    })
  })()
</script>
</body>
</html>
`
}
