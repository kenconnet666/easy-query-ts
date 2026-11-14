import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { dateFormatParts } from '@zerodep-dev/easy-query-ts';
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

describe('date format patterns', () => {
  it('英文字母都是格式符：不认识的报错，要原样输出的用单引号括起来', () => {
    assert.deepEqual(dateFormatParts("yyyy-MM-dd'T'HH:mm 年"), [
      { token: 'yyyy' },
      { text: '-' },
      { token: 'MM' },
      { text: '-' },
      { token: 'dd' },
      { text: 'T' },
      { token: 'HH' },
      { text: ':' },
      { token: 'mm' },
      { text: ' 年' },
    ]);
    // 两个单引号是一个单引号，引号里外都一样
    assert.deepEqual(dateFormatParts("''yy 'o''clock'"), [
      { text: "'" },
      { token: 'yy' },
      { text: " o'clock" },
    ]);
    assert.throws(() => dateFormatParts('yyyy-M-d'), /'M' is not a supported pattern letter/);
    assert.throws(() => dateFormatParts('yyyy-MM-ddTHH'), /'T' is not a supported pattern letter/);
    assert.throws(() => dateFormatParts("yyyy 'open"), /quoted text is not closed/);
  });

  it('format() 的模式写错时在构建语句时就报错，不发到库里', async () => {
    const { db } = await memoryDb();
    assert.throws(
      () =>
        db
          .queryable(User)
          .select((u) => u.createdAt.format('yyyy-MM-dd hh:mm'))
          .toSQL(),
      /'h' is not a supported pattern letter/,
    );
  });
});
