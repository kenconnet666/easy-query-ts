/** 与 Java 版的对应：从 easy-query（Java）过来的人查这一页 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { CodeBlock } from '@zerodep-dev/vue-tsx-pro-ui';
import { DocPage, Note, P, Points, Section, SimpleTable } from '../../site/content';

const javaCode = `// Java
List<User> users = easyEntityQuery.queryable(User.class)
    .where(u -> {
        u.age().ge(18);
        u.company().city().eq("杭州");
    })
    .orderBy(u -> u.name().asc())
    .toList();`;

const tsCode = `// TypeScript
const users = await db
  .queryable(User)
  .where((u) => [u.age.ge(18), u.company.city.eq('杭州')])
  .orderBy((u) => u.name.asc())
  .toList();`;

export default _component(() => () => (
  <DocPage>
    <Section id="overview" title="一样的思路，不一样的写法">
      <P text="这是 easy-query 的 TypeScript 版：实体加导航、lambda 里写条件、隐式 join、隐式子查询。能力按官方的单元测试和文档逐项对照过。" />
      <CodeBlock code={javaCode} lang="java" />
      <CodeBlock code={tsCode} lang="ts" />
      <Points
        items={[
          '**没有注解和代码生成**：实体用链式写法声明，代理类、DTO 都不需要生成，形状就是类型。',
          '**查询对象不可变**：每一步返回新的查询，可以存到变量里接着用，不用克隆。',
          '**`where` 返回条件**：Java 的语句式换成表达式，数组就是 AND。',
          '**不用追踪上下文**：`db.save` 在事务里先查再比较；`changes(before, after)` 不需要追踪模式。',
          '**一切都是异步的**：终结方法返回 Promise，事务靠回调或 `await using`。',
        ]}
      />
    </Section>
    <Section id="annotations" title="注解和配置">
      <SimpleTable
        head={['Java', 'TypeScript', '在哪一章']}
        rows={[
          ['`@Table`', '`entity(表名, 列)`', '实体与列'],
          ['`@Column(primaryKey, generatedKey)`', '`primaryKey()`、`generated()`', '实体与列'],
          ['`@Column(value)`', '`named()`', '实体与列'],
          ['`@LogicDelete`', '`softDelete()`', '逻辑删除'],
          ['`@Version`', '`version()`', '乐观锁'],
          ['`@UpdateIgnore`', '`insertOnly()`', '自动填充'],
          ['`@Encryption`', '`encrypted()`', '加密列'],
          ['`ColumnValueSQLConverter`', '`sqlConvert()`', '加密列'],
          ['`@ValueObject`', '`embed()`', '值对象'],
          ['`@Navigate`', '`r.one`、`r.many`、`r.manyToMany`', '关系'],
          ['`directMapping`', '`r.path`、`r.pathOne`', '直达关系'],
          ['`@ForeignKey`', '关系的 `foreignKey`', '关系'],
          ['`@SaveKey`', '`include` 的 `key`', '聚合保存'],
          ['`@ColumnIgnore`', '没有：实体和表一一对应', '-'],
          ['配置项 `deleteThrow`', '`hardDelete: "forbid"`', '创建 Db 与配置'],
          ['配置项 `resultSizeLimit`', '`maxRows`', '创建 Db 与配置'],
          ['配置项 `reverseOffsetThreshold`', '`reversePageAfter`', '性能'],
        ]}
      />
    </Section>
    <Section id="query" title="查询">
      <SimpleTable
        head={['Java', 'TypeScript', '在哪一章']}
        rows={[
          ['`whereById`、`whereByIds`', '`whereKey`、`whereKeys`', '基础查询'],
          ['`whereObject`', '`filterBy`', '列表页查询'],
          ['`orderByObject`', '`sortBy`、`table`', '列表页查询'],
          ['`selectAutoInclude`、DTO', '`defineView`、`select` 的形状', '视图'],
          ['`include`、`includes`', '`select` 里的 `toList`、`include`', '对象树'],
          ['`fillMany`、`fillOne`', '`fillMany`、`fillOne`', '按键填充'],
          ['`element`、`firstElement`', '`at(i)`、`first`', '对多：隐式子查询'],
          ['`subQueryToGroupJoin`', '`groupJoin()`', '性能'],
          ['`asTreeCTE`', '`descendantsOf`、`ancestorsOf`', '树形数据'],
          ['`toCteAs`', '`db.with`、`withRecursive`', 'CTE 与递归'],
          ['`asTableSegment`', '`tableHint`', '原生 SQL'],
          ['`asTable`（动态表名）', '`mapTables`', '动态表名'],
          ['`asSchema`', '`inSchema`', '动态表名'],
          ['`asTableLink`', '`withTableLink`', '动态表名'],
          ['`sqlSegment`、`sqlNativeSegment`', '`sql` 模板', '原生 SQL'],
          ['`JdbcExecutorListener`', '`onExecute`', '创建 Db 与配置'],
          ['计算属性（prop 一章）', '`defineComputed`', '计算属性'],
        ]}
      />
    </Section>
    <Section id="write" title="写入">
      <SimpleTable
        head={['Java', 'TypeScript', '在哪一章']}
        rows={[
          [
            '`insertable`、`updatable`、`deletable`',
            '`insert`、`update`、`delete`',
            '插入、更新、删除',
          ],
          ['`onConflictThen`', '`onConflict().merge()`、`ignore()`', '存在就更新'],
          ['`updatable(entity)`', '`update(X).entity(row)`', '更新'],
          ['`deletable(entity)`', '`delete(X).entity(row)`', '删除'],
          ['追踪模式的差异更新', '`changes(before, after)`', '更新'],
          ['`batch()`', '`entities(rows).batch()`', '更新'],
          ['`SQLExecuteStrategyEnum`', '`{ columns: "notNull" }`', '插入、更新'],
          ['`ignoreVersion`', '`ignoreVersion()`', '乐观锁'],
          ['savable（聚合根保存）', '`db.save`、`db.remove`', '聚合保存'],
          ['`transaction`', '`transaction`、`begin`', '事务'],
        ]}
      />
    </Section>
    <Section id="more" title="其它">
      <SimpleTable
        head={['Java', 'TypeScript', '在哪一章']}
        rows={[
          ['IDEA 插件：由表生成实体', '`eqts pull`', '迁移'],
          ['`syncTableCommand`', '`planSync`、`syncTables`', '建表与同步'],
          ['`createTableCommand`', '`createTablesSql`', '建表与同步'],
          ['缓存模块', '`-cache`：本机与 Redis 两级，只给接口', '二级缓存'],
          ['分表分库', '`sharding`、`shardDatabases`', '分表、分库'],
          ['读写分离', '`replicas`、`usePrimary`', '读写分离与只读'],
          ['search 扩展', '`parseSearchRequest`', '列表页查询'],
          ['Spring、Solon 集成', '不适用：一个 `createDb`，多数据源就是多个', '创建 Db 与配置'],
        ]}
      />
    </Section>
    <Section id="only-ts" title="只有 TypeScript 版有">
      <Points
        items={[
          '多态实体：`entity.union`，结果类型按判别列收窄。',
          '模块组合：`mergeSchemas`、`db.mount`，模块之间互不 import。',
          '方言能力写进类型：连的库不支持的方法在编辑器里标红。',
          '品牌类型：不同表的主键互不相容，定义关系时就核对。',
          'SQL 快照：`eqts snapshot`，评审时看 SQL 的差异。',
          '在浏览器、边缘函数里运行：PGlite、SQLite WASM、D1。',
          'Doris 方言。',
        ]}
      />
      <Note text="H2 跑在 JVM 里，Node 没有驱动，不支持。写法对不上时，看仓库 `docs/parity.md`、`docs/parity-docs.md` 的逐项对照。" />
    </Section>
  </DocPage>
));
