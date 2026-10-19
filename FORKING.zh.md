# 发布你自己的插件市场

[English](FORKING.md) | 中文

本仓库是一份**模板**：fork 之后，它会在你自己的 GitHub Pages 域下、按你自己的时间表，发布一份属于你的市场索引——不需要任何服务器。

构建流程会读取一个目录、转换成插件市场索引格式 1、用真正的校验器校验、然后部署。你要改的是**读哪个目录**与**怎么呈现**——那是配置，不是代码。

- [你能得到什么](#你能得到什么)
- [1. Fork 并开启 Pages](#1-fork-并开启-pages)
- [2. 指向你的目录](#2-指向你的目录)
- [3. 改成你自己的](#3-改成你自己的)
- [4. 让构建跑起来](#4-让构建跑起来)
- [5. 添加进 DSH](#5-添加进-dsh)
- [让 AI 来帮你做](#让-ai-来帮你做)
- [你需要负责的部分](#你需要负责的部分)
- [许可证](#许可证)

## 你能得到什么

| | |
| --- | --- |
| 一份市场索引 | `https://<你的账号>.github.io/<你的仓库>/index.json` |
| 重建频率 | 每日自动，外加一个手动 **Run workflow** 按钮 |
| 校验 | 每次运行都用 DSH 用的同一个校验器校验 |
| 成本 | 除 GitHub Actions 外无额外成本；默认 2000 条的发布下限在部署前强制生效 |

本项目不会给 DSH 打补丁。产出是一份 JSON 文件，DSH 在打开实验性的**自定义插件市场**功能后即可读取。

## 1. Fork 并开启 Pages

1. **Fork** 本仓库。想改名也行——所有地址都从你实际运行的仓库推导，因此**无需编辑任何文件**，URL 就是对的。
2. 在 fork 中打开 **Settings → Pages**，把 **Source** 设为 **GitHub Actions**。
   不要选「Deploy from a branch」：索引是作为 workflow artifact 发布的。

两个 workflow 都从运行它们的仓库推导 Pages 地址，所以 fork 从第一次运行起就在校验自己的域。`.github/` 下无需任何改动。

## 2. 指向你的目录

编辑 [`config/config.yml`](config/config.yml)。最小可用改动就是来源 URL：

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

`kind: upstream-catalog` 读取的是与上游目录同形的文档：一个 `plugins` 数组，其中每项至少带 `url`、`name`、`owner`。如果你的文档里这些字段叫别的名字，加一段 `fields` 映射即可，**不要写代码**——完整表格见[配置来源](README.zh.md#配置来源)，包括如何映射 capabilities、red lines、关键词以及你自己的排序键。

description 值得认真填写：它是用户在 Discover 里紧挨着你的市场唯一能看到的文字，请在其中写明你的仓库地址。

## 3. 改成你自己的

以下全部可选，每一项都是一行改动：

| 项 | 位置 |
| --- | --- |
| Discover 里的市场名 | `profiles[].title` |
| 市场名旁的说明文字 | `profiles[].description` |
| 星标下限（可另发一个「精选」市场） | `profiles[].minStars` |
| 用不同下限再发一个市场 | 再加一条 `profiles[]`，给它自己的 `output` |
| 绝不允许出现的仓库 | `denyRepos` |
| 手工排除的包 | `denyPackages` |
| 近空索引的发布下限 | [`.github/workflows/build.yml`](.github/workflows/build.yml) 里的 `floor`——目录小就得调低，否则 CI 会拒绝发布 |

有两件事必须在依赖它们之前知道：

- **2000 条的 `floor` 是唯一会「静默挡住小市场」的设置。** CI 会拒绝部署插件数低于该下限的索引，这是保护线上站点不被上游故障牵连的机制。一个只有 40 个插件的精选目录会顺利构建、通过校验，然后**永远不发布**。请把 `build.yml` 里的 `floor` 调到你的目录能达到的数量。
- **profile 的 `output` 必须是纯文件名。** `index.json`、`curated.json` 可以；`markets/index.json` 会被拒绝，因为部署步骤是原样发布 `dist/`。

## 4. 让构建跑起来

推送到 `main` 后会有两个 workflow 运行：

- **Validate**——类型检查、测试、完整构建一次索引，然后校验。不部署。
- **Build and deploy index**——同样的构建，随后是近空下限、真校验器，最后上传并部署到 Pages。每日定时运行，也可手动触发。

首次部署需要 **Build and deploy index** 至少运行一次。你可以等每日定时，也可以手动触发：**Actions → Build and deploy index → Run workflow**。近空或非法的索引会在上传前中止，因此坏运行永远不会顶掉好索引。

跑完后，你的索引位于：

```
https://<你的账号>.github.io/<你的仓库>/index.json
```

不用任何工具就能确认它是否有效——workflow 做的就是同一件事：

```bash
GITHUB_REPOSITORY=<you>/<your-repo> node -e "import('@deepseek-ai/dsh-plugin-market-index').then(m=>{const fs=require('fs');const [o,r]=process.env.GITHUB_REPOSITORY.split('/');const doc=JSON.parse(fs.readFileSync('dist/site/index.json','utf8'));const v=m.parseMarketIndex(doc,'https://'+o+'.github.io/'+r+'/index.json');console.log('valid, plugins='+v.plugins.length)})"
```

## 5. 添加进 DSH

先要装好那个功能：

```bash
dsh plugin --profile web add @deepseek-ai/dsh-experimental-plugin-market-bundle
```

> 桌面端用户注意：`desktop` profile 属于 Electron 应用，CLI 会拒绝操作它。请在应用内的 **Plugins** 页面安装这个 bundle。

然后打开 **Plugins → 实验性插件**，开启**自定义插件市场**，再打开 **发现 → 添加索引源**，粘贴你的 URL。你的市场会带着配置好的标题与说明出现在市场菜单里。

需要 **DSH 0.2.1-alpha.4** 或更新。带截图的完整流程见[在 DSH Discover 中使用](README.zh.md#在-dsh-discover-中使用)。

## 让 AI 来帮你做

本仓库的结构使得 AI 可以凭一条指令完成全部工作。把下面这段贴上，替换成你的目录即可：

> Fork https://github.com/hytime/dsh-discover-index，把它改造成我目录的插件市场，我的目录在 `<目录 URL>`。
>
> 1. 在 `config/config.yml` 中把 `sources` 条目指向我的 URL，`kind` 用
>    `upstream-catalog`。如果我的文档不用 `url`/`name`/`owner` 表示仓库、也不用
>    `npm`/`version` 表示包，那就配置 `fields` 映射，不要写适配器。
> 2. 把 `profiles[].title` 与 `profiles[].description` 改成我的项目名，并在 description
>    里写上 `https://github.com/<me>/<repo>`。
> 3. 把 `.github/workflows/build.yml` 里的近空下限调低到我的目录能达到的数量，或者
>    说明为什么现在的值已经合适。
> 4. 运行 `pnpm install`、`pnpm run build`，然后运行 `node dist/cli.js doctor`，按原因
>    分组报告每一条被拒理由。除非文档根本无法用配置表达，否则不要改 `src/`——如果确实
>    必须改，请明确说出来。
> 5. 运行 `pnpm test` 与 `pnpm run typecheck`，并报告真实输出。
> 6. 开启 Pages（Source: GitHub Actions）并触发「Build and deploy index」。

有两件事能让 AI 做得更好：

- **`node dist/cli.js doctor` 就是诊断工具。** 它逐条报告被丢弃的条目及原因，且不写任何文件。当市场比预期小时，那份输出才是答案——而不是对代码的猜测。
- **`fields` 是逃生舱。** 大部分目录差异只是字段名不同，映射它们是配置。只有当文档的**形态**不同、而不仅仅是拼写不同时，才需要动 `src/`。

## 你需要负责的部分

你是在以自己的名义重新发布第三方数据。具体来说：

- **收录不等于安全审查。** 本项目不会审计或隔离它列出的任何插件。安装其中任意一个，都会以用户的权限运行第三方代码。
- **上游的策展标准不是你的。** 如果你指向别人的列表，他们的收录标准与免责声明也一并随之而来。请在 description 里说明这一点。
- **`denyRepos` 里应当包含你自己的项目**（如果它本身不是插件），就像本仓库会拒绝它所服务的那个 harness 一样。
- **保留出处。** description 里写明你的仓库地址，是让用户能把你这份市场与同一目录的另一份拷贝区分开的依据。

## 许可证

[MIT](LICENSE)。fork 保留许可证，其余一切都可以改。
