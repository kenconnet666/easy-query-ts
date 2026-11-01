/** 空值与条件：orElse、nullIf、caseWhen、cast */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { DocPage, Note, P, Section } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import { caseExpr, caseInGroup } from '../query/advanced.examples.ts';
import { conditions, nullable } from './func.examples.ts';
import {
  booleanValue,
  caseInAggregate,
  caseInOrder,
  caseInWhere,
  castValues,
  compareValues,
  nullIfValue,
  orElseChain,
} from './functions.examples.ts';

export default _component(() => () => (
  <DocPage>
    <Section id="null" title="空值">
      <P text="`orElse` 是 COALESCE，为空时取别的值，用过之后类型不再可空。可以接值，也可以接列，能连着写。" />
      <SqlExample example={nullable} title="orElse 和 nullIf" />
      <SqlExample example={orElseChain} title="公司名，没有就用部门名，再没有就“无”" />
      <P text="`nullIf` 相反：等于这个值时变成 NULL。常用来把 0 当成没有数据，避免除零。" />
      <SqlExample example={nullIfValue} title="0 当成没有" />
    </Section>
    <Section id="case" title="CASE">
      <P text="`caseWhen` 是表达式，能放进 `select`、`where`、`orderBy`，也能当分组键。结果类型是各分支值类型的并集。分支的值可以是字面量，也可以是列。" />
      <SqlExample example={caseExpr} title="按阅读量分级" />
      <SqlExample example={conditions} title="按点赞数分级、判断是不是回复" />
      <P text="放进排序，实现自定义的顺序。" />
      <SqlExample example={caseInOrder} title="按 lead、senior、junior 的顺序" />
      <P text="放进条件，不同的行用不同的门槛。" />
      <SqlExample example={caseInWhere} title="一级评论 10 赞起，回复 4 赞起" />
      <P text="放进分组键或聚合。" />
      <SqlExample example={caseInGroup} title="按等级分组" />
      <SqlExample example={caseInAggregate} title="热评和普通评论各有多少" />
    </Section>
    <Section id="boolean" title="条件当值">
      <P text="条件本身是布尔表达式，可以直接放进 `select`。SQL Server、Oracle 23 之前不能这么写，切换方言看：自动写成 CASE WHEN。" />
      <SqlExample example={booleanValue} title="热门吗、草稿吗" />
      <P text="`compare` 比大小，小于是 -1，等于 0，大于 1，任一为 NULL 时是 NULL。" />
      <SqlExample example={compareValues} title="和 1000 比" />
    </Section>
    <Section id="cast" title="类型转换">
      <P text="`cast` 的目标是 `string`、`int`、`bigint`、`double`、`decimal`、`date`、`datetime`，各库的类型名由方言选，结果类型也跟着变。" />
      <SqlExample example={castValues} title="转文字、转日期" />
      <Note text="能不转就不转：在条件里转换列通常会用不上索引。" />
    </Section>
  </DocPage>
));
