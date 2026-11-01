/** 方言差异：能力写进类型、按版本渲染、各库要注意的地方 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { CodeBlock } from '@zerodep-dev/vue-tsx-pro-ui';
import { DocPage, Note, P, Points, Section, SimpleTable, Sub } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import { limitOffset } from '../query/query.examples.ts';
import { upsert } from '../write/write.examples.ts';
import { salesByProduct } from '../query/advanced.examples.ts';

const capability = `const db = createDb({ schema, adapter: tdengine(connection) });

db.update(Reading);
// 类型错误：Property ''error: this Db does not support'' is missing ... 'Unsupported<"update">'

// 受限的 Db 不能赋给 Db<typeof schema>（默认全部能力）：变量用推出来的类型
function open() {
  return createDb({ schema, adapter: tdengine(connection) });
}
type AppDb = ReturnType<typeof open>;`;

const versions = `// 连上库读出版本：同一份代码部署到哪个版本都选对写法
const db = createDb({ schema, adapter: await mssql.detect(pool) });
const db2 = createDb({ schema, adapter: await mysql.detect(pool) }); // 连上 MariaDB 自动用 MariaDB 的方言
const db3 = createDb({ schema, adapter: await oracle.detect(pool) });

// 手写版本：不连库只看 SQL，或者要锁定基线
const legacy = createDb({ schema, adapter: mssql(pool, { version: 2008 }) });
const polar = createDb({ schema, adapter: mysql(pool, { version: '8.0.18' }) });

// 旧版本做不到的写法，渲染时就报错，不把一条库里才报错的 SQL 发出去：
// STRING_AGG needs sqlserver 2017 or later (the dialect is configured for 2016)`;

const adapters = `// PostgreSQL 系
createDb({ schema, adapter: postgres(new pg.Pool({ connectionString })) });
createDb({ schema, adapter: opengauss(pool) });   // 库按 DBCOMPATIBILITY 'PG' 建
createDb({ schema, adapter: kingbase(pool) });    // 按 PG 模式初始化的金仓

// MySQL 系：连接池设 timezone: 'Z'
createDb({ schema, adapter: mysql(createPool({ uri, timezone: 'Z' })) });
createDb({ schema, adapter: mariadb(pool) });
createDb({ schema, adapter: doris(pool, { replication: 1 }) });

// 其它
createDb({ schema, adapter: oracle(await oracledb.createPool({ ..., sessionCallback: oracleSession })) });
createDb({ schema, adapter: dameng(await dmdb.createPool({ connectString })) });
createDb({ schema, adapter: db2(new ibmdb.Pool(), url) });
createDb({ schema, adapter: clickhouse(createClient({ url, username, password, database })) });
createDb({ schema, adapter: duckdb(await DuckDBInstance.create(':memory:')) });
createDb({ schema, adapter: tdengine(await sqlConnect(conf)) });`;

const edge = `// Cloudflare Worker：D1 没有交互式事务，transaction、lock 在类型上不可调用
export default {
  async fetch(request, env) {
    const db = createDb({ schema, adapter: d1(env.DB) });
    return Response.json(await db.queryable(User).toList());
  },
};

// libSQL / Turso：本地文件库与远端同一个 Client
createDb({ schema, adapter: libsql(createClient({ url, authToken })) });

// Neon：WebSocket 的 Pool 和 pg.Pool 兼容；HTTP 模式没有交互式事务
createDb({ schema, adapter: postgres(new Pool({ connectionString })) });

// bun:sqlite 和 node:sqlite 是同一个适配器
createDb({ schema, adapter: sqlite(new Database(path)) });`;

export default _component(() => () => (
  <DocPage>
    <Section id="same-code" title="同一段代码，不同的 SQL">
      <P text="方言处理了引号、参数、分页、upsert、字符串聚合这些差异。下面几张卡片切换右上角的方言，看差别有多大。" />
      <SqlExample example={limitOffset} title="分页：LIMIT、OFFSET FETCH、ROWNUM" />
      <SqlExample example={upsert} title="upsert：ON CONFLICT、ON DUPLICATE KEY、MERGE" />
      <SqlExample example={salesByProduct} title="导航 join 和聚合" />
    </Section>
    <Section id="capabilities" title="能力写进类型">
      <P text="各库能做的事不一样。方言包的 adapter 带上它支持的能力，`createDb` 把能力挂在类型上，不支持的写法在编辑器里直接标红，不用等到运行。" />
      <CodeBlock code={capability} lang="ts" />
      <SimpleTable
        head={['能力', '管哪些方法', '没有的库']}
        rows={[
          ['`update`', '`db.update`', 'TDengine'],
          ['`transactions`', '`db.transaction`、`db.begin`', 'ClickHouse、Doris、TDengine、D1'],
          ['`lock`', '`db.lock`', 'ClickHouse、Doris、TDengine、D1'],
          ['`forUpdate`', '`forUpdate()`', 'SQLite、ClickHouse、Doris、TDengine'],
          ['`skipLocked`', '`forUpdateSkipLocked()`', '同上，加 DuckDB'],
          ['`noWait`', '`forUpdateNoWait()`', '同上，加 DuckDB、Db2'],
          ['`returning`', '`returning()`', 'MySQL、SQL Server、Oracle、达梦、Db2、HANA 等'],
          ['`generatedKeys`', '`returnId()`', 'ClickHouse、Doris、TDengine'],
          ['`upsert`', '`onConflict()`', 'ClickHouse'],
          ['`upsertIgnore`', '`onConflict().ignore()`', 'Doris、TDengine'],
        ]}
      />
      <Note text="表达式层面的差异（Db2 没有 `jsonLength`、TDengine 没有窗口函数）在渲染时报出，错误信息说明是哪个函数、哪个方言。" />
    </Section>
    <Section id="functions" title="函数和语法的差异">
      <SimpleTable
        head={['写法', 'SQLite', 'MySQL', 'PostgreSQL']}
        rows={[
          ['`eqNullSafe`', '`IS`', '`<=>`', '`IS NOT DISTINCT FROM`'],
          ['`dateTrunc`', '`strftime`', '`DATE_FORMAT` 再 `CAST`', '`DATE_TRUNC`'],
          ['`forUpdateNoWait`', '空操作', '`NOWAIT`', '`NOWAIT`'],
          ['`rollup`', '不支持', '`WITH ROLLUP`', '`ROLLUP(...)`'],
          ['`cube`', '不支持', '不支持', '`CUBE(...)`'],
          ['`returning`', '3.35 起', '不支持', '支持'],
          ['`merge` 的 `onlyIf`', '支持', '不支持', '支持'],
        ]}
      />
    </Section>
    <Section id="versions" title="按版本渲染">
      <P text="方言可以带版本。新版本有更好的写法时用新的；配置成旧版本时退回旧写法；旧版本根本做不到的，渲染时报出最低版本。只有三种情况才分支：旧写法被弃用、旧版本没有这个能力、新旧写法语义或性能差别大。只为好看的不分支，分支越少，没在旧库上实测过的路径越少。" />
      <CodeBlock code={versions} lang="ts" />
      <SimpleTable
        head={['数据库', '版本', '用到的写法', '更早的版本']}
        rows={[
          ['MySQL', '8.0.19', 'upsert 用行别名', '`VALUES(col)`'],
          ['MySQL', '8.0.17', '`JSON_OVERLAPS`、`MEMBER OF`', '报错'],
          [
            'SQL Server',
            '2012',
            '`OFFSET FETCH`、`CONCAT`、`FORMAT`',
            '`ROW_NUMBER` 分页、`+` 拼接',
          ],
          ['SQL Server', '2016', '`DROP TABLE IF EXISTS`、`JSON_VALUE`', '先读结构再删；JSON 报错'],
          ['SQL Server', '2017', '`STRING_AGG`', '`joining` 报错'],
          [
            'SQL Server',
            '2022',
            '`GREATEST`、`LEAST`、`JSON_PATH_EXISTS`',
            '`VALUES` 子查询取最值',
          ],
          ['Oracle', '12.1', '`OFFSET FETCH`、`IDENTITY` 列', '`ROWNUM` 分页；自增列报错'],
          ['Oracle', '19', '`LISTAGG(DISTINCT ...)`', '`joining({ distinct })` 报错'],
          ['Oracle', '21', '`JSON` 列类型', '`CLOB`'],
          ['Oracle', '23', 'SQL 的 `BOOLEAN`、`IF EXISTS`', '`CASE WHEN`、`NUMBER(1)`'],
        ]}
      />
    </Section>
    <Section id="connect" title="连接">
      <P text="驱动是方言包的 peer 依赖，版本由项目自己定。" />
      <CodeBlock code={adapters} lang="ts" />
      <CodeBlock code={edge} lang="ts" title="Serverless 与嵌入式" />
    </Section>
    <Section id="notes" title="各库要注意的地方">
      <Sub id="mysql" title="MySQL 与 MariaDB" />
      <Points
        items={[
          '连接池设 `timezone: "Z"`，日期时间按 UTC 读写。',
          '没有 RETURNING：`returnEntity` 先插入拿主键，再按主键查回。',
          'MariaDB 的 uuid 是原生 `UUID` 类型；`forShare` 是 LOCK IN SHARE MODE；没有 `GROUPING()`。',
          'bigint 参数写成整数字面量：mysql2 把它当带引号的字符串，`BIGINT + "1"` 会按 DOUBLE 运算而丢精度。',
        ]}
      />
      <Sub id="sqlserver" title="SQL Server" />
      <Points
        items={[
          '`OFFSET FETCH` 要有 `ORDER BY`，没有时补 `ORDER BY (SELECT NULL)`。',
          '条件不能直接当值，`select` 里写成 CASE；布尔列当条件写成 `= 1`。',
          '不支持 `returning()`、只读事务、`NTH_VALUE`。递归 CTE 只能 UNION ALL，数据里有环时由 MAXRECURSION 报错。',
          '全文检索用 `MsSql.contains`、`freetext`。',
        ]}
      />
      <Sub id="oracle" title="Oracle 与达梦" />
      <Points
        items={[
          'Oracle 用 `oracledb` 的 Thin 模式；空字符串就是 NULL；没有 TIME 类型，存成文字。',
          'Oracle 的多行插入写成匿名块里的逐行 INSERT，一块最多 500 行。',
          '达梦的方言继承 Oracle，但空字符串不是 NULL，也没有 JSON 类型（存 CLOB），多行插入是多行 VALUES。',
          '达梦：Node 17 起 OpenSSL 3 不认 `dmdb` 的旧算法，连接串加 `?loginEncrypt=false`。建库时把 `LENGTH_IN_CHAR` 设成 1，VARCHAR 按字符算。',
        ]}
      />
      <Sub id="db2" title="Db2" />
      <Points
        items={[
          '驱动 `ibm_db` 要 IBM CLI 驱动，实测环境是 Linux。',
          '字符串列是 `VARCHAR(n CODEUNITS32)`，长度按字符算。',
          '没有 NOWAIT；`jsonLength` 不支持。',
        ]}
      />
      <Sub id="clickhouse" title="ClickHouse、Doris（分析库）" />
      <Points
        items={[
          '没有自增列能取回值：主键由应用给（雪花 ID、UUID）。',
          '没有事务和行锁：`transaction()` 里依次执行，出错不回滚。',
          'ClickHouse 的更新、删除是 mutation（`ALTER TABLE ... UPDATE`），报不出影响的行数，乐观锁不可用；建表是 MergeTree。',
          'Doris 写入同一主键就是整行覆盖，upsert 只支持覆盖全部插入的列；建表用主键模型，索引建成倒排索引。',
        ]}
      />
      <Sub id="tdengine" title="TDengine（时序库）" />
      <Points
        items={[
          '实体的主键必须是一个 `datetime` 列，同一时间戳再写一次就是覆盖。',
          '没有 `update()`，改成按时间戳再插入；没有子查询、窗口函数、行锁、事务。',
        ]}
      />
      <Sub id="duckdb" title="DuckDB" />
      <Points
        items={[
          'SQL 接近 PG；自增列建成序列加 `nextval`。',
          '单写者、乐观并发：没有行锁和保存点，嵌套事务渲染时报错；外键只能写在建表语句里。',
        ]}
      />
      <Sub id="pg-compatible" title="openGauss 与人大金仓" />
      <Points
        items={[
          'openGauss 按 PG 兼容建库：默认的 Oracle 兼容里空字符串是 NULL、DATE 带时分秒。',
          'openGauss 没有 `IDENTITY`，自增列是 SERIAL；upsert 写成 ON DUPLICATE KEY UPDATE。',
          '金仓按 PG 模式初始化时语法和 PG 一致；Oracle 模式请按 Oracle 的写法评估。',
        ]}
      />
      <Sub id="embedded" title="SQLite、PGlite、D1" />
      <Points
        items={[
          'SQLite 大整数：`sqlite(db, { bigInts: true })`；`bun:sqlite` 在打开库时传 `safeIntegers: true`。',
          'PGlite 只有一条连接，事务进行中其它语句排在后面；两个事务互相等锁（NOWAIT、SKIP LOCKED）的写法会卡住。',
          'D1 没有 BEGIN，`save`、`syncTables`、迁移依次执行，出错不回滚；要原子写入用 `env.DB.batch()`。',
        ]}
      />
    </Section>
  </DocPage>
));
