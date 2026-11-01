// SQL 快照（ROADMAP 18.3.6）：按方言渲染成稳定的文本；eqts snapshot 写文件，--check 发现没更新的快照时失败
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, it } from 'vitest';
import { renderSnapshots } from '@zerodep-dev/easy-query-ts';
import demo from '../src/demo.snap.ts';

const bin = resolve(import.meta.dirname, '../../cli/src/bin.ts');
const module = resolve(import.meta.dirname, '../src/demo.snap.ts');
const out = mkdtempSync(join(tmpdir(), 'eqts-snapshot-'));
afterAll(() => rmSync(out, { recursive: true, force: true }));

/** 按源码跑 CLI（同 vitest 的解析条件）；失败时返回 stderr */
function eqts(...args: string[]): { ok: boolean; stderr: string } {
  try {
    execFileSync(process.execPath, ['--conditions=@vue-tsx-pro/source', bin, ...args], {
      stdio: 'pipe',
    });
    return { ok: true, stderr: '' };
  } catch (error) {
    return { ok: false, stderr: String((error as { stderr: Buffer }).stderr) };
  }
}

describe('SQL 快照', () => {
  it('按名字排序，每段是 SQL 与参数；方言不支持的写成 error', () => {
    const text = renderSnapshots(demo)['sqlite']!;
    assert.equal(
      text,
      [
        '-- adults',
        'SELECT t0."name" AS "c0" FROM "t_user" t0 WHERE t0."age" >= ?;',
        '-- params: [18]',
        '',
        '-- postsByAuthor',
        '-- error: rollup() is not supported by SQLite',
        '',
        '-- renameUser',
        'UPDATE "t_user" AS t0 SET "name" = ? WHERE t0."id" = ?;',
        '-- params: ["x",1]',
        '',
      ].join('\n'),
    );
    // 文本稳定：再渲染一次一样
    assert.equal(renderSnapshots(demo)['sqlite'], text);
  });

  it('eqts snapshot 写文件；--check 一致时通过，快照过期时失败并列出文件', () => {
    assert.deepEqual(eqts('snapshot', module, '--out', out), { ok: true, stderr: '' });
    const file = join(out, 'demo.snap.sqlite.sql');
    assert.equal(readFileSync(file, 'utf8'), renderSnapshots(demo)['sqlite']);
    assert.equal(eqts('snapshot', module, '--out', out, '--check').ok, true);
    writeFileSync(file, '-- stale\n');
    const stale = eqts('snapshot', module, '--out', out, '--check');
    assert.equal(stale.ok, false);
    assert.match(stale.stderr, /SQL snapshots are out of date[\s\S]*demo\.snap\.sqlite\.sql/);
  });
});
