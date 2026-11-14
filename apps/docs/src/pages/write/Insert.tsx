/** 插入 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { DocPage, Note, P, Points, Section, SimpleTable } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import {
  insertJson,
  insertManyMixed,
  insertNullable,
  insertSelectWithExpression,
  insertThenRead,
} from './more.examples.ts';
import {
  insertColumns,
  insertFromQuery,
  insertMany,
  insertOne,
  insertReturning,
  returnEntity,
} from './write.examples.ts';

export default _component(() => () => (
  <DocPage>
    <Section id="one" title="插入一行">
      <P text="`values` 的类型由实体推出：必填的列要给；自增、有默认值、可空的可省。没给的列不写进 SQL。" />
      <SimpleTable
        head={['结束方法', '返回', '各库怎么做']}
        rows={[
          ['`execute()`', '影响的行数', ''],
          [
            '`returnId()`',
            '自增主键，类型是主键列的类型',
            'PG、SQLite 是 RETURNING，MySQL 从驱动的结果里取，SQL Server 是 SCOPE_IDENTITY',
          ],
          [
            '`returnEntity()`',
            '整行，默认值都在',
            '有 RETURNING 的库一条语句；别的库先插入再按主键查回',
          ],
          ['`returning(...列)`', '指定的列，不写列名是整行', '没有 RETURNING 的库渲染时报错'],
        ]}
      />
      <SqlExample example={insertOne} title="插入一行，拿到主键" />
      <SqlExample example={returnEntity} title="插入一行，拿回整行" />
      <SqlExample example={insertNullable} title="可空的列可省" />
      <SqlExample example={insertJson} title="外键写的就是关联的主键" />
      <P text="刚插入的主键接着用。多条写入要一起成败时放进事务，见“事务”。" />
      <SqlExample example={insertThenRead} title="建公司，再建它的第一个员工" />
    </Section>
    <Section id="many" title="插入多行">
      <P text="给数组就是一条多行的 INSERT，按方言的参数上限自动切块，不用自己分批。" />
      <SqlExample example={insertMany} title="插入多行" />
      <P text="每行给的列可以不一样，按列分组写成几条语句。" />
      <SqlExample example={insertManyMixed} title="有的行给了年龄，有的没给" />
      <P text="切到 MySQL 看 `returning`：没有 RETURNING 的库在渲染时报错。这种库用 `returnId`、`returnEntity`，它们按方言自动选写法。" />
      <SqlExample example={insertReturning} title="插入多行，拿回主键和名字" />
      <Points
        items={[
          'PostgreSQL 100 行起写成一条 `unnest`，不受 65535 个参数的限制，只解析一次。',
          'MySQL 再按 `max_allowed_packet` 的四分之三切。',
        ]}
      />
    </Section>
    <Section id="columns" title="写哪些列">
      <P text="TS 里“没给”和“写 null”分得开：没给的列一律不写。`columns: 'notNull'` 把值为 null 的列也去掉，交给库里的默认值。" />
      <SqlExample example={insertColumns} title="null 的列不写" />
    </Section>
    <Section id="from-query" title="从查询插入">
      <P text="`fromQuery` 是 INSERT ... SELECT，数据不经过应用。`select` 的键就是目标列，类型检查必填列都要有。" />
      <SqlExample example={insertFromQuery} title="顶级分类的名字导入成标签" />
      <SqlExample example={insertSelectWithExpression} title="用表达式：复制一份打八折的商品" />
      <Note text="`fromQuery` 不经过插入拦截器，租户、默认值、版本要自己在 `select` 里给。" />
    </Section>
  </DocPage>
));
