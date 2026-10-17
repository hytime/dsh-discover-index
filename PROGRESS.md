# 项目进度 / Project status

> 快照时间：**2026-10-18 01:55 CST**
> 分支 `main`，已推送，工作区干净，CI 两个工作流均在最新提交上成功，索引已上线。
> 本文件是项目的当前状态记录；历史缺陷的完整复盘保留在下方，因为故障模式比修复本身更有参考价值。

**DSH 引用源**：`https://hytime.github.io/dsh-discover-index/index.json`

---

## 一句话说明

把 [awesome-dsh-plugin](https://awesome-dsh-plugin.com/) 的线上插件目录（5704 条）转换成 DeepSeek Harness **插件市场索引格式 1（format 1）** 的 JSON，供 DSH 实验性的 **Discover** 面板读取；定时重建并发布到 GitHub Pages。

产物不是"另一个插件市场"，而是一个**转换/聚合源**。

---

## 当前状态：全部完成并已验证上线

| 项 | 状态 | 证据 |
|---|---|---|
| TypeScript 编译 | ✅ | `tsc -p tsconfig.json --noEmit` 退出码 0 |
| 测试 | ✅ | `vitest run` → **364 通过 / 1 跳过 / 0 失败**（11 个文件，全离线） |
| 真实校验器验证 | ✅ | 产物经 `@deepseek-ai/dsh-plugin-market-index` 校验通过 |
| 全量构建 | ✅ | 5452 个插件、37355 个版本（2587 npm + 2865 git） |
| 版本历史 | ✅ | 2231 个插件拥有多个版本；645 个插件带 `engines.dsh` |
| 能力/风险/热度标签 | ✅ | 24 个已声明标签；1031 个插件带 `shell`，343 个带至少一个 `risk:` |
| deny 名单 fail-open | ✅ 已修复 | 见下方「已修复」；`git+https` / SSH / 非 GitHub 域名均被拒绝 |
| 市场描述含源码出处 | ✅ | 两语言均带 `https://github.com/hytime/dsh-discover-index`，长度 127 / 88，未触及 DSH 的 300 上限 |
| 可配置解析 | ✅ | `fields` 映射可指向任意字段名（含点路径）与自定义排序键；见 `tests/custom-parsing.test.ts` |
| 可 fork | ✅ | workflow 与测试均从运行仓库推导 Pages 地址；见 [`FORKING.md`](FORKING.md) |
| Git | ✅ | 11 次提交，已推送 `main`，工作区干净 |
| GitHub 仓库 | ✅ | <https://github.com/hytime/dsh-discover-index> |
| GitHub Pages | ✅ | <https://hytime.github.io/dsh-discover-index/index.json> 返回 200 |
| CI 工作流实跑 | ✅ | `Validate` 通过；`Build and deploy index` build + deploy 通过 |
| 自动化 | ✅ | 每日 cron `17 6 * * *` 已生效，另支持 `workflow_dispatch` |
| GitHub topics | ✅ | 10 个（`dsh-plugin`、`plugin-index`、`market-index` 等） |
| 官方 Discussions 帖 | ✅ | <https://github.com/deepseek-ai/deepseek-harness/discussions/10055> |

### 最近一次全量构建的事实

本地运行：

```
node dist/cli.js build
  → 2607 条 npm 条目 + 3097 条需 git 解析（命中缓存时更快）
  → 2607 份 registry 文档用于版本历史（约 150 MB、冷启动约 7 分钟）
  → 5649 个候选 → 5452 个插件、37355 个版本
  → 2644 次请求（10 次重试），89% 带 star 数
  → dist/index.json ≈ 13.0 MB（gzip 2.13 MB）
```

版本数分布：3224 个插件仅 1 个版本（多为 git 解析或 registry 无额外版本），103 个插件超过 50 个版本，最多的 `billion-context` 有 3744 个。超过 100 个版本的 103 个插件贡献了 17% 的版本量。


线上（CI 冷启动、无缓存）与本地数字相差在数条以内，属上游抖动。

拒绝原因分布：policy 197（164 + 33 为重复包名）、resolve 55（29 仓库不可达 / 16 无 `dsh.bundle` / 3 无可用 name+version / 5 包名非法 / 2 路径无 `package.json`）。

> 本地与线上数字略有差异属于每次运行都会有的上游抖动：目录条目在变、仓库 HEAD 在动。不是回归。

---

## 架构：五段式，每段可离线测试

```
extract → resolve → select → render → validate
```

| 模块 | 职责 |
|---|---|
| [`sources/upstream-catalog.ts`](src/sources/upstream-catalog.ts) | 读线上目录；纯函数 `parseUpstreamCatalog` 可离线测 |
| [`resolve/npm.ts`](src/resolve/npm.ts) | 已有 npm 包名的条目 → 零网络转换；从 registry 文档展开全部可安装版本 |
| [`resolve/git.ts`](src/resolve/git.ts) | 无包名条目 → `git ls-remote` 取 SHA + `raw@SHA` 取 manifest |
| [`resolve/discovery.ts`](src/resolve/discovery.ts) | 能力 → 标签、红线句子归一化、热度分档、搜索关键词 |
| [`resolve/urls.ts`](src/resolve/urls.ts) | 拆解 `/tree/main/packages/x` 子路径 |
| [`resolve/package-name.ts`](src/resolve/package-name.ts) | npm 包名合法性（唯一真源） |
| [`resolve/version-rules.ts`](src/resolve/version-rules.ts) | SemVer / `engines.dsh` / 时间戳 / git 源规则 |
| [`policy/filter.ts`](src/policy/filter.ts) | deny 名单、按包名去重、star 下限 |
| [`render/index.ts`](src/render/index.ts) | 组装 format 1 + 真校验器自检 |
| [`pipeline.ts`](src/pipeline.ts) | 编排；带 7 天 TTL 的 git 缓存 |
| [`cli.ts`](src/cli.ts) | `build` / `doctor` / `sources` |

### 关键设计决定

1. **只读线上，绝不读本地 clone。** 本机 `awesome-dsh-plugin/` 是 hytime fork，停在 2059 条；线上已 5704 条。读本地会静默丢掉 3645 条。
2. **包名来自 `package.json`，不来自仓库名。** 271 组仓库名跨 owner 重名、225 个含大写（npm 禁止），仓库名无法用作 format 1 的 `name`。
3. **`versions` 必须非空**，所以解析不出可安装版本的条目**带原因丢弃**，绝不产出空壳。
4. **发现过程不消耗 GitHub REST 配额**：`git ls-remote` + `raw.githubusercontent.com`，不烧 5000/小时的核心配额。
5. **发布前有双闸门**：真校验器 + 插件数下限（<2000 拒绝发布），且 deploy 是独立 job，坏索引无法顶掉好索引。
6. **热度做成标签必须分档，不能精确。** label id 在索引里只声明一次、由插件引用，不存在「每插件 label 值」。精确值需要 235 个星标标签 + 1690 个下载量标签，筛选菜单会不可用。精确数字留在 `sortKeys`（DSH 也会通过 `plugin_market` 工具交给模型）。
7. **版本历史是 best-effort。** registry 不可达时保留上游那一个版本——让一次 registry 故障导致插件从市场上消失，比只显示一个版本更糟。

---

## 侦察数据（已实测，非推测）

| 事实 | 数值 |
|---|---|
| 线上目录条目 | 5704 |
| 自带 npm 包名 + 版本 | 2607 |
| 需 git 解析 | 3097 |
| 仓库名跨 owner 重名 | 271 组 |
| 条目 `name` 字段含大写 | 225 |
| `/tree/` 子路径 URL | **597**（此前简报写的 285 不成立） |
| star 分布 | >100: 193 · >50: 288 · >10: 793 |

> 注：简报里"285 个 monorepo 子路径"经复核不成立，实际 597 个（其中 289 个无 npm 身份）。行为不受影响，仅数字需更正。详见 [`tests/RECON.md`](tests/RECON.md)。

---

## 已修复：deny 名单「fail open」

> 状态：**已修复并验证**（提交 `67f2ad5`）。下面保留原始记录，因为故障模式本身比修复更有参考价值。

### 原缺陷

提交 `194c9e9` 的信息声称让 deny 名单不再 fail open，但该缺陷当时仍然存在——它只改了成因的一半。

真正的原因在 [`policy/filter.ts`](src/policy/filter.ts)：

```js
const identity = candidate.repository ? repoIdentity(candidate.repository.url) : undefined
```

守卫**先判断 `candidate.repository` 是否存在**。而对于 `git+https://…` 形式和任何非 GitHub 域名的 URL，`npmCandidate` 根本不会设置 `repository` 字段（它要求 URL 以 `https://github.com/` 开头），所以 `repoIdentity` 永远不会被调用——那次重写在真正需要它的输入上是死代码。

**后果**：`denyRepos` 对 `git+https://github.com/deepseek-ai/deepseek-harness.git` 这类 URL 失效，DeepSeek 自身会出现在它自己的插件列表里。

**当时为什么测试全绿**：验证者有意把这两个用例写成断言**旧的 fail-open 行为**（原话是"当你修好后它们会翻红"）。它们从未翻红，所以**通过恰恰说明没修好**。这是一条值得记住的教训：断言 bug 行为的测试是合法的探针，但必须有一个"修复后翻红"的约定配套，否则它会长成永久绿灯。

### 修复内容（`67f2ad5`）

1. [`src/types.ts`](src/types.ts) 的 `Candidate` 新增 `sourceUrl`：来源发布的原始 URL，仅内部使用、永不渲染。它与 `repository` 分离是刻意的——后者是 format 1 约束的展示字段，只接受规范 `https://` URL。
2. [`src/resolve/npm.ts`](src/resolve/npm.ts) 与 [`src/resolve/git.ts`](src/resolve/git.ts) 都填充 `sourceUrl`。
3. [`src/policy/filter.ts`](src/policy/filter.ts) 新增 `repositoryIdentities()`，从 `sourceUrl`、`repository.url`、`homepage` 三处收集身份；`applyDenyLists` 改用穷举匹配，任一命中即拒绝。
4. [`tests/robustness.test.ts`](tests/robustness.test.ts) 把原来断言 fail-open 的用例**翻转**为断言拒绝，并补了 SSH 形式与"第三方同前缀仓库不被误杀"两个用例。

现在 `git+https`、SSH、非 GitHub 域名三种形式全部被拒绝，而 `pengyue-polaron/deepseek-harness-genui` 这类第三方仓库仍保留。

**验证**：`sourceUrl` 不出现在渲染产物中（`JSON.stringify(doc).includes('sourceUrl') === false`）；全量产物经真校验器通过，且不含 `deepseek-harness`。

### 第二个缺陷：pnpm 构建脚本批准键（CI 实跑才发现）

第一条真实 CI 运行在 `pnpm install --frozen-lockfile` 就失败了：

```
[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: esbuild@0.21.5, esbuild@0.28.2
```

根因：pnpm 11 只认 [`pnpm-workspace.yaml`](pnpm-workspace.yaml) 里的 **`allowBuilds` 映射形式**。仓库当时写的是 `onlyBuiltDependencies` —— 它被**接受但不生效**，而"未批准的构建脚本"在 pnpm 11 是**硬错误**而非警告，于是安装退出码 1。

**为什么本地一路绿灯**：本机的 pnpm store 里已经有 esbuild 的平台二进制，安装时无需重新执行 postinstall，所以这个错误只在干净环境里出现。这也是"本地全绿不等于 CI 能过"的典型样本。

**修复（`82ba4d6`）**：改成 `allowBuilds: { esbuild: true }`。用 A/B 对照实验确认：`onlyBuiltDependencies` 退出码 1，`allowBuilds` 退出码 0 并成功拉取平台二进制。验证方式是从 `git archive` 导出的干净目录跑完整 CI 序列（frozen install → typecheck → test → build），而不是在已预热的工作区里跑。

顺带修正了 CI 的 pnpm 版本锚点：`pnpm/action-setup@v4` 不再钉 `version: 9`，改为读取 `package.json` 的 `packageManager: pnpm@11.7.0`，与写出 `pnpm-lock.yaml` 的版本一致。

### 剩余已知事项（均不阻塞）

1. **`build.yml` 冷启动耗时长**：`actions/cache` 恢复的是 `data/resolve-cache.json`，而该文件被 `.gitignore` 忽略，因此首次运行必然回退为全量解析（约 3000 次请求，实测 build job 2m29s）。这是预期行为，后续运行会命中缓存。
2. **GitHub Actions 的 Node 20 弃用告警**：`checkout@v4` / `setup-node@v4` / `pnpm/action-setup@v4` 等仍以 Node 20 为目标，被 runner 强制在 Node 24 上跑。当前可用，未来需要升级 action 大版本。
3. `dist/` 是本地产物，已被 gitignore；线上由 CI 生成。
4. 上游数据每次运行都会抖动 ±数条（目录条目增减、仓库 HEAD 变化），本地与线上数字不必完全一致。

---

## 如何运行

```bash
pnpm install
pnpm run build
node dist/cli.js sources   # 检查源可达性
node dist/cli.js doctor    # 报告每条被拒理由，不写文件
node dist/cli.js build     # 生成 dist/index.json
pnpm test
```

`build` 支持 `--limit <n>`（限制本轮网络解析条数）、`--no-cache`、`--profile <id>`、`--cache-ttl-days <n>`。

### 在 DSH 中使用

先决条件：DSH 需为 **0.2.1-alpha.4** 或更新，且 profile 中必须有市场 bundle——出厂 `web` profile 只含 base 与 web-app，缺了它**根本没有那个开关**：

```bash
dsh plugin --profile web add @deepseek-ai/dsh-experimental-plugin-market-bundle
```

> 桌面端的 `desktop` profile 由 Electron 应用独占，CLI 会拒绝该 profile；桌面端请在应用内的插件页安装。

然后：

1. 打开 **Plugins** → **More**（在 **Experimental plugins** 旁）→ 开启 **Custom plugin markets**；
2. Plugins 页出现 **Installed** / **Discover** 两个标签；
3. Discover 里 **Add index source**，填入
   `https://hytime.github.io/dsh-discover-index/index.json`
4. 用市场菜单切换源；`stars` / `downloads` / `added` 排序项由索引自身声明，DSH 会自动显示。

> ✅ 该 URL 已上线（HTTP 200）。市场描述本身写明了源码仓库
> `https://github.com/hytime/dsh-discover-index`，出处随数据传播。

### 添加新源

分两种情况：

- **文档形状相同、只是字段名不同** → 只改配置。在 `sources:` 下加一项并用 `fields` 映射（支持点路径与自定义排序键）：

  ```yaml
  - id: other
    kind: upstream-catalog
    url: https://example.test/catalog.json
    priority: 5
    fields:
      capabilities: security.permissions
      redLines: security.warnings
      keywords: topics
      sortKey: { path: score, id: score }
  ```

- **文档形态本身不同** → 新增一个 `kind` 匹配的适配器模块，并在 `src/config.ts` 的 `KNOWN_SOURCE_KINDS` 注册。

多源合并去重、`priority` 数值更小者优先；每个 `profile` 产出一个独立 JSON，对应 Discover 里的一个可切换市场。完整说明见 README 的「配置来源」。

---

## 免责声明

索引内容是第三方数据，**不是安全审查**。收录不代表背书，安装前请自行阅读源码。
