/** 支持的数据库 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { CodeBlock } from '@zerodep-dev/vue-tsx-pro-ui';
import { DocPage, Note, P, Section, SimpleTable } from '../../site/content';

const detect = `import { createPool } from 'mysql2/promise';
import { mysql } from '@zerodep-dev/easy-query-ts-mysql';

// 连上库读出服务器版本再建 adapter：同一份代码部署到 8.0.18 还是 8.4，写法自动选
export const db = createDb({
  schema,
  adapter: await mysql.detect(createPool({ uri: process.env.DATABASE_URL })),
});`;

const serverless = `import { PGlite } from '@electric-sql/pglite';
import { pglite } from '@zerodep-dev/easy-query-ts-pg/pglite';

// WASM 版 PostgreSQL：跑在进程里，单测、浏览器、边缘函数都不用起数据库。本站的“运行”按钮就是它
const db = createDb({ schema, adapter: pglite(new PGlite()) });`;

export default _component(() => () => (
  <DocPage>
    <Section id="matrix" title="方言包">
      <P text="驱动是方言包的 peer 依赖，版本由项目自己定。除人大金仓外，每种方言都在 CI 上用“实测”一列的版本跑同一套实库测试；“说明”里更早的版本按写法支持，没有实测。" />
      <SimpleTable
        head={['数据库', '包', '驱动', '实测', '说明']}
        rows={[
          ['PostgreSQL', '`-pg`', '`pg`', '17', 'PG 12 起；也支持 PGlite、Neon'],
          ['openGauss', '`-pg`', '`pg`', '7.0', '`opengauss(pool)`'],
          [
            '人大金仓',
            '`-pg`',
            '`pg`',
            '无',
            '`kingbase(pool)`：PG 模式与 PG 同一套写法；公开镜像的许可证都已过期，没有实测',
          ],
          [
            'MySQL',
            '`-mysql`',
            '`mysql2`',
            '8.0.18',
            '8.0.18（PolarDB）起，`mysql.detect` 按版本选写法',
          ],
          ['MariaDB', '`-mysql`', '`mysql2`', '11.4', '`mariadb(pool)`'],
          ['Doris', '`-mysql`', '`mysql2`', '4.1', '`doris(pool)`'],
          [
            'SQLite',
            '`-sqlite`',
            'Node 自带',
            '`node:sqlite`',
            '`node:sqlite`、`bun:sqlite`、Cloudflare D1、libSQL / Turso',
          ],
          ['SQL Server', '`-mssql`', '`mssql`', '2022', '2008 起，旧版本按 ROW_NUMBER 分页'],
          ['Oracle', '`-oracle`', '`oracledb`', '23ai', 'Thin 模式，12c 之前按 ROWNUM 分页'],
          ['达梦', '`-dameng`', '`dmdb`', 'DM8', 'DM8'],
          ['Db2', '`-db2`', '`ibm_db`', '12.1', '12.1'],
          ['SAP HANA', '`-hana`', '`hdb`', '2.0 SPS08', '2.0'],
          [
            'ClickHouse',
            '`-clickhouse`',
            '`@clickhouse/client`',
            '25.8',
            '没有自增和事务，主键由应用给值',
          ],
          ['DuckDB', '`-duckdb`', '`@duckdb/node-api`', '1.5', '嵌入式，序列自增'],
          ['TDengine', '`-tdengine`', '`@tdengine/websocket`', '3.3', '时序库'],
        ]}
      />
      <Note text="包名都以 `@zerodep-dev/easy-query-ts` 开头。H2 跑在 JVM 里，Node 没有驱动，不支持。最低版本怎么提高见仓库的 RELEASE.md。" />
    </Section>
    <Section id="detect" title="一套代码部署到不同版本">
      <P text="方言按版本选写法：低于某个特性的最低版本时退回旧写法，没有旧写法就报错并说明要哪个版本。" />
      <CodeBlock code={detect} lang="ts" title="db.ts" />
    </Section>
    <Section id="serverless" title="嵌入式与 Serverless">
      <CodeBlock code={serverless} lang="ts" />
    </Section>
  </DocPage>
));
