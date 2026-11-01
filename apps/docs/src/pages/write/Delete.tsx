/** 删除 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { DocPage, Note, P, Section } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import {
  deleteAll,
  deleteByKey,
  deleteBySubquery,
  deleteEntity,
  deleteExpect,
  deleteWithExists,
} from './more.examples.ts';
import {
  remove,
  removeByNavigation,
  removeInBatches,
  removeReturning,
  removeTree,
} from './write.examples.ts';

export default _component(() => () => (
  <DocPage>
    <Section id="where" title="按条件删">
      <P text="`execute` 返回删掉的行数。有逻辑删除列的实体，删除自动变成更新，见“逻辑删除”。" />
      <SqlExample example={deleteByKey} title="按主键" />
      <SqlExample example={remove} title="几个条件" />
      <P text="条件里能用导航、子查询、对多的 `any`、`none`。" />
      <SqlExample example={removeByNavigation} title="导航：删掉草稿下的评论" />
      <SqlExample example={deleteBySubquery} title="子查询：删掉草稿的标签关系" />
      <SqlExample example={deleteWithExists} title="对多：没有帖子用的标签" />
    </Section>
    <Section id="safe" title="防误删">
      <P text="没有条件的 `delete` 编译不过，要清整张表得明确写 `.all()`。" />
      <SqlExample example={deleteAll} title="清空" />
      <P text="`expectRows` 断言删到的行数。" />
      <SqlExample example={deleteExpect} title="没删到就报错" />
      <Note text="`createDb({ hardDelete: 'forbid' })`：没有逻辑删除列的实体 delete 要显式 `.hard()` 才执行。" />
    </Section>
    <Section id="entity" title="按实体删">
      <P text="`entity` 按主键删；有版本列时带上版本条件，被别人改过就抛错。" />
      <SqlExample example={deleteEntity} title="删掉查出来的这一行" />
    </Section>
    <Section id="returning" title="拿回删掉的行">
      <SqlExample example={removeReturning} title="returning" />
    </Section>
    <Section id="batches" title="分批删">
      <P text="大表的清理不要开一个长事务：`orderBy` 加 `limit` 分批删，循环到 0。" />
      <SqlExample example={removeInBatches} title="分批删除" />
    </Section>
    <Section id="tree" title="删一棵树">
      <P text="`db.remove` 按 `include` 先删子项，行不存在返回 false。更多见“聚合保存”。" />
      <SqlExample example={removeTree} title="删帖子，连同它的评论" />
    </Section>
  </DocPage>
));
