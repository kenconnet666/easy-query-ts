/** 写入：增删改、upsert、条件更新 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { DocPage, Note, P, Section } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import {
  batch,
  changes,
  expectRows,
  insertMany,
  insertOne,
  remove,
  removeByNavigation,
  removeTree,
  returnEntity,
  update,
  updateByNavigation,
  updateBySubquery,
  updateEntity,
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
    </Section>
    <Section id="upsert" title="存在就更新">
      <P text="`onConflict` 加 `merge`，切换方言看差别：PostgreSQL、SQLite 是 ON CONFLICT，MySQL 是 ON DUPLICATE KEY，SQL Server、Oracle、Db2 是 MERGE。" />
      <SqlExample example={upsert} title="按主键更新或插入" />
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
    </Section>
    <Section id="entity" title="按实体更新">
      <P text="查出来改完再存：`entity` 按主键更新整行，带乐观锁条件，跳过 `insertOnly` 列。`changes` 只更新变了的列。`entities(...).batch()` 把一批合成一条语句，一次往返。" />
      <SqlExample example={updateEntity} title="更新整行" />
      <SqlExample example={changes} title="只更新变了的列" />
      <SqlExample example={batch} title="批量：合成一条 CASE WHEN" />
    </Section>
    <Section id="delete" title="删除">
      <SqlExample example={remove} title="按条件删" />
      <SqlExample example={removeByNavigation} title="条件里用导航：删掉草稿下的评论" />
      <P text="`db.remove` 删一棵树：按 `include` 先删子项。" />
      <SqlExample example={removeTree} title="删帖子，连同它的评论" />
      <Note text="没有条件的 `update`、`delete` 编译不过，要清整张表得明确写 `.all()`，防止误删。" />
    </Section>
  </DocPage>
));
