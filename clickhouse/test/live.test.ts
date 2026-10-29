/**
 * ClickHouse 实库测试。EQTS_CLICKHOUSE_URL=http://eqts:密码@127.0.0.1:28123/eqts，未设置时跳过
 * （容器：infra/dev/db.sh --profile clickhouse up -d）。
 * 共用套件依赖自增主键与事务，ClickHouse 都没有：这里按它的能力单独测查询、函数、mutation 与建表。
 */
import assert from 'node:assert/strict';
import { afterAll, beforeEach, describe, it } from 'vitest';
import { createClient } from '@clickhouse/client';
import {
  col,
  createDb,
  defineSchema,
  entity,
  win,
  type Statement,
} from '@zerodep-dev/easy-query-ts';
import { Post, schema, User } from '@zerodep-dev/easy-query-ts-test/fixture';
import { clickhouse } from '../src/index.ts';

const DDL = [
  'DROP TABLE IF EXISTS t_user',
  'DROP TABLE IF EXISTS t_post',
  'DROP TABLE IF EXISTS t_metric',
  `CREATE TABLE t_user (id Int64, name String, age Nullable(Int32), company_id Nullable(Int64), attrs String DEFAULT '{}', created_at DateTime64(3)) ENGINE = MergeTree ORDER BY id`,
  'CREATE TABLE t_post (id Int64, user_id Int64, title String, amount Decimal(12, 2)) ENGINE = MergeTree ORDER BY id',
];

/** 主键由应用给值的实体（ClickHouse 的常见用法） */
const Metric = entity(
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
const metrics = defineSchema({ Metric });

const raw = process.env['EQTS_CLICKHOUSE_URL'];

if (!raw) {
  describe('clickhouse (live)', () => {
    it('skipped: set EQTS_CLICKHOUSE_URL to run', { skip: true }, () => {});
  });
} else {
  const url = new URL(raw);
  const client = createClient({
    url: `${url.protocol}//${url.host}`,
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
  });
  afterAll(() => client.close());
  const statements: Statement[] = [];
  const adapter = clickhouse(client);
  const db = createDb({ schema, adapter, log: (s) => statements.push(s) });

  beforeEach(async () => {
    for (const statement of DDL) await client.command({ query: statement });
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

  describe(`clickhouse ${url.port}`, () => {
    it('条件、排序、分页、计数；参数带类型', async () => {
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
      assert.match(statements[0]!.sql, /\{p1:String\}/);
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
        .queryable(User)
        .orderBy((u) => u.id)
        .select((u) => ({ company: u.companyId, age: u.age }))
        .toList();
      assert.deepEqual(companies[1], { company: null, age: null });
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

    it('更新、删除是同步的 mutation；经过导航时范围写成主键 IN 子查询', async () => {
      await db
        .update(User)
        .set({ name: 'alicia' })
        .where((u) => u.id.eq(1))
        .execute();
      await db
        .delete(Post)
        .where((p) => p.user.name.eq('张三'))
        .execute();
      assert.match(
        statements[0]!.sql,
        /^ALTER TABLE `t_user` UPDATE `name` = \{p2:String\} WHERE `id` = \{p1:Int64\}$/,
      );
      assert.match(
        statements[1]!.sql,
        /^ALTER TABLE `t_post` DELETE WHERE \(`id`\) IN \(SELECT t0\.`id` FROM `t_post` AS t0 /,
      );
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

    it('建表：MergeTree、Nullable、注释、跳数索引；读库结构后没有要改的', async () => {
      const mdb = createDb({ schema: metrics, adapter });
      await mdb.dropTables();
      await mdb.createTables();
      assert.match(
        mdb.createTableSql(Metric),
        /^CREATE TABLE IF NOT EXISTS `t_metric` \(`id` Int64, `name` String COMMENT '指标名', .*`note` Nullable\(String\)\) ENGINE = MergeTree ORDER BY \(`id`\) COMMENT '指标'$/,
      );
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
