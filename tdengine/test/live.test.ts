/**
 * TDengine 实库测试。EQTS_TDENGINE_URL=ws://root:taosdata@127.0.0.1:26041/eqts，未设置时跳过
 * （容器：infra/dev/db.sh --profile tdengine up -d）。
 * 时序库没有自增、更新、子查询、事务，共用套件跑不了：这里用时间戳为主键的实体测建表、写入、查询、聚合、覆盖写与删除。
 */
import assert from 'node:assert/strict';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { sqlConnect, WSConfig, type WsSql } from '@tdengine/websocket';
import { col, createDb, defineSchema, entity, type Statement } from '@zerodep-dev/easy-query-ts';
import { tdengine } from '../src/index.ts';

const Reading = entity(
  't_reading',
  {
    ts: col.datetime().primaryKey(),
    device: col.string(20).nullable(),
    value: col.double().nullable(),
    ok: col.boolean().nullable(),
    count: col.bigint().nullable(),
  },
  { comment: '读数' },
);
const schema = defineSchema({ Reading });

const raw = process.env['EQTS_TDENGINE_URL'];

if (!raw) {
  describe('tdengine (live)', () => {
    it('skipped: set EQTS_TDENGINE_URL to run', { skip: true }, () => {});
  });
} else {
  const url = new URL(raw);
  const database = url.pathname.slice(1);
  let sql: WsSql;
  const statements: Statement[] = [];
  const open = (connection: WsSql) =>
    createDb({ schema, adapter: tdengine(connection), log: (s) => statements.push(s) });
  let db: ReturnType<typeof open>;

  beforeAll(async () => {
    const conf = new WSConfig(`ws://${url.host}`);
    conf.setUser(decodeURIComponent(url.username));
    conf.setPwd(decodeURIComponent(url.password));
    conf.setTimezone('UTC');
    const admin = await sqlConnect(conf);
    await admin.exec(`CREATE DATABASE IF NOT EXISTS ${database} PRECISION 'ms'`);
    await admin.close();
    conf.setDb(database);
    sql = await sqlConnect(conf);
    db = open(sql);
  });
  afterAll(async () => {
    await sql?.close();
  });

  const at = (minute: number) => new Date(Date.UTC(2026, 0, 2, 3, minute, 5, 6));

  beforeEach(async () => {
    await db.dropTables();
    await db.createTables();
    await db
      .insert(Reading)
      .values([
        { ts: at(0), device: 'a', value: 1.5, ok: true, count: 10 },
        { ts: at(1), device: "b'x", value: 2.5, ok: false, count: 20 },
        { ts: at(2), device: 'a', value: 4, ok: true, count: null },
      ])
      .execute();
    statements.length = 0;
  });

  describe(`tdengine ${url.port}`, () => {
    it('建表：时间戳主键在第一列、列没有 NOT NULL；值写成字面量', () => {
      assert.equal(
        db.createTableSql(Reading),
        "CREATE TABLE IF NOT EXISTS `t_reading` (`ts` TIMESTAMP, `device` NCHAR(20), `value` DOUBLE, `ok` BOOL, `count` BIGINT) COMMENT '读数'",
      );
      const { sql: text } = db
        .queryable(Reading)
        .where((r) => r.device.eq("b'x"))
        .toSQL();
      assert.match(text, /WHERE t0\.`device` = 'b\\'x'/);
    });

    it('条件、排序、分页、计数、聚合、分组', async () => {
      const rows = await db
        .queryable(Reading)
        .where((r) => r.ts.ge(at(1)))
        .orderBy((r) => r.ts.desc())
        .toList();
      assert.deepEqual(
        rows.map((r) => [r.ts.toISOString(), r.device, r.value, r.ok, r.count]),
        [
          ['2026-01-02T03:02:05.006Z', 'a', 4, true, null],
          ['2026-01-02T03:01:05.006Z', "b'x", 2.5, false, 20],
        ],
      );
      assert.equal(await db.queryable(Reading).count(), 3);
      const page = await db
        .queryable(Reading)
        .orderBy((r) => r.ts)
        .offset(1)
        .limit(1)
        .select((r) => r.device)
        .toList();
      assert.deepEqual(page, ["b'x"]);
      const groups = await db
        .queryable(Reading)
        .groupBy((r) => ({ device: r.device }))
        .orderBy((g) => g.key.device)
        .select((g) => ({ device: g.key.device, n: g.count(), total: g.sum((r) => r.value) }))
        .toList();
      assert.deepEqual(groups, [
        { device: 'a', n: 2, total: 5.5 },
        { device: "b'x", n: 1, total: 2.5 },
      ]);
    });

    it('同一时间戳再插入就是覆盖给出的列；删除按条件；没有 UPDATE', async () => {
      await db
        .insert(Reading)
        .values([{ ts: at(0), device: 'z', value: null, ok: null, count: null }])
        .onConflict((r) => r.ts)
        .merge((r) => [r.device, r.value, r.ok, r.count])
        .execute();
      assert.equal(
        await db
          .queryable(Reading)
          .where((r) => r.ts.eq(at(0)))
          .select((r) => r.device)
          .single(),
        'z',
      );
      assert.equal(
        await db
          .delete(Reading)
          .where((r) => r.ts.lt(at(2)))
          .execute(),
        2,
      );
      assert.match(
        statements.at(-1)!.sql,
        /^DELETE FROM `t_reading` WHERE `ts` < '2026-01-02 03:02:05\.006'$/,
      );
      // 没有 UPDATE：类型上就报错（方言能力），运行时也拦住
      assert.throws(
        () =>
          // @ts-expect-error the dialect of this Db does not support "update"
          db
            .update(Reading)
            .set({ device: 'x' })
            .where((r) => r.ts.eq(at(2)))
            .toSQL(),
        /no UPDATE/,
      );
    });

    it('读库结构后没有要改的', async () => {
      const plan = await db.planSync();
      assert.deepEqual(plan.statements, []);
    });
  });
}
