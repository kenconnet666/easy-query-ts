/** 基础查询：取行、选列、数一数 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { DocPage, Note, P, Section, SimpleTable } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import {
  distinctRows,
  findThrows,
  firstMissing,
  selectExpressions,
  selectNavigationRow,
  selectNested,
} from './basics.examples.ts';
import {
  all,
  compositeKey,
  count,
  distinct,
  exists,
  find,
  first,
  oneColumn,
  pickColumns,
  rootAggregates,
  whereKey,
  whereKeys,
} from './query.examples.ts';

export default _component(() => () => (
  <DocPage>
    <Section id="start" title="最简单的查询">
      <P text="`queryable` 开始一条查询，调用 `toList` 这类终结方法时才发 SQL。不写 `select` 就是整行，结果的类型来自实体。" />
      <SqlExample example={all} title="取几行" />
      <SimpleTable
        head={['终结方法', '返回']}
        rows={[
          ['`toList()`', '所有行'],
          ['`first()`', '第一行，没有时是 `undefined`'],
          ['`find(key)`', '按主键取，没有时是 `undefined`'],
          ['`findOrThrow(key)`', '按主键取，没有时抛 `NotFoundError`'],
          ['`count()`、`any()`', '行数、有没有'],
          ['`sum`、`avg`、`max`、`min`、`countDistinct`', '整条查询折成一个值'],
          ['`toPage(页码, 条数)`', '`{ rows, total, page, size }`，见“排序与分页”'],
          ['`table(请求)`', '解析好的列表页请求，见“列表页查询”'],
          ['`toTree(选项)`', '拼成树，见“树形数据”'],
          ['`stream()`', '一批批读，不把结果集全读进内存，见“性能”'],
          ['`toSQL()`、`explain()`', '只渲染、取执行计划，见“原生 SQL”'],
        ]}
      />
    </Section>
    <Section id="by-key" title="按主键取">
      <SqlExample example={find} title="find" />
      <P text="取不到时 `find`、`first` 是 `undefined`；一定要有的用 `findOrThrow`，接口层把 `NotFoundError` 翻译成 404。" />
      <SqlExample example={firstMissing} title="取不到" />
      <SqlExample example={findThrows} title="findOrThrow 抛错" />
      <P text="`whereKey`、`whereKeys` 只是加条件，之后还能接 `select`。复合主键传对象。" />
      <SqlExample example={whereKey} title="按主键，再选列" />
      <SqlExample example={whereKeys} title="一组主键" />
      <SqlExample example={compositeKey} title="复合主键" />
    </Section>
    <Section id="select" title="选列">
      <P text="`select` 返回什么形状，结果就是什么形状，类型跟着推出来，不用另写 DTO。" />
      <SqlExample example={pickColumns} title="选几列" />
      <P text="只选一列时结果是值的数组，不是对象的数组。" />
      <SqlExample example={oneColumn} title="只要一列" />
      <P text="值不一定是列：函数、运算、条件都是表达式，类型也跟着走。" />
      <SqlExample example={selectExpressions} title="算出来的值" />
      <P text="形状可以嵌套。SQL 还是平铺的列，读回来时按形状拼好。" />
      <SqlExample example={selectNested} title="嵌套的形状" />
      <P text="导航也能直接放进形状，得到那一整行；可空的导航没有时是 `null`。" />
      <SqlExample example={selectNavigationRow} title="带上作者整行" />
    </Section>
    <Section id="distinct" title="去重">
      <SqlExample example={distinct} title="一列去重" />
      <SqlExample example={distinctRows} title="几列组合去重" />
      <Note text="PostgreSQL 的 DISTINCT ON 用 `distinctOn`，见“分组与聚合”。" />
    </Section>
    <Section id="aggregate" title="数一数">
      <SqlExample example={count} title="已发布的帖子有多少" />
      <SqlExample example={exists} title="有没有未成年用户" />
      <SqlExample example={first} title="阅读量最高的一篇" />
      <P text="`sum`、`avg`、`max`、`min`、`countDistinct` 不用先 `groupBy`，整条查询折成一个值。`sum`、`avg` 只接受数值列；同时写了 `limit` 会报错，因为聚合发生在分页之后没有意义。" />
      <SqlExample example={rootAggregates} title="已发布帖子的总量、平均、最高、最低和作者数" />
    </Section>
  </DocPage>
));
