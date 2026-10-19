# Publishing your own plugin market

English | [中文](FORKING.zh.md)

This repository is a **template**: fork it and it publishes your own market index under
your own GitHub Pages origin, on your own schedule, with no server to run.

The build reads a catalog, converts it to plugin market index format 1, validates it with
the real validator, and deploys it. What you change is *which catalog* and *how it is
presented* — that is configuration, not code.

- [What you get](#what-you-get)
- [1. Fork and enable Pages](#1-fork-and-enable-pages)
- [2. Point it at your catalog](#2-point-it-at-your-catalog)
- [3. Make it yours](#3-make-it-yours)
- [4. Let the build run](#4-let-the-build-run)
- [5. Add it to DSH](#5-add-it-to-dsh)
- [Asking an AI to do it](#asking-an-ai-to-do-it)
- [What you are responsible for](#what-you-are-responsible-for)

## What you get

| | |
| --- | --- |
| A market index | `https://<your-account>.github.io/<your-repo>/index.json` |
| Rebuilt | Daily, plus a manual **Run workflow** button |
| Validated | Every run, by the same validator DSH uses |
| Cost | Nothing beyond GitHub Actions; the default 2,000-plugin floor is enforced before deploy |

Nothing here patches DSH. The output is a JSON file that DSH reads once the experimental
**Custom plugin markets** feature is switched on.

## 1. Fork and enable Pages

1. **Fork** this repository. Rename it if you like — everything derives from the
   repository you actually run in, so no file needs editing for the URLs to be right.
2. In the fork, open **Settings → Pages** and set **Source** to **GitHub Actions**.
   Not "Deploy from a branch": the index is published as a workflow artifact.

The workflows build the Pages origin from the repository that runs them, so a fork
validates against its own origin from the first run. Nothing in `.github/` needs editing.

## 2. Point it at your catalog

Edit [`config/config.yml`](config/config.yml). The smallest useful change is the source
URL:

```yaml
sources:
  - id: my-catalog
    kind: upstream-catalog
    enabled: true
    url: https://example.com/plugins.json
    minStars: 0
    priority: 10

profiles:
  - id: index
    title:
      en: My Plugin Market
      zh: 我的插件市场
    description:
      en: 'Curated plugins. Source: https://github.com/<you>/<your-repo>'
      zh: '精选插件。源码：https://github.com/<you>/<your-repo>'
    sources:
      - my-catalog
    minStars: 0
    output: index.json
```

`kind: upstream-catalog` reads a document shaped like the upstream catalog: a `plugins`
array whose entries carry at least `url`, `name`, and `owner`. If your document names
those things differently, add a `fields` mapping instead of writing code — see
[Configuring a source](README.md#configuring-a-source) for the full table, including how
to map capabilities, red lines, keywords, and your own sort key.

The description is worth filling in properly. It is the only text a user sees next to your
market in Discover, so name your repository there.

## 3. Make it yours

Everything below is optional, and each is a one-line change:

| What | Where |
| --- | --- |
| Market name in Discover | `profiles[].title` |
| The sentence shown beside it | `profiles[].description` |
| Star floor, to publish a "best of" market | `profiles[].minStars` |
| A second market with a different floor | Add another `profiles[]` entry with its own `output` |
| Repositories that must never be listed | `denyRepos` |
| Packages excluded by hand | `denyPackages` |
| The near-empty publish guard | `floor` in [`.github/workflows/build.yml`](.github/workflows/build.yml) — lower it for a small catalog, or CI will refuse to publish |

Two things to know before you rely on them:

- **The 2,000-plugin floor is the one setting that will silently block a small market.**
  CI refuses to deploy an index with fewer plugins than the floor, which is what protects
  the live site from an upstream outage. A curated catalog of 40 plugins will therefore
  build, validate, and then never publish. Lower the floor in `build.yml` to match your
  catalog.
- **A profile's `output` must be a bare filename.** `index.json` and `curated.json` are
  fine; `markets/index.json` is rejected, because the deploy step serves `dist/` as-is.

## 4. Let the build run

Push to `main`. Two workflows run:

- **Validate** — typecheck, tests, a full index build, then validation. No deploy.
- **Build and deploy index** — the same build, then the near-empty guard, then the
  validator, then the Pages upload and deploy. Runs daily on a cron and on demand.

The first deploy needs **Build and deploy index** to run once. Either wait for the daily
cron or trigger it: **Actions → Build and deploy index → Run workflow**. A near-empty or
invalid index aborts before the upload, so a bad run never replaces a good one.

When it finishes, your index is at:

```
https://<your-account>.github.io/<your-repo>/index.json
```

You can confirm it is valid without any tooling — the workflow already did exactly this:

```bash
GITHUB_REPOSITORY=<you>/<your-repo> node -e "import('@deepseek-ai/dsh-plugin-market-index').then(m=>{const fs=require('fs');const [o,r]=process.env.GITHUB_REPOSITORY.split('/');const doc=JSON.parse(fs.readFileSync('dist/site/index.json','utf8'));const v=m.parseMarketIndex(doc,'https://'+o+'.github.io/'+r+'/index.json');console.log('valid, plugins='+v.plugins.length)})"
```

## 5. Add it to DSH

The feature must be present first:

```bash
dsh plugin --profile web add @deepseek-ai/dsh-experimental-plugin-market-bundle
```

> Desktop users: the `desktop` profile belongs to the Electron app and the CLI refuses to
> touch it. Install the bundle from the app's **Plugins** page instead.

Then open **Plugins → Experimental plugins**, switch on **Custom plugin markets**, open
**Discover → Add index source**, and paste your URL. Your market appears in the market
menu with the title and description you configured.

Requires **DSH 0.2.1-alpha.4** or later. Full walkthrough with screenshots:
[Using it in DSH Discover](README.md#using-it-in-dsh-discover).

## Asking an AI to do it

The repository is laid out so an agent can do the whole job from one instruction. Paste
this, substituting your catalog:

> Fork https://github.com/hytime/dsh-discover-index and turn it into a plugin market for
> my catalog at `<CATALOG URL>`.
>
> 1. In `config/config.yml`, point the `sources` entry at my URL and give it
>    `kind: upstream-catalog`. If my document does not use `url`/`name`/`owner` for the
>    repository, plus `npm`/`version` for the package, configure the `fields` mapping
>    instead of writing an adapter.
> 2. Set `profiles[].title` and `profiles[].description` to my project name, and put
>    `https://github.com/<me>/<repo>` in the description.
> 3. Lower the near-empty floor in `.github/workflows/build.yml` to a number my catalog
>    can actually reach, or explain why it is already fine.
> 4. Run `pnpm install`, `pnpm run build`, then `node dist/cli.js doctor` and report every
>    rejection reason, grouped by cause. Do not touch `src/` unless the document cannot be
>    expressed by configuration — and say so explicitly if that is the case.
> 5. Run `pnpm test` and `pnpm run typecheck`, and report the real output.
> 6. Enable Pages (Source: GitHub Actions) and trigger "Build and deploy index".

Two things make this work well with an agent:

- **`node dist/cli.js doctor` is the diagnostic.** It reports each dropped entry and why,
  and writes nothing. When a market comes out smaller than expected, that output is the
  answer — not a guess about the code.
- **`fields` is the escape hatch.** Most catalog differences are member names, and mapping
  them is configuration. Reach for `src/` only when the document's *shape* differs, not
  its spelling.

## What you are responsible for

You are republishing third-party data under your own name. In particular:

- **A listing is not a security review.** Nothing here audits or sandboxes the plugins it
  lists. Installing one runs third-party code with the user's permissions.
- **The upstream catalog's curation is not yours.** If you point at someone else's list,
  their inclusion criteria and disclaimer come with it. Say so in your description.
- **Your `denyRepos` should include your own project** if it is not itself a plugin, the
  way this repository denies the harness it exists to serve.
- **Keep the provenance.** The `description` naming your repository is what lets a user
  tell your market apart from another copy of the same catalog.

## License

[MIT](LICENSE). Forks keep the license and are welcome to change everything else.
