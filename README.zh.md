# dsh-discover-index

[English](README.md) | 中文

把在线的 [awesome-dsh-plugin](https://awesome-dsh-plugin.com/) 目录汇总为**插件市场索引格式 1**——[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）Discover 标签页读取的那份 JSON 文档。

已发布索引：<https://hytime.github.io/dsh-discover-index/index.json>

> [!IMPORTANT]
> **本项目是转换与聚合的来源，不是安全审查。**
> 索引中的每一条都是来自上游的第三方数据。本项目不会审计、隔离或担保它列出的插件。安装 DSH 插件会在你的 harness 内运行第三方代码，安装前请先阅读插件源码。

## 状态

已发布并自动化。上面的索引地址提供的是一份活文档，由 [`build.yml`](.github/workflows/build.yml) 每日重建，且只有通过真正的 `@deepseek-ai/dsh-plugin-market-index` 校验器之后才会部署。

| 检查项 | 结果 |
| --- | --- |
| TypeScript | 编译干净 |
| 测试 | 354 通过、离线运行、基于从线上目录录制的 fixture |
| 已发布索引 | 5452 个插件、格式 1、通过真校验器 |
| 自动化 | 每日 cron，另支持 `workflow_dispatch` 手动重建 |

流水线读取的是线上目录，因此两次运行之间插件数量会有几条的浮动（上游新增、下架、重新固定仓库）。这是预期行为。参见[本地运行](#本地运行)。

## 产出

`dist/index.json`——一份格式 1 文档，发布于 <https://hytime.github.io/dsh-discover-index/index.json>。`config/config.yml` 中声明的每个 **profile** 各自产出一份文档（例如按星标下限筛选的子集可以单独发布为一个市场），每一份都会在 CI 中独立校验。

### 市场声明了什么

格式 1 允许市场发布自己的策展词表，Discover 会全部渲染出来。本市场四个维度都有用到：

| 维度 | 声明的内客 | 在 Discover 里得到什么 |
| --- | --- | --- |
| `metadata.categories` | 上游 23 个分类，含中文标题 | 列表上方的分类胶囊 |
| `metadata.labels` | 权限能力、风险发现、热度分档 | **标签**筛选菜单与卡片上的标签 |
| `metadata.sortKeys` | `stars`、`downloads`、`added` | **排序**菜单项，各自默认降序 |
| `metadata.keywords` | 运行时标识、分类、能力词 | 全文搜索的召回 |

其中**标签**最有用，因为它能回答上游目录本身答不了的问题。标签来自三处：

- **能力**——上游的信任扫描会报告每个插件代码能触达什么：`fs-read`、`fs-write`、`network`、`shell`、`env`、`credentials`、`llm`、`host-runtime`、`dynamic-code`、`subagent`。筛 `shell` 就能找出所有能在你机器上执行命令的插件。
- **风险发现**，被归一化成五类，而不是上游发布的那 86 句原始描述（大多只提到某一个域名或 IP）：`risk:credentials-and-network`（476 条）、`risk:plaintext-http`（97）、`risk:literal-ip`（47）、`risk:install-time-code`（22）、`risk:dynamic-code`。
- **热度分档**——`stars:1k+` / `100+` / `10+` / `1+` / `0`，以及 `downloads:10k+` / `1k+` / `100+` / `1+` / `0`。

热度用分档而非精确值，这是格式的硬约束：label id 在索引里只声明一次、由插件**引用**，因此不存在「每个插件自己的 label 值」。用精确值需要 235 个星标标签、1690 个下载量标签，筛选菜单会变得不可用。精确数字仍然在它们该在的地方——`stars` 与 `downloads` 排序键，DSH 还会通过 `plugin_market` 工具把它们交给模型。

### 来源

| 项 | 地址 |
| --- | --- |
| 上游目录（数据） | <https://awesome-dsh-plugin.com/plugins.json> · [awesome-dsh-plugin/awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) |
| 版本历史（npm） | <https://registry.npmjs.org/>——每个 npm 包一份文档 |
| 本项目（转换代码） | <https://github.com/hytime/dsh-discover-index> |
| 已发布索引（DSH 读取的源） | <https://hytime.github.io/dsh-discover-index/index.json> |

### 版本历史

上游每条只给一个版本。DSH 的插件页会列出它能安装的每个版本，并通过 `engines.dsh` 拒绝当前 DSH 不满足的版本——而每个插件只有一个版本时，这两件事都没有意义。因此构建时会读取每个 npm 包的 registry 文档，列出所有声明了 `dsh.bundle`、未被废弃、且有发布时间的版本（2607 份文档，冷启动约 150 MB）。

Git 解析的插件仍然只列它们固定提交里的那一个版本。registry 不可达不致命：该插件保留上游版本，因为让一次 registry 故障导致插件消失，比只显示一个版本更糟。

索引是上游列表的**转换产物**，不是独立注册表。上游负责征集与托管目录，本仓库只负责把它转换成格式 1、用真校验器自检、并按日重新发布。某条条目本身有问题，应当去上游报告；某条好条目被**转换错了**，则属于本仓库。

这份出处信息也写进了发布文档自身的 `description`，因此来源会随数据一起传播，在 Discover 里直接可见，无需回来看这份 README：

```json
"description": {
  "en": "The awesome-dsh-plugin list converted to the plugin market index format 1. Source: https://github.com/hytime/dsh-discover-index",
  "zh": "由 awesome-dsh-plugin 列表转换而来的插件市场索引（格式 1）。源码：https://github.com/hytime/dsh-discover-index"
}
```

## 上游数据到格式 1 的映射

上游的 `plugins.json` 是一份自有 schema 的精选列表，格式 1 的 schema 更严格。聚合器逐条转换，两条安装路径的处理方式不同：

| 上游条目 | 格式 1 的结果 |
| --- | --- |
| 声明了 npm 包（`npm` + `version`） | 产出一个版本，`source: { "type": "npm" }`。包名是权威来源（registry 实际提供的就是这个名字），安装时用户机器上无需构建步骤。包名取自包本身，绝不从仓库名推断。 |
| 仅有 Git（没有 npm 包） | 解析仓库、读取其 manifest，产出一个版本，`source: { "type": "git", "url": …, "commit": "<40 位十六进制 SHA>" }`。提交是**固定**的，绝不用分支或标签，因此索引条目始终指向不可变的代码。 |
| Monorepo 子目录 | 仓库与包目录被拆分为 `repository.directory`（展示用）和 `source.path`（安装用）。 |
| 无法解析出真实包名与版本 | **丢弃**。格式 1 要求 `versions` 非空，因此无法解析的条目绝不会以空壳形式产出。`node dist/cli.js doctor` 会报告每一条丢弃及其原因。 |

其他映射规则：

- **展示元数据**——标题、描述、图标、作者、仓库来自上游与包的 manifest。描述按语言分别保留。
- **排序键**——`stars`、`downloads` 以及条目加入列表的日期会成为数值排序键，也就是 Discover 标签页排序菜单里的选项。上游没有提供的值会被省略，而不是写成 `0`。
- **发布时间**——已知时采用 registry 自己的发布时间，否则回退到条目加入上游列表的日期。
- **拒绝清单**——`config/config.yml` 列出绝不应出现的仓库与包。DeepSeek Harness 本身就在该清单上：harness 声明了 bundle，否则会通过所有结构性检查，而在「本产品的插件列表」里列出本产品，是每位访客都会注意到的那个错误条目。

### 示例

以下是产出的代表性片段。它未经修改即可通过 `@deepseek-ai/dsh-plugin-market-index` 的 `parseMarketIndex`：

```json
{
  "format": 1,
  "title": { "en": "DSH Plugin Index", "zh": "DSH 插件索引" },
  "description": {
    "en": "The awesome-dsh-plugin list converted to the plugin market index format 1. Source: https://github.com/hytime/dsh-discover-index",
    "zh": "由 awesome-dsh-plugin 列表转换而来的插件市场索引（格式 1）。源码：https://github.com/hytime/dsh-discover-index"
  },
  "metadata": {
    "categories": {
      "agi": { "title": { "en": "AGI Architecture Exploration", "zh": "AGI 架构探索" } },
      "session": { "title": { "en": "Sessions & Messages", "zh": "会话与消息" } }
    },
    "labels": {},
    "sortKeys": {
      "stars": { "title": { "en": "Stars", "zh": "星标" }, "order": "desc" }
    }
  },
  "plugins": [
    {
      "name": "dsh-session-steward",
      "title": { "en": "dsh-session-steward", "zh": "dsh-session-steward" },
      "description": { "en": "Session Steward for DSH.", "zh": "面向 DSH 的会话管家。" },
      "author": "drscrewdriver",
      "homepage": "https://github.com/drscrewdriver/dsh-session-steward",
      "repository": { "url": "https://github.com/drscrewdriver/dsh-session-steward" },
      "metadata": {
        "category": "session",
        "keywords": [],
        "labels": [],
        "sortKeys": { "stars": 1 }
      },
      "versions": [
        {
          "version": "0.5.2",
          "publishTimestamp": 1758153600,
          "source": { "type": "npm" },
          "engines": {}
        }
      ]
    },
    {
      "name": "dsh-quality-review",
      "title": { "en": "dsh-quality-review", "zh": "dsh-quality-review" },
      "author": "CAI-MH",
      "repository": { "url": "https://github.com/CAI-MH/dsh-quality-review" },
      "metadata": { "keywords": [], "labels": [], "sortKeys": { "stars": 2 } },
      "versions": [
        {
          "version": "0.1.0",
          "publishTimestamp": 1757116800,
          "source": {
            "type": "git",
            "url": "https://github.com/CAI-MH/dsh-quality-review",
            "commit": "3f1c9a2b7d4e50618c9b2a7f4d3e1c0b9a8f7e6d"
          },
          "engines": {}
        }
      ]
    }
  ]
}
```

请注意这个示例必须遵守的一条规则：每个插件的 `category` id 都必须出现在 `metadata.categories` 中，否则校验器会拒绝整份文档。

## 在 DSH Discover 中使用

Discover 标签页是**实验性**的，自定义市场还藏在另一个开关后面，该开关随实验性插件市场 bundle 一起提供：

1. 打开 **Plugins**。
2. 在 **Experimental plugins** 旁打开 **More**。
3. 打开 **Custom plugin markets**。Plugins 页面此时会多出两个标签页：**Installed** 和 **Discover**。
4. 打开 **Discover** → **Add index source**，粘贴：

   ```
   https://hytime.github.io/dsh-discover-index/index.json
   ```

   只需要这一个 URL。它本身就是一份完整的格式 1 文档，不配套任何 manifest 或 API。
5. 添加多个来源后，用**市场菜单**在它们之间切换。每个配置的 profile 都是一份独立索引，因而也是一个独立市场。
6. 在市场内搜索、筛选、排序，然后安装需要的插件。

切换市场是纯客户端操作，因为每个 profile 都发布为一份完整索引——新增市场无需改动 DSH。市场标题、描述与插件元数据都是第三方文本，不构成任何背书；上面的 `description` 写明了本仓库地址，因此出处在这份列表里就能看到。

## 以后如何新增来源

配置即数据。新增一个来源只需要一个适配器加一条配置：

1. 在 `src/sources/` 下新增适配器模块，把抓取到的数据转换为 `Candidate[]`（参考 `src/sources/upstream-catalog.ts`）。
2. 在 `src/config.ts` 的 `KNOWN_SOURCE_KINDS` 中注册它的 `kind`——配置里写了未注册的 kind 会被直接拒绝，这样拼写错误不会悄悄让一个来源失效。
3. 在 `config/config.yml` 的 `sources:` 下添加该来源，填好 `id`、`kind`、`url`（如果有）、`minStars` 和 `priority`。当两个来源产出同一个包名时，`priority` 数值更小者优先。
4. 在 `profiles:` 条目中引用该来源的 `id` 以单独发布，或引用到已有 profile 中以合并进同一个市场。

新来源对 npm 条目必须给出真实的 npm 包名与精确版本。仅有 Git 的条目要固定提交 SHA。从仓库名猜测包名会错两次：仓库名在不同 owner 之间并不唯一，而且很多还含 npm 包名不允许的大写字母。

## 本地运行

需要 Node 22 与 pnpm 9+。

```bash
pnpm install                 # 与 CI 完全一致地安装依赖
pnpm run build               # 编译 TypeScript 到 dist/
node dist/cli.js build       # 抓取上游并写出 dist/index.json（及 profile 产出）
node dist/cli.js doctor      # 逐条列出被拒绝的条目及原因
node dist/cli.js sources     # 列出已配置的来源
pnpm test                    # 单元测试
pnpm run typecheck           # 只做类型检查，不产出文件
```

lockfile 是 `pnpm-lock.yaml`，需要提交；CI 使用 `pnpm install --frozen-lockfile` 安装，
因此改动依赖必须在同一个提交里更新 lockfile。

不需要本地克隆上游列表：`plugins.json` 是实时读取的，因为本地副本会严重滞后于在线目录。

`DSH_DISCOVER_UPSTREAM_URL` 可以覆盖目录 URL，便于对着录制好的响应做测试，而无需改动 `config/config.yml`。

要复现 CI 的校验关卡，可以按 CI 的方式运行校验器：

```bash
node -e "import('@deepseek-ai/dsh-plugin-market-index').then(m=>{const fs=require('fs');const doc=JSON.parse(fs.readFileSync('dist/index.json','utf8'));const v=m.parseMarketIndex(doc,'https://hytime.github.io/dsh-discover-index/index.json');console.log('valid, plugins='+v.plugins.length)})"
```

## 自动化

| Workflow | 触发条件 | 作用 |
| --- | --- | --- |
| [`build.yml`](.github/workflows/build.yml) | 每日 cron、`workflow_dispatch` | 构建索引；少于 2000 个插件时拒绝发布；用真实校验器校验；然后上传 `dist/` 并部署到 Pages。 |
| [`validate.yml`](.github/workflows/validate.yml) | pull request、push 到 `main` | 类型检查、测试、编译，并完整构建一次索引且必须通过校验。不部署，也没有 Pages 权限。 |

坏索引永远不会覆盖好索引：校验步骤在产物上传之前运行，deploy job 依赖 build job 成功，且新运行会通过 `concurrency` 的 `cancel-in-progress` 取消进行中的旧运行。

## 许可证

[MIT](LICENSE) © 2026 hytime

上游目录数据归其作者所有，按其条款转载。
