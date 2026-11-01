/** 显式 join 与表别名 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { DocPage, Note, P, Points, Section, SimpleTable, Sub } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import {
  antiJoin,
  crossJoin,
  innerJoin,
  joinGroup,
  joinNavigation,
  joinPage,
  joinSubquery,
  leftJoin,
  noRelation,
  onConditions,
  rawAlias,
  rightJoin,
  sameTableTwice,
  selfJoin,
  threeTables,
  whereConditions,
  wholeRows,
} from './join.examples.ts';

export default _component(() => () => (
  <DocPage>
    <Section id="when" title="和导航怎么选">
      <P text="声明过的关系用导航最省事（见“对一：隐式 join”）。下面这些情况写显式 join，两种写法可以混用。" />
      <SimpleTable
        head={['你要的', '写法', 'SQL']}
        rows={[
          ['沿着关系取对一的列', '导航 `u.company.name`', '自动 LEFT JOIN'],
          [
            '沿着关系判断、统计对多',
            '导航 `u.posts.any(...)`、`u.posts.count()`',
            'EXISTS、子查询',
          ],
          ['子表每行展平成一行', '`innerJoin(Post, ...)`', 'INNER JOIN'],
          ['没声明关系的表，或不是外键的条件', '`leftJoin(User, ...)`', 'LEFT JOIN'],
          ['同一张表用两次', '`innerJoin(User, ...)` 两次', '两个别名'],
          ['和统计结果连接', '`leftJoin(子查询, ...)`', 'JOIN (SELECT ...)'],
        ]}
      />
    </Section>
    <Section id="kinds" title="四种 join">
      <Sub id="inner" title="innerJoin" />
      <P text="`on` 收到此前所有表和新表；之后的 `where`、`orderBy`、`select` 都按 join 的顺序收到它们，参数名随你取。" />
      <SqlExample example={innerJoin} title="用户和他的热门帖子" />
      <P text="不写 `select` 时，每张表一整行，按实体名分组。同一张表 join 两次时必须写 `select`。" />
      <SqlExample example={wholeRows} title="不写 select：{ User, Post }" />
      <Sub id="left" title="leftJoin" />
      <P text="新表没匹配到时列都是空的，类型上也自动可空：下面 `user` 的类型是 `string | null`。" />
      <SqlExample example={leftJoin} title="没有员工的公司也在结果里" />
      <SqlExample example={antiJoin} title="只要没匹配到的：没有员工的公司" />
      <Sub id="right" title="rightJoin" />
      <P text="新表的行都保留，此前各表的列都变成可空。" />
      <SqlExample example={rightJoin} title="从用户右连接公司" />
      <Sub id="cross" title="crossJoin" />
      <P text="笛卡尔积，没有 `on`，条件写在 `where`。" />
      <SqlExample example={crossJoin} title="公司和标签两两组合" />
    </Section>
    <Section id="conditions" title="连接条件">
      <P text="`on` 和 `where` 一样，数组就是 AND。LEFT JOIN 的条件放哪里结果不同：放 `on` 里，没匹配到的用户还在；放 `where` 里，他们被过滤掉了，效果等于内连接。对比下面两张卡片。" />
      <SqlExample example={onConditions} title="条件放 on：10 个用户都在" />
      <SqlExample example={whereConditions} title="条件放 where：只剩写过热门帖子的" />
      <Note text="`on` 的条件全被跳过（比如都是没填的筛选值）时会报错，免得悄悄变成笛卡尔积。" />
      <Sub id="more-tables" title="多张表" />
      <SqlExample example={threeTables} title="已付款订单、下单人、公司" />
      <Sub id="no-relation" title="没声明关系的表" />
      <P text="连接条件可以是任意表达式，不要求外键，也不要求声明过关系。" />
      <SqlExample example={noRelation} title="文档按创建人的名字找用户" />
    </Section>
    <Section id="same-table" title="同一张表 join 多次">
      <P text="自连接不用声明别名：传两次同一个实体，回调里各是各的参数，框架给它们不同的表别名。" />
      <SqlExample example={selfJoin} title="用户和上级" />
      <SqlExample example={sameTableTwice} title="关注表连两次用户：陈默的粉丝" />
    </Section>
    <Section id="subquery" title="join 子查询">
      <P text="目标可以是一条查询，它的 `select` 键就是能用的列，类型跟着带过来。`left join` 时这些列同样可空。" />
      <SqlExample example={joinSubquery} title="先按作者统计，再连回用户" />
    </Section>
    <Section id="after" title="join 之后">
      <P text="join 进来的表上照样能点导航，框架把隐式 join 排在后面。" />
      <SqlExample example={joinNavigation} title="显式 join 和导航混用" />
      <P text="`groupBy`、聚合的回调也按 join 的顺序收到各张表。注意内连接一对多之后 `count` 数的是连接后的行数。" />
      <SqlExample example={joinGroup} title="每家公司的帖子数和总阅读量" />
      <P text="`toPage` 的总数按连接后的行数算。" />
      <SqlExample example={joinPage} title="join 之后分页" />
    </Section>
    <Section id="alias" title="表别名">
      <P text="别名不用你写，也没有手动指定别名的 API：回调的参数名就是你的别名，它只活在 TypeScript 里，不进 SQL。" />
      <Points
        items={[
          '表别名按出现顺序生成：`t0`、`t1`、`t2`……导航产生的 join 接着往后排。引用外层的子查询（`any`、`count`）和外层不重复；FROM、JOIN 里的派生表自成作用域，里面重新从 `t0` 数起，同样不会撞名。',
          '结果列的别名是 `c0`、`c1`……读回来时按 `select` 的键还原，所以结果里看到的是 `name`、`title`。',
          '写原生片段时不要手写 `t0`：把列插进 `sql` 模板，它渲染成带别名的列名，切方言、改 join 顺序都不会错。',
          '唯一要自己起名字的是 CTE：`db.with` 的第一个参数，之后用 `entity` 按这个名字引用。',
        ]}
      />
      <SqlExample example={rawAlias} title="sql 模板里引用列" />
    </Section>
  </DocPage>
));
