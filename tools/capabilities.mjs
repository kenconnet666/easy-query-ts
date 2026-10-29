/**
 * 对照清单的能力表（ROADMAP 16.1）：官方用例归到哪种能力（按文件、按方法体里的 API），以及 TS 侧的状态与对应的实现、测试。
 * 状态：done 已对应｜different 写法不同（效果一致，按 TS 的写法）｜todo 待做｜na 不适用（写明理由）。
 * 做完一种能力就改这里的状态与 ts 说明，再运行 parity-tests.mjs 重新生成清单。
 */

/** 按文件归类：方言目录、分片、缓存等整文件都是同一种能力 */
export const fileRules = [
  [/^sharding\/|Sharding(Base)?Test\.java$/, 'sharding'],
  [/^cache\//, 'cache'],
  [/^search\//, 'search'],
  [/^migration\/|MigrationTest\.java$/, 'codeFirst'],
  [/^mssqlrownumber\//, 'dialect.mssql2008'],
  [/^mssql\//, 'dialect.mssql'],
  [/^dameng\//, 'dialect.dameng'],
  [/^kingbase\//, 'dialect.kingbase'],
  [/^duckdb\//, 'dialect.duckdb'],
  [/^click\//, 'dialect.clickhouse'],
  [/^h2\//, 'dialect.h2'],
  [/Encryption|^encryption\//, 'column.encryption'],
  [/LogicDelete|^logicdel\//, 'logicDelete'],
  [/VersionTest|^version\//, 'version'],
  [/Interceptor|^interceptor\//, 'interceptor'],
  [/TrackTest|^eqdiff\//, 'tracking'],
  [/^increment\//, 'column.generated'],
  [/^conversion\/|^enums\//, 'column.converter'],
];

/** 按方法体里的 API 归类，越靠前越具体 */
export const rules = [
  [/\.savable\(/, 'save.aggregate'],
  [/syncTableCommand|getDatabaseCodeFirst|createTableCommand/, 'codeFirst'],
  [/asTracking|TrackManager|addTracking/, 'tracking'],
  [/mapQueryable/, 'query.map'],
  [/asTableLink/, 'table.link'],
  [/\.asSchema\(/, 'table.schema'],
  [/\.flatElement\(|\.elements\(/, 'nav.flat'],
  [/subQueryToGroupJoin/, 'nav.groupJoin'],
  [/selectAutoInclude/, 'dto.autoInclude'],
  [/whereObject|orderByObject|filterConfigure/, 'dto.object'],
  [/toTreeList|asTreeCTE/, 'tree'],
  [/fillMany|fillOne/, 'fill'],
  [/\.include\(|\.includes\(/, 'nav.include'],
  [/\.joining\(/, 'func.joining'],
  [/partitionBy|rowNumberOver|\.lag\(|\.lead\(|firstValue|lastValue|nthValue|\.offset\(/, 'window'],
  [/caseWhen\(/, 'expr.case'],
  [/toCteAs|withCte/, 'query.cte'],
  [/\.union\(|\.unionAll\(/, 'query.union'],
  [/sqlNativeSegment|sqlSegment|sqlQuery|executeSQL|sqlQueryMap|toResultSet/, 'sql.native'],
  [/forUpdate|forShare|NoWait|SkipLocked/, 'lock'],
  [/onConflictThen|insertOrUpdate/, 'write.upsert'],
  [/\.insertable\(/, 'write.insert'],
  [/\.updatable\(/, 'write.update'],
  [/\.deletable\(/, 'write.delete'],
  [/JsonObject|jsonObject|JSONObject|JSONArray|jsonArray|toJSON/i, 'func.json'],
  [
    /plus(Days|Months|Years|Hours|Minutes|Seconds|Weeks)|duration\(|toDays|toHours|toMinutes|toSeconds|dayOfWeek|dayOfYear|\.format\(|\.now\(\)|utcNow/,
    'func.date',
  ],
  [
    /subString|leftPad|rightPad|ltrim|rtrim|toLower|toUpper|stringFormat|nullEmpty|compareTo|\.trim\(|\.replace\(|\.indexOf\(|\.length\(\)/,
    'func.string',
  ],
  [
    /\.abs\(|ceiling|\.floor\(|\.round\(|power|sqrt|\.sign\(|\.log\(|\.exp\(|truncate|\.mod\(/,
    'func.math',
  ],
  [/maxColumns|minColumns|nullOrDefault|equalsWith/, 'func.general'],
  [/toPageResult|toShardingPageResult/, 'query.page'],
  [/groupBy\(|having\(/, 'query.group'],
  [/leftJoin|rightJoin|innerJoin|crossJoin|fullJoin/, 'query.join'],
  [/streamBy|toChunk|toStreamResult|\.stream\(/, 'query.stream'],
  [/\.toMap\(|\.toMaps\(/, 'query.map'],
  [/cloneQueryable/, 'query.reuse'],
  [/\.asTable\(/, 'table.rename'],
  [/\.(any|none|count|sum|max|min|avg)\(/, 'nav.subquery'],
];

/** 能力 → TS 侧的状态与说明 */
export const capabilities = {
  'query.basic': {
    title: '基本查询（条件、排序、选列、分页）',
    status: 'done',
    ts: 'query.ts；test/src/suite.ts queries、sqlite.sql.test.ts',
  },
  'query.group': {
    title: '分组与 having',
    status: 'done',
    ts: 'groupBy / having / rollup / cube；suite.ts',
  },
  'query.page': {
    title: '分页结果',
    status: 'done',
    ts: 'toPage、table()；suite.ts、table.test.ts',
  },
  'query.join': {
    title: '显式 join（含 merge 写法）',
    status: 'done',
    ts: 'innerJoin / leftJoin / rightJoin / crossJoin，lambda 按顺序收到各表；suite.ts explicit joins',
  },
  'query.union': { title: 'union / union all', status: 'done', ts: 'union / unionAll；suite.ts' },
  'query.cte': { title: 'CTE', status: 'done', ts: 'db.with / withRecursive；suite.ts' },
  'query.stream': { title: '流式读取', status: 'done', ts: 'stream()；suite.ts streaming' },
  'query.map': {
    title: '无实体的 Map 查询、toMap',
    status: 'different',
    ts: "不在 schema 里的实体直接查：db.queryable(entity('t_x', {...}))（带类型）；无实体、按列名取的 Map 结果用 db.sql；行本来就是普通对象（toMap）；adhoc.test.ts",
  },
  'query.reuse': {
    title: '复用查询（cloneQueryable）',
    status: 'different',
    ts: '查询对象不可变，直接复用',
  },
  'table.rename': {
    title: '换表名（asTable）',
    status: 'different',
    ts: 'db.mapTables；suite.ts table mapping',
  },
  'table.schema': {
    title: '换 schema（asSchema）',
    status: 'different',
    ts: 'db.inSchema；sqlite.tenant.test.ts',
  },
  'table.link': {
    title: '跨库链接（asTableLink）',
    status: 'done',
    ts: 'db.withTableLink(link, only?)，表名渲染成 "t"@link；adhoc.test.ts',
  },
  'nav.relation': {
    title: '导航关系与隐式 join',
    status: 'done',
    ts: 'r.one / many / manyToMany（复合键、无中间表按共同列）、r.manyOn / oneOn 任意条件（逗号分隔列 inCsv、路径左匹配）、required、关系上的拦截器开关；relations.test.ts、relation-on.test.ts、relation-options.test.ts',
  },
  'nav.subquery': {
    title: '隐式子查询（any / none / count / sum …）',
    status: 'done',
    ts: 'ManyRef；suite.ts、relation-filter.test.ts',
  },
  'nav.include': {
    title: 'include 带出导航',
    status: 'done',
    ts: 'include()、select 里的 toList；suite.ts',
  },
  'nav.flat': {
    title: '一对多展开（flatElement / elements）',
    status: 'different',
    ts: 'flatElement 在条件里是 any(…)、select 里是 toList(p => p.x)、多层是 r.path；element / firstElement 是 at(i)，另有 all、countDistinct；suite.ts implicit subqueries',
  },
  'nav.groupJoin': {
    title: '隐式子查询改分组 join',
    status: 'done',
    ts: 'groupJoin()；group-join.test.ts',
  },
  'dto.autoInclude': {
    title: '按 DTO 自动带出（selectAutoInclude）',
    status: 'different',
    ts: 'defineView + select(View)；suite.ts views',
  },
  'dto.object': {
    title: '按对象筛选排序（whereObject / orderByObject）',
    status: 'done',
    ts: 'filterBy(input, rules)（同名列直接写比较方式，{ op, column } 多列任一满足、经过导航，没填的跳过）、sortBy(sort, 白名单)、table(request, { filterable, sortable })；filter-by.test.ts、table.test.ts',
  },
  tree: {
    title: '树（toTreeList / asTreeCTE）',
    status: 'done',
    ts: 'toTree、descendantsOf / ancestorsOf；tree.test.ts',
  },
  fill: { title: '按键填充（fillMany / fillOne）', status: 'done', ts: 'fill.test.ts' },
  'func.joining': {
    title: '字符串聚合（joining）',
    status: 'done',
    ts: 'g.joining / u.posts.joining / groupJoin().joining；suite.ts function library',
  },
  'func.date': {
    title: '日期函数',
    status: 'done',
    ts: 'format、add / addYears / addHours …（数量可以是列）、hour / minute / second、dayOfYear、dayOfWeek、isoDayOfWeek、diff、now；suite.ts function library',
  },
  'func.string': {
    title: '字符串函数',
    status: 'done',
    ts: 'ltrim / rtrim、padStart / padEnd、text 模板、compare、notStartsWith / notEndsWith（nullEmpty 用 orElse）；suite.ts function library',
  },
  'func.math': {
    title: '数学函数',
    status: 'done',
    ts: 'sign、power、sqrt、exp、ln、log10、log、三角函数、truncate；suite.ts function library',
  },
  'func.json': {
    title: 'JSON 函数',
    status: 'done',
    ts: 'json / jsonText / jsonNumber / jsonBoolean / jsonHas / jsonLength，路径按列的 TS 类型补全检查；json-functions.test.ts、suite.ts function library',
  },
  'func.general': {
    title: '通用函数（nullOrDefault、maxColumns …）',
    status: 'done',
    ts: 'orElse（nullOrDefault）、greatest / least（忽略 NULL）；suite.ts function library',
  },
  window: {
    title: '窗口函数与分区',
    status: 'done',
    ts: 'win.* 含 firstValue / lastValue / nthValue；suite.ts function library、windows',
  },
  'expr.case': { title: 'CASE WHEN', status: 'done', ts: 'caseWhen；suite.ts functions and CASE' },
  'sql.native': { title: '原生 SQL', status: 'done', ts: 'sql 标签、db.sql；suite.ts native SQL' },
  lock: {
    title: '行锁',
    status: 'done',
    ts: 'forUpdate / NoWait / SkipLocked、tx.lock；suite.ts、transaction-hooks.test.ts',
  },
  'write.insert': {
    title: '插入',
    status: 'done',
    ts: 'insert().values / fromQuery / returnId / returnEntity；suite.ts writes',
  },
  'write.update': {
    title: '更新',
    status: 'done',
    ts: 'update().set / entity / changes / withVersion；suite.ts、changes.test.ts',
  },
  'write.delete': {
    title: '删除',
    status: 'done',
    ts: 'delete()、hard()、hardDelete 护栏；suite.ts、guards.test.ts',
  },
  'write.upsert': {
    title: 'upsert',
    status: 'done',
    ts: 'onConflict().merge / ignore；suite.ts upsert',
  },
  'save.aggregate': {
    title: '聚合根保存（savable）',
    status: 'different',
    ts: 'db.save(entity, tree, { include })：类型化 include 树，按现状比较（无追踪上下文）；多层、多对多中间表、多对一/一对一、removed、key；db.remove 删整棵树',
  },
  tracking: {
    title: '追踪与差异更新',
    status: 'different',
    ts: 'update().changes(before, after)；changes.test.ts',
  },
  logicDelete: {
    title: '逻辑删除',
    status: 'done',
    ts: 'softDelete、$onDelete、导航上单独关；suite.ts column rules、guards.test.ts',
  },
  version: {
    title: '乐观锁版本',
    status: 'done',
    ts: 'version() / version({ initial, next })、withVersion；changes.test.ts',
  },
  interceptor: {
    title: '拦截器',
    status: 'done',
    ts: 'interceptor-toggles.test.ts、write-events.test.ts',
  },
  'column.encryption': {
    title: '列加密',
    status: 'done',
    ts: 'encrypted（可分段搜索）、sqlConvert；guards.test.ts、sql-convert.test.ts',
  },
  'column.converter': {
    title: '值转换、枚举',
    status: 'done',
    ts: 'col.custom / codec、col.enum、col.json；json-schema.test.ts',
  },
  'column.generated': {
    title: '库里生成的列',
    status: 'done',
    ts: '插入值、$default 返回 sql 片段；guards.test.ts',
  },
  codeFirst: {
    title: '建表与迁移（code-first）',
    status: 'todo',
    ts: '部分：createTables；syncTables 待做（16.5）',
  },
  sharding: { title: '分库分表', status: 'todo', ts: '待做（16.6.2、16.6.3）' },
  cache: { title: '二级缓存', status: 'todo', ts: '待做（16.6.1）' },
  search: { title: 'search 扩展', status: 'todo', ts: '待对照（16.6.5）' },
  'dialect.mssql': { title: 'SQL Server 方言', status: 'todo', ts: '待做（16.7.1）' },
  'dialect.mssql2008': {
    title: 'SQL Server 2008 及以前（ROW_NUMBER 分页）',
    status: 'todo',
    ts: '待做（16.7.1）',
  },
  'dialect.dameng': { title: '达梦方言', status: 'todo', ts: '待做（16.7.4）' },
  'dialect.kingbase': { title: '人大金仓方言', status: 'todo', ts: '待做（16.7.5）' },
  'dialect.duckdb': { title: 'DuckDB 方言', status: 'todo', ts: '待做（16.7.3）' },
  'dialect.clickhouse': { title: 'ClickHouse 方言', status: 'todo', ts: '待做（16.7.6）' },
  'dialect.h2': { title: 'H2 方言', status: 'na', ts: '不适用：H2 运行在 JVM 里，Node 没有驱动' },
};
