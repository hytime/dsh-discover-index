/**
 * GitHub URL decomposition.
 *
 * Upstream entries point either at a repository root or at a package inside a
 * monorepo (`.../tree/main/packages/x`). The distinction matters twice:
 * `git ls-remote` fails outright on a `/tree/` URL, and format 1 wants the two
 * facts separately — `repository.url` plus `repository.directory`, and for a
 * Git install source `source.url` plus `source.path`.
 */

/** The pieces of a GitHub URL that the resolver and renderer need separately. */
export interface RepoLocation {
  /** `https://github.com/owner/repo`, always the repository root. */
  readonly repo: string
  /** POSIX path of the package inside the repository; absent at the root. */
  readonly directory?: string
  readonly owner: string
  readonly name: string
}

const GITHUB_PREFIX = 'https://github.com/'
const TREE_MARKER = '/tree/'

/**
 * Split a GitHub URL into its repository and optional package directory.
 *
 * Only the `tree` form carries a directory. A URL such as `/tree/main` names a
 * branch and no directory, so it decomposes to the repository alone rather than
 * to an empty string — an empty `path` would be emitted as `path: ""`, which
 * format 1 rejects as an empty segment.
 *
 * @param url - a `https://github.com/...` URL.
 * @returns the location, or `undefined` when the URL is not a GitHub repository.
 */
export function decomposeRepoUrl(url: string): RepoLocation | undefined {
  if (!url.startsWith(GITHUB_PREFIX)) return undefined
  const rest = url.slice(GITHUB_PREFIX.length).replace(/\/+$/, '')
  const segments = rest.split('/')
  const owner = segments[0]
  const name = segments[1]
  if (!owner || !name) return undefined

  const repo = `${GITHUB_PREFIX}${owner}/${name}`
  const tail = segments.slice(2)
  let directory: string | undefined
  if (tail[0] === 'tree') {
    // tail is ['tree', <branch>, ...path]; anything after the branch is the
    // package directory. A branch name cannot be told from a directory name
    // here, so the first segment after `tree` is always taken as the ref —
    // which is what both upstream's slugFor and GitHub's own UI do.
    const pathSegments = tail.slice(2)
    if (pathSegments.length > 0) directory = pathSegments.join('/')
  }
  return directory === undefined ? { repo, owner, name } : { repo, owner, name, directory }
}

/**
 * Stable filesystem-safe key for a GitHub URL, matching upstream's slug rules
 * so cache keys are recognisable to anyone who knows that repo.
 * @param url - a GitHub URL.
 * @returns `owner__repo`, or `owner__repo--packages-x` for a subdirectory.
 */
export function slugFor(url: string): string {
  const location = decomposeRepoUrl(url)
  if (!location) return url.replace(/[^a-zA-Z0-9._-]/g, '-')
  const base = `${location.owner}__${location.name}`
  return location.directory ? `${base}--${location.directory.replaceAll('/', '-')}` : base
}

/**
 * `owner/repo` identity from a repository URL, for deny-list comparisons.
 *
 * Deliberately more permissive than `decomposeRepoUrl`, and the difference is
 * the point. `decomposeRepoUrl` answers "can I clone this and display it?" and
 * so insists on github.com, because that is what format 1's install sources
 * accept. This function answers a question with opposite failure semantics:
 * "is this the repository I must never list?" A deny rule that returns
 * `undefined` for a URL shape it did not anticipate FAILS OPEN, and the entry
 * it fails to recognise is the one entry a visitor would notice. So this
 * recognises every shape a repository URL arrives in — npm's `git+https://`
 * form, a trailing `.git`, any host, a monorepo subpath — and only returns
 * `undefined` when there is genuinely no repository in the string.
 *
 * @param url - any repository URL.
 * @returns `owner/repo`, or `undefined` when the string names no repository.
 */
export function repoIdentity(url: string): string | undefined {
  // npm and package manifests write `git+https://…` and `git+ssh://…`; the
  // prefix is protocol metadata, not part of the repository.
  const withoutPrefix = url.replace(/^git\+/u, '').trim()
  // `git@github.com:owner/repo.git` is the SCP-like SSH form, which `new URL`
  // cannot parse. Normalise it rather than letting it fail open.
  const scp = /^(?:ssh:\/\/)?git@([^/:]+)[:/](.+)$/u.exec(withoutPrefix)
  const normalized = scp
    ? `https://${scp[1]}/${scp[2] ?? ''}`
    : withoutPrefix

  let parsed: URL
  try {
    parsed = new URL(normalized)
  } catch {
    return undefined
  }

  const segments = parsed.pathname.replace(/^\/+|\/+$/gu, '').split('/').filter((segment) => segment !== '')
  const owner = segments[0]
  let name = segments[1]
  if (!owner || !name) return undefined
  // A `/tree/<ref>/…` path names a package inside the repository, not a
  // different repository.
  name = name.replace(/\.git$/u, '')
  if (name === '') return undefined
  return `${owner}/${name}`
}

/**
 * A GitHub-hosted avatar, used as the entry icon when the upstream entry
 * carries no curated screenshot.
 *
 * Format 1 accepts an absolute https URL here, and `github.com/<owner>.png`
 * redirects to the avatar CDN — an https URL either way, which is what the
 * validator requires of a non-data icon.
 */
export function avatarUrl(owner: string): string {
  return `https://github.com/${owner}.png`
}
