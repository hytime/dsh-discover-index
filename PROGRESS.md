# 项目进度 / Project status

> 快照时间：**2026-10-17 22:10 CST**（上一版为 21:46；本次修复了 deny 名单缺陷）
> 分支 `main`，工作区改动待提交。上一版标记的唯一已知缺陷已修复并有回归测试锁定。

---

## 一句话说明

把 [awesome-dsh-plugin](https://awesome-dsh-plugin.com/) 的线上插件目录（5704 条）转换成 DeepSeek Harness **插件市场索引格式 1（format 1）** 的 JSON，供 DSH 实验性的 **Discover** 面板读取；定时重建并发布到 GitHub Pages。

产物不是"另一个插件市场"，而是一个**转换/聚合源**。

---

## 当前状态：代码完成且已验证；发布链路未启动

| 项 | 状态 | 证据 |
|---|---|---|
| TypeScript 编译 | ✅ | `tsc -p tsconfig.json --noEmit` 退出码 0 |
| 测试 | ✅ | `vitest run` → **327 通过 / 1 跳过 / 0 失败**（9 个文件，全离线） |
| 真实校验器验证 | ✅ | 产物经 `@deepseek-ai/dsh-plugin-market-index` 校验通过 |
| 全量构建 | ✅ | 5451 个插件（2587 npm + 2864 git） |
| deny 名单 fail-open | ✅ 已修复 | 见下方「已修复」；`git+https` / SSH / 非 GitHub 域名均被拒绝 |
| Git | 🟡 | 3 次提交，本次修复待提交 |
| GitHub 仓库 | ❌ | `hytime/dsh-discover-index` **不存在** |
| remote / push | ❌ | 无 remote，未推送 |
| GitHub Pages | ❌ | 未开启，README 里的索引 URL 目前 404 |
| CI 工作流实跑 | ❌ | 从未在 Actions 中运行过 |

### 最近一次全量构建的事实

```
node dist/cli.js build
  → 2607 条 npm 条目 + 3097 条需 git 解析（73 条命中缓存）
  → 5648 个候选 → 5451 个插件
  → 3011 次请求（16 次重试），89% 带 star 数
  → dist/index.json ≈ 7.7 MB
```

拒绝原因分布：policy 197（144 + 53 为重复包名）、resolve 56（30 仓库不可达 / 16 无 `dsh.bundle` / 3 无可用 name+version / 5 包名非法 / 2 路径无 `package.json`）。

> 数字比上一版各少 1（5452 → 5451、5649 → 5648、resolve 55 → 56）属于每次运行都会有的上游抖动：目录条目在变、仓库 HEAD 在动。不是回归。

---

## 架构：五段式，每段可离线测试

```
extract → resolve → select → render → validate
```

| 模块 | 职责 |
|---|---|
| [`sources/upstream-catalog.ts`](src/sources/upstream-catalog.ts) | 读线上目录；纯函数 `parseUpstreamCatalog` 可离线测 |
| [`resolve/npm.ts`](src/resolve/npm.ts) | 已有 npm 包名的条目 → 零网络转换 |
| [`resolve/git.ts`](src/resolve/git.ts) | 无包名条目 → `git ls-remote` 取 SHA + `raw@SHA` 取 manifest |
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

> 状态：**已修复并验证**（本次修改）。下面保留原始记录，因为故障模式本身比修复更有参考价值。

### 原缺陷

提交 `194c9e9` 的信息声称让 deny 名单不再 fail open，但该缺陷当时仍然存在——它只改了成因的一半。

真正的原因在 [`policy/filter.ts`](src/policy/filter.ts)：

```js
const identity = candidate.repository ? repoIdentity(candidate.repository.url) : undefined
```

守卫**先判断 `candidate.repository` 是否存在**。而对于 `git+https://…` 形式和任何非 GitHub 域名的 URL，`npmCandidate` 根本不会设置 `repository` 字段（它要求 URL 以 `https://github.com/` 开头），所以 `repoIdentity` 永远不会被调用——那次重写在真正需要它的输入上是死代码。

**后果**：`denyRepos` 对 `git+https://github.com/deepseek-ai/deepseek-harness.git` 这类 URL 失效，DeepSeek 自身会出现在它自己的插件列表里。

**当时为什么测试全绿**：验证者有意把这两个用例写成断言**旧的 fail-open 行为**（原话是"当你修好后它们会翻红"）。它们从未翻红，所以**通过恰恰说明没修好**。这是一条值得记住的教训：断言 bug 行为的测试是合法的探针，但必须有一个"修复后翻红"的约定配套，否则它会长成永久绿灯。

### 本次修复

1. [`src/types.ts`](src/types.ts) 的 `Candidate` 新增 `sourceUrl`：来源发布的原始 URL，仅内部使用、永不渲染。它与 `repository` 分离是刻意的——后者是 format 1 约束的展示字段，只接受规范 `https://` URL。
2. [`src/resolve/npm.ts`](src/resolve/npm.ts) 与 [`src/resolve/git.ts`](src/resolve/git.ts) 都填充 `sourceUrl`。
3. [`src/policy/filter.ts`](src/policy/filter.ts) 新增 `repositoryIdentities()`，从 `sourceUrl`、`repository.url`、`homepage` 三处收集身份；`applyDenyLists` 改用穷举匹配，任一命中即拒绝。
4. [`tests/robustness.test.ts`](tests/robustness.test.ts) 把原来断言 fail-open 的用例**翻转**为断言拒绝，并补了 SSH 形式与"第三方同前缀仓库不被误杀"两个用例。

现在 `git+https`、SSH、非 GitHub 域名三种形式全部被拒绝，而 `pengyue-polaron/deepseek-harness-genui` 这类第三方仓库仍保留。

**验证**：`sourceUrl` 不出现在渲染产物中（`JSON.stringify(doc).includes('sourceUrl') === false`）；全量产物 5451 个插件经真校验器通过，且不含 `deepseek-harness`。

### 其他未完成

1. **GitHub 仓库未创建** → 无 remote、无 push。
2. **Pages 未开启** → 索引 URL 404。
3. **两个工作流从未真跑**：只做了语法与片段级验证。`build.yml` 还需注意：它引用了 `data/resolve-cache.json` 的 `actions/cache`，但该缓存文件被 `.gitignore` 忽略 —— 冷启动时第一步会回退为全量解析（约 3084 次请求），这是预期行为但耗时长。
4. `dist/` 是上一次运行的产物，已被 gitignore；CI 会重新生成。
5. pnpm 配置已迁至 [`pnpm-workspace.yaml`](pnpm-workspace.yaml)（pnpm 10+ 不再读 `package.json` 的 `pnpm` 字段），并加了 `packageManager: pnpm@11.7.0`；CI 里钉的是 pnpm 9，与本地 11.7 存在版本差，未实测。

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

1. 打开 **Plugins** → **More**（在 **Experimental plugins** 旁）→ 开启 **Custom plugin markets**；
2. Plugins 页出现 **Installed** / **Discover** 两个标签；
3. Discover 里 **Add index source**，填入
   `https://hytime.github.io/dsh-discover-index/index.json`
4. 用市场菜单切换源；`stars` / `downloads` / `added` 排序项由索引自身声明，DSH 会自动显示。

> ⚠️ 该 URL 目前 404，因为仓库和 Pages 都还没创建。

### 添加新源

在 [`config/config.yml`](config/config.yml) 的 `sources:` 下加一项，并新增一个 `kind` 匹配的适配器模块。多源合并去重、`priority` 高者优先；每个 `profile` 产出一个独立 JSON，对应 Discover 里的一个可切换市场。

---

## 免责声明

索引内容是第三方数据，**不是安全审查**。收录不代表背书，安装前请自行阅读源码。
