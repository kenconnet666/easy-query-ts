// col.datetime({ timeZone: true })：PG 建成 TIMESTAMPTZ，写入带偏移，会话时区改了照样是同一个时刻
import assert from 'node:assert/strict';
import { afterAll, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { col, createDb, defineSchema, Dialect, entity } from '@zerodep-dev/easy-query-ts';
import { pglite } from '../src/pglite.ts';

const Event = entity('t_event', {
  id: col.int().primaryKey(),
  at: col.datetime({ timeZone: true }),
  local: col.datetime(),
});

const database = new PGlite();
afterAll(() => database.close());
const db = createDb({ schema: defineSchema({ Event }), adapter: pglite(database) });

it('建成 timestamptz；会话时区不是 UTC 时写入、读出、比较都是同一个时刻', async () => {
  await db.createTables();
  const { rows } = await database.query<{ data_type: string }>(
    `SELECT data_type FROM information_schema.columns WHERE table_name = 't_event' AND column_name = 'at'`,
  );
  assert.equal(rows[0]?.data_type, 'timestamp with time zone');
  assert.deepEqual(await db.planSync(), { statements: [], differences: [] });

  await database.exec(`SET TIME ZONE 'Asia/Shanghai'`);
  const at = new Date('2026-03-01T12:30:45.123Z');
  await db.insert(Event).values({ id: 1, at, local: at }).execute();
  const row = await db.queryable(Event).findOrThrow(1);
  assert.equal(row.at.toISOString(), at.toISOString());
  const { rows: raw } = await database.query<{ utc: string }>(
    `SELECT to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.MS') AS utc FROM t_event`,
  );
  assert.equal(raw[0]?.utc, '2026-03-01 12:30:45.123');
  const later = await db
    .queryable(Event)
    .where((e) => e.at.gt(new Date('2026-03-01T12:30:45.000Z')))
    .count();
  assert.equal(later, 1);
});

it('别的库建表时报错：只有 PostgreSQL 有 TIMESTAMPTZ', () => {
  class Plain extends Dialect {
    readonly name = 'plain';
  }
  assert.throws(() => new Plain().createTable(Event), /TIMESTAMPTZ/);
});
