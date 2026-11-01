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
| [docs/features/](docs/features/README.md)                             | 各特性的说明，文档站做好后改写进去                                    |
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
wsl -d Debian -- bash -lc 'cd /mnt/c/Users/lionheart/IdeaProjects/easy-query-ts && bash infra/dev/db.sh up -d --wait'   # MySQL 8.4、PG 17、Redis 8.2
wsl -d Debian -- bash -lc 'cd /mnt/c/Users/lionheart/IdeaProjects/easy-query-ts && bash infra/dev/db.sh --profile hana up -d'   # 按需加 HANA 等，见 compose.yaml
```

密码、连接说明与环境变量在不提交的 `.local/db.env`、`.local/connections.md`，首次运行 `db.sh` 时生成。跑之前先 `set -a; . ./.local/db.env; set +a`。
本地只跑相关的库，全部方言交给 CI 的 `db`、`db-analytic`、`db-db2` 任务；HANA 不在 CI，本机跑。

## 约定

- 测试分两层：生成的 SQL 在 SQLite 上断言（快、不要库）；语义在 `packages/test/src/suite.ts` 的共用实库套件里跑，每种方言都跑一遍。
- 源码只用可擦除的 TS 语法（`erasableSyntaxOnly`），Node 不经编译直接运行。
- 核心零依赖；驱动都是方言包的 peer 依赖。缓存包不带 Redis 与 MQ 的驱动，只给接口，示例放测试包。
- `vue-tsx-pro` 的 `flow/engine`、`flow-demo`、`fullstack-demo` 依赖 npm 上的版本：破坏性改动发版前先看一眼。

## 下一步

文档站（ROADMAP 阶段 24）：用组件库写，不用 Markdown；代码卡片显示生成的 SQL、可切方言、默认 PostgreSQL。
