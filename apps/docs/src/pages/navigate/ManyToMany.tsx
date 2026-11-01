/** 多对多 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { DocPage, Note, P, Section } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import { countTags, mutualFollow, orderProducts, tagCloud, tagsFiltered } from './more.examples.ts';
import { manyToMany, mutual, reverseManyToMany, selfManyToMany } from './navigate.examples.ts';

export default _component(() => () => (
  <DocPage>
    <Section id="basic" title="和一对多一样用">
      <P text="多对多和一对多的用法完全一样，中间表由框架 join，代码里看不到。" />
      <SqlExample example={manyToMany} title="打了“架构”标签的帖子和它们的全部标签" />
      <SqlExample example={countTags} title="标签不少于两个的帖子" />
      <SqlExample example={tagsFiltered} title="有“架构”、没有“缓存”" />
    </Section>
    <Section id="reverse" title="从另一边查">
      <P text="另一边声明一个反向的导航，查法一样。" />
      <SqlExample example={reverseManyToMany} title="从标签这边反过来查，按帖子数排序" />
      <SqlExample example={tagCloud} title="标签云：帖子数、总阅读量、最热的一篇" />
    </Section>
    <Section id="self" title="自关联的多对多">
      <P text="用户关注用户：同一张关注表，两个方向是两个导航。" />
      <SqlExample example={selfManyToMany} title="粉丝不少于两个的人和他们关注的人" />
      <SqlExample example={mutual} title="关注了上海的同行的人" />
      <SqlExample example={mutualFollow} title="粉丝列表，带公司" />
    </Section>
    <Section id="business" title="中间表带业务列">
      <P text="订单和商品经订单明细连接，中间表上还有数量和价格。只要商品时用多对多，要数量和价格时用一对多的 `items`，两个导航可以同时声明。" />
      <SqlExample example={orderProducts} title="买过 999 元以上商品的订单" />
      <Note text="保存时只维护中间表，不删了重建，中间表上的业务列不受影响，见“聚合保存”。" />
    </Section>
  </DocPage>
));
