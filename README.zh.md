# dsh-discover-index

[English](README.md) | 中文

把在线的 [awesome-dsh-plugin](https://awesome-dsh-plugin.com/) 目录汇总为**插件市场索引格式 1**——[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）Discover 标签页读取的那份 JSON 文档。

已发布索引：<https://hytime.github.io/dsh-discover-index/index.json>

> [!NOTE]
> **需要较新版本的 DSH，且是作为「自定义插件市场」使用的。**
> 本索引由实验功能**自定义插件市场**消费，而不是 DSH 核心。该功能自 **DSH 0.2.1-alpha.4**（2026-10-15）起提供，之后的每个 0.2.1 构建都包含它；更早的 DSH 没有「发现」标签页，也无法添加索引源。上游目前仍将其标记为实验性，因此默认关闭，需要你自己打开——见[在 DSH Discover 中使用](#在-dsh-discover-中使用)。
>
> 本项目不打补丁、也不扩展 DSH：它只发布一份 JSON 文件，你把该功能的索引源指向这个 URL 之后，由 DSH 去读取。

> [!IMPORTANT]
> **本项目是转换与聚合的来源，不是安全审查。**
> 索引中的每一条都是来自上游的第三方数据。本项目不会审计、隔离或担保它列出的插件。安装 DSH 插件会在你的 harness 内运行第三方代码，安装前请先阅读插件源码。

## 状态

已发布并自动化。上面的索引地址提供的是一份活文档，由 [`build.yml`](.github/workflows/build.yml) 每日重建，且只有通过真正的 `@deepseek-ai/dsh-plugin-market-index` 校验器之后才会部署。

| 检查项 | 结果 |
| --- | --- |
| TypeScript | 编译干净 |
| 测试 | 离线全绿，基于从线上目录录制的 fixture——`pnpm test` |
| 已发布索引 | 格式 1、通过真校验器、按日重建 |
| 自动化 | 每日 cron，另支持 `workflow_dispatch` 手动重建 |

这里刻意不写死插件数量：流水线读取的是线上目录，两次运行之间会有几条的浮动（上游新增、下架、重新固定仓库）。要今天的数字，请直接查询索引，或看 Actions 里的运行摘要。自行构建见[本地运行](#本地运行)。

## 发布你自己的市场

本仓库是一份模板。Fork 之后指向一个目录，它就会在你自己的 GitHub Pages 地址上发布属于你的市场，并按日重建——无需服务器，也没有任何硬编码到本账号的地方。**[发布你自己的插件市场 →](FORKING.zh.md)**

## 产出

`dist/site/index.json`——一份格式 1 文档，发布于 <https://hytime.github.io/dsh-discover-index/index.json>。`config/config.yml` 中声明的每个 **profile** 各自产出一份文档（例如按星标下限筛选的子集可以单独发布为一个市场），每一份都会在 CI 中独立校验。

旁边还有 **`stats.html`**——由同一份文档生成的统计页。

> `dist/site/` 才是发布的目录；`dist/` 还放着编译后的 JavaScript，它不发布。Pages artifact 只取 `dist/site/`，因此构建产物不会作为网页内容被公开。

### 统计页展示了什么

<https://hytime.github.io/dsh-discover-index/stats.html>

市场索引回答「有哪些插件」；统计页回答的是另一个问题——一个访客在决定要不要加这个市场时真正关心的：这里面有多少是**被测量过的**，多少是**可信的**。页面给出：

- **覆盖率**，每一项都对应各自的分母——有多少条目带星标数、下载量、版本历史、`engines.dsh` 范围、分类、标签，或风险标记。这里给单一的「覆盖率 %」会是在编造数字：星标覆盖的是某一部分插件，DSH 范围覆盖的是另一部分，用同一个总数去除两者，等于凭空造出一个没人测量过的事实。
- **分布**——每个插件的版本数、各分类的插件数、各标签的插件数。
- **谁在使用这份索引**——提到或消费本索引的仓库，按证据分档：*读取了 JSON*（该仓库里出现了已发布的索引地址）、*仅提及*（只出现项目名）、以及 fork（可以自行发布一份副本）。各档**不会相加成一个数字**，因为一份只链接到本仓库的清单并没有消费这个市场。

  页面如实写明了两条限制，而不是留给人猜：GitHub Pages 不保留访问日志，因此有多少客户端真的加载过索引**没有任何地方记录**——使用可以不留下公开痕迹；而 GitHub 的代码搜索并不覆盖所有仓库与所有近期改动，所以引用数是**下限，不是总数**。

所有数字都在构建时由「刚刚通过校验的那份文档」算出，因此统计页不可能描述一个与已发布市场不一致的市场；数字直接写在 HTML 里，而不是靠脚本生成。页面**不加载任何第三方脚本**，引用的远端域名只有本项目自己的。

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

上游每条只给一个版本。DSH 的插件页会列出它能安装的每个版本，并通过 `engines.dsh` 拒绝当前 DSH 不满足的版本——而每个插件只有一个版本时，这两件事都没有意义。因此构建时会读取每个 npm 包的 registry 文档，列出声明了 `dsh.bundle`、未被废弃、且有发布时间的版本（2607 份文档，冷启动约 150 MB）。

**每个插件最多保留五个版本。** 高频发版的包会产出几百个版本，它们增加的是菜单行而不是可做的选择——`billion-context` 一个包就有 3781 个版本，占整份文档的十分之一，版本列表完全无法使用。上限保留**发布时间最近的五个**，外加两个**永不丢弃**的版本：

- **最高稳定版**——DSH 优先选择稳定版，只有当一个插件完全没有稳定版时才回退到预发布版。以线上目录实测：若只按发布时间截断，会有 **11 个插件仅有的稳定版被删掉**，导致它们只能以预发布形式安装；
- **整体最高版本**——插件页首先展示它，「有新版本」也是与它比较。

因此一个插件最多列出七个版本，按由新到旧排序。截断去掉了约三分之二的版本条目，文档体积减少约四分之一——这里给比例而不是绝对值，因为两者都会随目录增长而变化。

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

「发现」标签页是**实验性**的：它不属于 DSH 的标准安装，而在一个可选 bundle 里；必须先让该 bundle 出现在你的 profile 中，第一步里那个开关才会存在。

**前置条件。**

1. DSH 构建为 **0.2.1-alpha.4** 或更新——这是该功能首次发布的版本。
2. 把实验性插件市场 bundle 装进你的 profile：

   ```bash
   dsh plugin --profile web add @deepseek-ai/dsh-experimental-plugin-market-bundle
   ```

   `dsh plugin` 会在 profile 目录内转发给 pnpm，因此 `--profile` 是必需的，其余就是 pnpm 自己的语法。出厂的 `web` profile 只带 base 与 web-app 两个 bundle，所以缺少这一步就没有 **自定义插件市场** 那一行可开。

   > 桌面端（Electron 应用）的 `desktop` profile 由应用独占管理，CLI 会明确拒绝 `--profile desktop`。桌面端用户请在应用内的插件页安装这个 bundle，不要用上面这条命令。

本索引**本身不是** DSH 插件，无需安装——它只是一份由 DSH 通过 https 读取的 JSON 文件。需要安装的，只是「能读它的那个功能」。

### 1. 打开「自定义插件市场」

打开 **Plugins**，在 **实验性插件** 下打开 **自定义插件市场**。Plugins 页面此时会多出 **已安装** 和 **发现** 两个标签页。该开关默认关闭，因为上游仍将其标记为实验性；打开它才会挂载「发现」标签页及其背后的市场服务。

名字以 `@deepseek-ai/dsh-experimental-` 开头的 bundle 都会列在**实验性插件**下——这个分组是按名字判定的，并不是另一份注册表，所以必须先装好 bundle，那一行才会出现。

![在「实验性插件」下打开「自定义插件市场」](docs/images/01-enable-custom-market.jpg)

### 2. 添加索引源

打开 **发现** → **添加索引源**，粘贴：

```
https://hytime.github.io/dsh-discover-index/index.json
```

只需要这一个 URL。它本身就是一份完整的格式 1 文档，不配套任何 manifest 或 API。

![索引源弹窗，已填入已发布的索引 URL](docs/images/02-add-index-source.jpg)

### 3. 浏览市场

市场名为 **DSH 插件索引**。分类胶囊、**标签**筛选器与**排序**菜单全部由索引自身声明，因此添加来源后立刻出现——DSH 不需要知道这个市场里有什么。

![发现列表：分类胶囊、每张卡片上的标签、排序菜单](docs/images/03-plugin-list.jpg)

### 4. 打开某个插件

插件页会列出索引中该插件的每一个版本（标出推荐版本），并在**标签**一行展示声明的标签。

![插件详情页：标签与版本列表](docs/images/04-plugin-detail.jpg)

添加多个来源后，用**市场菜单**在它们之间切换。每个配置的 profile 都是一份独立索引，因而也是一个独立市场。

切换市场是纯客户端操作，因为每个 profile 都发布为一份完整索引——新增市场无需改动 DSH。市场标题、描述与插件元数据都是第三方文本，不构成任何背书；上面的 `description` 写明了本仓库地址，因此出处在这份列表里就能看到。

> 这些截图来自一个只配置了本索引的 DSH 0.2.1-rc.2 实例，因此画面里只有本索引、没有别的东西。其中的分类、标签、排序键与版本列表，全部渲染自已发布的那份文档。

## 配置来源

一个来源就是 `config/config.yml` 里的一条配置。`kind` 决定用哪个适配器读文档；`fields` 映射说明该文档把「要变成标签、关键词、排序键的东西」放在哪里。

仓库自带的配置读取上游目录、不需要任何映射，因为该适配器本身就知道上游的结构：

```yaml
sources:
  - id: awesome-dsh-plugin
    kind: upstream-catalog
    enabled: true
    url: https://awesome-dsh-plugin.com/plugins.json
    minStars: 0
    priority: 10
```

### 指向一个字段命名不同的文档

`fields` 就是「换一份目录 = 改配置而不是改代码」的载体。每个路径都以点号分隔，且全部可选；没写的部分就不贡献任何内容。下面这个例子读的是把信任信息嵌在 `security` 下、并自带 `score` 的目录：

```yaml
sources:
  - id: other-catalog
    kind: upstream-catalog
    enabled: true
    url: https://example.test/catalog.json
    minStars: 0
    priority: 5
    fields:
      capabilities: security.permissions   # -> 形如 `shell` 的标签
      redLines: security.warnings          # -> 归一化后的 `risk:` 标签
      keywords: topics                     # -> 额外的搜索词
      sortKey:
        path: score                        # -> 一个数值排序键……
        id: score                          #    ……以这个 id 发布
```

| 键 | 指向 | 变成什么 |
| --- | --- | --- |
| `capabilities` | 权限 id 数组，如 `["shell", "network"]` | 每个 id 一个标签，同时该 id 及其词元作为关键词 |
| `redLines` | 描述性发现的数组 | 每个可识别类别一个 `risk:` 标签；无法识别的句子被忽略 |
| `keywords` | 发现词数组 | 在身份关键词与分类之外的额外搜索词 |
| `sortKey.path` | 一个数字 | 一个排序键，于是 Discover 多出一个按它排序的菜单项 |
| `sortKey.id` | — | 该键发布与被引用时使用的 id |

有两条规则在加载时就强制检查，因为这两种错误否则都是静默的：

- **拒绝空的路径片段。** `security..permissions` 会解析到空，来源看上去「没有发布任何能力」。
- **`sortKey` 必须同时给 `path` 和 `id`。** 有值无 id 无法被引用；有 id 无值会对外宣称一个排不出顺序的排序项。

路径在文档里根本不存在**不算错误**——该条目保留其他信息，只是不再从该成员贡献标签。这是刻意的：写错一个路径，代价应该是丢掉它指向的标签，而不是整轮构建失败。

### 索引会声明什么

自定义排序键会根据实际携带它的候选项自动声明，因此配置好的 `sortKey` 无需额外工作就会出现在 Discover 的**排序**菜单里。标签同理：插件引用的每个标签都会被声明，而每个声明都有本地化标题；对于本项目没见过的词表，标题回退为 id 本身。

### 需要新适配器时

配置无法凭空创造一种文档格式。当目录不是现有适配器能读的形状时：

1. 在 `src/sources/` 下新增适配器模块，把抓取到的文档转换为 `Candidate[]`（参考 `src/sources/upstream-catalog.ts`）。
2. 在 `src/config.ts` 的 `KNOWN_SOURCE_KINDS` 中注册它的 `kind`——配置里写了未注册的 kind 会被直接拒绝，这样拼写错误不会悄悄让一个来源失效。
3. 在 `sources:` 下添加该条目，并在 `profiles:` 条目中引用它的 `id` 以单独发布，或引用到已有 profile 中以合并进同一个市场。当两个来源产出同一个包名时，`priority` 数值更小者优先。

新来源对 npm 条目必须给出真实的 npm 包名与精确版本。仅有 Git 的条目要固定提交 SHA。从仓库名猜测包名会错两次：仓库名在不同 owner 之间并不唯一，而且很多还含 npm 包名不允许的大写字母。

### 发布第二个市场

每个 `profiles:` 条目各自产出一份文档，因而在 Discover 里也是一个独立市场：

```yaml
profiles:
  - id: curated
    title: { en: Curated Plugins, zh: 精选插件 }
    sources: [awesome-dsh-plugin, other-catalog]
    minStars: 100
    output: curated.json
```

多个 profile 可以共用来源；同一个插件出现在两个市场里没有问题，因为两份文档相互独立。`minStars` 与各来源自己的 `minStars` 都会生效——profile 取两者中更高的那个。

## 本地运行

需要 Node 22 与 pnpm 9+。

```bash
pnpm install                 # 与 CI 完全一致地安装依赖
pnpm run build               # 编译 TypeScript 到 dist/
node dist/cli.js build       # 抓取上游并写出 dist/site/index.json（及 profile 产出与统计页）
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
node -e "import('@deepseek-ai/dsh-plugin-market-index').then(m=>{const fs=require('fs');const doc=JSON.parse(fs.readFileSync('dist/site/index.json','utf8'));const v=m.parseMarketIndex(doc,'https://hytime.github.io/dsh-discover-index/index.json');console.log('valid, plugins='+v.plugins.length)})"
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
