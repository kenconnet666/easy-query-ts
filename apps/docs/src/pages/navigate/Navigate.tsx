/** 导航：隐式 join、隐式子查询、多对多、自关联、直达关系、显式 join */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { CodeBlock } from '@zerodep-dev/vue-tsx-pro-ui';
import { DocPage, Note, P, Points, Section, Sub } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import {
  aggregates,
  any,
  conditionalCount,
  fixedCondition,
  groupJoin,
  innerJoin,
  leftJoin,
  manyToMany,
  multiLevel,
  mutual,
  nestedAny,
  none,
  oneToOne,
  path,
  pathProducts,
  required,
  reverseManyToMany,
  reverseOne,
  selfManager,
  selfManyToMany,
  threeTables,
  toOne,
} from './navigate.examples.ts';

const relations = `defineSchema({ User, Company, Post, Tag, PostTag, Follow, ... }, {
  User: (r) => ({
    company: r.one('Company', { from: 'companyId', to: 'id' }),      // 多对一
    profile: r.one('Profile', { from: 'id', to: 'userId' }),         // 一对一
    manager: r.one('User', { from: 'managerId', to: 'id' }),         // 自关联
    posts: r.many('Post', { from: 'id', to: 'authorId' }),           // 一对多
    hotPosts: r.many('Post', { from: 'id', to: 'authorId' }, {
      where: (p) => p.views.ge(1000),                                // 固定条件
    }),
    followers: r.manyToMany('User', {                                // 多对多
      through: 'Follow', throughFrom: 'followeeId', throughTo: 'followerId',
    }),
    products: r.path('Product', ['orders', 'products']),             // 直达关系
  }),
  Profile: (r) => ({
    user: r.one('User', { from: 'userId', to: 'id' }, { required: true }), // 必有：INNER JOIN
  }),
});`;

export default _component(() => () => (
  <DocPage>
    <Section id="relations" title="声明关系">
      <P text="关系写在 `defineSchema` 的第二个参数里，名字和类型都会带到查询上。外键可空的导航，取到的列也可空；复合外键把 `from`、`to` 写成数组；`r.manyOn` 是任意条件的关系（逗号分隔列、路径前缀这类非标准关系）。完整的模型和数据见“示例模型”。" />
      <CodeBlock code={relations} lang="ts" title="schema.ts" />
    </Section>
    <Section id="to-one" title="对一：隐式 join">
      <P text="对一的导航直接点下去，条件、排序、结果里都能用。用到才 join，同一个导航只 join 一次。" />
      <SqlExample example={toOne} title="最简单的：取公司名" />
      <P text="隐式 join 默认是 LEFT JOIN：没有公司的用户还在结果里，公司名的类型是 `string | null`。确定外键一定有值时，声明 `required: true` 就变成 INNER JOIN，结果类型不可空，查询也略快。对比上下两张卡片的 SQL。" />
      <SqlExample example={required} title="required：资料一定属于某个用户" />
      <Sub id="one-to-one" title="一对一" />
      <SqlExample example={oneToOne} title="从用户到资料" />
      <SqlExample example={reverseOne} title="从资料反过来到用户，再到公司" />
      <Sub id="multi-level" title="连续点好几层" />
      <SqlExample example={multiLevel} title="帖子 → 作者 → 公司，帖子 → 分类 → 上级分类" />
      <Sub id="self" title="自关联" />
      <P text="导航指向自己这张表也一样写，别名由框架管。" />
      <SqlExample example={selfManager} title="周航下属的下属：两层上级" />
    </Section>
    <Section id="to-many" title="对多：隐式子查询">
      <Points
        items={[
          '`any`、`none`、`all` 生成 EXISTS，可以带条件。',
          '`count`、`sum`、`avg`、`max`、`min` 生成相关子查询，能放进结果、条件和排序。',
        ]}
      />
      <SqlExample example={any} title="写过热门帖子的用户" />
      <SqlExample example={none} title="一篇帖子也没写的用户" />
      <P text="`any` 可以嵌套，一路穿过一对多和多对多。" />
      <SqlExample example={nestedAny} title="有员工写过“架构”标签帖子的公司" />
      <SqlExample example={aggregates} title="阅读量最高的三位作者" />
      <SqlExample example={conditionalCount} title="分别数已发布和草稿" />
      <Sub id="fixed-condition" title="带固定条件的关系" />
      <P text="`hotPosts` 声明时就带了 `views >= 1000`，用的时候不用再写。" />
      <SqlExample example={fixedCondition} title="热门帖子" />
      <Sub id="group-join" title="子查询太多时：groupJoin" />
      <P text="一个导航上要好几个聚合时，逐行子查询要跑好几遍。`groupJoin()` 改成先分组再 LEFT JOIN，一次算完，写法不变。" />
      <SqlExample example={groupJoin} title="一次算出帖子数和总阅读量" />
    </Section>
    <Section id="many-to-many" title="多对多">
      <P text="多对多和一对多的用法完全一样，中间表由框架 join。" />
      <SqlExample example={manyToMany} title="打了“架构”标签的帖子和它们的全部标签" />
      <SqlExample example={reverseManyToMany} title="从标签这边反过来查，按帖子数排序" />
      <Sub id="self-many" title="自关联的多对多" />
      <P text="用户关注用户：同一张关注表，两个方向是两个导航。" />
      <SqlExample example={selfManyToMany} title="粉丝不少于两个的人和他们关注的人" />
      <SqlExample example={mutual} title="关注了上海的同行的人" />
    </Section>
    <Section id="path" title="直达关系">
      <P text="`r.path` 沿已有的导航走到目标，之后当一个普通的对多导航用。中间自动去重：同一篇帖子不会因为经过两条路径算两次。" />
      <SqlExample example={path} title="公司的全部帖子：经员工到帖子" />
      <SqlExample example={pathProducts} title="用户买过的商品：经订单、订单明细" />
    </Section>
    <Section id="join" title="显式 join">
      <P text="导航表达不了时才用：内连接筛选、join 没声明过关系的表、把一对多展平成“父子对”。之后的回调按 join 顺序拿到各张表；left join 那张表的列在类型上自动可空。" />
      <SqlExample example={innerJoin} title="INNER JOIN：用户和他的热门帖子" />
      <SqlExample example={leftJoin} title="LEFT JOIN：没有员工的公司也在结果里" />
      <SqlExample example={threeTables} title="三张表：已付款订单、下单人、公司" />
      <Note text="`on` 收到此前所有表和新表；条件全被跳过时报错，免得悄悄变成笛卡尔积。" />
    </Section>
  </DocPage>
));
