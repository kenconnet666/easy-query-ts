/** 方言专属函数：Pg、MySQL、MsSql、Hana 四个入口的完整列表，别的库怎么办，自己怎么加 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { CodeBlock } from '@zerodep-dev/vue-tsx-pro-ui';
import { DocPage, Note, P, Points, Section, SimpleTable } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import {
  arrayHas,
  arrayHasAll,
  arrayHasAny,
  arrayLength,
  fulltextChinese,
  fulltextConfig,
  fulltextMatches,
  fulltextOrNot,
  fulltextRank,
  jsonbContainedBy,
  jsonbContains,
  jsonbHasAllKeys,
  jsonbHasAnyKey,
  jsonbHasKey,
  jsonbInAny,
  jsonbPathExists,
  jsonbPathMatch,
  jsonbThroughJoin,
} from './pg.examples.ts';
import {
  hanaColumns,
  hanaContains,
  hanaFuzzy,
  hanaScore,
  mssqlContains,
  mssqlDataLength,
  mssqlFreetext,
  mssqlInSelect,
  mysqlContains,
  mysqlContainsAllPaths,
  mysqlContainsAt,
  mysqlContainsPath,
  mysqlHasMember,
  mysqlHasMemberAt,
  mysqlMatch,
  mysqlMatchBoolean,
  mysqlMatchColumns,
  mysqlMatchExpansion,
  mysqlOverlaps,
  mysqlScore,
} from './vendor.examples.ts';

const imports = `import { Pg } from '@zerodep-dev/easy-query-ts-pg';
import { MySQL } from '@zerodep-dev/easy-query-ts-mysql';
import { MsSql } from '@zerodep-dev/easy-query-ts-mssql';
import { Hana } from '@zerodep-dev/easy-query-ts-hana';

// 用 PGlite、没有装 pg 驱动时
import { Pg } from '@zerodep-dev/easy-query-ts-pg/pglite';`;

const arrayColumn = `const Article = entity('t_article', {
  id: col.bigint().primaryKey().generated(),
  tags: col.array(col.string(30)), // VARCHAR(30)[]，JS 里是 string[]
});

db.queryable(Article).where((a) => [
  a.tags.has('sql'),             // $1 = ANY(tags)
  a.tags.hasAll(['sql', 'orm']), // tags @> $1
  a.tags.hasAny(['sql', 'orm']), // tags && $1
  a.tags.arrayLength().gt(1),    // cardinality(tags) > $1
]);`;

const fragment = `import { sql } from '@zerodep-dev/easy-query-ts';

// 一次性的写法：列和参数照样绑定，泛型给出结果类型
db.queryable(Post)
  .where((p) => sql<boolean>\`REGEXP_LIKE(\${p.title}, \${pattern})\`)
  .select((p) => ({ size: sql<number>\`LENGTHB(\${p.title})\` }));`;

const custom = `import { codecs, createDb, dialectFn, type Expr, type FunctionRenderer } from '@zerodep-dev/easy-query-ts';
import { postgres, PostgresDialect } from '@zerodep-dev/easy-query-ts-pg';

// 1. 在方言的函数表里登记写法：a 是已经渲染好的参数
class MyDialect extends PostgresDialect {
  protected override functions(): Record<string, FunctionRenderer> {
    return {
      ...super.functions(),
      'my.similarity': (a) => \`similarity(\${a[0]}, \${a[1]})\`,
    };
  }
}

// 2. 写一个构造表达式的函数：名字对上函数表，codec 决定结果怎么解码
const similarity = (column: Expr<string | null>, text: string) =>
  dialectFn<number>('my.similarity', [column, text], codecs.double);

// 3. 换上这个方言，之后和内置函数一样用
const db = createDb({ schema, adapter: { ...postgres(pool), dialect: new MyDialect() } });
db.queryable(Post).orderBy((p) => similarity(p.title, '缓存').desc());`;

export default _component(() => () => (
  <DocPage>
    <Section id="how" title="怎么用">
      <P text="只有某个库才有的能力，从这个库的方言包取入口，包住列，得到的还是条件或表达式，能写在 `where`、`select`、`orderBy` 里，也能经导航、在 `any` 里用。" />
      <CodeBlock code={imports} lang="ts" title="入口" />
      <SimpleTable
        head={['入口', '方法', '方言包']}
        rows={[
          [
            '`Pg.jsonb(列)`',
            '`contains`、`containedBy`、`hasKey`、`hasAnyKey`、`hasAllKeys`、`pathExists`、`pathMatch`',
            '`easy-query-ts-pg`',
          ],
          ['`Pg.array(表达式)`', '`has`、`hasAll`、`hasAny`、`length`', '`easy-query-ts-pg`'],
          ['`Pg.fulltext(列, 配置?)`', '`matches`、`rank`', '`easy-query-ts-pg`'],
          [
            '`MySQL.json(列)`',
            '`contains`、`overlaps`、`hasMember`、`containsPath`、`containsAllPaths`',
            '`easy-query-ts-mysql`',
          ],
          ['`MySQL.match(...列)`', '`against`、`score`', '`easy-query-ts-mysql`'],
          ['`MsSql`', '`contains`、`freetext`、`dataLength`', '`easy-query-ts-mssql`'],
          ['`Hana.text(...列)`', '`contains`、`fuzzy`、`score`', '`easy-query-ts-hana`'],
        ]}
      />
      <Points
        items={[
          '这一页的卡片固定在自己的方言上，不跟着全站的方言切换。PostgreSQL 的卡片能在浏览器里运行；别的库文档站连不上，只看 SQL。',
          "用到别的方言上，生成 SQL 时报错，说明是哪个函数、哪个方言：`function 'mysql.json_contains' is not supported by the postgres dialect`。TS 构造表达式时还不知道方言，所以检查放在渲染。",
          'JSON 文档、JSONPath、全文查询串都是库自己解析的文字，写错了由库报错，这里不检查。',
        ]}
      />
    </Section>

    <Section id="pg-jsonb" title="PostgreSQL：JSONB">
      <P text="示例模型的 `Profile.skills` 是字符串数组。列不是 JSONB 也能用：渲染时转成 `::jsonb`，但只有表达式索引能接上。" />
      <SimpleTable
        head={['方法', 'SQL', '含义']}
        rows={[
          ['`contains(文档)`', '`列 @> 文档`', '包含这段 JSON'],
          ['`containedBy(文档)`', '`列 <@ 文档`', '被这段 JSON 包含'],
          ['`hasKey(键)`', '`jsonb_exists(列, 键)`', '有这个键，或字符串数组里有这个元素'],
          ['`hasAnyKey(...键)`', '`jsonb_exists_any(列, ARRAY[…])`', '至少有一个'],
          ['`hasAllKeys(...键)`', '`jsonb_exists_all(列, ARRAY[…])`', '全都有'],
          ['`pathExists(路径)`', '`jsonb_path_exists(列, 路径)`', 'JSONPath 找得到值，要 PG 12'],
          ['`pathMatch(谓词)`', '`列 @@ 谓词`', 'JSONPath 谓词为真，要 PG 12'],
        ]}
      />
      <SqlExample example={jsonbContains} title="contains：会 Vue 的人" />
      <SqlExample example={jsonbContainedBy} title="containedBy：技能都在这个范围里" />
      <SqlExample example={jsonbHasKey} title="hasKey：字符串数组里有这个元素" />
      <SqlExample example={jsonbHasAnyKey} title="hasAnyKey：会其中之一" />
      <SqlExample example={jsonbHasAllKeys} title="hasAllKeys：两个都会" />
      <SqlExample example={jsonbPathExists} title="pathExists：JSONPath 过滤" />
      <SqlExample example={jsonbPathMatch} title="pathMatch：至少三个技能" />
      <SqlExample example={jsonbThroughJoin} title="经导航用：隐式 join 照常生成" />
      <SqlExample example={jsonbInAny} title="在 any 里用：隐式子查询" />
      <Note text="没有 `?` 运算符：它和占位符混淆，所以写成等价的 `jsonb_exists`。这个函数走不了 GIN 索引；数据量大、要走索引时用 `contains`。" />
    </Section>

    <Section id="pg-array" title="PostgreSQL：数组">
      <P text="`Pg.array` 接任意数组表达式，比如 `sql` 片段算出来的数组。这里把标题按空格拆成词。" />
      <SimpleTable
        head={['方法', 'SQL', '含义']}
        rows={[
          ['`has(值)`', '`值 = ANY(数组)`', '含有这个值'],
          ['`hasAll(...值)`', '`值 = ANY(数组) AND …`', '都含有'],
          ['`hasAny(...值)`', '`值 = ANY(数组) OR …`', '含有其中之一'],
          ['`length()`', '`cardinality(数组)`', '元素个数'],
        ]}
      />
      <SqlExample example={arrayHas} title="has" />
      <SqlExample example={arrayHasAll} title="hasAll" />
      <SqlExample example={arrayHasAny} title="hasAny" />
      <SqlExample example={arrayLength} title="length：放进结果" />
      <P text="数组列不用这个入口：`col.array` 声明的列自己就有这些方法，类型跟着元素走，`hasAll`、`hasAny` 用的是能走 GIN 索引的 `@>`、`&&`。" />
      <CodeBlock code={arrayColumn} lang="ts" title="数组列" />
    </Section>

    <Section id="pg-fulltext" title="PostgreSQL：全文检索">
      <P text="`Pg.fulltext(列, 配置)` 的配置默认 `simple`：只按空白和标点切词，不做词干。要走索引，表达式索引的配置得和这里一样。配置名写进 SQL，只接受标识符。" />
      <SimpleTable
        head={['方法', 'SQL', '含义']}
        rows={[
          [
            '`matches(查询)`',
            '`to_tsvector(配置, 列) @@ websearch_to_tsquery(配置, 查询)`',
            '查询串像搜索引擎：`a b`、`"a b"`、`a or b`、`-a`',
          ],
          ['`rank(查询)`', '`ts_rank(…)`', '相关度，放进 `select`、`orderBy`'],
        ]}
      />
      <SqlExample example={fulltextMatches} title="matches：按词匹配，不分大小写" />
      <SqlExample example={fulltextOrNot} title="or 和排除" />
      <SqlExample example={fulltextRank} title="rank：按相关度排序" />
      <SqlExample
        example={fulltextConfig}
        title="换配置：english 会还原词形，joins 也能找到 join"
      />
      <SqlExample example={fulltextChinese} title="中文：simple 不会切词" />
      <Note text="`simple`、`english` 都不会切中文：连着的汉字是一个词，搜“入门”找不到“窗口函数入门”。中文全文检索要在库里装 zhparser、pg_jieba 这类扩展，再把它们的配置名传进来。" />
    </Section>

    <Section id="mysql-json" title="MySQL：JSON">
      <SimpleTable
        head={['方法', 'SQL', '含义']}
        rows={[
          [
            '`contains(文档, 路径?)`',
            '`JSON_CONTAINS(列, 文档[, 路径])`',
            '文档是 JSON 文字，字符串要带引号：`\'"Vue"\'`',
          ],
          ['`overlaps(文档)`', '`JSON_OVERLAPS(列, 文档)`', '有共同的元素或键值对，要 8.0.17'],
          [
            '`hasMember(值, 路径?)`',
            '`值 MEMBER OF(列)`',
            '数组含有这个值，要 8.0.17；多值索引能接上',
          ],
          ['`containsPath(...路径)`', "`JSON_CONTAINS_PATH(列, 'one', …)`", '至少一个路径存在'],
          ['`containsAllPaths(...路径)`', "`JSON_CONTAINS_PATH(列, 'all', …)`", '所有路径都存在'],
        ]}
      />
      <SqlExample example={mysqlContains} title="contains" />
      <SqlExample example={mysqlContainsAt} title="contains：只看某个路径" />
      <SqlExample example={mysqlOverlaps} title="overlaps" />
      <SqlExample example={mysqlHasMember} title="hasMember" />
      <SqlExample example={mysqlHasMemberAt} title="hasMember：路径处的数组" />
      <SqlExample example={mysqlContainsPath} title="containsPath：有第三或第四个技能" />
      <SqlExample example={mysqlContainsAllPaths} title="containsAllPaths：至少两个技能" />
      <Note text="方言配置的版本低于要求时，渲染时报出最低版本：`JSON_OVERLAPS needs mysql 8.0.17 or later`。" />
    </Section>

    <Section id="mysql-match" title="MySQL：全文检索">
      <P text="`MySQL.match(...列)` 的列要和某个 FULLTEXT 索引的列完全一致；中文要在建索引时指定 ngram 解析器。第二个参数是模式。" />
      <SimpleTable
        head={['方法', 'SQL']}
        rows={[
          ['`against(词, 模式?)`', '`MATCH(列) AGAINST(词 IN NATURAL LANGUAGE MODE)`'],
          ["`against(词, 'boolean')`", '`… IN BOOLEAN MODE`：`+必须 -排除 前缀*`'],
          ["`against(词, 'expansion')`", '`… WITH QUERY EXPANSION`：相关词再查一遍'],
          ['`score(词, 模式?)`', '同上，当值用：相关度'],
        ]}
      />
      <SqlExample example={mysqlMatch} title="against" />
      <SqlExample example={mysqlMatchColumns} title="多列" />
      <SqlExample example={mysqlMatchBoolean} title="布尔模式" />
      <SqlExample example={mysqlMatchExpansion} title="查询扩展" />
      <SqlExample example={mysqlScore} title="score：按相关度排序" />
    </Section>

    <Section id="mssql" title="SQL Server">
      <SimpleTable
        head={['方法', 'SQL', '含义']}
        rows={[
          [
            '`MsSql.contains(列, 查询)`',
            '`CONTAINS(列, 查询)`',
            '全文查询语法：`"orm*"`、`NEAR`，要有全文索引',
          ],
          ['`MsSql.freetext(列, 文字)`', '`FREETEXT(列, 文字)`', '按意思匹配，要有全文索引'],
          ['`MsSql.dataLength(列)`', '`DATALENGTH(列)`', '字节数，含尾部空格，`LEN` 不含'],
        ]}
      />
      <SqlExample example={mssqlContains} title="contains" />
      <SqlExample example={mssqlFreetext} title="freetext" />
      <SqlExample
        example={mssqlInSelect}
        title="放进结果：SQL Server 的条件不能当值，自动写成 CASE WHEN"
      />
      <SqlExample example={mssqlDataLength} title="dataLength" />
    </Section>

    <Section id="hana" title="SAP HANA">
      <P text="列上要有 FULLTEXT INDEX，否则 `CONTAINS` 按整列值匹配。" />
      <SimpleTable
        head={['方法', 'SQL', '含义']}
        rows={[
          [
            '`contains(查询)`',
            '`CONTAINS(列, 查询)`',
            'EXACT：按词，支持 `"短语"`、`OR`、`-排除`、`*`',
          ],
          [
            '`fuzzy(查询, 阈值)`',
            '`CONTAINS(列, 查询, FUZZY(阈值))`',
            '容错匹配，阈值 0 到 1，写进 SQL',
          ],
          ['`score()`', '`SCORE()`', '本查询里 `CONTAINS` 的相关度'],
        ]}
      />
      <SqlExample example={hanaContains} title="contains" />
      <SqlExample example={hanaColumns} title="多列" />
      <SqlExample example={hanaFuzzy} title="fuzzy：拼错了也能找到" />
      <SqlExample example={hanaScore} title="score：按相关度排序" />
      <Note text="`contains`、`fuzzy` 是条件，写在 `where` 里；要把相关度放进结果用 `score`。" />
    </Section>

    <Section id="compatible" title="兼容的库">
      <P text="协议兼容的库继承方言，入口也能用，但库不一定都有对应的函数。下面是在真实容器上核对过的差别：库没有的函数渲染时就报错，不用等到发给库。" />
      <SimpleTable
        head={['库', '入口', '差别']}
        rows={[
          [
            'MariaDB 11.4',
            '`MySQL`',
            '没有 `MEMBER OF`：`hasMember` 报不支持。其余 JSON 函数和全文检索都有',
          ],
          [
            'openGauss 7.0',
            '`Pg`',
            '没有 `websearch_to_tsquery`：`Pg.fulltext` 报不支持。`Pg.array().length()` 换成 `array_length`。JSONPath 只认它自己的路径写法，`pathMatch` 的谓词语法用不了',
          ],
          ['KingbaseES（PG 模式）', '`Pg`', '方言与 PostgreSQL 相同；这些函数没有单独核对过'],
          [
            'Apache Doris',
            '`MySQL`',
            '方言继承 MySQL；这些函数没有单独核对过，全文检索 Doris 有自己的语法，用 `sql` 片段',
          ],
        ]}
      />
    </Section>

    <Section id="others" title="别的库">
      <P text="Oracle、达梦、Db2、ClickHouse、DuckDB、SQLite、TDengine 没有专属入口。库里有、这里没有的函数用 `sql` 片段，见“原生 SQL”。" />
      <CodeBlock code={fragment} lang="ts" title="sql 片段" />
      <P text="写在列上的通用函数大多各库都有，下面几个例外，没有的库渲染时报错。这张表没有核对 TDengine。" />
      <SimpleTable
        head={['函数', '能用的库', '不能用的库']}
        rows={[
          [
            '`matches`（正则）',
            'PostgreSQL 系、MySQL、MariaDB、Doris、Oracle、达梦、DuckDB',
            'SQLite、SQL Server、Db2、HANA、ClickHouse',
          ],
          [
            '`jsonSome`、`jsonSet`、`jsonRemove`、`jsonMerge`、`jsonAppend`',
            'PostgreSQL 系、MySQL、MariaDB、Doris、SQLite',
            'SQL Server、Oracle、达梦、Db2、HANA、ClickHouse、DuckDB',
          ],
          ['`col.array` 的列方法', 'PostgreSQL 系', '其余都不能，改用 `col.json<T[]>()`'],
          ['`jsonLength`', '除 Db2 外都能', 'Db2'],
          ['`dateTrunc`', '除 HANA 外都能', 'HANA'],
        ]}
      />
    </Section>

    <Section id="custom" title="写自己的方言函数">
      <P text="内置入口怎么做的，自己就怎么做：在方言子类的函数表里登记写法，再用 `dialectFn` 构造表达式。一次性的写法用 `sql` 片段就够了，要在很多地方用、想要类型时才写成函数。" />
      <CodeBlock code={custom} lang="ts" title="自己加一个函数" />
      <Points
        items={[
          '名字带上前缀（`my.`）：没登记过的方言渲染时报不支持，不会悄悄发错的 SQL。',
          '`a` 里的参数已经渲染好了：列是列名，值是占位符，别自己拼字符串。',
          '返回布尔的函数传 `codecs.boolean`，结果就是 `Pred`，能直接写在 `where` 里。SQL Server、达梦这类条件不能当值的库，还要在方言的 `conditionFunctions()` 里登记：`where` 里才不会多写 `= 1`，`select` 里才会写成 CASE WHEN。',
        ]}
      />
    </Section>
  </DocPage>
));
