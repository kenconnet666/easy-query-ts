// 自关联的树（对应 Java 版的 toTreeList、asTreeCTE）：行拼成树、取某个节点的全部下级与全部上级
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'vitest';
import { col, createDb, defineSchema, entity } from '@zerodep-dev/easy-query-ts';
import { sqlite } from '@zerodep-dev/easy-query-ts-sqlite';

const Dept = entity('t_dept', {
  id: col.int().primaryKey(),
  parentId: col.int().nullable(),
  name: col.string(),
});
const schema = defineSchema({ Dept }, {});

async function deptDb() {
  const database = new DatabaseSync(':memory:');
  database.exec(
    'CREATE TABLE t_dept (id INTEGER PRIMARY KEY, parent_id INTEGER, name TEXT NOT NULL)',
  );
  const db = createDb({ schema, adapter: sqlite(database) });
  //        1 总部
  //       ├─ 2 研发 ── 4 前端
  //       └─ 3 销售
  //        5 子公司（另一棵树）
  await db
    .insert(Dept)
    .values([
      { id: 1, parentId: null, name: '总部' },
      { id: 2, parentId: 1, name: '研发' },
      { id: 3, parentId: 1, name: '销售' },
      { id: 4, parentId: 2, name: '前端' },
      { id: 5, parentId: null, name: '子公司' },
    ])
    .execute();
  return { db, database };
}

describe('sqlite: trees', async () => {
  const { db, database } = await deptDb();

  it('toTree：按 id 与 parent 把行挂到父节点下；父节点不在结果里的是根；节点是 select 的形状', async () => {
    const tree = await db
      .queryable(Dept)
      .orderBy((d) => d.id)
      .select((d) => ({ id: d.id, parentId: d.parentId, label: d.name }))
      .toTree({ id: 'id', parent: 'parentId' });
    const names = (nodes: typeof tree): unknown =>
      nodes.map((node) => [node.label, names(node.children)]);
    assert.deepEqual(names(tree), [
      [
        '总部',
        [
          ['研发', [['前端', []]]],
          ['销售', []],
        ],
      ],
      ['子公司', []],
    ]);
  });

  it('只查出一部分时，父节点不在结果里的行当作根；children 的名字可以换', async () => {
    const tree = await db
      .queryable(Dept)
      .where((d) => d.id.in([2, 4]))
      .toTree({ id: 'id', parent: 'parentId', children: 'items' });
    assert.equal(tree.length, 1);
    assert.equal(tree[0]!.name, '研发');
    assert.equal(tree[0]!.items[0]!.name, '前端');
  });

  it('行里有环时报错，列出环上的编号', async () => {
    database.exec("INSERT INTO t_dept VALUES (6, 7, '环 A'), (7, 6, '环 B')");
    await assert.rejects(
      db.queryable(Dept).toTree({ id: 'id', parent: 'parentId' }),
      /cycle.*6.*7|cycle.*7.*6/,
    );
    database.exec('DELETE FROM t_dept WHERE id IN (6, 7)');
  });

  it('descendantsOf：某个节点的全部下级（默认含它自己），之后照常 where、select、toTree', async () => {
    const names = await db
      .descendantsOf(Dept, 1, { parent: (d) => d.parentId })
      .orderBy((d) => d.id)
      .select((d) => d.name)
      .toList();
    assert.deepEqual(names, ['总部', '研发', '销售', '前端']);
    const below = await db
      .descendantsOf(Dept, 2, { parent: (d) => d.parentId, self: false })
      .select((d) => d.name)
      .toList();
    assert.deepEqual(below, ['前端']);
  });

  it('ancestorsOf：某个节点的全部上级（默认含它自己）', async () => {
    const names = await db
      .ancestorsOf(Dept, 4, { parent: (d) => d.parentId, self: false })
      .orderBy((d) => d.id)
      .select((d) => d.name)
      .toList();
    assert.deepEqual(names, ['总部', '研发']);
  });
});
