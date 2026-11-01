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
2. **确认 CI**：要发布的提交在 `master` 上，GitHub Actions 全部通过（check、test、consumer、db、db-analytic、db-db2）。
3. **发布**（`-r` 按依赖顺序先发核心；`prepack` 会先构建）：

   ```bash
   pnpm install --frozen-lockfile
   pnpm -r publish --access public --no-git-checks
   ```

4. **打标签**：`git tag -a v0.2.0 -m "0.2.0"`，`git push origin v0.2.0`；在 GitHub 上用这个标签建 Release。

## 怎么构建

开发和测试直接跑 `src` 里的 `.ts`（Node 24 类型剥离），不需要先构建；发布时才产出 `dist`。

- 每个包有 `tsconfig.build.json`（继承根目录的 `tsconfig.build.base.json`），用 TypeScript 项目引用（`composite`）：依赖核心包的包在构建时读取核心产出的 `.d.ts`。
- 源码里的相对导入写 `.ts`（Node 直接运行需要），构建时由 `rewriteRelativeImportExtensions` 改成 `.js`。
- `exports` 的 `@easy-query-ts/source` 条件指向源码，只有本仓库的 Node 进程（`pnpm-workspace.yaml` 的 `nodeOptions`）与 `tsconfig.json` 打开它；使用方走 `types` 与 `default`，指向 `dist`。
- `pnpm test:consumer` 把包打成 tarball，在仓库之外安装、类型检查并运行。
