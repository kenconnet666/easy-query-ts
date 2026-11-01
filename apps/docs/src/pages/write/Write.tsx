/** 写入：增删改、upsert、条件更新 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { DocPage, Note, P, Section } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import {
  batch,
  changes,
  conditionalMerge,
  expectRows,
  insertColumns,
  insertFromQuery,
  insertIgnore,
  insertMany,
  insertOne,
  insertReturning,
  remove,
  removeByNavigation,
  removeInBatches,
  removeReturning,
  removeTree,
  returnEntity,
  update,
  updateByNavigation,
  updateBySubquery,
  updateColumns,
  updateEntity,
  updateLimit,
  updateReturning,
  updateSimple,
  upsert,
} from './write.examples.ts';

export default _component(() => () => (
  <DocPage>
    <Section id="insert" title="插入">
      <P text="`returnId()` 返回自增主键，PostgreSQL 用 RETURNING，MySQL 从驱动的结果里取；`returnEntity()` 拿回整行，库里的默认值、`$default` 都在。多行时按方言的参数上限自动分块。" />
      <SqlExample example={insertOne} title="插入一行，拿到主键" />
      <SqlExample example={returnEntity} title="插入一行，拿回整行" />
      <SqlExample example={insertMany} title="插入多行" />
      <P text="`returning` 拿回指定的列，多行时也一样；不写列名是整行。切到 MySQL 看：没有 RETURNING 的库在渲染时报错，这种库用 `returnId`、`returnEntity`，它们按方言自动选写法。" />
      <SqlExample example={insertReturning} title="插入多行，拿回主键和名字" />
      <P text="TS 里“没给”和“写 null”分得开：没给的列一律不写。`columns: 'notNull'` 把值为 null 的列也去掉，交给库里的默认值。" />
      <SqlExample example={insertColumns} title="null 的列不写" />
      <P text="`fromQuery` 是 INSERT ... SELECT，数据不经过应用。`select` 的键就是目标列，类型检查必填列都要有。它不经过插入拦截器，租户、默认值要自己在 `select` 里给。" />
      <SqlExample example={insertFromQuery} title="顶级分类的名字导入成标签" />
    </Section>
    <Section id="upsert" title="存在就更新">
      <P text="`onConflict` 加 `merge`，切换方言看差别：PostgreSQL、SQLite 是 ON CONFLICT，MySQL 是 ON DUPLICATE KEY，SQL Server、Oracle、Db2 是 MERGE。" />
      <SqlExample example={upsert} title="按主键更新或插入" />
      <P text="`ignore` 冲突时什么也不做。" />
      <SqlExample example={insertIgnore} title="已经有了就跳过" />
      <P text="`onlyIf` 只在满足条件时覆盖，第一个参数是现有的行，第二个是新行。常见用法是只在版本更大时覆盖。PostgreSQL、SQLite 支持，别的库构建时报错。" />
      <SqlExample example={conditionalMerge} title="只在新库存更多时覆盖" />
    </Section>
    <Section id="update" title="更新">
      <SqlExample example={updateSimple} title="改一列" />
      <P text="`set` 也可以给回调，用当前列的值算新值。" />
      <SqlExample example={update} title="阅读量加一" />
      <P text="条件里也能用导航，各方言写成 UPDATE ... JOIN、UPDATE ... FROM 或 EXISTS。" />
      <SqlExample example={updateByNavigation} title="把北京公司员工的帖子改回草稿" />
      <SqlExample example={updateBySubquery} title="写过 500 阅读帖子的新人升一级" />
      <P text="`expectRows` 断言改到的行数，不对就抛错，事务里整个回滚。这是实现“只能发布一次”这类状态流转最简单的办法。" />
      <SqlExample example={expectRows} title="发布：只有草稿能发布" />
      <SqlExample example={updateReturning} title="拿回改之后的值" />
      <P text="`orderBy` 加 `limit` 只动前几行。MySQL 写成 ORDER BY ... LIMIT，别的库写成“主键 IN (排序取前 n 行的主键)”，切换方言看看。" />
      <SqlExample example={updateLimit} title="阅读量最低的两篇改回草稿" />
    </Section>
    <Section id="entity" title="按实体更新">
      <P text="查出来改完再存：`entity` 按主键更新整行，带乐观锁条件，跳过 `insertOnly` 列。`changes` 只更新变了的列。`entities(...).batch()` 把一批合成一条语句，一次往返。" />
      <SqlExample example={updateEntity} title="更新整行" />
      <SqlExample example={changes} title="只更新变了的列" />
      <SqlExample example={batch} title="批量：合成一条 CASE WHEN" />
      <P text="表单里没填的字段是 null 时，`columns: 'notNull'` 让它们保持原值；`columns: 'null'` 反过来，只把 null 的列写成 NULL。主键、版本、只插入的列不受影响。" />
      <SqlExample example={updateColumns} title="没填的不改" />
    </Section>
    <Section id="delete" title="删除">
      <SqlExample example={remove} title="按条件删" />
      <SqlExample example={removeByNavigation} title="条件里用导航：删掉草稿下的评论" />
      <P text="`db.remove` 删一棵树：按 `include` 先删子项。" />
      <SqlExample example={removeTree} title="删帖子，连同它的评论" />
      <SqlExample example={removeReturning} title="拿回删掉的行" />
      <P text="大表的清理不要开一个长事务：`orderBy` 加 `limit` 分批删，循环到 0。" />
      <SqlExample example={removeInBatches} title="分批删除" />
      <Note text="没有条件的 `update`、`delete` 编译不过，要清整张表得明确写 `.all()`，防止误删。" />
    </Section>
  </DocPage>
));
