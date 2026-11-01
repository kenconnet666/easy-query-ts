/** 写入：增删改、upsert、条件更新 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { DocPage, Note, P, Points, Section } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import {
  expectRows,
  insertMany,
  insertOne,
  remove,
  update,
  updateByNavigation,
  upsert,
} from './write.examples.ts';

export default _component(() => () => (
  <DocPage>
    <Section id="insert" title="插入">
      <P text="`returnId()` 返回自增主键，PostgreSQL 用 RETURNING，MySQL 从驱动的结果里取。多行时按方言的参数上限自动分块。" />
      <SqlExample example={insertOne} title="插入一行，拿到主键" />
      <SqlExample example={insertMany} title="插入多行" />
    </Section>
    <Section id="upsert" title="存在就更新">
      <P text="`onConflict` 加 `merge`，切换方言看差别：PostgreSQL、SQLite 是 ON CONFLICT，MySQL 是 ON DUPLICATE KEY，SQL Server、Oracle、Db2 是 MERGE。" />
      <SqlExample example={upsert} title="按主键更新或插入" />
    </Section>
    <Section id="update" title="更新">
      <P text="`set` 可以给对象，也可以给回调，用当前列的值算新值。" />
      <SqlExample example={update} title="阅读量加一" />
      <P text="条件里也能用导航，各方言写成 UPDATE ... JOIN、UPDATE ... FROM 或 EXISTS。" />
      <SqlExample example={updateByNavigation} title="把北京公司员工的帖子改回草稿" />
      <P text="`expectRows` 断言改到的行数，不对就抛错，事务里整个回滚。这是实现“只能发布一次”这类状态流转最简单的办法。" />
      <SqlExample example={expectRows} title="发布：只有草稿能发布" />
    </Section>
    <Section id="delete" title="删除">
      <SqlExample example={remove} title="删掉没人看过的草稿" />
      <Note text="没有条件的 `update`、`delete` 编译不过，要清整张表得明确写 `.all()`，防止误删。" />
      <Points
        items={[
          '`changes(before, after)` 只更新变了的列；`batch` 按主键更新一批实体。',
          '列上声明的 `insertOnly()`、`$default()`、`$onUpdate()` 在写入时自动生效。',
        ]}
      />
    </Section>
  </DocPage>
));
