import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { createDb } from '@zerodep-dev/easy-query-ts';
import { ddlSchema, Gadget, Post, schema, User } from '@zerodep-dev/easy-query-ts-test/fixture';
import { MsSql, mssql } from '../src/index.ts';

const pool = {} as never;

describe('sqlserver: SQL text', () => {
  const db = createDb({ schema, adapter: mssql(pool) });
  const old = createDb({ schema, adapter: mssql(pool, { version: 2008 }) });

  it('[] 引号、@p 参数、OFFSET … FETCH（没排序时补 ORDER BY (SELECT NULL)）', () => {
    const { sql, params } = db
      .queryable(User)
      .where((u) => u.name.eq('alice'))
      .limit(5)
      .select((u) => u.id)
      .toSQL();
    assert.equal(
      sql,
      'SELECT t0.[id] AS [c0] FROM [t_user] t0 WHERE t0.[name] = @p1 ORDER BY (SELECT NULL) OFFSET 0 ROWS FETCH NEXT 5 ROWS ONLY',
    );
    assert.deepEqual(params, ['alice']);
  });

  it('2008：带偏移的分页用 ROW_NUMBER() 包一层', () => {
    const { sql } = old
      .queryable(Post)
      .orderBy((p) => p.id)
      .offset(10)
      .limit(5)
      .select((p) => p.title)
      .toSQL();
    assert.equal(
      sql,
      'SELECT eq_page.[c0] AS [c0] FROM (SELECT t0.[title] AS [c0], ROW_NUMBER() OVER (ORDER BY t0.[id] ASC) AS [eq_rn] FROM [t_post] t0) eq_page' +
        ' WHERE eq_page.[eq_rn] > 10 AND eq_page.[eq_rn] <= 15 ORDER BY eq_page.[eq_rn] ASC',
    );
  });

  it('条件当值写成 CASE WHEN，布尔列当条件写成 = 1', () => {
    const { sql } = db
      .queryable(User)
      .select((u) => ({ adult: u.age.ge(18) }))
      .toSQL();
    assert.equal(
      sql,
      'SELECT CASE WHEN t0.[age] >= @p1 THEN 1 ELSE 0 END AS [c0] FROM [t_user] t0',
    );
  });

  it('UPDATE / DELETE 写成 t0 … FROM；upsert 写成 MERGE；给自增列写值时打开 IDENTITY_INSERT', () => {
    assert.equal(
      db
        .update(Post)
        .set((p) => ({ title: p.user.name }))
        .where((p) => p.id.eq(1))
        .toSQL().sql,
      'UPDATE t0 SET [title] = t1.[name] FROM [t_post] AS t0 LEFT JOIN [t_user] t1 ON t1.[id] = t0.[user_id] WHERE t0.[id] = @p1',
    );
    assert.equal(
      db
        .delete(Post)
        .where((p) => p.id.eq(1))
        .toSQL().sql,
      'DELETE t0 FROM [t_post] AS t0 WHERE t0.[id] = @p1',
    );
    const [merge] = db
      .insert(Post)
      .values({ id: 9, userId: 1, title: 't', amount: '1.00' })
      .onConflict((p) => p.id)
      .merge((p) => p.title)
      .toSQL();
    assert.equal(
      merge!.sql,
      'SET IDENTITY_INSERT [t_post] ON; MERGE INTO [t_post] AS eq_t USING (VALUES (@p1, @p2, @p3, @p4)) AS eq_s ([id], [user_id], [title], [amount])' +
        ' ON (eq_t.[id] = eq_s.[id]) WHEN MATCHED THEN UPDATE SET eq_t.[title] = eq_s.[title]' +
        ' WHEN NOT MATCHED THEN INSERT ([id], [user_id], [title], [amount]) VALUES (eq_s.[id], eq_s.[user_id], eq_s.[title], eq_s.[amount]); SET IDENTITY_INSERT [t_post] OFF',
    );
  });

  it('版本门槛：没有旧写法的报出要哪个版本；专属函数只有这个方言认', () => {
    assert.throws(
      () =>
        old
          .queryable(User)
          .select((u) => u.createdAt.format('yyyy'))
          .toSQL(),
      /FORMAT needs sqlserver 2012 or later \(the dialect is configured for 2008\)/,
    );
    assert.equal(
      db
        .queryable(Post)
        .where((p) => MsSql.contains(p.title, '"orm*"'))
        .select((p) => p.id)
        .toSQL().sql,
      'SELECT t0.[id] AS [c0] FROM [t_post] t0 WHERE CONTAINS(t0.[title], @p1)',
    );
  });

  it('建表：IDENTITY、NVARCHAR、DATETIME2、BIT；注释写成扩展属性', () => {
    assert.equal(
      db.createTableSql(Gadget),
      'CREATE TABLE [t_gadget] ([id] BIGINT IDENTITY(1,1) NOT NULL, [name] NVARCHAR(50) NOT NULL, [price] DECIMAL(10, 2) NOT NULL,' +
        ' [qty] INT NOT NULL DEFAULT 0, [active] BIT NOT NULL, [born] DATE, [seen_at] DATETIME2(3) NOT NULL, [tags] NVARCHAR(MAX) NOT NULL,' +
        ' [photo] VARBINARY(MAX), PRIMARY KEY ([id]), UNIQUE ([name]))',
    );
    const statements = createDb({ schema: ddlSchema, adapter: mssql(pool) }).createTablesSql();
    assert.ok(
      statements.some((s) =>
        s.includes("sp_addextendedproperty @name = N'MS_Description', @value = N'书架'"),
      ),
    );
  });
});
