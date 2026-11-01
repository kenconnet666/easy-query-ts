/** 直达关系 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { DocPage, Note, P, Section } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import { pathAggregate, pathTree, pathWhere } from './more.examples.ts';
import { path, pathOne, pathProducts } from './navigate.examples.ts';

export default _component(() => () => (
  <DocPage>
    <Section id="path" title="跨过中间几层">
      <P text="`r.path` 沿已有的导航走到目标，之后当一个普通的对多导航用。对应 Java 版的 directMapping。" />
      <SqlExample example={path} title="公司的全部帖子：经员工到帖子" />
      <SqlExample example={pathProducts} title="用户买过的商品：经订单、订单明细" />
    </Section>
    <Section id="distinct" title="自动去重">
      <P text="各段拼成一张去重的桥，同一个商品经两张订单到达也只算一次，`count`、`sum`、`toList` 都不重复。看 SQL 一栏的 DISTINCT。" />
      <SqlExample example={pathAggregate} title="买过几种商品、最贵的多少" />
      <SqlExample example={pathWhere} title="买过数据库实战课的用户" />
      <SqlExample example={pathTree} title="每家公司阅读量最高的两篇" />
    </Section>
    <Section id="path-one" title="全是多对一：pathOne">
      <P text="全程都是多对一时用 `r.pathOne`：不建桥，等同于一段段点下去，和直接写 `u.department.company` 共用同样的 JOIN。" />
      <SqlExample example={pathOne} title="用户所在部门的公司" />
      <Note text="各段的拦截器条件、中间各段的固定条件在桥里；最后一段的固定条件作用在目标上。声明的写法见“关系”。" />
    </Section>
  </DocPage>
));
