/** 完整例子：用一个社区首页串起查询与写入 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { DocPage, P, Points, Section } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import {
  authorPage,
  companyDashboard,
  detail,
  feed,
  orgChart,
  publish,
  ranking,
  revenue,
  userOrders,
} from './practice.examples.ts';

export default _component(() => () => (
  <DocPage>
    <Section id="feed" title="首页：帖子列表">
      <P text="一张卡片要标题、作者、公司、评论数、标签。作者和公司是对一的导航，自动 join；评论数是对多的聚合，生成子查询；标签是多对多，再发一条查询取回。一段代码，三种关系全用上了，结果类型一个字都不用写。" />
      <SqlExample example={feed} title="第一页，按阅读量排序" />
    </Section>
    <Section id="detail" title="详情页：帖子和评论">
      <P text="`select` 里的对象可以嵌套，结果就按这个形状返回，不用自己拼 DTO。评论和它的回复是同一张表的自关联。" />
      <SqlExample example={detail} title="一篇帖子，带作者、标签、评论和回复" />
    </Section>
    <Section id="author" title="作者主页：统计加最新内容">
      <P text="聚合和列表放在一起写。`limit` 限制的是每个父行的子行数。一对一的资料、自关联的多对多（粉丝）都在一段 `select` 里。" />
      <SqlExample example={authorPage} title="资料、粉丝数、总阅读量、最新两篇" />
    </Section>
    <Section id="publish" title="发帖：写帖子、标签、评论">
      <P text="几张表一起写，放进一个事务。中途抛错就全部回滚，运行一下看 SQL 一栏的顺序。" />
      <SqlExample example={publish} title="在一个事务里写三张表" />
    </Section>
    <Section id="ranking" title="榜单：排名和分级">
      <P text="表达式能复用：`views` 算一次，后面的窗口函数和 CASE 都能用。" />
      <SqlExample example={ranking} title="作者榜" />
    </Section>
    <Section id="company" title="公司页：组织和内容">
      <P text="直达关系 `c.posts` 经员工到帖子；部门是一棵树，下级部门用 `children` 取。" />
      <SqlExample example={companyDashboard} title="公司概览：人数、帖子数、总阅读量" />
      <SqlExample example={orgChart} title="组织架构：部门 → 下级部门 → 员工" />
    </Section>
    <Section id="shop" title="商店：订单和营收">
      <SqlExample example={userOrders} title="我的订单：明细、商品名、小计" />
      <P text="报表最考验写法：跨订单、明细、商品、用户、公司五张表，筛选已付款的订单，按城市汇总。" />
      <SqlExample example={revenue} title="各城市卖出的件数和营收" />
    </Section>
    <Section id="review" title="回头看">
      <Points
        items={[
          '整个页面没有手写一个 join 条件，也没有手写 DTO 类。',
          '列名、关系名、比较的值类型写错都编译不过，改了实体，受影响的查询立刻报错。',
          '切换右上角的方言，同一段代码换一个数据库也能跑。',
        ]}
      />
    </Section>
  </DocPage>
));
