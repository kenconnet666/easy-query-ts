# 交接：现状与地图

easy-query 的 TypeScript 版。2026-11-01 从 [vue-tsx-pro](https://github.com/kenconnet666/vue-tsx-pro) 的 `packages/easy-query` 带历史迁到本仓库，更早的历史来自 easy-query 仓库的 `ts/`。

## 地图

| 位置                                                                  | 内容                                                                  |
| --------------------------------------------------------------------- | --------------------------------------------------------------------- |
| [README.md](README.md)                                                | 是什么、各个包                                                        |
| [ROADMAP.md](ROADMAP.md)                                              | 阶段与勾选；代码注释里的 `ROADMAP 18.3.2` 这类编号指这里              |
| [RELEASE.md](RELEASE.md)                                              | 发布步骤、怎么构建                                                    |
| `packages/`                                                           | 核心、方言、列类型、缓存、CLI；`packages/test` 是共用夹具与跨方言套件 |
| [docs/decisions/](docs/decisions/0002-ts-design.md)                   | 设计与取舍                                                            |
| [docs/features/](docs/features/README.md)                             | 各特性的说明，内容已改写进文档站；站点部署后删掉（ROADMAP 25.5.1）    |
| [docs/parity.md](docs/parity.md)、`parity-tests.md`、`parity-docs.md` | 对照官方 easy-query 的能力、2249 个用例、文档页；`tools/` 的脚本生成  |
| `infra/dev/`                                                          | 本机的实库容器                                                        |
| `tests/consumer/`                                                     | 发布产物的检查                                                        |

## 上手

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm check
```

实库套件在设了 `EQTS_*` 环境变量时才跑，容器在 WSL Debian 的 Docker 里（compose 项目 `easy-query-ts-dev`，端口 3xxxx，和 `vue-tsx-pro-dev` 错开）：

```bash
# 在仓库根目录执行（wsl 沿用当前目录）
wsl -d Debian -- bash infra/dev/db.sh up -d --wait          # MySQL 8.4、PG 17、Redis 8.2
wsl -d Debian -- bash infra/dev/db.sh --profile hana up -d  # 按需加 HANA 等，见 compose.yaml
```

密码、连接说明与环境变量在不提交的 `.local/db.env`、`.local/connections.md`，首次运行 `db.sh` 时生成。跑之前先 `set -a; . ./.local/db.env; set +a`；
`db.env` 里有所有库的连接串，没启动的库会让它的套件一直等连接，只跑其中几个时单独导出对应的变量（如 `EQTS_PG_URLS`、`EQTS_MYSQL_URLS`）。
本地只跑相关的库，全部方言交给 CI 的 `db`、`db-analytic`、`db-db2`、`db-hana` 任务。

HANA 首次启动要初始化 6～11 分钟（看机器忙不忙），之后带着数据卷启动不到 1 分钟；内存上限 8 GB（镜像里关掉了测试用不到的服务，见 `infra/dev/hana/`）。
`infra/dev/hana/volume.sh save / restore` 把初始化好的数据卷存成约 100 MB 的包，CI 按它做缓存，本机想回到刚初始化的状态时也用它。

## 约定

- 测试分两层：生成的 SQL 在 SQLite 上断言（快、不要库）；语义在 `packages/test/src/suite.ts` 的共用实库套件里跑，每种方言都跑一遍。
- 源码只用可擦除的 TS 语法（`erasableSyntaxOnly`），Node 不经编译直接运行。
- 核心零依赖；驱动都是方言包的 peer 依赖。缓存包不带 Redis 与 MQ 的驱动，只给接口，示例放测试包。
- `vue-tsx-pro` 的 `flow/engine`、`flow-demo`、`fullstack-demo` 依赖 npm 上的版本：破坏性改动发版前先看一眼。

## 文档站

线上：https://easy-query-ts.zerodep.dpdns.org（Cloudflare Workers 静态资源，`apps/docs/wrangler.jsonc`；CI 的 `deploy-docs` 任务上传，要在 GitHub 的 `docs` 环境（只允许 master）里配 `CLOUDFLARE_API_TOKEN`）。

`apps/docs`：`pnpm dev:docs`（端口 5175）。页面是 TSX，用 npm 上的组件库写；示例写在 `*.examples.ts`，由 `build/render-examples.ts` 算出各方言的 SQL 与结果，浏览器里点“运行”走 `src/site/live.ts`。
`pnpm build:docs && pnpm --filter @easy-query-ts/docs test:site`：逐页水合，每张卡片在 PGlite、SQLite WASM 上各跑一遍。

## 下一步

文档站：全文搜索与对账（ROADMAP 25.6）。
