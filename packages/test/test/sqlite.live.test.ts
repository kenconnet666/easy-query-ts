import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { seed, User } from '../src/fixture.ts';
import { liveSuite } from '../src/suite.ts';
import { memoryDb } from '../src/sqlite-env.ts';

liveSuite('sqlite', memoryDb, {
  jsonEdits: true,
  extensionTypes: true,
  extraTables: true,
  rollup: false,
  cube: false,
  rowLocks: false,
  returning: true,
});

describe('sqlite: computed date-times keep the stored text format', () => {
  it('addDays / addMonths 保留毫秒，结果能和日期参数直接比较', async () => {
    const { db } = await seed(await memoryDb());
    // alice 的 created_at = 2026-01-02 03:04:05.006
    const alice = db.queryable(User).where((u) => u.name.eq('alice'));
    assert.equal(
      await alice
        .where((u) => u.createdAt.addDays(1).eq(new Date('2026-01-03T03:04:05.006Z')))
        .count(),
      1,
    );
    assert.equal(
      await alice
        .where((u) => u.createdAt.addMonths(1).eq(new Date('2026-02-02T03:04:05.006Z')))
        .count(),
      1,
    );
    assert.equal(
      await alice
        .where((u) => u.createdAt.addDays(1).le(new Date('2026-01-03T03:04:05.000Z')))
        .count(),
      0,
    );
  });
});
