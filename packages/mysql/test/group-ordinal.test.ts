// MySQL 的 only_full_group_by 同样认不出带参数的分组键：选出来了就按序号分组（实库用例在 PG 的 pglite-types.test.ts）
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  caseWhen,
  col,
  defineSchema,
  defineSnapshots,
  entity,
  renderSnapshots,
} from '@zerodep-dev/easy-query-ts';
import { MySqlDialect } from '../src/index.ts';

const Item = entity('t_item', { id: col.int().primaryKey(), stock: col.int() });

describe('mysql: 带参数的分组键', () => {
  it('GROUP BY、ORDER BY 写成序号，SELECT 只绑一份参数', () => {
    const { mysql } = renderSnapshots(
      defineSnapshots({
        schema: defineSchema({ Item }),
        dialects: { mysql: new MySqlDialect({ version: '8.4' }) },
        queries: {
          level: (db) =>
            db
              .queryable(Item)
              .groupBy((i) => ({ level: caseWhen(i.stock.ge(20), 'high').else('low') }))
              .orderBy((g) => g.key.level)
              .select((g) => ({ level: g.key.level, items: g.count() })),
        },
      }),
    );
    assert.match(mysql!, /GROUP BY 1 ORDER BY 1 ASC/);
    assert.match(mysql!, /params: \[20,"high","low"\]/);
  });
});
