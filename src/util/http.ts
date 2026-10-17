/**
 * Bounded network primitives.
 *
 * Every outbound call in this project goes through here so that concurrency,
 * retries and timeouts are set in exactly one place. Deliberately dependency
 * free: `fetch` is available in Node 20+, and a retry ladder is a few lines.
 */

/** Raised when a response is not ok after every retry. */
export class HttpError extends Error {
  constructor(
    readonly url: string,
    readonly status: number | null,
    message?: string,
  ) {
    super(message ?? `HTTP ${status ?? 'error'} for ${url}`)
    this.name = 'HttpError'
  }
}

/** A 404 is a fact about the world, not a transient failure: do not retry it. */
function isRetryable(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

export interface HttpClientOptions {
  /** Requests in flight at once. Kept low enough to stay a good citizen. */
  readonly concurrency?: number
  /** Per-attempt deadline. */
  readonly timeoutMs?: number
  readonly retries?: number
  /** Adds an Authorization header when set; raises GitHub's rate limit. */
  readonly token?: string | undefined
  /** Injected for tests. */
  readonly fetchImpl?: typeof fetch
}

/** Per-call overrides, for requests whose size or latency differs from the norm. */
export interface RequestOptions {
  /** Deadline for this call, overriding the client default. */
  readonly timeoutMs?: number
}

/**
 * A concurrency-limited, retrying HTTP client.
 *
 * The limiter is a simple counting semaphore rather than a queue of promises,
 * because the callers already await each request individually.
 */
export class HttpClient {
  readonly #limit: number
  readonly #timeoutMs: number
  readonly #retries: number
  readonly #token: string | undefined
  readonly #fetch: typeof fetch
  #active = 0
  #waiters: (() => void)[] = []
  /** Requests issued, for the run report. */
  requests = 0
  /** Requests that succeeded after at least one retry. */
  retried = 0

  constructor(options: HttpClientOptions = {}) {
    this.#limit = options.concurrency ?? 12
    this.#timeoutMs = options.timeoutMs ?? 20_000
    this.#retries = options.retries ?? 2
    this.#token = options.token
    this.#fetch = options.fetchImpl ?? fetch
  }

  async #acquire(): Promise<void> {
    if (this.#active < this.#limit) {
      this.#active += 1
      return
    }
    await new Promise<void>((resolve) => this.#waiters.push(resolve))
    this.#active += 1
  }

  #release(): void {
    this.#active -= 1
    const next = this.#waiters.shift()
    if (next) next()
  }

  /**
   * Fetch a URL, retrying transient failures with exponential backoff.
   * @param url - absolute URL.
   * @param init - standard fetch options.
   * @param options - per-call deadline override.
   * @returns the successful response.
   * @throws {HttpError} when every attempt fails, or on a non-retryable status.
   */
  async raw(url: string, init: RequestInit = {}, options: RequestOptions = {}): Promise<Response> {
    await this.#acquire()
    try {
      const deadline = options.timeoutMs ?? this.#timeoutMs
      let lastError: unknown
      for (let attempt = 0; attempt <= this.#retries; attempt += 1) {
        if (attempt > 0) {
          this.retried += 1
          await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** (attempt - 1)))
        }
        this.requests += 1
        const headers = new Headers(init.headers)
        if (this.#token && !headers.has('authorization')) {
          headers.set('authorization', `Bearer ${this.#token}`)
        }
        try {
          const response = await this.#fetch(url, {
            ...init,
            headers,
            redirect: init.redirect ?? 'follow',
            signal: AbortSignal.timeout(deadline),
          })
          if (response.ok) return response
          // Drain the body so the socket can be reused or closed.
          await response.arrayBuffer().catch(() => undefined)
          if (!isRetryable(response.status)) {
            throw new HttpError(url, response.status)
          }
          lastError = new HttpError(url, response.status)
        } catch (error) {
          if (error instanceof HttpError && !isRetryable(error.status ?? 0) && error.status !== null) throw error
          lastError = error
        }
      }
      throw lastError instanceof Error ? lastError : new HttpError(url, null)
    } finally {
      this.#release()
    }
  }

  /** Fetch and parse JSON. */
  async json<T>(url: string, init: RequestInit = {}, options: RequestOptions = {}): Promise<T> {
    const response = await this.raw(url, {
      ...init,
      headers: { accept: 'application/json', ...Object.fromEntries(new Headers(init.headers)) },
    }, options)
    return (await response.json()) as T
  }

  /** Fetch and return text. */
  async text(url: string, init: RequestInit = {}, options: RequestOptions = {}): Promise<string> {
    const response = await this.raw(url, init, options)
    return await response.text()
  }

  /**
   * Fetch JSON, returning `undefined` for a 404 instead of throwing.
   *
   * A missing file is an ordinary outcome here — most repositories that do not
   * declare `dsh.bundle` simply have no manifest at the path we guessed — and
   * treating it as an exception would drown the real failures.
   */
  async jsonOr404<T>(url: string, init: RequestInit = {}, options: RequestOptions = {}): Promise<T | undefined> {
    try {
      return await this.json<T>(url, init, options)
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) return undefined
      throw error
    }
  }
}

/**
 * Run `worker` over `items` with bounded concurrency, preserving input order.
 * @param items - work items.
 * @param worker - async mapper.
 * @param concurrency - how many run at once.
 * @returns results in the order of `items`.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  worker: (item: T, index: number) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const index = cursor++
      if (index >= items.length) return
      results[index] = await worker(items[index] as T, index)
    }
  })
  await Promise.all(runners)
  return results
}
