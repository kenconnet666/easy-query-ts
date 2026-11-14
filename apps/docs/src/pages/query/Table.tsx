/** 列表页查询：filterBy、sortBy、table */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { CodeBlock } from '@zerodep-dev/vue-tsx-pro-ui';
import { DocPage, Note, P, Points, Section, SimpleTable } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import { filterBy, range, sortBy, table, whitelist } from './table.examples.ts';

const search = `// GET /users?name=林&name-op=lml&joinedAt-1=2026-01-01&joinedAt-2=2026-02-01&joinedAt-op=rco&sort=joinedAt:desc&current=2
const request = parseSearchRequest(query, {
  fields: ['name', 'joinedAt'],
  defaultSort: ['joinedAt:desc'],
});

const page = await db
  .queryable(User)
  .select((u) => ({ name: u.name, joinedAt: u.joinedAt }))
  .table(request);`;

export default _component(() => () => (
  <DocPage>
    <Section id="filter" title="按表单筛选">
      <P text="`filterBy` 接一个表单对象和一组规则。没填的字段跳过；同名的列直接写比较方式，不同名的写 `{ op, column }`；`column` 可以经过导航，也可以给几列，任一满足。这对应官方的 `whereObject`，规则的键和值类型都由实体推出，写错编译不过。" />
      <SqlExample example={filterBy} title="关键字查标题或作者，再加最低阅读量" />
      <P text="区间用 `between`，给一对值，任一端为空就不限。" />
      <P text="日期时间列上只写了日期的值（`2026-01-31`）一律按整天算，时区看 `timeZone`：等于是“落在这一天里”，小于等于含这一整天，大于是“这一天之后”，区间的两端同理。条件树、`search` 参数、`between` 用的是同一套；`in` 不按整天，要写出时刻。" />
      <P text="不走 `filterBy`、自己拼条件时，同样的规则可以单独拿来用：`rangeOf(列, 字段名, 起, 止)` 是“任一端为空就不限”的区间，`conditionOf(条件树, 形状)` 把前端传来的条件树变成条件，字段只认形状里有的列。两个都返回普通的条件，放进任何 `where`。" />
      <SqlExample example={range} title="年龄区间" />
      <SimpleTable
        head={['比较方式', '含义']}
        rows={[
          ['`eq`、`ne`', '等于、不等于'],
          ['`gt`、`ge`、`lt`、`le`', '大于、大于等于、小于、小于等于'],
          ['`like`、`startsWith`、`endsWith`', '包含、开头是、结尾是；空白的输入跳过'],
          ['`in`', '值在列表里；空列表跳过'],
          ['`between`', '区间，任一端为空不限'],
        ]}
      />
    </Section>
    <Section id="sort" title="按参数排序">
      <P text="前端传排序字段名，不能直接拼进 SQL。`sortBy` 只认登记过的名字，减号或 `desc` 是倒序，别的名字报错。" />
      <SqlExample example={sortBy} title="动态排序" />
    </Section>
    <Section id="table" title="一次接好表格">
      <P text="列表页的请求（页码、条数、排序、表头筛选、关键字）交给 `parseTableRequest` 解析，`table` 把它变成查询，返回 `{ rows, total, page, size }`。能筛选、排序的只有 `select` 里的列，相当于白名单，请求碰不到结果以外的列。" />
      <SqlExample example={table} title="解析请求，执行，拿到这一页和总数" />
      <P text="要收得更紧，用 `filterable`、`sortable` 单独列出来，键的类型由 `select` 推出。" />
      <SqlExample example={whitelist} title="只允许按状态筛选、按阅读量排序" />
      <Points
        items={[
          '请求参数：`page`、`pageSize`、`sort`（`-amount,name`）、`filter.列`（多选）、`search.列`（包含）、`total`（前端已知总数时不再数）。',
          '每页条数上限 2000，超过直接报错，不悄悄少给。',
          '其余参数留在 `request.params` 里，由你自己写进 `where`。',
        ]}
      />
      <Note text="这份参数格式和 vue-tsx-pro 组件库 `useTableQuery` 发出的一致，前后端可以直接对上。" />
    </Section>
    <Section id="search" title="另一套参数：search">
      <P text="已有的前端按官方 search 扩展（Bean Searcher 风格）传参时，`parseSearchRequest` 把它解析成 `table` 认的请求，白名单、整天的日期区间都沿用 `table`。" />
      <CodeBlock code={search} lang="ts" />
      <SimpleTable
        head={['参数', '含义']}
        rows={[
          ['`name=v`、`name-op=eq`', '比较方式默认 eq'],
          ['`name=a&name=b`、`name-0`、`name-1`', '多个值，配合 `in`、`ni`'],
          ['`name-1`、`name-2`', '区间的两端，缺一端不限'],
          ['`sort=name:desc`', '排序，可以多个；没给时用 `defaultSort`'],
          ['`current`、`pageSize`', '分页'],
        ]}
      />
      <P text="比较方式：`eq ne gt ge lt le`、`in ni`、`lk nl`（包含、不包含）、`lml nlml`（开头）、`lmr nlmr`（结尾）、`rc ro roc rco`（闭、开、左开右闭、左闭右开区间）和对应的 `nrc nro nroc nrco`、`inn`（非空）。严格模式（默认）下不认识的字段和比较方式报错，`{ strict: false }` 时忽略。" />
    </Section>
  </DocPage>
));
