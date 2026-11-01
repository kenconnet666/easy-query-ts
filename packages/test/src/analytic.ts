/**
 * 分析型库（ClickHouse、Doris）的实库套件：它们取不回自增主键、没有能回滚的事务，共用套件（suite.ts）的种子数据与事务用例跑不了。
 * 这里主键由应用给值，测查询、导航 join、聚合、窗口、函数、更新删除与建表；方言特有的 SQL 写法由各包的测试另外断言。
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'vitest';
import {
  col,
  createDb,
  defineSchema,
  entity,
  win,
  type Adapter,
  type Statement,
} from '@zerodep-dev/easy-query-ts';
import { Post, schema, User } from './fixture.ts';

/** 主键由应用给值的实体：建表、写入、读回、planSync 往返 */
export const Metric = entity(
  't_metric',
  {
    id: col.bigint().primaryKey(),
    name: col.string(50).comment('指标名'),
    value: col.double(),
    ok: col.boolean(),
    day: col.date(),
    at: col.datetime(),
    note: col.string().nullable(),
  },
  { comment: '指标', indexes: [{ columns: ['day'], name: 'ix_metric_day' }] },
);

export interface AnalyticEnv {
  readonly adapter: Adapter;
  /** 重建 t_user、t_post（主键不自增），删掉 t_metric */
  readonly reset: () => Promise<void>;
}

/** 写入的 SQL 由各方言另外断言：传进来的回调拿到本用例执行过的语句 */
export interface AnalyticChecks {
  readonly writes?: (statements: readonly Statement[]) => void;
  readonly createTable?: (sql: string) => void;
}

export function analyticSuite(name: string, env: AnalyticEnv, checks: AnalyticChecks = {}): void {
  const statements: Statement[] = [];
  const db = createDb({ schema, adapter: env.adapter, log: (s) => statements.push(s) });

  beforeEach(async () => {
    await env.reset();
    await db
      .insert(User)
      .values([
        {
          id: 1,
          name: 'alice',
          age: 30,
          companyId: 1,
          attrs: { tags: ['vip', 'new'] },
          createdAt: new Date('2026-01-02T03:04:05.006Z'),
        },
        {
          id: 2,
          name: 'bob',
          age: null,
          companyId: null,
          attrs: { tags: [] },
          createdAt: new Date('2026-02-03T00:00:00.000Z'),
        },
        {
          id: 3,
          name: '张三',
          age: 17,
          companyId: 1,
          attrs: { tags: ['vip'] },
          createdAt: new Date('2026-03-04T12:30:00.000Z'),
        },
      ])
      .execute();
    await db
      .insert(Post)
      .values([
        { id: 10, userId: 1, title: 'orm tips', amount: '12.50' },
        { id: 11, userId: 1, title: 'sql 100%', amount: '7.25' },
        { id: 12, userId: 3, title: '中文标题', amount: '1.00' },
      ])
      .execute();
    statements.length = 0;
  });

  describe(`${name}: analytic suite`, () => {
    it('条件、排序、分页、计数', async () => {
      const q = db
        .queryable(User)
        .where((u) => [u.createdAt.ge(new Date('2026-01-15T00:00:00.000Z')), u.name.notLike('ali')])
        .orderBy((u) => u.id.desc());
      assert.deepEqual(await q.select((u) => u.name).toList(), ['张三', 'bob']);
      assert.equal(await q.count(), 2);
      const page = await db
        .queryable(User)
        .orderBy((u) => u.id)
        .toPage(2, 2);
      assert.deepEqual([page.rows.map((u) => u.id), page.total], [[3], 3]);
    });

    it('导航 join、分组聚合、子查询、窗口函数；LEFT JOIN 缺的行是 NULL', async () => {
      const rows = await db
        .queryable(Post)
        .orderBy((p) => p.id)
        .select((p) => ({ title: p.title, author: p.user.name }))
        .toList();
      assert.deepEqual(
        rows.map((r) => r.author),
        ['alice', 'alice', '张三'],
      );
      const totals = await db
        .queryable(Post)
        .groupBy((p) => ({ userId: p.userId }))
        .orderBy((g) => g.key.userId)
        .select((g) => ({
          userId: g.key.userId,
          total: g.sum((p) => p.amount),
          titles: g.joining((p) => p.title, { separator: '|' }),
        }))
        .toList();
      assert.deepEqual(
        totals.map((t) => [t.userId, t.total]),
        [
          [1, '19.75'],
          [3, '1.00'],
        ],
      );
      const withPosts = await db
        .queryable(User)
        .where((u) => u.posts.any())
        .orderBy((u) => u.id)
        .select((u) => ({
          name: u.name,
          n: u.posts.count(),
          rank: win.rowNumber((w) => w.orderBy(u.id.desc())),
        }))
        .toList();
      assert.deepEqual(
        withPosts.map((u) => [u.name, u.n, u.rank]),
        [
          ['alice', 2, 2],
          ['张三', 1, 1],
        ],
      );
      const companies = await db
        .queryable(Post)
        .orderBy((p) => p.id)
        .select((p) => ({ company: p.user.company.name }))
        .toList();
      assert.deepEqual(companies[0], { company: null });
    });

    it('函数：字符串、日期、JSON、条件', async () => {
      const row = await db
        .queryable(User)
        .where((u) => u.id.eq(1))
        .select((u) => ({
          upper: u.name.upper(),
          len: u.name.length(),
          sub: u.name.substring(1, 4),
          year: u.createdAt.year(),
          month: u.createdAt.dateTrunc('month'),
          later: u.createdAt.addDays(1),
          tags: u.attrs.jsonLength('tags'),
          first: u.attrs.jsonText('tags', 0),
          hasTags: u.attrs.jsonHas('tags'),
          adult: u.age.ge(18),
        }))
        .single();
      assert.deepEqual(
        { ...row, month: row.month.toISOString(), later: row.later.toISOString() },
        {
          upper: 'ALICE',
          len: 5,
          sub: 'lic',
          year: 2026,
          month: '2026-01-01T00:00:00.000Z',
          later: '2026-01-03T03:04:05.006Z',
          tags: 2,
          first: 'vip',
          hasTags: true,
          adult: true,
        },
      );
    });

    it('更新、删除（经过导航时按主键圈定范围）', async () => {
      await db
        .update(User)
        .set({ name: 'alicia' })
        .where((u) => u.id.eq(1))
        .execute();
      await db
        .delete(Post)
        .where((p) => p.user.name.eq('张三'))
        .execute();
      checks.writes?.(statements);
      assert.equal(
        await db
          .queryable(User)
          .where((u) => u.id.eq(1))
          .select((u) => u.name)
          .single(),
        'alicia',
      );
      assert.deepEqual(
        await db
          .queryable(Post)
          .orderBy((p) => p.id)
          .select((p) => p.id)
          .toList(),
        [10, 11],
      );
    });

    it('建表、写入、读回；读库结构后没有要改的', async () => {
      const mdb = createDb({ schema: defineSchema({ Metric }), adapter: env.adapter });
      await mdb.createTables();
      checks.createTable?.(mdb.createTableSql(Metric));
      await mdb
        .insert(Metric)
        .values([
          {
            id: 1,
            name: 'cpu',
            value: 0.5,
            ok: true,
            day: '2026-01-02',
            at: new Date('2026-01-02T03:04:05.006Z'),
            note: null,
          },
        ])
        .execute();
      const back = await mdb.queryable(Metric).single();
      assert.deepEqual(
        { ...back, at: back.at.toISOString() },
        {
          id: 1,
          name: 'cpu',
          value: 0.5,
          ok: true,
          day: '2026-01-02',
          at: '2026-01-02T03:04:05.006Z',
          note: null,
        },
      );
      assert.deepEqual((await mdb.planSync()).statements, []);
    });
  });
}
