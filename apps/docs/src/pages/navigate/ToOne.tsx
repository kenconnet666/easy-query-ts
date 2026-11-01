/** 对一：隐式 join */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { DocPage, Note, P, Section } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import {
  commentChain,
  deepSelfRelation,
  toOneGroup,
  toOneJoinedOnce,
  toOneNullCheck,
  toOneOrder,
  toOneWhere,
  toOneWholeRow,
} from './more.examples.ts';
import {
  multiLevel,
  oneToOne,
  required,
  reverseOne,
  selfManager,
  toOne,
} from './navigate.examples.ts';

export default _component(() => () => (
  <DocPage>
    <Section id="basic" title="点下去就是 join">
      <P text="对一的导航直接点下去，条件、排序、分组、结果里都能用。不用写 join，也不用想别名。" />
      <SqlExample example={toOne} title="最简单的：取公司名" />
      <SqlExample example={toOneWhere} title="条件里用" />
      <SqlExample example={toOneOrder} title="排序里用" />
      <SqlExample example={toOneGroup} title="分组里用" />
      <P text="用到才 join，同一个导航只 join 一次：下面条件、排序、结果都用了公司，SQL 里只有一个 JOIN。" />
      <SqlExample example={toOneJoinedOnce} title="只 join 一次" />
    </Section>
    <Section id="left-join" title="LEFT JOIN 和 required">
      <P text="隐式 join 默认是 LEFT JOIN：没有公司的用户还在结果里，公司名的类型是 `string | null`。确定外键一定有值时，声明 `required: true` 就变成 INNER JOIN，结果类型不可空。对比上面第一张和下面这张的 SQL。" />
      <SqlExample example={required} title="required：资料一定属于某个用户" />
      <P text="LEFT JOIN 的语义保留到底：按目标的列判空，能找出没有关联的行。" />
      <SqlExample example={toOneNullCheck} title="没有公司的用户" />
    </Section>
    <Section id="row" title="取整行">
      <P text="导航本身放进形状，就是那一整行。" />
      <SqlExample example={toOneWholeRow} title="用户的公司和部门" />
    </Section>
    <Section id="one-to-one" title="一对一">
      <P text="一对一和多对一写法一样，区别只在外键在哪边。" />
      <SqlExample example={oneToOne} title="从用户到资料" />
      <SqlExample example={reverseOne} title="从资料反过来到用户，再到公司" />
    </Section>
    <Section id="multi-level" title="连续点好几层">
      <P text="每一层一个 JOIN，别名由框架管。" />
      <SqlExample example={multiLevel} title="帖子 → 作者 → 公司，帖子 → 分类 → 上级分类" />
      <SqlExample
        example={commentChain}
        title="评论 → 被回复的评论 → 作者，评论 → 帖子 → 作者 → 公司"
      />
    </Section>
    <Section id="self" title="自关联">
      <P text="导航指向自己这张表也一样写，SQL 里是两个不同的别名。" />
      <SqlExample example={selfManager} title="周航下属的下属：两层上级" />
      <SqlExample example={deepSelfRelation} title="部门、上级部门、上上级部门" />
      <Note text="要 INNER JOIN 但不想声明 `required`，或者要 join 没声明关系的表，用显式 join，见“显式 join 与表别名”。" />
    </Section>
  </DocPage>
));
