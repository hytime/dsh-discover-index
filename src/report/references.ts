/**
 * Who references this index.
 *
 * This is the one question GitHub Pages cannot answer from the server side: it
 * serves the document and keeps no access log, so "how many people loaded
 * index.json" is not merely hard to get — it is not recorded anywhere. What can
 * be observed is who *names* the project in public code, which is a different
 * and smaller question, but a real one and answerable.
 *
 * Three signals exist, and only one is honest here:
 *
 *   - **GitHub code search** — repository + path of every file naming this
 *     project. This is the reference count below. Its limit is latency: the
 *     index trails by minutes to hours, so a reference made today can be
 *     invisible, and a count is a floor rather than a total.
 *   - **GitHub traffic** — views and clones of this repository, available only
 *     to a token with push access. It measures the repository page, not the
 *     index being served, so it is not a reference count and is kept separate.
 *   - **A client-side counter** (hits.sh and friends) — rejected. Every request
 *     increments it, including crawlers, badge refreshes and the author's own
 *     tests, so the number measures requests rather than people. Publishing it
 *     as a visitor count would be a fabricated statistic, which is worse than
 *     publishing none.
 */

/** One repository that names this project. */
export interface Reference {
  /** `owner/repo`, as the search API reports it. */
  readonly repository: string
  /** Files in that repository that mention the project. */
  readonly paths: readonly string[]
  /** Whether any of those files carries the index URL itself, not just the name. */
  readonly usesIndexUrl: boolean
}

/** What a reference sweep found, and what it could not see. */
export interface ReferenceReport {
  /** Repositories naming this project, excluding this one. */
  readonly references: readonly Reference[]
  /** Repositories whose text contains the published index URL. */
  readonly urlCitations: number
  /** How many search queries were issued, for the run report. */
  readonly queries: number
  /**
   * True when a search failed and the result is therefore incomplete. A partial
   * sweep is reported as partial rather than as a smaller true number.
   */
  readonly incomplete: boolean
}

/** GitHub's code search page size is capped at 100. */
const MAX_RESULTS = 100

/** One hit from the code search API. */
interface CodeSearchItem {
  readonly repository?: { readonly full_name?: unknown }
  readonly path?: unknown
}

/** The shape of a code search response, in the members this module reads. */
interface CodeSearchResponse {
  readonly total_count?: unknown
  readonly items?: unknown
}

/** The subset of `fetch` this module needs, injected for tests. */
export type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<{
  readonly ok: boolean
  readonly status: number
  json(): Promise<unknown>
}>

export interface ReferenceOptions {
  /** Published index URL; citations of it are counted separately. */
  readonly indexUrl: string
  /** This repository, in `owner/repo` form — excluded from its own count. */
  readonly self: string
  /** Token for the search API. Anonymous search is heavily rate limited. */
  readonly token?: string | undefined
  readonly fetchImpl?: FetchLike
  /** Injected for tests and for a deterministic report. */
  readonly apiBase?: string
}

/** Run one code search query and return its hits. */
async function search(
  fetchImpl: FetchLike,
  apiBase: string,
  query: string,
  token: string | undefined,
): Promise<{ items: CodeSearchItem[]; total: number }> {
  const url = `${apiBase}/search/code?q=${encodeURIComponent(query)}&per_page=${String(MAX_RESULTS)}`
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
  }
  if (token !== undefined) headers['authorization'] = `Bearer ${token}`
  const response = await fetchImpl(url, { headers })
  if (!response.ok) throw new Error(`code search ${String(response.status)} for ${query}`)
  const body = (await response.json()) as CodeSearchResponse
  const items = Array.isArray(body.items) ? (body.items as CodeSearchItem[]) : []
  const total = typeof body.total_count === 'number' ? body.total_count : items.length
  return { items, total }
}

/**
 * Find the repositories that name this project.
 *
 * Two queries are issued rather than one, because they answer different
 * questions: the project name finds anything that mentions it, while the index
 * URL finds only documents that point a reader at the market itself. A
 * repository that names the project without the URL is still a reference — it is
 * how most people would link to it, by repository — but the split tells a
 * publisher whether the index is actually being consumed or merely discussed.
 *
 * Never throws. A failed query marks the report incomplete and returns what was
 * found, because a monitoring step must not be able to fail a build whose actual
 * product is the index.
 *
 * @param options - URLs, identity, and the token to search with.
 * @returns the references found, with an explicit incompleteness flag.
 */
export async function findReferences(options: ReferenceOptions): Promise<ReferenceReport> {
  const fetchImpl: FetchLike = options.fetchImpl
    ?? ((url, init) => fetch(url, init as RequestInit) as unknown as ReturnType<FetchLike>)
  const apiBase = options.apiBase ?? 'https://api.github.com'
  const self = options.self.toLowerCase()

  const byRepository = new Map<string, { paths: Set<string>; usesIndexUrl: boolean }>()
  let queries = 0
  let incomplete = false

  const collect = (items: readonly CodeSearchItem[], usesIndexUrl: boolean): void => {
    for (const item of items) {
      const name = item.repository?.full_name
      if (typeof name !== 'string') continue
      if (name.toLowerCase() === self) continue
      const entry = byRepository.get(name) ?? { paths: new Set<string>(), usesIndexUrl: false }
      if (typeof item.path === 'string' && item.path !== '') entry.paths.add(item.path)
      if (usesIndexUrl) entry.usesIndexUrl = true
      byRepository.set(name, entry)
    }
  }

  for (const [query, usesIndexUrl] of [
    ['"dsh-discover-index" in:file', false],
    [`"${new URL(options.indexUrl).host}${new URL(options.indexUrl).pathname}" in:file`, true],
  ] as const) {
    queries += 1
    try {
      const result = await search(fetchImpl, apiBase, query, options.token)
      collect(result.items, usesIndexUrl)
      // A total above the page size means the API returned a subset; say so
      // rather than reporting the page length as the count.
      if (result.total > result.items.length) incomplete = true
    } catch {
      incomplete = true
    }
  }

  const references: Reference[] = [...byRepository.entries()]
    .map(([repository, entry]) => ({
      repository,
      paths: [...entry.paths].sort(),
      usesIndexUrl: entry.usesIndexUrl,
    }))
    .sort((left, right) => left.repository.localeCompare(right.repository))

  return {
    references,
    urlCitations: references.filter((reference) => reference.usesIndexUrl).length,
    queries,
    incomplete,
  }
}
