/** 存在就更新 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { DocPage, Note, P, Section, SimpleTable } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import {
  compositeConflict,
  compositeMerge,
  mergeAll,
  mergeInsertsNew,
  upsertMany,
} from './more.examples.ts';
import { conditionalMerge, insertIgnore, upsert } from './write.examples.ts';

export default _component(() => () => (
  <DocPage>
    <Section id="merge" title="merge">
      <P text="`onConflict` 指定冲突的列，`merge` 指定冲突时覆盖哪些列。这是各库差别最大的语句之一，切换方言看看。" />
      <SimpleTable
        head={['数据库', '写法']}
        rows={[
          ['PostgreSQL、SQLite、DuckDB', 'ON CONFLICT ... DO UPDATE'],
          ['MySQL、MariaDB', 'ON DUPLICATE KEY UPDATE；8.0.19 起用行别名'],
          ['SQL Server、Oracle、达梦、Db2', 'MERGE'],
          ['openGauss', 'ON DUPLICATE KEY UPDATE'],
          ['Doris、TDengine', '同一主键再写一次就是覆盖'],
          ['ClickHouse', '不支持，类型上就没有 `onConflict`'],
        ]}
      />
      <SqlExample example={upsert} title="按主键，只覆盖名字" />
      <SqlExample example={mergeInsertsNew} title="没有冲突时就是插入" />
      <P text="`merge()` 不给列时覆盖全部插入的列。" />
      <SqlExample example={mergeAll} title="覆盖全部" />
      <SqlExample example={upsertMany} title="多行" />
    </Section>
    <Section id="composite" title="复合键">
      <SqlExample example={compositeMerge} title="订单明细：同一个商品改数量" />
    </Section>
    <Section id="ignore" title="已有就跳过">
      <P text="`ignore` 冲突时什么也不做。切到 MySQL 看：写成 ON DUPLICATE KEY UPDATE 主键等于自己，不用 INSERT IGNORE，免得吞掉别的错误。" />
      <SqlExample example={insertIgnore} title="已经有了就跳过" />
      <SqlExample example={compositeConflict} title="帖子打标签：打过就算了" />
    </Section>
    <Section id="only-if" title="带条件的覆盖">
      <P text="`onlyIf` 只在满足条件时覆盖，第一个参数是现有的行，第二个是新行。常见用法是只在版本更大时覆盖。PostgreSQL、SQLite 支持，别的库构建时报错。" />
      <SqlExample example={conditionalMerge} title="只在新库存更多时覆盖" />
      <Note text="MySQL 的 ON DUPLICATE KEY 按所有唯一键判断，冲突的列由表上的约束决定，`onConflict` 给的列在这里只用来选覆盖的范围。" />
    </Section>
  </DocPage>
));
