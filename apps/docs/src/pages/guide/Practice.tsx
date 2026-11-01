/** 完整例子：用一个社区首页串起查询与写入 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { DocPage, P, Points, Section } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import { authorPage, detail, feed, publish, ranking } from './practice.examples.ts';

export default _component(() => () => (
  <DocPage>
    <Section id="feed" title="首页：帖子列表">
      <P text="一张卡片要标题、作者、公司、评论数、标签。作者和公司是对一的导航，自动 join；评论数是对多的聚合，生成子查询；标签是多对多，再发一条查询取回。一段代码，三种关系全用上了，结果类型一个字都不用写。" />
      <SqlExample example={feed} title="第一页，按阅读量排序" />
    </Section>
    <Section id="detail" title="详情页：帖子和评论">
      <P text="`select` 里的对象可以嵌套，结果就按这个形状返回，不用自己拼 DTO。" />
      <SqlExample example={detail} title="一篇帖子，带作者和全部评论" />
    </Section>
    <Section id="author" title="作者主页：统计加最新内容">
      <P text="聚合和列表放在一起写。`limit` 限制的是每个父行的子行数。" />
      <SqlExample example={authorPage} title="总帖子数、总阅读量、最新两篇" />
    </Section>
    <Section id="publish" title="发帖：写帖子、标签、评论">
      <P text="几张表一起写，放进一个事务。中途抛错就全部回滚，运行一下看 SQL 一栏的顺序。" />
      <SqlExample example={publish} title="在一个事务里写三张表" />
    </Section>
    <Section id="ranking" title="榜单：排名和分级">
      <P text="表达式能复用：`views` 算一次，后面的窗口函数和 CASE 都能用。" />
      <SqlExample example={ranking} title="作者榜" />
    </Section>
    <Section id="review" title="回头看">
      <Points
        items={[
          '整个页面没有手写 join，也没有手写 DTO 类。',
          '列名、关系名、比较的值类型写错都编译不过，改了实体，受影响的查询立刻报错。',
          '切换右上角的方言，同一段代码换一个数据库也能跑。',
        ]}
      />
    </Section>
  </DocPage>
));
