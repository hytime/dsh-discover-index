# dsh-discover-index

[English](README.md) | 中文

把在线的 [awesome-dsh-plugin](https://awesome-dsh-plugin.com/) 目录汇总为**插件市场索引格式 1**——[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）Discover 标签页读取的那份 JSON 文档。

已发布索引：<https://hytime.github.io/dsh-discover-index/index.json>

> [!IMPORTANT]
> **本项目是转换与聚合的来源，不是安全审查。**
> 索引中的每一条都是来自上游的第三方数据。本项目不会审计、隔离或担保它列出的插件。安装 DSH 插件会在你的 harness 内运行第三方代码，安装前请先阅读插件源码。

## 状态

流水线与这些 workflow 仍在建设中。在 CLI 完成、并且 CI 里真正跑过一次 `node dist/cli.js build` 之前，请把已发布的索引地址和这些 workflow 都视为**未经验证**。参见[本地运行](#本地运行)。

## 产出

`dist/index.json`——一份格式 1 文档。`config/config.yml` 中声明的每个 **profile** 各自产出一份文档（例如按星标下限筛选的子集可以单独发布为一个市场），每一份都会在 CI 中独立校验。

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
    "en": "The awesome-dsh-plugin list converted to the plugin market index format.",
    "zh": "由 awesome-dsh-plugin 列表转换而来的插件市场索引。"
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
4. 打开 **Discover**，添加索引来源 URL——已发布的是 `https://hytime.github.io/dsh-discover-index/index.json`。
5. 添加多个来源后，用**市场菜单**在它们之间切换。每个配置的 profile 都是一份独立索引，因而也是一个独立市场。
6. 在市场内搜索、筛选、排序，然后安装需要的插件。

切换市场是纯客户端操作，因为每个 profile 都发布为一份完整索引——新增市场无需改动 DSH。

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
