/** 查询：从查一行到动态条件 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { DocPage, P, Points, Section, SimpleTable } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import {
  all,
  compositeKey,
  count,
  distinct,
  dynamic,
  exists,
  filter,
  find,
  first,
  limitOffset,
  nested,
  notInList,
  nullSafe,
  oneColumn,
  operators,
  orCondition,
  orElse,
  pickColumns,
  rootAggregates,
  sort,
  sortPage,
  whereKey,
  whereKeys,
} from './query.examples.ts';

export default _component(() => () => (
  <DocPage>
    <Section id="start" title="最简单的查询">
      <P text="`queryable` 开始一条查询，调用 `toList` 这类终结方法时才发 SQL。不写 `select` 就是整行，结果的类型来自实体。" />
      <SqlExample example={all} title="取几行" />
      <SqlExample example={find} title="按主键取一行" />
      <SimpleTable
        head={['终结方法', '返回']}
        rows={[
          ['`toList()`', '所有行'],
          ['`first()`', '第一行，没有时是 `undefined`'],
          ['`find(key)`、`findOrThrow(key)`', '按主键取，第二个找不到时抛错'],
          ['`count()`、`any()`', '行数、有没有'],
          ['`toPage(页码, 条数)`', '`{ rows, total, page, size }`'],
          ['`stream()`', '一批批读，不把结果集全读进内存'],
        ]}
      />
    </Section>
    <Section id="select" title="选列">
      <P text="`select` 返回什么形状，结果就是什么形状，类型跟着推出来。只选一列时结果是值的数组。" />
      <SqlExample example={pickColumns} title="选几列" />
      <SqlExample example={oneColumn} title="只要一列" />
      <SqlExample example={distinct} title="去重" />
    </Section>
    <Section id="aggregate" title="数一数">
      <SqlExample example={count} title="已发布的帖子有多少" />
      <SqlExample example={exists} title="有没有未成年用户" />
      <SqlExample example={first} title="阅读量最高的一篇" />
      <P text="`sum`、`avg`、`max`、`min`、`countDistinct` 不用先 `groupBy`，整条查询折成一个值。`sum`、`avg` 只接受数值列；同时写了 `limit` 会报错，因为聚合发生在分页之后没有意义。" />
      <SqlExample example={rootAggregates} title="已发布帖子的总量、平均、最高、最低和作者数" />
    </Section>
    <Section id="where" title="条件">
      <P text="`where` 的回调拿到这张表的列，返回一个条件；数组就是 AND。列上的方法名就是比较方式，参数类型跟着列走，写错类型编译不过。" />
      <SqlExample example={filter} title="几个条件同时满足" />
      <SqlExample example={operators} title="区间、IN、LIKE、取反、判空" />
      <SqlExample example={orCondition} title="或者：or(...)" />
      <SqlExample example={nested} title="AND、OR、NOT 嵌套" />
      <SimpleTable
        head={['方法', '含义']}
        rows={[
          ['`eq`、`ne`、`gt`、`ge`、`lt`、`le`', '比较；右边可以是值，也可以是另一列'],
          ['`in`、`notIn`', '在、不在列表里；也接受一条子查询'],
          ['`between`', '区间'],
          ['`isNull`、`isNotNull`', '判空'],
          [
            '`like`、`notLike`',
            '包含：两边自动加 `%`，输入里的 `%`、`_` 按字面匹配；`{ ignoreCase: true }` 忽略大小写',
          ],
          [
            '`startsWith`、`endsWith`、`notStartsWith`、`notEndsWith`',
            '开头、结尾，规则同 `like`；右边也可以是一列',
          ],
          ['`matches`', '正则，各库的 `~`、`REGEXP`、`REGEXP_LIKE`'],
          ['`eqNullSafe`', '两边都是 NULL 也算相等'],
          ['`collate(规则)`', '按指定排序规则比较：`u.name.collate("utf8mb4_bin").eq(x)`'],
          ['`inCsv(列)`', '本值在逗号分隔的列里，MySQL 是 `FIND_IN_SET`'],
          ['`orElse(值)`', '`COALESCE`：为空时取别的值，类型变成不可空'],
        ]}
      />
      <SqlExample example={notInList} title="notIn" />
      <P text="`=` 遇到 NULL 得到“未知”，参数可能为空时条件永远不成立。`eqNullSafe` 把两个 NULL 也算相等，切换方言看各库的写法。" />
      <SqlExample example={nullSafe} title="参数可能为空的相等" />
      <SqlExample example={orElse} title="空值给个默认" />
      <P text="按主键取用 `whereKey`，一组主键用 `whereKeys`；复合主键传对象。和 `find` 不同，它们只是加条件，之后还能接 `select`。" />
      <SqlExample example={whereKey} title="按主键，再选列" />
      <SqlExample example={whereKeys} title="一组主键" />
      <SqlExample example={compositeKey} title="复合主键" />
    </Section>
    <Section id="dynamic" title="动态条件">
      <P text="页面上的筛选项多半是可选的。条件数组里的 `undefined`、`false`、空字符串都被跳过，用 `&&` 就够了，不用写一串 if。表单字段多时用“列表页查询”一章的 `filterBy`。" />
      <SqlExample example={dynamic} title="没填的条件自动跳过" />
    </Section>
    <Section id="page" title="排序与分页">
      <P text="`orderBy` 可以返回一个数组，列本身就是升序，也可以写 `asc()`、`desc()`。" />
      <SqlExample example={sort} title="多列排序" />
      <P text="分页的写法各库差别很大：PostgreSQL 是 LIMIT OFFSET，Oracle、SQL Server 是 OFFSET FETCH，切换方言看看。" />
      <SqlExample example={limitOffset} title="跳过 4 行取 3 行" />
      <SqlExample example={sortPage} title="toPage：先数总数，再取这一页" />
      <Points
        items={[
          '`toPage` 的页码从 1 开始。总数已知时（只翻页）可以用 `table` 带上 `total`，少一条 COUNT。',
          '`createDb({ reversePageAfter })`：偏移超过它、也超过总数的一半时倒序取再翻回来，深分页更快。见“性能”。',
        ]}
      />
    </Section>
  </DocPage>
));
