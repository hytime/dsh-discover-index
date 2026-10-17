/**
 * Frozen internal contract. Every module speaks these types; only `render/`
 * knows about the published format-1 shape, and it delegates validation to the
 * upstream validator rather than re-implementing the rules.
 */

/** Where a supported-version's install artifact comes from. */
export type InstallSource =
  | { readonly type: 'npm'; readonly registry?: string }
  | {
    readonly type: 'git'
    /** Canonical https repository URL, no `.git` suffix, no credentials. */
    readonly url: string
    /** Lowercase 40-hex-digit commit SHA. */
    readonly commit: string
    /** Relative POSIX package directory inside the repository. */
    readonly path?: string
  }

/** One installable version of a candidate, already resolved and vetted. */
export interface ResolvedVersion {
  /** Exact SemVer. */
  readonly version: string
  /** Unix seconds. */
  readonly publishTimestamp: number
  readonly source: InstallSource
  /** DSH version range the version declares, when it declares one. */
  readonly dshRange?: string
}

/**
 * One plugin as the pipeline carries it: the union of what every source
 * adapter can discover, before rendering. `name` is the real npm package name,
 * never a repository name, because format 1 requires a valid npm package name
 * and repository names are neither unique nor lowercase.
 */
export interface Candidate {
  /** Real npm package name, taken from the package manifest. */
  readonly name: string
  readonly title?: Readonly<Record<string, string>>
  readonly description?: Readonly<Record<string, string>>
  readonly author?: string
  readonly homepage?: string
  /** Absolute https icon URL. */
  readonly icon?: string
  /** Display-only repository facts. */
  readonly repository?: { readonly url: string; readonly directory?: string }
  /**
   * The source URL this candidate was derived from, exactly as the source
   * published it. Internal only — never rendered.
   *
   * `repository` cannot serve this purpose. It is a display field constrained
   * by format 1 to canonical `https://` URLs, so a resolver that cannot
   * decompose a URL leaves it unset, and anything reading it to decide policy
   * silently sees nothing. That asymmetry is dangerous for a deny rule: the
   * question "must this entry never be listed?" has to be answerable from
   * whatever the source actually said, including npm's `git+https://…` form,
   * an SSH URL, or a non-GitHub host.
   */
  readonly sourceUrl?: string
  readonly category?: string
  readonly keywords: readonly string[]
  readonly labels: readonly string[]
  /** Numeric sort-key values, such as `stars` and `downloads`. */
  readonly sortKeys: Readonly<Record<string, number>>
  /** Non-empty, descending SemVer order. */
  readonly versions: readonly ResolvedVersion[]
  /** Which configured source produced this candidate; for reporting. */
  readonly provenance: readonly string[]
}

/** Why one upstream entry did not become a candidate. */
export interface Rejection {
  /** Upstream identity, such as `owner/repo`. */
  readonly id: string
  readonly stage: 'source' | 'resolve' | 'policy'
  readonly reason: string
}

/** What one source adapter returns for one run. */
export interface SourceResult {
  readonly candidates: readonly Candidate[]
  readonly rejections: readonly Rejection[]
}

/** Read-only capabilities a source adapter is given. */
export interface SourceContext {
  readonly config: SourceConfig
  readonly fetchJson: <T>(url: string, init?: RequestInit) => Promise<T>
  readonly fetchText: (url: string, init?: RequestInit) => Promise<string>
  readonly log: (message: string) => void
}

/** One configured upstream source. */
export interface SourceConfig {
  readonly id: string
  readonly kind: string
  readonly enabled: boolean
  /** Minimum stars for a source that discovers by popularity; 0 means no floor. */
  readonly minStars: number
  readonly queries?: readonly string[]
  readonly url?: string
  /** Lower number wins when two candidates carry the same package name. */
  readonly priority: number
}

/** A named bundle of enabled sources; the thing a user switches between. */
export interface Profile {
  readonly id: string
  readonly title: Readonly<Record<string, string>>
  readonly description?: Readonly<Record<string, string>>
  readonly sources: readonly string[]
  readonly minStars: number
  readonly output: string
}

/** Top-level project configuration, loaded from `config/config.yml`. */
export interface ProjectConfig {
  readonly sources: readonly SourceConfig[]
  readonly profiles: readonly Profile[]
  /** Repository identities that are never plugins, even if they look like one. */
  readonly denyRepos: readonly string[]
  /** Package names excluded by editorial decision. */
  readonly denyPackages: readonly string[]
}
