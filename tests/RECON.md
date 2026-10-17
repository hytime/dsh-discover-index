# Recon of the live catalog — verifier evidence

Sample: `https://awesome-dsh-plugin.com/plugins.json`, fetched 2026-10-17, HTTP 200,
7,082,448 bytes, sha256 `b8f15642a7359c086a15f3a8611a0681c737a7899c53e686f1b569a676f01ef3`.
The document declares `count` = 5,704 (`updated` = 2026-10-17) and its `plugins` array
holds exactly 5,704 entries, so the sample is complete and internally consistent.

Machine-readable counts and their exact definitions live in
[`tests/fixtures/meta.json`](./fixtures/meta.json) under `reconCounts` and
`reconDefinitions`. The totals below are that file, rendered.

## Adversarial case counts

| Case | Definition actually measured | Measured | Brief |
|---|---|---|---|
| 1 | Distinct lowercased repository basenames claimed by more than one owner, counting **root-level repositories only** | **271** | 271 ✔ |
| 1 | Same, counting entries whose URL has a `/tree/` subpath | 286 | — |
| 1 | Distinct case-**sensitive** basenames claimed by more than one owner, all entries | 283 | — |
| 2 | Entries whose upstream `name` field contains an uppercase letter | **225** | 225 ✔ |
| 2 | Distinct `(owner, repo)` pairs whose **repository name** contains uppercase | 216 | — |
| 3 | URLs with a `/tree/` subpath | **597** | 285 ✘ |
| 3 | `/tree/` URLs with **no** npm identity, so needing git resolution | 289 | ~285 |
| 3 | `/tree/<branch>/packages/*` URLs | 281 | — |
| 3 | Distinct repositories owning at least one `/tree/` entry | 401 | — |
| 4 | Entries with no npm identity at all → candidates that must be resolved or dropped | 3,097 | — |
| 5 | Entries owned by `deepseek-ai` | **0** | 0 |

The exact counts are recorded rather than assumed, so a future re-run against a
changed catalog can tell "the rule broke" apart from "the input moved".

## Where the brief's figures come from

**271 (case 1)** reproduces exactly once the basename comparison is
case-insensitive and restricted to repository-root entries. That is the correct
comparison: npm package names are lowercase, so `dsh-Memory` and `dsh-memory`
collide in the output index even though they are distinct directory names on
GitHub. Case-sensitively over all entries the figure is 283, over root-level
entries 271.

**225 (case 2)** reproduces exactly as the count of upstream *`name` fields*
containing uppercase, which is the right unit — the risk being tested is "a name
derived from the upstream entry", not "a GitHub directory name". The stricter
repository-name count is 216, and there are 222 entries across those 216
repositories.

**285 (case 3)** does **not** reproduce. The sample contains 597 `/tree/` URLs,
289 of them without an npm identity. 285 may have come from a different snapshot,
a different sample, or a filter that is not recorded. This is a reporting
discrepancy, not a code defect: every assertion in `resolve.test.ts` depends on
the *behaviour* (a `/tree/` URL must be decomposed before `git ls-remote`), which
is enforced regardless of the count. The `dsh-memory` example in the brief also
drifts: 13 entries share that basename, 12 of them at repository root.

## Recorded from the live environment

* `git ls-remote https://github.com/john-walks-slow/dsh-proactive/tree/main/packages/dsh-proactive`
  → `fatal: repository '...' not found`, exit 128.
* `git ls-remote https://github.com/john-walks-slow/dsh-proactive HEAD`
  → `7a959839f6486aa521e6024a67425b33f098aa0b	HEAD`, exit 0.
* `registry.npmjs.org/dsh-j-space` → HTTP 404 (the package is published as
  `@anonyjcy/dsh-j-space`), which is why package names are resolved from the
  manifest rather than guessed.

## Reproducing

The 7 MB sample is not committed. `tests/fixtures/meta.json` carries its URL and
sha256; `tests/fixtures/upstream-catalog-min.json` is a real recorded subset
covering every case. To reproduce this file:

```sh
curl -sS https://awesome-dsh-plugin.com/plugins.json -o /tmp/plugins.json
shasum -a 256 /tmp/plugins.json   # expect b8f15642a7359c086a15f3a8611a0681c737a7899c53e686f1b569a676f01ef3
```
