# 手动发布到 npm

发布由维护者在本机手动执行，CI 不发布。所有包都在 npm 组织 `zerodep-dev` 下，版本号一起走；`@zerodep-dev/easy-query-ts-test` 是测试模块，不发布。

核心包在其余包里是 peer 依赖：适配器、列类型包与使用方的代码必须共用同一份核心（表达式靠 `instanceof` 识别），重复安装会失灵。
依赖写成 `workspace:^`，`pnpm publish` 发布时换成实际版本号，所以必须用 pnpm 发布，不能用 `npm publish`。

## 一次性准备

1. npm 账号开启 2FA，建一个范围是 `@zerodep-dev`、勾选 Bypass 2FA 的 Granular Access Token，放进用户级环境变量 `NPM_TOKEN`。
2. `~/.npmrc` 写 `//registry.npmjs.org/:_authToken=${NPM_TOKEN}`，不写明文。
3. 新包第一次发布后要经过一两分钟校验才出现在版本列表里；发布中途报 `409 Cannot publish over previously staged version` 说明上传已被接收，等一会儿，不要重发。

## 每次发布

1. **确认版本**：`packages/*/package.json` 的 `version` 相同且没发布过（npm 上已发布的版本不能覆盖）。
2. **确认 CI**：要发布的提交在 `master` 上，GitHub Actions 全部通过（check、test、consumer、docs、db、db-analytic、db-db2、db-hana）。
3. **比公开 API**：`pnpm api:diff` 把构建出的 `.d.ts` 和 npm 上的 latest 逐包比（去掉注释）。删掉的、签名变了的，在发布说明里写迁移办法（见下面的版本策略）。
4. **发布**（`-r` 按依赖顺序先发核心；`prepack` 会先构建）：

   ```bash
   pnpm install --frozen-lockfile
   pnpm -r publish --access public --no-git-checks
   ```

5. **打标签**：`git tag -a v0.2.0 -m "0.2.0"`，`git push origin v0.2.0`；在 GitHub 上用这个标签建 Release。

## 版本策略

0.x 期间，次版本可以有破坏性变更，发布说明里写迁移办法。1.0 起按[语义化版本](https://semver.org/lang/zh-CN/)：破坏性变更只进主版本。

### 什么算破坏性变更

- 删掉或改名包入口导出的东西（`pnpm exports:check` 核对的就是这些），或者删掉、改名它们的方法、属性、参数、选项。
- 原来能通过类型检查的代码不再通过。类型层面怎么判断参照 [Semantic Versioning for TypeScript Types](https://www.semver-ts.org/)。
- 同样的写法查出、写入的结果不同，或者生成的 SQL 语义不同；同一种失败抛出的错误换了类。
- 使用方自己实现的接口（`Adapter`、`Driver`、拦截器、列类型的编解码、方言子类覆盖的方法）多了必须实现的成员。
- 提高 `engines.node`、驱动 peer 依赖的下限、各库的最低版本、支持的最低 TypeScript 版本。

### 不算破坏性变更

- 新增导出、可选参数、可选选项；方言基类新增带默认实现的方法。
- 生成的 SQL 文本变了、语义没变（别名、括号、空白、参数顺序）。SQL 文本不是契约：`eqts` 的 SQL 快照随版本更新。
- 修 bug，改掉的结果原来就是错的。这类在发布说明里单列"行为调整"。
- 类型推断更准，只让原本就写错的代码报错。
- 包入口没导出的模块、`src` 与 `dist` 里的文件路径。

### 弃用

先在次版本里给要去掉的 API 标 `@deprecated`（编辑器里会划线），说明里写替代写法，发布说明里列出来。至少保留到下一个主版本，并且从标记起至少 6 个月。

### 运行时、TypeScript、驱动与数据库

- **Node**：`engines.node` 是最低版本。`pnpm test:consumer` 在最低版本与最新的正式版上各运行一遍。最低版本只在主版本里提高，并且只去掉 [Node 发布计划](https://github.com/nodejs/release#release-schedule)里已经结束维护的主线。
- **Bun、Deno**：不在 `engines` 里。发布前同一个检查在两者的最新版上各运行一遍，坏了要么修，要么在发布说明里写明。
- **TypeScript**：5.7 起（声明里用到 `Uint8Array<…>` 这类 5.7 才有的写法）。`pnpm test:consumer` 用最低版本与仓库用的版本各做一遍类型检查。最低版本只在主版本里提高。
- **驱动**：peer 依赖范围的下限只在主版本里提高；驱动出了新的主版本，在次版本里加进范围。
- **数据库**：文档站"方言包"一页的"说明"列是按写法支持的最低版本，"实测"列是 CI 上跑共用套件的版本。最低版本只在主版本里提高；实测的版本随 CI 镜像升级。人大金仓没有可用的实例（公开镜像的许可证都已过期），按 PG 模式的写法支持，没有实测。

### 维护哪些版本

只维护最新的主版本。安全问题在它的补丁版本里修。

## 怎么构建

开发和测试直接跑 `src` 里的 `.ts`（Node 24 类型剥离），不需要先构建；发布时才产出 `dist`。

- 每个包有 `tsconfig.build.json`（继承根目录的 `tsconfig.build.base.json`），用 TypeScript 项目引用（`composite`）：依赖核心包的包在构建时读取核心产出的 `.d.ts`。
- 源码里的相对导入写 `.ts`（Node 直接运行需要），构建时由 `rewriteRelativeImportExtensions` 改成 `.js`。
- `exports` 的 `@easy-query-ts/source` 条件指向源码，只有本仓库的 Node 进程（`pnpm-workspace.yaml` 的 `nodeOptions`）与 `tsconfig.json` 打开它；使用方走 `types` 与 `default`，指向 `dist`。
- `pnpm test:consumer` 把包打成 tarball，在仓库之外安装、类型检查并运行。
