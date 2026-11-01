// 可观测性（ROADMAP 18.3.4）：每条语句一个 span；一个范围里同一条 SQL 反复执行（N+1）、慢查询报出来
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'vitest';
import {
  col,
  createDb,
  defineSchema,
  entity,
  statementSpans,
  type SpanTracer,
} from '@zerodep-dev/easy-query-ts';
import { queryWatch, type QueryWarning } from '@zerodep-dev/easy-query-ts/observe';
import { sqlite } from '@zerodep-dev/easy-query-ts-sqlite';

const Item = entity('t_obs_item', {
  id: col.int().primaryKey(),
  name: col.string(),
});

/** 记下 startSpan / setStatus / end 的假 Tracer */
function recordingTracer() {
  const spans: {
    name: string;
    attributes: Readonly<Record<string, string | number>>;
    status?: { code: number; message?: string };
    ended: boolean;
    startTime: number;
  }[] = [];
  const tracer: SpanTracer = {
    startSpan: (name, options) => {
      const span: (typeof spans)[number] = {
        name,
        attributes: options.attributes,
        ended: false,
        startTime: options.startTime,
      };
      spans.push(span);
      return {
        setStatus: (status) => (span.status = status),
        recordException: () => {},
        end: () => (span.ended = true),
      };
    },
  };
  return { spans, tracer };
}

describe('statementSpans 与 queryWatch', async () => {
  const { spans, tracer } = recordingTracer();
  const warnings: QueryWarning[] = [];
  const watch = queryWatch({ repeat: 3, slowMs: 1000, report: (w) => warnings.push(w) });
  const db = createDb({
    schema: defineSchema({ Item }),
    adapter: sqlite(new DatabaseSync(':memory:')),
    onExecute: [statementSpans(tracer), watch.onExecute],
  });
  await db.createTables();
  await db
    .insert(Item)
    .values([
      { id: 1, name: 'a' },
      { id: 2, name: 'b' },
      { id: 3, name: 'c' },
    ])
    .execute();

  it('每条语句一个 span：语义约定的属性，失败时记错误状态', async () => {
    spans.length = 0;
    await db.queryable(Item).toList();
    await assert.rejects(db.sql`SELECT * FROM t_missing`);
    assert.equal(spans.length, 2);
    const [ok, failed] = spans;
    assert.equal(ok!.name, 'SELECT');
    assert.deepEqual(
      {
        system: ok!.attributes['db.system.name'],
        rows: ok!.attributes['db.response.returned_rows'],
        ended: ok!.ended,
      },
      { system: 'sqlite', rows: 3, ended: true },
    );
    assert.match(String(ok!.attributes['db.query.text']), /FROM "t_obs_item"/);
    assert.ok(ok!.startTime <= Date.now());
    assert.equal(failed!.status?.code, 2);
    assert.match(failed!.status?.message ?? '', /no such table/);
  });

  it('一个范围里同一条读 SQL 到 repeat 次报一次；范围外不计数', async () => {
    warnings.length = 0;
    const byId = (id: number) =>
      db
        .queryable(Item)
        .where((i) => i.id.eq(id))
        .first();
    await watch.run(async () => {
      for (const id of [1, 2, 3, 1, 2]) await byId(id);
      await db.queryable(Item).count();
    });
    assert.deepEqual(
      warnings.map((w) => ({ kind: w.kind, count: w.kind === 'repeated' ? w.count : 0 })),
      [{ kind: 'repeated', count: 3 }],
    );
    assert.match(warnings[0]!.sql, /WHERE t0\."id" = \?/);
    for (const id of [1, 2, 3, 1]) await byId(id);
    assert.equal(warnings.length, 1);
  });

  it('慢查询：耗时到 slowMs 就报，不论在不在范围里', () => {
    const slow: QueryWarning[] = [];
    const w = queryWatch({ slowMs: 50, report: (x) => slow.push(x) });
    w.onExecute({
      statement: { sql: 'SELECT 1', params: [] },
      dialect: 'sqlite',
      kind: 'query',
      durationMs: 80,
      rows: 1,
      error: undefined,
    });
    assert.deepEqual(slow, [{ kind: 'slow', sql: 'SELECT 1', durationMs: 80 }]);
  });

  it('慢的读语句带上执行计划（explain），写语句与 EXPLAIN 自己照常报', async () => {
    const warnings: QueryWarning[] = [];
    let planned!: () => void;
    const done = new Promise<void>((resolve) => (planned = resolve));
    const watch = queryWatch({
      slowMs: 0,
      explain: (statement) => db.explain(statement),
      report: (w) => {
        warnings.push(w);
        if (w.kind === 'slow' && w.plan && w.sql.includes('t_obs_item')) planned();
      },
    });
    const db = createDb({
      schema: defineSchema({ Item }),
      adapter: sqlite(new DatabaseSync(':memory:')),
      onExecute: watch.onExecute,
    });
    await db.createTables();
    await db
      .queryable(Item)
      .where((i) => i.id.eq(1))
      .toList();
    await done;
    // 建表时读表结构的 SELECT 也慢（slowMs 0）、也带计划：找这条查询
    const withPlan = warnings.find(
      (w) => w.kind === 'slow' && w.plan !== undefined && w.sql.includes('t_obs_item'),
    );
    assert.ok(withPlan && withPlan.kind === 'slow');
    assert.match(withPlan.sql, /^SELECT/);
    assert.match(JSON.stringify(withPlan.plan), /t_obs_item|t0/);
    // EXPLAIN 自己与建表语句：不取计划
    assert.ok(
      warnings.some((w) => w.kind === 'slow' && /^EXPLAIN/.test(w.sql) && w.plan === undefined),
    );
  });
});
