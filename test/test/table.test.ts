// 列表页的请求 → 查询（对应 Java 版的 whereObject / orderByObject；参数同组件库 useTableQuery 的 tableParams）
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { parseTableRequest, rangeOf } from '@zerodep-dev/easy-query-ts';
import { seed, User } from '../src/fixture.ts';
import { memoryDb } from '../src/sqlite-env.ts';

describe('parseTableRequest', () => {
  it('读页码、条数、排序、总数、filter.、search.，其余原样留给使用方', () => {
    const request = parseTableRequest(
      new URLSearchParams(
        'page=2&pageSize=20&sort=-amount,name&total=368&filter.status=draft&filter.status=paid&filter.empty=&search.supplier=%20启航%20&keyword=泵',
      ),
    );
    assert.deepEqual(request, {
      page: 2,
      pageSize: 20,
      sorts: [
        { key: 'amount', descending: true },
        { key: 'name', descending: false },
      ],
      total: 368,
      filters: { status: ['draft', 'paid'] },
      searches: { supplier: '启航' },
      condition: undefined,
      params: { keyword: ['泵'] },
    });
  });

  it('框架解析好的 query 对象也认；没写页码、条数时 1、10；也认 `amount desc` 的排序写法', () => {
    const request = parseTableRequest({ sort: 'amount desc, id', 'filter.age': ['30'] });
    assert.equal(request.page, 1);
    assert.equal(request.pageSize, 10);
    assert.deepEqual(request.sorts, [
      { key: 'amount', descending: true },
      { key: 'id', descending: false },
    ]);
    assert.deepEqual(request.filters, { age: ['30'] });
  });

  it('页码、条数不对或条数超过上限时报错', () => {
    assert.throws(() => parseTableRequest({ page: '0' }), /page must be a positive integer/);
    assert.throws(() => parseTableRequest({ pageSize: '5000' }), /must not exceed 2000/);
  });
});

describe('sqlite: Queryable.table', async () => {
  const { db } = await seed(await memoryDb());
  const people = () =>
    db.queryable(User).select((u) => ({ name: u.name, age: u.age, company: u.company.name }));

  it('表头筛选按列的类型读值（数字列的 30）、关键字筛选是包含、排序按结果列；数出总数', async () => {
    const page = await people().table(
      parseTableRequest({ 'filter.age': ['30', '17'], 'search.name': 'a', sort: '-age' }),
    );
    assert.deepEqual(
      page.rows.map((row) => row.name),
      ['alice', 'carol'],
    );
    assert.equal(page.total, 2);
    assert.equal(page.size, 10);
  });

  it('筛选、排序可以用导航带出的列（company）；带了 total 时不再数行数', async () => {
    const page = await people().table(
      parseTableRequest({ 'filter.company': 'acme', sort: 'name', total: '99', pageSize: '1' }),
    );
    assert.deepEqual(
      page.rows.map((row) => row.name),
      ['alice'],
    );
    assert.equal(page.total, 99);
  });

  it('只认结果里的列：不在结果里、或不能搜索的列报错，并列出能用哪些', async () => {
    await assert.rejects(
      people().table(parseTableRequest({ sort: 'attrs' })),
      /cannot sort by 'attrs'.*columns: name, age, company/,
    );
    await assert.rejects(
      people().table(parseTableRequest({ 'search.age': '3' })),
      /only text columns can be searched/,
    );
    await assert.rejects(
      people().table(parseTableRequest({ 'filter.age': 'x' })),
      /expects a number/,
    );
  });

  it('没有 select 时结果列就是实体的列', async () => {
    const page = await db
      .queryable(User)
      .table(parseTableRequest({ sort: '-name', pageSize: '1' }));
    assert.equal(page.rows[0]!.name, 'carol');
  });

  it('条件树（FilterBar 的高级筛选）：all / any / not、between、in、contains、empty，字段只认结果列', async () => {
    const condition = JSON.stringify({
      all: [
        {
          any: [
            { field: 'age', op: 'gte', value: 18 },
            { field: 'age', op: 'empty' },
          ],
        },
        { not: { field: 'name', op: 'contains', value: 'ob' } },
        { field: 'company', op: 'in', value: ['acme'] },
      ],
    });
    const page = await people().table(parseTableRequest({ condition }));
    assert.deepEqual(
      page.rows.map((row) => row.name),
      ['alice'],
    );
    await assert.rejects(
      people().table(
        parseTableRequest({ condition: JSON.stringify({ field: 'attrs', op: 'exists' }) }),
      ),
      /cannot filter by 'attrs'/,
    );
    assert.throws(() => parseTableRequest({ condition: '{' }), /condition must be JSON/);
  });

  it('日期时间列上只写了日期的区间按整天算，时区可以指定；查询栏的区间用 rangeOf', async () => {
    const created = () =>
      db.queryable(User).select((u) => ({ name: u.name, createdAt: u.createdAt }));
    // 种子数据的时刻是 2026-01-02T03:04:05Z
    const between = (start: string, end: string) =>
      JSON.stringify({ field: 'createdAt', op: 'between', value: [start, end] });
    assert.equal(
      (await created().table(parseTableRequest({ condition: between('2026-01-02', '2026-01-02') })))
        .total,
      3,
    );
    assert.equal(
      (await created().table(parseTableRequest({ condition: between('', '2026-01-01') }))).total,
      0,
    );
    // 洛杉矶（UTC-8）那时还是 1 月 1 日晚上
    assert.equal(
      (
        await created().table(
          parseTableRequest({ condition: between('2026-01-01', '2026-01-01') }),
          {
            timeZone: 'America/Los_Angeles',
          },
        )
      ).total,
      3,
    );
    const request = parseTableRequest({ created: ['2026-01-02', ''] });
    const [start, end] = request.params['created']!;
    const rows = await db
      .queryable(User)
      .where((u) => rangeOf(u.createdAt, 'created', start, end))
      .count();
    assert.equal(rows, 3);
  });
});
