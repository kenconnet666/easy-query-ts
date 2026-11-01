/** 视图：把形状存下来复用 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { CodeBlock } from '@zerodep-dev/vue-tsx-pro-ui';
import { DocPage, Note, P, Section } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import {
  viewFirst,
  viewInNavigation,
  viewList,
  viewReturnType,
  viewThreeLevels,
  viewWhere,
} from './more.examples.ts';
import { nestedView, view } from './navigate.examples.ts';

const shared = `// views/product.ts：放在一起，接口和页面共用
export const ProductCard = defineView(schema, Product, (p) => ({
  name: p.name,
  price: p.price,
  sold: p.items.sum((i) => i.quantity),
}));

// 接口的返回值类型
export type ProductCardDto = ViewOf<typeof ProductCard>;`;

export default _component(() => () => (
  <DocPage>
    <Section id="define" title="把形状存下来">
      <P text="结果形状就是 DTO 的类型，不需要另写 VO 类。常用的形状用 `defineView` 存下来，别处直接 `select`。这对应官方的 selectAutoInclude：Java 版要写 DTO 类并用注解标导航，这里形状本身就是声明。" />
      <SqlExample example={view} title="把形状存下来，到处复用" />
      <CodeBlock code={shared} lang="ts" />
    </Section>
    <Section id="use" title="怎么用">
      <P text="视图只管形状，条件、排序、分页还是查询上写。" />
      <SqlExample example={viewList} title="列表" />
      <SqlExample example={viewWhere} title="加条件、排序、分页" />
      <SqlExample example={viewFirst} title="取一行" />
      <P text="`ViewOf<typeof ProductCard>` 拿到这个形状的类型，给接口返回值用。" />
      <SqlExample example={viewReturnType} title="结果的类型" />
    </Section>
    <Section id="nested" title="视图里嵌视图">
      <P text="把另一个视图传给 `toList`、`first`，形状就能一层层组合。" />
      <SqlExample example={viewInNavigation} title="导航上用视图" />
      <SqlExample example={nestedView} title="两层" />
      <SqlExample example={viewThreeLevels} title="三层：作者 → 帖子 → 点赞最多的评论" />
      <Note text="视图绑定了实体。只依赖几列、想跨实体复用的是条件，用 `defineScope`，见“复用查询”。" />
    </Section>
  </DocPage>
));
