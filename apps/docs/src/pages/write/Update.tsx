/** 更新 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { DocPage, Note, P, Points, Section } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import {
  dynamicSet,
  entitiesEach,
  setCase,
  setExpressions,
  setFromNavigation,
  setMany,
  setToNull,
  updateAll,
  updateWithExists,
} from './more.examples.ts';
import {
  batch,
  changes,
  expectRows,
  update,
  updateByNavigation,
  updateBySubquery,
  updateColumns,
  updateEntity,
  updateLimit,
  updateReturning,
  updateSimple,
} from './write.examples.ts';

export default _component(() => () => (
  <DocPage>
    <Section id="set" title="改几列">
      <P text="`set` 给对象，只写给出的列；值的类型按列检查。`execute` 返回改到的行数。" />
      <SqlExample example={updateSimple} title="改一列" />
      <SqlExample example={setMany} title="改几列" />
      <SqlExample example={setToNull} title="写 NULL" />
      <P text="`undefined` 的列不写，表单只改填了的字段时不用自己挑。" />
      <SqlExample example={dynamicSet} title="没填的不改" />
    </Section>
    <Section id="expression" title="用当前的值算">
      <P text="`set` 也可以给回调，用当前列的值算新值，一条语句完成，不用先查再改，并发时也不会丢更新。" />
      <SqlExample example={update} title="阅读量加一" />
      <SqlExample example={setExpressions} title="减库存、打折、改名字" />
      <SqlExample example={setCase} title="CASE：按年龄定级别" />
      <P text="回调里也能用对一的导航。可空的导航写进不可空的列时编译报错，要 `orElse` 兜底。" />
      <SqlExample example={setFromNavigation} title="标题后面加上作者名" />
    </Section>
    <Section id="where" title="条件">
      <P text="条件里也能用导航，各方言写成 UPDATE ... JOIN、UPDATE ... FROM 或 EXISTS，LEFT JOIN 的语义和查询一致。" />
      <SqlExample example={updateByNavigation} title="把北京公司员工的帖子改回草稿" />
      <SqlExample example={updateBySubquery} title="写过 500 阅读帖子的新人升一级" />
      <SqlExample example={updateWithExists} title="帖子下有 15 赞评论的人升级" />
      <P text="没有条件的 `update` 编译不过，要改整张表得明确写 `.all()`。" />
      <SqlExample example={updateAll} title="清零全部阅读量" />
    </Section>
    <Section id="expect" title="断言行数">
      <P text="`expectRows` 断言改到的行数，不对就抛错，事务里整个回滚。这是实现“只能发布一次”这类状态流转最简单的办法。" />
      <SqlExample example={expectRows} title="发布：只有草稿能发布" />
    </Section>
    <Section id="returning" title="拿回改之后的值">
      <P text="切到 MySQL 看：没有 RETURNING 的库在渲染时报错。`expectRows` 与乐观锁的检查照常生效：行数不对、版本对不上时抛错，不会返回空数组。" />
      <SqlExample example={updateReturning} title="returning" />
    </Section>
    <Section id="limit" title="分批改">
      <P text="`orderBy` 加 `limit` 只动前几行，循环到 0 就把大表分批处理完。MySQL 写成 ORDER BY ... LIMIT，别的库写成“主键 IN (排序取前 n 行的主键)”，切换方言看看。" />
      <SqlExample example={updateLimit} title="阅读量最低的两篇改回草稿" />
    </Section>
    <Section id="entity" title="按实体更新">
      <P text="查出来改完再存：`entity` 按主键更新整行，带乐观锁条件，跳过 `insertOnly` 列。" />
      <SqlExample example={updateEntity} title="更新整行" />
      <P text="`changes` 只更新变了的列，没有变化时返回 0、不发语句。比较时按列的编码：日期比时刻，JSON 比内容。" />
      <SqlExample example={changes} title="只更新变了的列" />
      <P text="表单里没填的字段是 null 时，`columns: 'notNull'` 让它们保持原值；`columns: 'null'` 反过来，只把 null 的列写成 NULL。主键、版本、只插入的列不受影响。" />
      <SqlExample example={updateColumns} title="null 的不改" />
    </Section>
    <Section id="batch" title="批量更新">
      <P text="`entities` 每行一条语句。加 `batch()` 把写的列相同的行合成一条 CASE WHEN，一次往返；每条最多 500 行，并按参数上限切块。" />
      <SqlExample example={entitiesEach} title="逐行" />
      <SqlExample example={batch} title="合成一条" />
      <Points
        items={[
          '带版本列时逐行带版本条件，改到的行数不足就抛错。',
          '`entities` 不自带事务，要原子请放进 `transaction`。',
        ]}
      />
      <Note text="乐观锁的 `withVersion`、`ignoreVersion` 见“乐观锁”。" />
    </Section>
  </DocPage>
));
