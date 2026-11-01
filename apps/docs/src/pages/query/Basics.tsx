/** 查询：从查一行到动态条件 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { DocPage, P, Points, Section, SimpleTable } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import {
  all,
  count,
  distinct,
  dynamic,
  exists,
  filter,
  find,
  first,
  limitOffset,
  nested,
  oneColumn,
  operators,
  orCondition,
  pickColumns,
  sort,
  sortPage,
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
    </Section>
    <Section id="where" title="条件">
      <P text="`where` 的回调拿到这张表的列，返回一个条件；数组就是 AND。列上的方法名就是比较方式，参数类型跟着列走，写错类型编译不过。" />
      <SqlExample example={filter} title="几个条件同时满足" />
      <SqlExample example={operators} title="区间、IN、LIKE、取反、判空" />
      <SqlExample example={orCondition} title="或者：or(...)" />
      <SqlExample example={nested} title="AND、OR、NOT 嵌套" />
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
          '`reversePageAfter(n)`：偏移超过总数的一半时倒序取再翻回来，深分页更快。',
        ]}
      />
    </Section>
  </DocPage>
));
