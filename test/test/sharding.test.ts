// 分表规则本身：取模（整数、文字）、按时间的表名与裁剪
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { byDay, byMod, byMonth, byYear } from '@zerodep-dev/easy-query-ts';

describe('sharding rules', () => {
  it('byMod：整数按值取模（负数也落在 0..n-1），文字按稳定的哈希', () => {
    const rule = byMod('userId', 4);
    assert.deepEqual(rule.tables('t_log'), ['t_log_0', 't_log_1', 't_log_2', 't_log_3']);
    assert.equal(rule.tableOf('t_log', 6), 't_log_2');
    assert.equal(rule.tableOf('t_log', -1), 't_log_3');
    assert.equal(rule.tableOf('t_log', 6n), 't_log_2');
    assert.equal(rule.tableOf('t_log', 'abc'), rule.tableOf('t_log', 'abc'));
    assert.deepEqual(rule.prune('t_log', { values: [1, 5, 2] }), ['t_log_1', 't_log_2']);
    // 范围裁剪不了
    assert.equal(rule.prune('t_log', { min: { value: 1, inclusive: true } }).length, 4);
    assert.throws(() => byMod('userId', 0), /positive integer/);
  });

  it('byTime：表名按 UTC 的年 / 月 / 日，范围裁剪到 from..to 之内', () => {
    const month = byMonth('at', { from: '2025-11-20', to: () => new Date('2026-02-10T00:00:00Z') });
    assert.deepEqual(month.tables('t_o'), ['t_o_202511', 't_o_202512', 't_o_202601', 't_o_202602']);
    assert.equal(month.tableOf('t_o', new Date('2026-01-31T23:59:59Z')), 't_o_202601');
    assert.deepEqual(
      month.prune('t_o', {
        min: { value: new Date('2025-12-15T00:00:00Z'), inclusive: true },
        max: { value: new Date('2026-02-01T00:00:00Z'), inclusive: false },
      }),
      ['t_o_202512', 't_o_202601'],
    );
    assert.deepEqual(
      byYear('at', { from: '2024-06-01', to: () => new Date('2025-01-01') }).tables('t'),
      ['t_2024', 't_2025'],
    );
    assert.deepEqual(
      byDay('at', { from: '2026-02-27', to: () => new Date('2026-03-01') }).tables('t'),
      ['t_20260227', 't_20260228', 't_20260301'],
    );
  });
});
