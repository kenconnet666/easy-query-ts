/**
 * 各方言在实库上跑的同一套用例。open 每次给一个已建表的空库；方言包的测试调用 liveSuite 即可。
 */
import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { entitySource } from '@zerodep-dev/easy-query-ts-cli';
import { describe, it } from 'vitest';
import {
  and,
  byMod,
  byMonth,
  caseWhen,
  col,
  entity,
  greatest,
  least,
  now,
  text,
  createDb,
  defineSchema,
  defineView,
  or,
  touch,
  win,
  type Expr,
  type ExecutionEvent,
  type Interceptor,
} from '@zerodep-dev/easy-query-ts';
import { CalendarDateTime, fromDate, parseDate, Time } from '@internationalized/date';
import { Decimal } from 'decimal.js';
import {
  Comment,
  Token,
  Company,
  Dept,
  Doc,
  Ext,
  Gadget,
  Member,
  Note,
  Post,
  Role,
  schema,
  seed,
  User,
  UserRole,
  type TestEnv,
} from './fixture.ts';

// 用例里自己写的拦截器：名字要登记，noInterceptor 才认得
declare module '@zerodep-dev/easy-query-ts' {
  interface InterceptorNames {
    adults: true;
    'default-age': true;
    audit: true;
    veto: true;
  }
}

export interface LiveSuiteOptions {
  /** 库里建了 t_ext 表，可以跑 decimal.js / bigint / @internationalized/date 的往返用例 */
  readonly extensionTypes?: boolean;
  /** 库里建了 t_role / t_user_role / t_member / t_note，可以跑多对多与复合外键的用例 */
  readonly extraTables?: boolean;
  /** 是否测试递归 CTE；HANA 没有 WITH RECURSIVE，传 false */
  readonly recursiveCte?: boolean;
  /** 是否测试只读事务；各库的拒绝写入报错不同，只断言"会失败"。HANA 未验证时可关 */
  readonly readOnlyTransactions?: boolean;
  /** 保存点（嵌套事务）；DuckDB 没有 */
  readonly savepoints?: boolean;
  /** 外键的 ON DELETE / ON UPDATE 动作；DuckDB 没有 */
  readonly foreignKeyActions?: boolean;
  /** 以下能力默认都测；某个库不支持就传 false */
  readonly dateTrunc?: boolean;
  readonly rollup?: boolean;
  readonly cube?: boolean;
  /** 行锁（SKIP LOCKED / NOWAIT）要两条连接同时持锁：SQLite 只有一条连接，没有行锁 */
  readonly rowLocks?: boolean;
  /** CREATE TABLE … AS SELECT（HANA 要加括号，写法不同） */
  readonly createTableAs?: boolean;
  /** 是否支持 RETURNING（PG、SQLite 支持；MySQL、HANA 不支持，改测"报不支持"） */
  readonly returning?: boolean;
  /** 是否测试代码优先建表（createTables）的往返 */
  readonly ddl?: boolean;
  /** 窗口函数 NTH_VALUE（SQL Server 没有） */
  readonly nthValue?: boolean;
  /** FOR UPDATE NOWAIT（Db2 LUW 没有，只有 SKIP LOCKED DATA） */
  readonly noWait?: boolean;
  /** jsonLength（Db2 的 JSON_TABLE 只能从根展开，数不了数组长度） */
  readonly jsonLength?: boolean;
}

export function liveSuite(
  name: string,
  open: () => Promise<TestEnv>,
  options: LiveSuiteOptions = {},
): void {
  const seeded = async () => seed(await open());

  describe(`${name}: queries`, () => {
    it('reads rows with decoded values', async () => {
      const { db } = await seeded();
      const alice = await db
        .queryable(User)
        .where((u) => u.name.eq('alice'))
        .single();
      assert.equal(alice.id, 1);
      assert.deepEqual(alice.attrs, { tags: ['vip'] });
      assert.ok(alice.createdAt instanceof Date);
      assert.equal(alice.createdAt.toISOString(), '2026-01-02T03:04:05.006Z');
      assert.equal(
        await db
          .queryable(User)
          .where((u) => u.name.eq('nobody'))
          .first(),
        undefined,
      );
    });

    it('escapes LIKE wildcards in the searched text', async () => {
      const { db } = await seeded();
      const titles = await db
        .queryable(Post)
        .where((p) => p.title.like('_'))
        .select((p) => ({ t: p.title }))
        .toList();
      assert.deepEqual(titles, [{ t: 'orm_v2' }]);
      assert.equal(
        await db
          .queryable(Post)
          .where((p) => p.title.endsWith('100%'))
          .count(),
        1,
      );
    });

    it('filters through navigations and implicit subqueries', async () => {
      const { db } = await seeded();
      const names = await db
        .queryable(User)
        .where((u) => [u.company.name.eq('acme'), u.posts.any((p) => p.title.startsWith('orm'))])
        .orderBy((u) => u.id)
        .select((u) => ({ name: u.name }))
        .toList();
      assert.deepEqual(names, [{ name: 'alice' }, { name: 'bob' }]);
      assert.equal(
        await db
          .queryable(User)
          .where((u) => u.posts.none())
          .count(),
        1,
      );
    });

    it('selects nullable navigations, aggregates and nested objects', async () => {
      const { db } = await seeded();
      const rows = await db
        .queryable(User)
        .orderBy((u) => u.id)
        .select((u) => ({
          name: u.name,
          company: u.company.name,
          stats: {
            posts: u.posts.count(),
            big: u.posts.count((p) => p.amount.gt('100')),
            max: u.posts.max((p) => p.title),
          },
        }))
        .toList();
      assert.deepEqual(rows, [
        { name: 'alice', company: 'acme', stats: { posts: 2, big: 1, max: 'sql 100%' } },
        { name: 'bob', company: 'acme', stats: { posts: 2, big: 0, max: 'orm_v2' } },
        { name: 'carol', company: null, stats: { posts: 0, big: 0, max: null } },
      ]);
    });

    it('assembles object trees with toList, nested two levels', async () => {
      const { db, statements } = await seeded();
      const rows = await db
        .queryable(User)
        .where((u) => u.company.name.eq('acme'))
        .orderBy((u) => u.id)
        .select((u) => ({
          name: u.name,
          posts: u.posts
            .where((p) => p.amount.gt('2'))
            .orderBy((p) => p.id.desc())
            .toList((p) => ({
              title: p.title,
              author: p.user.name,
              comments: p.comments.orderBy((c) => c.id).toList((c) => ({ body: c.body })),
            })),
        }))
        .toList();
      assert.deepEqual(rows, [
        {
          name: 'alice',
          posts: [
            { title: 'sql 100%', author: 'alice', comments: [] },
            {
              title: 'orm tips',
              author: 'alice',
              comments: [{ body: 'nice' }, { body: 'thanks' }],
            },
          ],
        },
        { name: 'bob', posts: [{ title: 'hello', author: 'bob', comments: [] }] },
      ]);
      assert.equal(statements.length, 3, 'one query per level');
    });

    it('includes navigations on whole rows', async () => {
      const { db } = await seeded();
      const users = await db
        .queryable(User)
        .where((u) => u.name.in(['bob', 'carol']))
        .orderBy((u) => u.id)
        .include((u) => ({ company: u.company, posts: u.posts.orderBy((p) => p.id).toList() }))
        .toList();
      assert.equal(users[0]!.company?.name, 'acme');
      assert.deepEqual(
        users[0]!.posts.map((p) => p.title),
        ['orm_v2', 'hello'],
      );
      assert.equal(users[1]!.company, null);
      assert.deepEqual(users[1]!.posts, []);
    });

    it('groups with conditional aggregates and having', async () => {
      const { db } = await seeded();
      const rows = await db
        .queryable(Post)
        .groupBy((p) => ({ userId: p.userId }))
        .having((g) => g.count().ge(2))
        .orderBy((g) => g.key.userId)
        .select((g) => ({
          ...g.key,
          n: g.count(),
          orm: g.count((p) => p.title.startsWith('orm')),
          total: g.sum((p) => p.amount),
        }))
        .toList();
      assert.deepEqual(
        rows.map((r) => [r.userId, r.n, r.orm]),
        [
          [1, 2, 1],
          [2, 2, 1],
        ],
      );
      assert.equal(Number(rows[0]!.total), 2010.5);
      assert.equal(
        await db
          .queryable(Post)
          .groupBy((p) => ({ userId: p.userId }))
          .count(),
        2,
      );
    });

    it('pages with a total count', async () => {
      const { db } = await seeded();
      const page = await db
        .queryable(Post)
        .orderBy((p) => p.id)
        .select((p) => ({ id: p.id }))
        .toPage(2, 3);
      assert.deepEqual(page, { rows: [{ id: 4 }], total: 4, page: 2, size: 3 });
    });

    it('reuses builders without leaking state', async () => {
      const { db } = await seeded();
      const base = db.queryable(Post).where((p) => p.title.startsWith('orm'));
      assert.equal(await base.count(), 2);
      assert.equal((await base.where((p) => p.user.name.eq('bob')).toList()).length, 1);
      assert.equal((await base.toList()).length, 2);
      assert.equal(await base.any(), true);
    });

    it('combines and / or / not helpers', async () => {
      const { db } = await seeded();
      const n = await db
        .queryable(User)
        .where((u) => or(and(u.age.ge(18), u.name.eq('alice')), u.company.id.isNull()))
        .count();
      assert.equal(n, 2);
    });

    it('uses dialect functions', async () => {
      const { db } = await seeded();
      const r = await db
        .queryable(User)
        .where((u) => u.id.eq(1))
        .select((u) => ({
          up: u.name.upper(),
          len: u.name.length(),
          year: u.createdAt.year(),
          label: u.name.concat('@', u.company.name.orElse('-')),
        }))
        .single();
      assert.deepEqual(r, { up: 'ALICE', len: 5, year: 2026, label: 'alice@acme' });
    });

    it('rejects outer navigations inside toList filters', async () => {
      const { db } = await seeded();
      await assert.rejects(
        db
          .queryable(User)
          .select((u) => ({ posts: u.posts.where((p) => p.title.eq(u.name)).toList() }))
          .toList(),
        /not part of this statement/,
      );
    });

    it('runs subqueries through deep navigation', async () => {
      const { db } = await seeded();
      const companies = await db
        .queryable(Company)
        .where((c) => c.users.any((u) => u.posts.any((p) => p.comments.any())))
        .select((c) => ({ name: c.name }))
        .toList();
      assert.deepEqual(companies, [{ name: 'acme' }]);
      assert.equal(
        await db
          .queryable(Comment)
          .where((c) => c.post.user.company.name.eq('acme'))
          .count(),
        2,
      );
    });
  });

  describe(`${name}: writes`, () => {
    it('updates with expressions and conditions', async () => {
      const { db } = await seeded();
      const n = await db
        .update(User)
        .set((u) => ({ age: u.age.plus(1), name: 'alice2' }))
        .where((u) => u.name.eq('alice'))
        .execute();
      assert.equal(n, 1);
      const alice = await db
        .queryable(User)
        .where((u) => u.id.eq(1))
        .single();
      assert.equal(alice.age, 31);
      assert.equal(alice.name, 'alice2');
    });

    it('updates and deletes through many-navigation subqueries', async () => {
      const { db } = await seeded();
      assert.equal(
        await db
          .update(User)
          .set({ age: 99 })
          .where((u) => u.posts.any((p) => p.amount.gt('1000')))
          .execute(),
        1,
      );
      assert.equal(
        await db
          .delete(Post)
          .where((p) => p.title.startsWith('orm'))
          .execute(),
        2,
      );
      assert.equal(await db.queryable(Post).count(), 2);
    });

    it('updates a whole row by primary key', async () => {
      const { db } = await seeded();
      const alice = await db
        .queryable(User)
        .where((u) => u.name.eq('alice'))
        .single();
      assert.equal(
        await db
          .update(User)
          .entity({ ...alice, name: 'alice2', attrs: { tags: ['x'] } })
          .execute(),
        1,
      );
      const after = await db
        .queryable(User)
        .where((u) => u.id.eq(alice.id))
        .single();
      assert.equal(after.name, 'alice2');
      assert.deepEqual(after.attrs, { tags: ['x'] });
      assert.equal(after.createdAt.toISOString(), alice.createdAt.toISOString());
    });

    it('deletes everything only with all()', async () => {
      const { db } = await seeded();
      assert.equal(await db.delete(Comment).all().execute(), 2);
    });

    it('commits and rolls back transactions', async () => {
      const { db } = await seeded();
      await db.transaction(async (tx) => {
        await tx
          .update(User)
          .set({ age: 1 })
          .where((u) => u.id.eq(1))
          .execute();
      });
      await assert.rejects(
        db.transaction(async (tx) => {
          await tx
            .update(User)
            .set({ age: 2 })
            .where((u) => u.id.eq(1))
            .execute();
          throw new Error('boom');
        }),
        /boom/,
      );
      assert.equal(
        (
          await db
            .queryable(User)
            .where((u) => u.id.eq(1))
            .single()
        ).age,
        1,
      );
    });

    it('serializes concurrent transactions that lock the same row', async () => {
      const { db } = await seeded();
      const bump = () =>
        db.transaction(async (tx) => {
          const { age } = await tx
            .queryable(User)
            .where((u) => u.id.eq(1))
            .forUpdate()
            .single();
          await new Promise((r) => setTimeout(r, 5));
          await tx
            .update(User)
            .set({ age: (age ?? 0) + 1 })
            .where((u) => u.id.eq(1))
            .execute();
        });
      await Promise.all([bump(), bump(), bump()]);
      assert.equal(
        (
          await db
            .queryable(User)
            .where((u) => u.id.eq(1))
            .single()
        ).age,
        33,
      );
    });

    it('lock() serializes read-modify-write on the same row and reports whether it exists', async () => {
      const { db } = await seeded();
      const bump = () =>
        db.transaction(async (tx) => {
          assert.equal(await tx.lock(User, 1), true);
          const { age } = await tx.queryable(User).findOrThrow(1);
          await new Promise((r) => setTimeout(r, 5));
          await tx
            .update(User)
            .set({ age: (age ?? 0) + 1 })
            .where((u) => u.id.eq(1))
            .execute();
        });
      await Promise.all([bump(), bump(), bump()]);
      assert.equal((await db.queryable(User).findOrThrow(1)).age, 33);
      assert.equal(await db.transaction((tx) => tx.lock(User, -1)), false);
    });

    it('afterCommit runs after commit only; afterRollback after rollback only', async () => {
      const { db } = await seeded();
      const seen: string[] = [];
      await db.transaction(async (tx) => {
        tx.afterCommit(() => seen.push('committed'));
        tx.afterRollback(() => seen.push('rolled back'));
        await tx
          .update(User)
          .set({ age: 5 })
          .where((u) => u.id.eq(1))
          .execute();
        assert.deepEqual(seen, []);
      });
      await assert.rejects(
        db.transaction(async (tx) => {
          tx.afterCommit(() => seen.push('never'));
          tx.afterRollback(() => seen.push('undone'));
          throw new Error('boom');
        }),
        /boom/,
      );
      assert.deepEqual(seen, ['committed', 'undone']);
    });

    it('expectRows throws its error and rolls back when the update hits another number of rows', async () => {
      const { db } = await seeded();
      const handled = (affected: number) => new Error(`already handled (${affected})`);
      await db.transaction((tx) =>
        tx
          .update(User)
          .set({ age: 7 })
          .where((u) => u.id.eq(1))
          .expectRows(1, handled)
          .execute(),
      );
      await assert.rejects(
        db.transaction(async (tx) => {
          await tx
            .update(User)
            .set({ age: 8 })
            .where((u) => u.id.eq(1))
            .execute();
          await tx
            .update(User)
            .set({ age: 9 })
            .where((u) => u.id.eq(-1))
            .expectRows(1, handled)
            .execute();
        }),
        /already handled \(0\)/,
      );
      assert.equal((await db.queryable(User).findOrThrow(1)).age, 7);
    });
  });

  describe(`${name}: upsert and interceptors`, () => {
    it('upserts by merging, defaulting the merged columns, and ignoring', async () => {
      const { db } = await seeded();
      await db
        .insert(Company)
        .values({ id: 1, name: 'acme2' })
        .onConflict((c) => c.id)
        .merge((c) => [c.name])
        .execute();
      await db
        .insert(Company)
        .values({ id: 2, name: 'globex2' })
        .onConflict((c) => c.id)
        .merge()
        .execute();
      await db
        .insert(Company)
        .values({ id: 1, name: 'ignored' })
        .onConflict((c) => c.id)
        .ignore()
        .execute();
      const names = await db
        .queryable(Company)
        .orderBy((c) => c.id)
        .select((c) => ({ name: c.name }))
        .toList();
      assert.deepEqual(names, [{ name: 'acme2' }, { name: 'globex2' }]);
    });

    it('applies filters to the root, joins, subqueries, toList and writes', async () => {
      const env = await seeded();
      const adults: Interceptor = {
        name: 'adults',
        filter: (ref, entity) =>
          entity.table === 't_user' && (ref as unknown as { age: Expr<number | null> }).age.ge(18),
      };
      const db = createDb({ schema, adapter: env.adapter, interceptors: [adults] });
      assert.equal(await db.queryable(User).count(), 1);
      assert.equal(await db.queryable(User).noInterceptor('adults').count(), 3);
      // LEFT JOIN 的条件进 ON：帖子都在，bob 的帖子作者为 null
      const authors = await db
        .queryable(Post)
        .orderBy((p) => p.id)
        .select((p) => ({ author: p.user.name }))
        .toList();
      assert.deepEqual(
        authors.map((a) => a.author),
        ['alice', 'alice', null, null],
      );
      const companies = await db
        .queryable(Company)
        .orderBy((c) => c.id)
        .select((c) => ({ n: c.users.count(), users: c.users.toList((u) => ({ name: u.name })) }))
        .toList();
      assert.deepEqual(companies, [
        { n: 1, users: [{ name: 'alice' }] },
        { n: 0, users: [] },
      ]);
      assert.equal(await db.update(User).set({ age: 50 }).all().execute(), 1);
      assert.equal(
        (
          await env.db
            .queryable(User)
            .where((u) => u.name.eq('bob'))
            .single()
        ).age,
        null,
      );
    });

    it('fills values before insert and update', async () => {
      const env = await seeded();
      const defaultAge: Interceptor = {
        name: 'default-age',
        beforeInsert: (row, entity) => {
          if (entity.table === 't_user' && row['age'] === undefined) row['age'] = 1;
        },
      };
      const db = createDb({
        schema,
        adapter: env.adapter,
        interceptors: [defaultAge, touch('title', () => 'touched')],
      });
      await db
        .insert(User)
        .values({ name: 'dave', attrs: { tags: [] }, createdAt: new Date() })
        .execute();
      assert.equal(
        (
          await db
            .queryable(User)
            .where((u) => u.name.eq('dave'))
            .single()
        ).age,
        1,
      );
      await db
        .update(Post)
        .set({ amount: '9.00' })
        .where((p) => p.id.eq(1))
        .execute();
      assert.equal(
        (
          await db
            .queryable(Post)
            .where((p) => p.id.eq(1))
            .single()
        ).title,
        'touched',
      );
    });
  });

  describe(`${name}: windows and per-parent limits`, () => {
    it('computes row numbers, running totals, lag and global counts', async () => {
      const { db } = await seeded();
      const rows = await db
        .queryable(Post)
        .orderBy((p) => p.id)
        .select((p) => ({
          id: p.id,
          rn: win.rowNumber((w) => w.partitionBy(p.userId).orderBy(p.id.desc())),
          running: win.sum(p.amount, (w) =>
            w.partitionBy(p.userId).orderBy(p.id).rows('unboundedPreceding', 'currentRow'),
          ),
          prev: win.lag(p.title, (w) => w.orderBy(p.id)),
          total: win.count(),
        }))
        .toList();
      assert.deepEqual(
        rows.map((r) => [r.id, r.rn, Number(r.running), r.prev, r.total]),
        [
          [1, 2, 10.5, null, 4],
          [2, 1, 2010.5, 'orm tips', 4],
          [3, 2, 1.25, 'sql 100%', 4],
          [4, 1, 4.25, 'orm_v2', 4],
        ],
      );
    });

    it('takes the first row and the top n per parent', async () => {
      const { db } = await seeded();
      const rows = await db
        .queryable(User)
        .orderBy((u) => u.id)
        .select((u) => ({
          name: u.name,
          latest: u.posts.orderBy((p) => p.id.desc()).first((p) => ({ title: p.title })),
          top: u.posts
            .orderBy((p) => p.amount.desc())
            .limit(1)
            .toList((p) => ({ title: p.title })),
        }))
        .toList();
      assert.deepEqual(rows, [
        { name: 'alice', latest: { title: 'sql 100%' }, top: [{ title: 'sql 100%' }] },
        { name: 'bob', latest: { title: 'hello' }, top: [{ title: 'hello' }] },
        { name: 'carol', latest: null, top: [] },
      ]);
    });
  });

  describe(`${name}: functions and CASE`, () => {
    it('runs string functions', async () => {
      const { db } = await seeded();
      // 第 1 篇帖子的标题是 'orm tips'
      const row = await db
        .queryable(Post)
        .where((p) => p.id.eq(1))
        .select((p) => ({
          head: p.title.substring(0, 3),
          tail: p.title.substring(4),
          replaced: p.title.replace('orm', 'ORM'),
          found: p.title.indexOf('tips'),
          missing: p.title.indexOf('zzz'),
          left: p.title.left(3),
          right: p.title.right(4),
          rightAll: p.title.right(100),
        }))
        .single();
      assert.deepEqual(row, {
        head: 'orm',
        tail: 'tips',
        replaced: 'ORM tips',
        found: 4,
        missing: -1,
        left: 'orm',
        right: 'tips',
        rightAll: 'orm tips',
      });
    });

    it('runs math functions', async () => {
      const { db } = await seeded();
      // 第 3 篇帖子金额 1.25；alice 30 岁
      const post = await db
        .queryable(Post)
        .where((p) => p.id.eq(3))
        .select((p) => ({
          rounded: p.amount.round(1),
          floor: p.amount.floor(),
          ceil: p.amount.ceil(),
          abs: p.amount.minus(5).abs(),
        }))
        .single();
      assert.deepEqual(
        [Number(post.rounded), Number(post.floor), Number(post.ceil), Number(post.abs)],
        [1.3, 1, 2, 3.75],
      );
      const user = await db
        .queryable(User)
        .where((u) => u.name.eq('alice'))
        .select((u) => ({ mod: u.age.mod(7), diff: u.age.minus(40).abs() }))
        .single();
      assert.deepEqual([Number(user.mod), Number(user.diff)], [2, 10]);
    });

    it('adds days and months and diffs dates', async () => {
      const { db } = await seeded();
      // created_at = 2026-01-02 03:04:05
      const row = await db
        .queryable(User)
        .where((u) => u.name.eq('alice'))
        .select((u) => ({
          plus30: u.createdAt.addDays(30).month(),
          plus30Day: u.createdAt.addDays(30).day(),
          minus2: u.createdAt.addDays(-2).year(),
          plus11m: u.createdAt.addMonths(11).month(),
          plus12m: u.createdAt.addMonths(12).year(),
          diff: u.createdAt.diffDays(new Date('2025-12-31T00:00:00Z')),
        }))
        .single();
      assert.deepEqual(row, {
        plus30: 2,
        plus30Day: 1,
        minus2: 2025,
        plus11m: 12,
        plus12m: 2027,
        diff: 2,
      });
    });

    it('casts and nullIfs', async () => {
      const { db } = await seeded();
      const row = await db
        .queryable(User)
        .where((u) => u.name.eq('alice'))
        .select((u) => ({
          text: u.age.cast('string'),
          double: u.age.cast('double'),
          decimal: u.age.cast('decimal', 10, 2),
          nulled: u.age.nullIf(30),
          kept: u.age.nullIf(31),
        }))
        .single();
      assert.equal(row.text, '30');
      assert.equal(row.double, 30);
      assert.equal(Number(row.decimal), 30);
      assert.equal(row.nulled, null);
      assert.equal(row.kept, 30);
    });

    it('builds CASE WHEN with literal and expression branches', async () => {
      const { db } = await seeded();
      const rows = await db
        .queryable(User)
        .orderBy((u) => u.id)
        .select((u) => ({
          name: u.name,
          // bob 的年龄为 NULL，比较结果是 NULL，落到 ELSE
          group: caseWhen(u.age.lt(18), 'minor').when(u.age.lt(65), 'adult').else('unknown'),
          adult: caseWhen(u.age.ge(18), 1).else(0),
          label: caseWhen(u.age.isNull(), u.name.upper()).end(),
        }))
        .toList();
      assert.deepEqual(rows, [
        { name: 'alice', group: 'adult', adult: 1, label: null },
        { name: 'bob', group: 'unknown', adult: 0, label: 'BOB' },
        { name: 'carol', group: 'minor', adult: 0, label: null },
      ]);
    });

    it('uses CASE inside conditions and aggregates', async () => {
      const { db } = await seeded();
      // CASE 当条件：年龄 >= 18 才是 adult；bob 的年龄为 NULL，落到 ELSE
      const names = await db
        .queryable(User)
        .where((u) => caseWhen(u.age.ge(18), 'adult').else('minor').eq('adult'))
        .select((u) => u.name)
        .toList();
      assert.deepEqual(names, ['alice']);
      // CASE 当聚合的参数：金额大于 5 的帖子数（10.50 与 2000.00 两篇）
      assert.equal(
        Number(await db.queryable(Post).sum((p) => caseWhen(p.amount.gt('5'), 1).else(0))),
        2,
      );
    });
  });

  describe(`${name}: extension column types`, { skip: !options.extensionTypes }, () => {
    const at = new Date('2026-01-02T03:04:05.006Z');
    const row = (amount: string, big: bigint) => ({
      amount: new Decimal(amount),
      big,
      day: parseDate('2026-01-02'),
      startsAt: new CalendarDateTime(2026, 1, 2, 3, 4, 5, 6),
      at: fromDate(at, 'Asia/Shanghai'),
      clock: new Time(8, 30, 15),
      raw: Uint8Array.from([0, 1, 2, 254, 255]),
    });

    it('round-trips decimal.js, 64-bit integers and every @internationalized/date type', async () => {
      const { db } = await seeded();
      // 2^53 + 1：number 表示不了，往返后必须一模一样
      const big = 9007199254740993n;
      await db.insert(Ext).values(row('10.50', big)).execute();
      const back = await db.queryable(Ext).single();
      assert.ok(back.amount instanceof Decimal);
      assert.equal(back.amount.toFixed(2), '10.50');
      assert.equal(back.big, big);
      assert.equal(back.day.toString(), '2026-01-02');
      assert.equal(back.startsAt.toString(), '2026-01-02T03:04:05.006');
      // 同一个时刻，读出时换算到 Asia/Shanghai（UTC+8）
      assert.equal(back.at.toDate().toISOString(), at.toISOString());
      assert.equal(back.at.timeZone, 'Asia/Shanghai');
      assert.equal(back.at.hour, 11);
      assert.equal(back.clock.toString(), '08:30:15');
      // 二进制：读出是普通的 Uint8Array（不是 Buffer），内容一致
      assert.ok(!(back.raw instanceof Buffer));
      assert.deepEqual(back.raw, Uint8Array.from([0, 1, 2, 254, 255]));
    });

    it('compares and filters with the extension types', async () => {
      const { db } = await seeded();
      await db
        .insert(Ext)
        .values([row('10.50', 9007199254740993n), row('0.25', 1n)])
        .execute();
      assert.equal(
        await db
          .queryable(Ext)
          .where((e) => e.amount.gt(new Decimal('5')))
          .count(),
        1,
      );
      assert.equal(
        await db
          .queryable(Ext)
          .where((e) => e.big.eq(9007199254740993n))
          .count(),
        1,
      );
      assert.equal(
        await db
          .queryable(Ext)
          .where((e) => e.day.ge(parseDate('2026-01-02')))
          .count(),
        2,
      );
      assert.equal(
        await db
          .queryable(Ext)
          .where((e) => e.day.gt(parseDate('2026-01-02')))
          .count(),
        0,
      );
      assert.equal(
        await db
          .queryable(Ext)
          .where((e) => e.startsAt.eq(new CalendarDateTime(2026, 1, 2, 3, 4, 5, 6)))
          .count(),
        2,
      );
      assert.equal(
        await db
          .queryable(Ext)
          .where((e) => e.at.eq(fromDate(at, 'Asia/Shanghai')))
          .count(),
        2,
      );
      // year / month / day 认得这些类型
      const parts = await db
        .queryable(Ext)
        .select((e) => ({ y: e.day.year(), m: e.startsAt.month(), d: e.at.day() }))
        .first();
      assert.deepEqual(parts, { y: 2026, m: 1, d: 2 });
    });

    it('does exact arithmetic and aggregates on Decimal and bigint', async () => {
      const { db } = await seeded();
      // 浮点算 0.1 + 0.2 会得到 0.30000000000000004；Decimal 不会
      await db
        .insert(Ext)
        .values([row('0.10', 9007199254740993n), row('0.20', 2n)])
        .execute();
      const sum = await db.queryable(Ext).sum((e) => e.amount);
      assert.ok(sum instanceof Decimal);
      assert.equal(sum.toFixed(2), '0.30');
      assert.equal((await db.queryable(Ext).avg((e) => e.amount))?.toFixed(2), '0.15');
      assert.equal((await db.queryable(Ext).max((e) => e.amount))?.toFixed(2), '0.20');
      const rows = await db
        .queryable(Ext)
        .orderBy((e) => e.id)
        .select((e) => ({
          doubled: e.amount.times(2),
          shifted: e.amount.plus(new Decimal('1.05')),
          next: e.big.plus(1n),
        }))
        .toList();
      assert.deepEqual(
        rows.map((r) => [r.doubled.toFixed(2), r.shifted.toFixed(2), r.next]),
        [
          ['0.20', '1.15', 9007199254740994n],
          ['0.40', '1.25', 3n],
        ],
      );
      assert.equal(await db.queryable(Ext).sum((e) => e.big), 9007199254740995n);
      await db
        .update(Ext)
        .set((e) => ({ amount: e.amount.times(3) }))
        .where((e) => e.big.eq(2n))
        .execute();
      assert.equal(
        (
          await db
            .queryable(Ext)
            .where((e) => e.big.eq(2n))
            .single()
        ).amount.toFixed(2),
        '0.60',
      );
    });

    it('adds days and diffs dates on @internationalized/date columns', async () => {
      const { db } = await seeded();
      await db.insert(Ext).values(row('1.00', 1n)).execute();
      const r = await db
        .queryable(Ext)
        .select((e) => ({
          plus: e.day.addDays(30).month(),
          diff: e.day.diffDays(parseDate('2025-12-31')),
        }))
        .single();
      assert.deepEqual(r, { plus: 2, diff: 2 });
    });
  });

  describe(`${name}: many-to-many and composite relations`, { skip: !options.extraTables }, () => {
    /** alice: admin + dev；bob: dev；carol 没有角色 */
    const withRoles = async () => {
      const env = await seeded();
      const { db } = env;
      await db
        .insert(Role)
        .values([{ name: 'admin' }, { name: 'dev' }, { name: 'ops' }])
        .execute();
      await db
        .insert(UserRole)
        .values([
          { userId: 1, roleId: 1 },
          { userId: 1, roleId: 2 },
          { userId: 2, roleId: 2 },
        ])
        .execute();
      return env;
    };

    it('relations on any condition: manyOn / oneOn (official navigate/dotcolumn, many2many2)', async () => {
      const { db } = await seeded();
      const rows = await db
        .queryable(User)
        .orderBy((u) => u.id)
        .select((u) => ({
          name: u.name,
          big: u.bigPosts.count(),
          has: u.bigPosts.any(),
          titles: u.bigPosts.toList((p) => p.title),
          grouped: u.bigPosts.groupJoin().count(),
        }))
        .toList();
      assert.deepEqual(rows, [
        { name: 'alice', big: 1, has: true, titles: ['sql 100%'], grouped: 1 },
        { name: 'bob', big: 0, has: false, titles: [], grouped: 0 },
        { name: 'carol', big: 0, has: false, titles: [], grouped: 0 },
      ]);
      const authors = await db
        .queryable(Post)
        .orderBy((p) => p.id)
        .select((p) => p.author.name)
        .toList();
      assert.deepEqual(authors, ['alice', 'alice', 'bob', 'bob']);
    });

    it('path relations: a de-duplicated bridge over several navigations', async () => {
      const { db } = await withRoles();
      const users = await db
        .queryable(User)
        .orderBy((u) => u.id)
        .select((u) => ({
          name: u.name,
          peers: u.peers.count(),
          names: u.peers.orderBy((p) => p.id).toList((p) => p.name),
        }))
        .toList();
      assert.deepEqual(users, [
        { name: 'alice', peers: 2, names: ['alice', 'bob'] },
        { name: 'bob', peers: 2, names: ['alice', 'bob'] },
        { name: 'carol', peers: 0, names: [] },
      ]);
      const companies = await db
        .queryable(Company)
        .orderBy((c) => c.id)
        .select((c) => ({
          name: c.name,
          posts: c.posts.count(),
          big: c.posts.any((p) => p.amount.gt('1000')),
        }))
        .toList();
      assert.deepEqual(companies, [
        { name: 'acme', posts: 4, big: true },
        { name: 'globex', posts: 0, big: false },
      ]);
      const post = await db
        .queryable(Post)
        .select((p) => ({ title: p.title, company: p.company.name }))
        .find(1);
      assert.deepEqual(post, { title: 'orm tips', company: 'acme' });
    });

    it('filters and counts through the junction table', async () => {
      const { db } = await withRoles();
      const names = (rows: { name: string }[]) => rows.map((r) => r.name);
      const q = db.queryable(User).orderBy((u) => u.id);
      assert.deepEqual(names(await q.where((u) => u.roles.any((r) => r.name.eq('dev'))).toList()), [
        'alice',
        'bob',
      ]);
      assert.deepEqual(
        names(await q.where((u) => u.roles.any((r) => r.name.eq('admin'))).toList()),
        ['alice'],
      );
      assert.deepEqual(
        names(await q.where((u) => u.roles.none((r) => r.name.eq('admin'))).toList()),
        ['bob', 'carol'],
      );
      const counts = await q.select((u) => ({ name: u.name, roles: u.roles.count() })).toList();
      assert.deepEqual(
        counts.map((c) => [c.name, c.roles]),
        [
          ['alice', 2],
          ['bob', 1],
          ['carol', 0],
        ],
      );
    });

    it('builds object trees through the junction table, with per-parent limits', async () => {
      const { db } = await withRoles();
      const rows = await db
        .queryable(User)
        .orderBy((u) => u.id)
        .select((u) => ({
          name: u.name,
          roles: u.roles.orderBy((r) => r.name).toList((r) => ({ name: r.name })),
          first: u.roles.orderBy((r) => r.name.desc()).first((r) => ({ name: r.name })),
        }))
        .toList();
      assert.deepEqual(rows, [
        { name: 'alice', roles: [{ name: 'admin' }, { name: 'dev' }], first: { name: 'dev' } },
        { name: 'bob', roles: [{ name: 'dev' }], first: { name: 'dev' } },
        { name: 'carol', roles: [], first: null },
      ]);
    });

    it('works from the other side too', async () => {
      const { db } = await withRoles();
      const rows = await db
        .queryable(Role)
        .orderBy((r) => r.id)
        .select((r) => ({
          name: r.name,
          users: r.users.orderBy((u) => u.id).toList((u) => ({ name: u.name })),
        }))
        .toList();
      assert.deepEqual(rows, [
        { name: 'admin', users: [{ name: 'alice' }] },
        { name: 'dev', users: [{ name: 'alice' }, { name: 'bob' }] },
        { name: 'ops', users: [] },
      ]);
    });

    it('matches composite foreign keys on every column', async () => {
      const { db } = await seeded();
      // m1 与 m3 的 id 相同、租户不同：只比较 id 会把租户 2 的笔记算到 m1 头上
      await db
        .insert(Member)
        .values([
          { tenantId: 1, id: 1, name: 'm1' },
          { tenantId: 1, id: 2, name: 'm2' },
          { tenantId: 2, id: 1, name: 'm3' },
        ])
        .execute();
      await db
        .insert(Note)
        .values([
          { tenantId: 1, memberId: 1, body: 'a' },
          { tenantId: 1, memberId: 1, body: 'b' },
          { tenantId: 2, memberId: 1, body: 'c' },
          { tenantId: 1, memberId: 2, body: 'd' },
        ])
        .execute();
      const members = await db
        .queryable(Member)
        .orderBy((m) => [m.tenantId, m.id])
        .select((m) => ({
          name: m.name,
          count: m.notes.count(),
          notes: m.notes.orderBy((n) => n.body).toList((n) => ({ body: n.body })),
        }))
        .toList();
      assert.deepEqual(
        members.map((m) => [m.name, m.count, m.notes.map((n) => n.body)]),
        [
          ['m1', 2, ['a', 'b']],
          ['m2', 1, ['d']],
          ['m3', 1, ['c']],
        ],
      );
      // 多对一也按整组列连接
      const owners = await db
        .queryable(Note)
        .orderBy((n) => n.body)
        .select((n) => ({ body: n.body, owner: n.member.name }))
        .toList();
      assert.deepEqual(
        owners.map((o) => [o.body, o.owner]),
        [
          ['a', 'm1'],
          ['b', 'm1'],
          ['c', 'm3'],
          ['d', 'm2'],
        ],
      );
      assert.equal(
        await db
          .queryable(Member)
          .where((m) => m.notes.any((n) => n.body.eq('c')))
          .count(),
        1,
      );
    });
  });

  describe(`${name}: save, returnEntity, batch updates and write hooks`, () => {
    const dave = {
      name: 'dave',
      age: 40,
      createdAt: new Date('2026-02-03T00:00:00.000Z'),
      attrs: { tags: [] as string[] },
    };

    it('saves a new parent together with its children', async () => {
      const { db } = await seeded();
      const saved = await db.save(
        User,
        {
          ...dave,
          posts: [
            { title: 'p1', amount: '1.00' },
            { title: 'p2', amount: '2.00' },
          ],
        },
        { include: { posts: true } },
      );
      assert.equal(saved.name, 'dave');
      // 自增主键取回之后，子行的关联列自动设成它
      const posts = await db
        .queryable(Post)
        .where((p) => p.userId.eq(saved.id))
        .orderBy((p) => p.title)
        .toList();
      assert.deepEqual(
        posts.map((p) => p.title),
        ['p1', 'p2'],
      );
    });

    it('updates only the given columns of an existing parent and deletes removed children', async () => {
      const { db } = await seeded();
      // 帖子 2 的评论跟着删（include 下一层）
      await db.insert(Comment).values({ postId: 2, body: 'bye' }).execute();
      const saved = await db.save(
        User,
        { id: 1, name: 'alice2', posts: [{ id: 1, title: 'changed' }] },
        { include: { posts: { removed: 'delete', include: { comments: true } } } },
      );
      // age 没给，保持 30；alice 的第 2 篇帖子不在列表里被删除；bob 的帖子不受影响
      assert.deepEqual([saved.name, saved.age], ['alice2', 30]);
      const posts = await db
        .queryable(Post)
        .orderBy((p) => p.id)
        .toList();
      assert.deepEqual(
        posts.map((p) => [p.id, p.title]),
        [
          [1, 'changed'],
          [3, 'orm_v2'],
          [4, 'hello'],
        ],
      );
      assert.equal(
        await db
          .queryable(Comment)
          .where((c) => c.postId.eq(2))
          .count(),
        0,
      );
      // 帖子 1 的评论不在输入里（comments 没出现）：不动
      assert.equal(
        await db
          .queryable(Comment)
          .where((c) => c.postId.eq(1))
          .count(),
        2,
      );
    });

    it('refuses to guess what to do with removed children and unknown navigations', async () => {
      const { db } = await seeded();
      // userId 不可空：没写 removed 又确实有要移除的帖子，报错而不是默认删除
      await assert.rejects(
        () => db.save(User, { id: 1, posts: [{ id: 1 }] }, { include: { posts: true } }),
        /cannot be null; set removed/,
      );
      await assert.rejects(
        () => db.save(User, { id: 1, posts: [] } as never),
        /list it in include/,
      );
      await assert.rejects(
        () => db.save(User, { id: 1, bigPosts: [] } as never, { include: { bigPosts: true } }),
        /path \/ on relation/,
      );
      // 什么都没改
      assert.equal(await db.queryable(Post).count(), 4);
    });

    it('matches children by a business key and keeps the rest', async () => {
      const { db } = await seeded();
      await db.save(
        User,
        {
          id: 1,
          posts: [
            { title: 'orm tips', amount: '99.00' },
            { title: 'fresh', amount: '1.00' },
          ],
        },
        { include: { posts: { key: 'title', removed: 'keep' } } },
      );
      const posts = await db
        .queryable(Post)
        .where((p) => p.userId.eq(1))
        .orderBy((p) => p.id)
        .select((p) => ({ id: p.id, title: p.title, amount: p.amount }))
        .toList();
      assert.deepEqual(
        posts.map((p) => [p.id, p.title, Number(p.amount)]),
        [
          [1, 'orm tips', 99],
          [2, 'sql 100%', 2000],
          [5, 'fresh', 1],
        ],
      );
    });

    it('saves a many-to-one target first and nested children after the parent', async () => {
      const { db } = await seeded();
      const saved = await db.save(
        User,
        {
          ...dave,
          company: { name: 'initech' },
          posts: [{ title: 'p1', amount: '1.00', comments: [{ body: 'c1' }, { body: 'c2' }] }],
        },
        { include: { company: true, posts: { include: { comments: true } } } },
      );
      const row = await db
        .queryable(User)
        .where((u) => u.id.eq(saved.id))
        .select((u) => ({
          company: u.company.name,
          comments: u.posts.count((p) => p.comments.any()),
        }))
        .single();
      assert.deepEqual(row, { company: 'initech', comments: 1 });
      assert.equal(
        await db
          .queryable(Comment)
          .where((c) => c.post.userId.eq(saved.id))
          .count(),
        2,
      );
      // 多对一给 null：外键置空，公司本身不动
      await db.save(User, { id: saved.id, company: null }, { include: { company: true } });
      assert.equal((await db.queryable(User).findOrThrow(saved.id)).companyId, null);
      assert.equal(
        await db
          .queryable(Company)
          .where((c) => c.name.eq('initech'))
          .count(),
        1,
      );
    });

    it('unlinks removed children whose foreign key is nullable', async () => {
      const { db } = await seeded();
      // bob 不在 acme 的员工列表里了：companyId 置空，人还在
      await db.save(Company, { id: 1, users: [{ id: 1 }] }, { include: { users: true } });
      const users = await db
        .queryable(User)
        .orderBy((u) => u.id)
        .select((u) => ({ name: u.name, companyId: u.companyId }))
        .toList();
      assert.deepEqual(users, [
        { name: 'alice', companyId: 1 },
        { name: 'bob', companyId: null },
        { name: 'carol', companyId: null },
      ]);
    });

    it('rolls the whole save back when a child fails', async () => {
      const { db } = await seeded();
      // 第二个子行缺必填的标题：整个 save 在一个事务里，父行也不该留下
      await assert.rejects(() =>
        db.save(
          User,
          { ...dave, posts: [{ title: 'ok', amount: '1.00' }, { amount: '1.00' }] },
          { include: { posts: true } },
        ),
      );
      assert.equal(
        await db
          .queryable(User)
          .where((u) => u.name.eq('dave'))
          .count(),
        0,
      );
    });

    it('removes a row with the children it owns', async () => {
      const { db } = await seeded();
      assert.equal(await db.remove(Post, 1, { include: { comments: true } }), true);
      assert.equal(await db.remove(Post, 1), false);
      assert.equal(await db.queryable(Comment).count(), 0);
      assert.equal(await db.queryable(Post).count(), 3);
    });

    it(
      'links many-to-many targets by key and saves the new ones',
      { skip: !options.extraTables },
      async () => {
        const { db } = await seeded();
        const admin = Number(await db.insert(Role).values({ name: 'admin' }).returnId());
        const dev = Number(await db.insert(Role).values({ name: 'dev' }).returnId());
        const roleNames = async () =>
          db
            .queryable(Role)
            .where((r) => r.users.any((u) => u.id.eq(1)))
            .orderBy((r) => r.name)
            .select((r) => r.name)
            .toList();
        await db.save(
          User,
          { id: 1, roles: [{ id: admin }, { name: 'ops' }] },
          { include: { roles: true } },
        );
        assert.deepEqual(await roleNames(), ['admin', 'ops']);
        // 默认只删中间表的行，角色本身还在
        await db.save(User, { id: 1, roles: [{ id: dev }] }, { include: { roles: true } });
        assert.deepEqual(await roleNames(), ['dev']);
        assert.equal(await db.queryable(Role).count(), 3);
        assert.equal(await db.queryable(UserRole).count(), 1);
        // 删用户时沿 include 把中间表的行一起删掉
        await db
          .delete(Post)
          .where((p) => p.userId.eq(1))
          .execute();
        await db.delete(Comment).all().execute();
        assert.equal(await db.remove(User, 1, { include: { roles: true } }), true);
        assert.equal(await db.queryable(UserRole).count(), 0);
      },
    );

    it('returns the whole inserted row', async () => {
      const { db } = await seeded();
      const post = await db
        .insert(Post)
        .values({ userId: 1, title: 'ret', amount: '5.00' })
        .returnEntity();
      assert.deepEqual([typeof post.id, post.title, Number(post.amount)], ['number', 'ret', 5]);
    });

    it(
      'returns database defaults and client defaults of an inserted row',
      { skip: !options.extraTables },
      async () => {
        const { db } = await seeded();
        const doc = await db
          .insert(Doc)
          .values({ title: 't', createdBy: 'x', secret: 'hush' })
          .returnEntity();
        // status 是库里的默认值，token 是 $default，version 是乐观锁的初值，secret 已透明解密
        assert.deepEqual(
          [doc.status, doc.token, doc.version, doc.deleted, doc.secret],
          ['draft', 'tok', 0, false, 'hush'],
        );
      },
    );

    it('updates a batch of entities by primary key', async () => {
      const { db } = await seeded();
      const rows = await db
        .queryable(Post)
        .orderBy((p) => p.id)
        .toList();
      assert.equal(
        await db
          .update(Post)
          .entities(rows.map((r) => ({ ...r, title: r.title.toUpperCase() })))
          .execute(),
        4,
      );
      assert.deepEqual(
        (
          await db
            .queryable(Post)
            .orderBy((p) => p.id)
            .toList()
        ).map((p) => p.title),
        ['ORM TIPS', 'SQL 100%', 'ORM_V2', 'HELLO'],
      );
    });

    it('merges a batch of entity updates into one statement per written column set', async () => {
      const { db, statements } = await seeded();
      const users = await db
        .queryable(User)
        .orderBy((u) => u.id)
        .toList();
      statements.length = 0;
      const affected = await db
        .update(User)
        .entities(
          users.map((u) => ({ ...u, name: u.name.toUpperCase(), age: u.id === 3 ? null : 50 })),
          { columns: 'notNull' },
        )
        .batch()
        .execute();
      // carol 的 age、companyId 是 null，不写：她单独一组
      assert.equal(affected, 3);
      assert.equal(statements.length, 2);
      const after = await db
        .queryable(User)
        .orderBy((u) => u.id)
        .select((u) => ({ name: u.name, age: u.age, companyId: u.companyId }))
        .toList();
      assert.deepEqual(after, [
        { name: 'ALICE', age: 50, companyId: 1 },
        { name: 'BOB', age: 50, companyId: 1 },
        { name: 'CAROL', age: 17, companyId: null },
      ]);
    });

    it('writes only the columns the strategy picks', async () => {
      const { db } = await seeded();
      const insert = db
        .insert(User)
        .values({ ...dave, age: null, companyId: null }, { columns: 'notNull' })
        .toSQL();
      assert.doesNotMatch(insert[0]!.sql, /age|company_id|companyId/);
      const alice = await db.queryable(User).findOrThrow(1);
      // 'null'：只写值为 null 的列，name 不动
      await db
        .update(User)
        .entity({ ...alice, name: 'ignored', age: null }, { columns: 'null' })
        .execute();
      const row = await db.queryable(User).findOrThrow(1);
      assert.deepEqual([row.name, row.age], ['alice', null]);
    });

    it('updates and deletes through many-to-one navigations', async () => {
      const { db } = await seeded();
      // set 与条件里都用导航：帖子标题改成作者名
      assert.equal(
        await db
          .update(Post)
          .set((p) => ({ title: p.user.name }))
          .where((p) => p.user.name.eq('bob'))
          .execute(),
        2,
      );
      // LEFT JOIN 的语义：没有公司的 carol 也算"公司名为空"
      assert.equal(
        await db
          .update(User)
          .set({ age: 99 })
          .where((u) => u.company.name.isNull())
          .execute(),
        1,
      );
      // 两层导航：删掉 alice 帖子下的评论
      assert.equal(
        await db
          .delete(Comment)
          .where((c) => c.post.user.name.eq('alice'))
          .execute(),
        2,
      );
      const titles = await db
        .queryable(Post)
        .orderBy((p) => p.id)
        .select((p) => p.title)
        .toList();
      assert.deepEqual(titles, ['orm tips', 'sql 100%', 'bob', 'bob']);
      assert.equal((await db.queryable(User).findOrThrow(3)).age, 99);
      assert.equal(await db.queryable(Comment).count(), 0);
      assert.throws(
        () =>
          db
            .delete(Comment)
            .where((c) => c.post.title.eq('x'))
            .returning('id'),
        /returning\(\) cannot be used/,
      );
    });

    it('hands the rows before an update to interceptors that ask for them', async () => {
      const env = await seeded();
      const before: string[] = [];
      const audit: Interceptor = {
        name: 'audit',
        before: true,
        afterWrite: (e) => {
          if (e.kind !== 'insert')
            before.push(
              ...(e.before ?? [])
                .map((r) => String(r['title'] ?? r['body']))
                .toSorted((a, b) => a.localeCompare(b)),
            );
        },
      };
      const db = createDb({ schema, adapter: env.adapter, interceptors: [audit] });
      await db
        .update(Post)
        .set({ title: 'x' })
        .where((p) => p.userId.eq(1))
        .execute();
      await db
        .delete(Comment)
        .where((c) => c.body.eq('nice'))
        .execute();
      assert.deepEqual(before, ['orm tips', 'sql 100%', 'nice']);
    });

    it('notifies afterWrite interceptors after every write', async () => {
      const env = await seeded();
      const events: string[] = [];
      const audit: Interceptor = {
        name: 'audit',
        afterWrite: (e: { kind: string; entity: { table: string }; affected: number }) => {
          events.push(`${e.kind}:${e.entity.table}:${e.affected}`);
        },
      };
      const db = createDb({ schema, adapter: env.adapter, interceptors: [audit] });
      await db.insert(Company).values({ name: 'initech' }).execute();
      await db
        .update(Post)
        .set({ title: 'x' })
        .where((p) => p.userId.eq(1))
        .execute();
      await db
        .delete(Comment)
        .where((c) => c.id.eq(1))
        .execute();
      await db.insert(Company).values({ name: 'umbrella' }).returnId();
      assert.deepEqual(events, [
        'insert:t_company:1',
        'update:t_post:2',
        'delete:t_comment:1',
        'insert:t_company:1',
      ]);
      // afterWrite 抛错，写入所在的事务回滚
      const failing = createDb({
        schema,
        adapter: env.adapter,
        interceptors: [
          {
            name: 'veto',
            afterWrite: () => {
              throw new Error('vetoed');
            },
          },
        ],
      });
      await assert.rejects(
        () =>
          failing.transaction(async (tx) => {
            await tx.insert(Company).values({ name: 'vetoed' }).execute();
          }),
        /vetoed/,
      );
      assert.equal(
        await db
          .queryable(Company)
          .where((c) => c.name.eq('vetoed'))
          .count(),
        0,
      );
    });
  });

  describe(`${name}: code-first DDL`, { skip: options.ddl === false }, () => {
    it('creates a table from the entity definition and round-trips every column type', async () => {
      const env = await seeded();
      const db = createDb({ schema: defineSchema({ Gadget }), adapter: env.adapter });
      // HANA 没有 DROP TABLE IF EXISTS：先试着删，不存在就算了
      await db.sql.execute`DROP TABLE ${db.sql.ident('t_gadget')}`.catch(() => undefined);
      await db.createTables();
      try {
        const seenAt = new Date('2026-03-04T05:06:07.008Z');
        await db
          .insert(Gadget)
          .values({ name: 'widget', price: '12.50', active: true, seenAt, tags: ['a', 'b'] })
          .execute();
        const row = await db.queryable(Gadget).single();
        // qty 没给，库里的 DEFAULT 0 生效；可空列没给就是 null
        assert.deepEqual(
          [row.name, Number(row.price), row.qty, row.active, row.born, row.photo],
          ['widget', 12.5, 0, true, null, null],
        );
        assert.equal(row.seenAt.toISOString(), seenAt.toISOString());
        assert.deepEqual(row.tags, ['a', 'b']);
        assert.equal(typeof row.id, 'number');
        // 唯一约束
        await assert.rejects(() =>
          db
            .insert(Gadget)
            .values({ name: 'widget', price: '1.00', active: false, seenAt, tags: [] })
            .execute(),
        );
      } finally {
        await db.sql.execute`DROP TABLE ${db.sql.ident('t_gadget')}`;
      }
    });
  });

  describe(`${name}: uuid and unsigned columns`, { skip: options.ddl === false }, () => {
    it('stores uuids in the native type, finds and filters by them, and syncs to an empty plan', async () => {
      const env = await seeded();
      const db = createDb({ schema: defineSchema({ Token }), adapter: env.adapter });
      await db.sql.execute`DROP TABLE ${db.sql.ident('t_token')}`.catch(() => undefined);
      await db.createTables();
      try {
        const owner = '0192F3A4-1B2C-7D8E-9F01-23456789ABCD';
        await db
          .insert(Token)
          .values([
            { owner, hits: 4_000_000_000 },
            { owner: null, hits: 0 },
          ])
          .execute();
        // 不按 id 排序：SQL Server 的 UNIQUEIDENTIFIER 先比较最后 6 个字节，v7 在那里不是按时间有序的
        const rows = await db
          .queryable(Token)
          .orderBy((t) => t.hits.desc())
          .toList();
        assert.equal(rows.length, 2);
        // 写进去的是大写，读出来是小写的标准写法
        assert.deepEqual(
          rows.map((r) => [r.owner, r.hits]),
          [
            [owner.toLowerCase(), 4_000_000_000],
            [null, 0],
          ],
        );
        for (const r of rows)
          assert.match(
            r.id,
            /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
          );
        const first = rows[0]!.id;
        assert.equal((await db.queryable(Token).findOrThrow(first)).owner, owner.toLowerCase());
        assert.equal(
          await db
            .queryable(Token)
            .where((t) => t.owner.eq(owner))
            .count(),
          1,
        );
        assert.equal(
          await db
            .queryable(Token)
            .where((t) => t.id.in([first, rows[1]!.id]))
            .count(),
          2,
        );
        assert.deepEqual((await db.planSync()).statements, []);
      } finally {
        await db.sql.execute`DROP TABLE ${db.sql.ident('t_token')}`;
      }
    });
  });

  describe(`${name}: code-first sync`, { skip: options.ddl === false }, () => {
    // 两张表：B 经 aId 引用 A（外键、级联删除），各带注释与索引
    const SyncA = entity(
      't_sync_a',
      { id: col.bigint().primaryKey().generated(), name: col.string(50).comment('名称') },
      { comment: '同步测试' },
    );
    const SyncB = entity(
      't_sync_b',
      {
        id: col.bigint().primaryKey().generated(),
        aId: col.bigint().nullable(),
        title: col.string(100),
      },
      { indexes: [{ columns: ['title'] }] },
    );
    const syncSchema = defineSchema(
      { SyncA, SyncB },
      {
        SyncB: (r) => ({
          a: r.one(
            'SyncA',
            { from: 'aId', to: 'id' },
            { foreignKey: options.foreignKeyActions === false ? true : { onDelete: 'cascade' } },
          ),
        }),
      },
    );

    it('creates tables with comments, indexes and foreign keys, then finds nothing left to do', async () => {
      const env = await seeded();
      const db = createDb({ schema: syncSchema, adapter: env.adapter });
      await db.dropTables(SyncB, SyncA);
      try {
        const plan = await db.syncTables();
        assert.ok(plan.statements.length >= 2);
        const tables = await db.introspect();
        const a = tables.find((t) => t.name.toLowerCase() === 't_sync_a')!;
        const b = tables.find((t) => t.name.toLowerCase() === 't_sync_b')!;
        assert.deepEqual(
          a.columns.map((c) => c.name.toLowerCase()),
          ['id', 'name'],
        );
        assert.deepEqual(
          a.primaryKey.map((c) => c.toLowerCase()),
          ['id'],
        );
        assert.ok(b.indexes.some((i) => i.name === 't_sync_b_title_idx' && !i.unique));
        assert.deepEqual(
          b.foreignKeys.map((f) => [
            f.columns.map((c) => c.toLowerCase()),
            f.references.toLowerCase(),
          ]),
          [[['a_id'], 't_sync_a']],
        );
        // SQLite 没有注释
        assert.equal(a.comment, name.startsWith('sqlite') ? null : '同步测试');
        // 建好之后再比：类型写法、注释、索引、外键都对上，没有要做的事
        const again = await db.planSync();
        assert.deepEqual([again.statements, again.differences], [[], []]);
        assert.equal(await db.tableExists(SyncA), true);
        // 反过来由表生成实体（eqts pull）：生成的 schema 与库再比也是空计划
        const source = entitySource(await db.introspect(), { tables: ['t_sync_a', 't_sync_b'] });
        assert.ok(source.includes("export const SyncB = entity('t_sync_b'"), source);
        assert.ok(source.includes("a: r.one('SyncA', { from: 'aId', to: 'id' }"), source);
        assert.ok(source.includes("syncBs: r.many('SyncB'"), source);
        const dir = new URL('../.generated/', import.meta.url);
        const file = new URL(`${name.replace(/\W+/g, '_')}.ts`, dir);
        await mkdir(dir, { recursive: true });
        await writeFile(file, source);
        try {
          const pulled = (await import(file.href)) as {
            schema: typeof syncSchema;
          };
          const pulledDb = createDb({ schema: pulled.schema, adapter: env.adapter });
          assert.deepEqual(await pulledDb.planSync(), { statements: [], differences: [] });
        } finally {
          await rm(file, { force: true });
        }
      } finally {
        await db.dropTables(SyncB, SyncA);
      }
      assert.equal(await db.tableExists(SyncA), false);
    });

    it('renames, adds and indexes columns of an existing table and lists what it will not change', async () => {
      const env = await seeded();
      const v1 = createDb({ schema: defineSchema({ SyncA }), adapter: env.adapter });
      await v1.dropTables(SyncA);
      await v1.createTables();
      try {
        await v1.insert(SyncA).values({ name: 'kept' }).execute();
        // 改了列名（renamedFrom）、加了可空列和索引
        const SyncA2 = entity(
          't_sync_a',
          {
            id: col.bigint().primaryKey().generated(),
            title: col.string(50).comment('名称').renamedFrom('name'),
            note: col.string(20).nullable(),
          },
          { comment: '同步测试', indexes: [{ columns: ['note'] }] },
        );
        const v2 = createDb({ schema: defineSchema({ SyncA2 }), adapter: env.adapter });
        const plan = await v2.syncTables();
        assert.equal(plan.statements.length, 3);
        assert.deepEqual(plan.differences, []);
        assert.equal((await v2.queryable(SyncA2).single()).title, 'kept');
        assert.deepEqual(await v2.planSync(), { statements: [], differences: [] });
        // 类型变了、列删了：不自动改，只列出来
        const SyncA3 = entity('t_sync_a', {
          id: col.bigint().primaryKey().generated(),
          title: col.int(),
        });
        const v3 = createDb({ schema: defineSchema({ SyncA3 }), adapter: env.adapter });
        const diff = await v3.planSync();
        assert.deepEqual(diff.statements, []);
        assert.ok(
          diff.differences.some((d) => /t_sync_a\.title: type is/i.test(d)),
          diff.differences.join('\n'),
        );
        assert.ok(
          diff.differences.some((d) => /note: in the database but not in the entity/i.test(d)),
        );
      } finally {
        await v1.dropTables(SyncA);
      }
    });
  });

  describe(`${name}: table sharding`, { skip: options.ddl === false }, () => {
    const ShardLog = entity(
      't_shard_log',
      { id: col.int().primaryKey(), userId: col.int(), msg: col.string(50) },
      { sharding: byMod('userId', 3) },
    );
    const ShardOrder = entity(
      't_shard_order',
      { id: col.int().primaryKey(), at: col.datetime(), amount: col.int() },
      {
        sharding: byMonth('at', {
          from: '2026-01-01T00:00:00Z',
          to: () => new Date('2026-03-15T00:00:00Z'),
        }),
      },
    );
    const shardSchema = defineSchema({ ShardLog, ShardOrder });
    const open = async () => {
      const env = await seeded();
      const db = createDb({ schema: shardSchema, adapter: env.adapter });
      await db.dropTables(ShardLog, ShardOrder);
      await db.createTables();
      return db;
    };
    const day = (text: string) => new Date(`${text}T08:00:00Z`);

    it('routes inserts by the sharding key and prunes the tables a query reads', async () => {
      const db = await open();
      try {
        const names = (await db.introspect()).map((t) => t.name.toLowerCase());
        for (const t of [
          't_shard_log_0',
          't_shard_log_1',
          't_shard_log_2',
          't_shard_order_202601',
          't_shard_order_202603',
        ])
          assert.ok(names.includes(t), t);
        await db
          .insert(ShardLog)
          .values([1, 2, 3, 4, 5, 6].map((u) => ({ id: u, userId: u, msg: `m${u}` })))
          .execute();
        const [counted] = await db.sql<{
          n: number;
        }>`SELECT COUNT(*) AS ${db.sql.ident('n')} FROM ${db.sql.ident('t_shard_log_0')}`;
        assert.equal(Number(counted!.n), 2);
        // 等于：只查一张表
        const one = db.queryable(ShardLog).where((l) => l.userId.eq(4));
        assert.ok(one.toSQL().sql.includes('t_shard_log_1') && !/UNION/i.test(one.toSQL().sql));
        assert.deepEqual(
          (await one.toList()).map((l) => l.msg),
          ['m4'],
        );
        // IN：两张表 UNION ALL；没条件：全部表，排序、计数、分页都在库里
        const two = db.queryable(ShardLog).where((l) => l.userId.in([1, 2]));
        assert.equal((two.toSQL().sql.match(/UNION ALL/gi) ?? []).length, 1);
        assert.deepEqual(
          (await two.orderBy((l) => l.id).toList()).map((l) => l.id),
          [1, 2],
        );
        assert.equal(await db.queryable(ShardLog).count(), 6);
        const page = await db
          .queryable(ShardLog)
          .orderBy((l) => l.id.desc())
          .toPage(2, 4);
        assert.deepEqual([page.rows.map((l) => l.id), page.total], [[2, 1], 6]);
      } finally {
        await db.dropTables(ShardLog, ShardOrder);
      }
    });

    it('prunes month tables by range and updates or deletes table by table', async () => {
      const db = await open();
      try {
        await db
          .insert(ShardOrder)
          .values([
            { id: 1, at: day('2026-01-10'), amount: 10 },
            { id: 2, at: day('2026-02-03'), amount: 20 },
            { id: 3, at: day('2026-02-20'), amount: 30 },
            { id: 4, at: day('2026-03-05'), amount: 40 },
          ])
          .execute();
        const feb = db
          .queryable(ShardOrder)
          .where((o) => [
            o.at.ge(new Date('2026-02-01T00:00:00Z')),
            o.at.lt(new Date('2026-03-01T00:00:00Z')),
          ]);
        assert.ok(
          feb.toSQL().sql.includes('t_shard_order_202602') && !/UNION/i.test(feb.toSQL().sql),
        );
        assert.equal(await feb.sum((o) => o.amount), 50);
        const later = db.queryable(ShardOrder).where((o) => o.at.ge(day('2026-02-15')));
        assert.equal((later.toSQL().sql.match(/UNION ALL/gi) ?? []).length, 1);
        assert.deepEqual(
          (await later.orderBy((o) => o.id).toList()).map((o) => o.id),
          [3, 4],
        );
        // 分片键落在没有表的月份：查不到，不报错
        assert.equal(
          await db
            .queryable(ShardOrder)
            .where((o) => o.at.eq(day('2026-07-01')))
            .count(),
          0,
        );
        // 更新、删除：只碰裁剪出的表，行数合计
        assert.equal(
          await db
            .update(ShardOrder)
            .set({ amount: 0 })
            .where((o) => o.at.ge(day('2026-02-01')))
            .execute(),
          3,
        );
        assert.equal(await db.queryable(ShardOrder).sum((o) => o.amount), 10);
        assert.equal(
          await db
            .delete(ShardOrder)
            .where((o) => o.id.in([1, 4]))
            .execute(),
          2,
        );
        assert.equal(await db.queryable(ShardOrder).count(), 2);
      } finally {
        await db.dropTables(ShardLog, ShardOrder);
      }
    });
  });

  describe(`${name}: dialect parity (null-safe equality, dateTrunc, row locks, rollup, table mapping)`, () => {
    it('compares null-safely', async () => {
      const { db } = await seeded();
      const names = async (cond: (u: any) => any) =>
        (
          await db
            .queryable(User)
            .where(cond)
            .orderBy((u) => u.id)
            .toList()
        ).map((u) => u.name);
      assert.deepEqual(await names((u) => u.age.eqNullSafe(null)), ['bob']);
      assert.deepEqual(await names((u) => u.age.eqNullSafe(30)), ['alice']);
      // 和自己比：连 NULL 也相等；而普通的 eq 碰到 NULL 得不到 bob
      assert.deepEqual(await names((u) => u.age.eqNullSafe(u.age)), ['alice', 'bob', 'carol']);
      assert.deepEqual(await names((u) => u.age.eq(u.age)), ['alice', 'carol']);
    });

    it('truncates dates to a unit', { skip: options.dateTrunc === false }, async () => {
      const { db } = await seeded();
      // created_at = 2026-01-02 03:04:05.006（星期五）
      const row = await db
        .queryable(User)
        .where((u) => u.name.eq('alice'))
        .select((u) => ({
          year: u.createdAt.dateTrunc('year'),
          quarter: u.createdAt.dateTrunc('quarter'),
          month: u.createdAt.dateTrunc('month'),
          week: u.createdAt.dateTrunc('week'),
          day: u.createdAt.dateTrunc('day'),
          hour: u.createdAt.dateTrunc('hour'),
          minute: u.createdAt.dateTrunc('minute'),
          second: u.createdAt.dateTrunc('second'),
        }))
        .single();
      const iso = Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v.toISOString()]));
      assert.deepEqual(iso, {
        year: '2026-01-01T00:00:00.000Z',
        quarter: '2026-01-01T00:00:00.000Z',
        month: '2026-01-01T00:00:00.000Z',
        week: '2025-12-29T00:00:00.000Z',
        day: '2026-01-02T00:00:00.000Z',
        hour: '2026-01-02T03:00:00.000Z',
        minute: '2026-01-02T03:04:00.000Z',
        second: '2026-01-02T03:04:05.000Z',
      });
      // 按月分组统计
      const byMonth = await db
        .queryable(User)
        .groupBy((u) => ({ month: u.createdAt.dateTrunc('month') }))
        .select((g) => ({ month: g.key.month, n: g.count() }))
        .toList();
      assert.deepEqual(
        byMonth.map((r) => [r.month.toISOString(), r.n]),
        [['2026-01-01T00:00:00.000Z', 3]],
      );
    });

    it('locks rows with NOWAIT and SKIP LOCKED', { skip: options.rowLocks === false }, async () => {
      const { db } = await seeded();
      await db.transaction(async (holder) => {
        await holder
          .queryable(User)
          .where((u) => u.id.eq(1))
          .forUpdate()
          .toList();
        // 按主键加锁只锁这一行（按没有索引的列查，InnoDB 会锁住扫描过的所有行）。另一个事务：跳过被锁的 alice，拿到其余的行
        const skipped = await db.transaction((other) =>
          other
            .queryable(User)
            .orderBy((u) => u.id)
            .forUpdateSkipLocked()
            .toList(),
        );
        assert.deepEqual(
          skipped.map((u) => u.name),
          ['bob', 'carol'],
        );
        if (options.noWait === false) return;
        // NOWAIT 碰到被锁的行立即报错，而不是排队
        await assert.rejects(() =>
          db.transaction((other) =>
            other
              .queryable(User)
              .where((u) => u.id.eq(1))
              .forUpdateNoWait()
              .toList(),
          ),
        );
        // 没被锁的行 NOWAIT 照常拿到
        const free = await db.transaction((other) =>
          other
            .queryable(User)
            .where((u) => u.id.eq(2))
            .forUpdateNoWait()
            .toList(),
        );
        assert.equal(free.length, 1);
      });
    });

    it('rolls up subtotals and a grand total', { skip: options.rollup === false }, async () => {
      const { db } = await seeded();
      const rows = await db
        .queryable(Post)
        .groupBy((p) => ({ userId: p.userId }))
        .rollup()
        .select((g) => ({
          userId: g.key.userId,
          total: g.sum((p) => p.amount),
          isTotal: g.grouping((p) => p.userId),
        }))
        .toList();
      const sorted = rows.sort((a, b) => (a.userId ?? Infinity) - (b.userId ?? Infinity));
      assert.deepEqual(
        sorted.map((r) => [r.userId, Number(r.total), Number(r.isTotal)]),
        [
          [1, 2010.5, 0],
          [2, 4.25, 0],
          [null, 2014.75, 1],
        ],
      );
    });

    it('cubes every combination of the keys', { skip: options.cube === false }, async () => {
      const { db } = await seeded();
      const rows = await db
        .queryable(Post)
        .groupBy((p) => ({ userId: p.userId, title: p.title }))
        .cube()
        .select((g) => ({ userId: g.key.userId, title: g.key.title, n: g.count() }))
        .toList();
      // 4 个明细 + 2 个用户小计 + 4 个标题小计 + 1 个总计
      assert.equal(rows.length, 11);
      assert.equal(rows.find((r) => r.userId === null && r.title === null)?.n, 4);
    });

    it(
      'inserts from a query without the data leaving the database',
      { skip: options.createTableAs === false },
      async () => {
        const { db } = await seeded();
        await db.sql
          .execute`CREATE TABLE ${db.sql.ident('t_post_copy')} AS SELECT * FROM ${db.sql.ident('t_post')} WHERE 1 = 0`;
        try {
          const copy = db.mapTables({ Post: 't_post_copy' });
          // 金额大于 5 的两篇（10.50、2000.00）搬到副本表，标题顺手转大写
          const affected = await copy
            .insert(Post)
            .fromQuery(
              db
                .queryable(Post)
                .where((p) => p.amount.gt('5'))
                .select((p) => ({
                  id: p.id,
                  userId: p.userId,
                  title: p.title.upper(),
                  amount: p.amount,
                })),
            )
            .execute();
          assert.equal(affected, 2);
          assert.deepEqual(
            (
              await copy
                .queryable(Post)
                .orderBy((p) => p.id)
                .toList()
            ).map((p) => [p.id, p.title]),
            [
              [1, 'ORM TIPS'],
              [2, 'SQL 100%'],
            ],
          );
          assert.equal(await db.queryable(Post).count(), 4);
          // select 里写了目标表没有的列：报错
          assert.throws(
            () =>
              copy
                .insert(Post)
                .fromQuery(db.queryable(User).select((u) => ({ nope: u.name })) as never)
                .toSQL(),
            /no column 'nope'/,
          );
        } finally {
          await db.sql.execute`DROP TABLE ${db.sql.ident('t_post_copy')}`;
        }
      },
    );

    it(
      'returns columns of inserted, updated and deleted rows',
      { skip: options.returning === false },
      async () => {
        const { db } = await seeded();
        const inserted = await db
          .insert(Post)
          .values({ userId: 1, title: 'r', amount: '9.00' })
          .returning('id', 'title')
          .execute();
        assert.deepEqual(
          inserted.map((r) => r.title),
          ['r'],
        );
        assert.equal(typeof inserted[0]!.id, 'number');
        const updated = await db
          .update(Post)
          .set({ title: 'u' })
          .where((p) => p.id.eq(1))
          .returning('id', 'title')
          .execute();
        assert.deepEqual(updated, [{ id: 1, title: 'u' }]);
        const deleted = await db
          .delete(Post)
          .where((p) => p.id.eq(4))
          .returning('title')
          .execute();
        assert.deepEqual(deleted, [{ title: 'hello' }]);
        // 不写列名就是整行，并按列类型解码
        const whole = await db
          .update(Post)
          .set({ title: 'w' })
          .where((p) => p.id.eq(2))
          .returning()
          .execute();
        assert.equal(whole[0]!.title, 'w');
        assert.equal(Number(whole[0]!.amount), 2000);
      },
    );

    it(
      'reports returning as unsupported where the database has none',
      { skip: options.returning !== false },
      async () => {
        const { db } = await seeded();
        assert.throws(
          () =>
            db
              .insert(Post)
              .values({ userId: 1, title: 'r', amount: '9.00' })
              .returning('id')
              .toSQL(),
          /not supported/,
        );
      },
    );

    it(
      'replaces tables for a whole query tree with mapTables',
      { skip: options.createTableAs === false },
      async () => {
        const { db } = await seeded();
        await db.sql
          .execute`CREATE TABLE ${db.sql.ident('t_post_old')} AS SELECT * FROM ${db.sql.ident('t_post')} WHERE ${db.sql.ident('id')} <= 2`;
        try {
          const archive = db.mapTables({ Post: 't_post_old' });
          // 同一个实体、同样的查询代码，读的是归档表；导航（post.user）、一对多（user.posts）都跟着换
          assert.equal(await archive.queryable(Post).count(), 2);
          assert.equal(await db.queryable(Post).count(), 4);
          assert.deepEqual(
            (
              await archive
                .queryable(Post)
                .orderBy((p) => p.id)
                .select((p) => ({ title: p.title, owner: p.user.name }))
                .toList()
            ).map((r) => r.owner),
            ['alice', 'alice'],
          );
          assert.deepEqual(
            (
              await archive
                .queryable(User)
                .orderBy((u) => u.id)
                .select((u) => ({ name: u.name, posts: u.posts.count() }))
                .toList()
            ).map((r) => r.posts),
            [2, 0, 0],
          );
          assert.deepEqual(
            (
              await archive
                .queryable(User)
                .where((u) => u.posts.any((p) => p.id.eq(3)))
                .toList()
            ).map((u) => u.name),
            [],
          );
        } finally {
          await db.sql.execute`DROP TABLE ${db.sql.ident('t_post_old')}`;
        }
      },
    );
  });

  describe(`${name}: streaming, cancellation and transactions`, () => {
    it('streams rows in batches without loading everything first', async () => {
      const { db } = await seeded();
      await db
        .insert(Post)
        .values(
          Array.from({ length: 1200 }, (_, i) => ({
            userId: 1,
            title: `bulk ${i}`,
            amount: '1.00' as const,
          })),
        )
        .execute();
      let count = 0;
      let batches = 0;
      for await (const row of db
        .queryable(Post)
        .orderBy((p) => p.id)
        .stream({ batchSize: 500 })) {
        count += 1;
        if (row.id % 500 === 0) batches += 1;
      }
      assert.equal(count, 1204);
      assert.ok(batches >= 2);
      // 读到第一行就放弃：连接要还回去，之后的查询照常
      for await (const row of db
        .queryable(Post)
        .orderBy((p) => p.id)
        .stream()) {
        assert.equal(row.title, 'orm tips');
        break;
      }
      assert.equal(await db.queryable(Post).count(), 1204);
      await assert.rejects(async () => {
        for await (const _ of db
          .queryable(User)
          .select((u) => ({ posts: u.posts.toList() }))
          .stream())
          void _;
      }, /toList()/);
    });

    it('streams inside a transaction and reports the streamed rows to onExecute', async () => {
      const env = await seeded();
      const events: ExecutionEvent[] = [];
      const db = createDb({ schema, adapter: env.adapter, onExecute: (e) => events.push(e) });
      await db.transaction(async (tx) => {
        await tx.insert(Comment).values({ postId: 1, body: 'inside' }).execute();
        const bodies: string[] = [];
        for await (const c of tx
          .queryable(Comment)
          .orderBy((c) => c.id)
          .stream({ batchSize: 2 }))
          bodies.push(c.body);
        assert.deepEqual(bodies, ['nice', 'thanks', 'inside']);
      });
      assert.ok(events.some((e) => e.kind === 'query' && e.rows === 3 && e.error === undefined));
    });

    it(
      'rolls back only the savepoint when a nested transaction fails',
      { skip: options.savepoints === false },
      async () => {
        const { db } = await seeded();
        const titles = async () =>
          (
            await db
              .queryable(Post)
              .where((p) => p.title.startsWith('tx-'))
              .orderBy((p) => p.title)
              .toList()
          ).map((p) => p.title);
        const add = (tx: typeof db, title: string) =>
          tx.insert(Post).values({ userId: 1, title, amount: '1.00' }).execute();
        await db.transaction(async (tx) => {
          await add(tx, 'tx-a');
          await assert.rejects(
            () =>
              tx.transaction(async (inner) => {
                await add(inner, 'tx-b');
                throw new Error('boom');
              }),
            /boom/,
          );
          await tx.transaction(async (inner) => {
            await add(inner, 'tx-c');
          });
        });
        assert.deepEqual(await titles(), ['tx-a', 'tx-c']);
        // 外层回滚时，成功的嵌套事务也一起回滚
        await assert.rejects(
          () =>
            db.transaction(async (tx) => {
              await tx.transaction(async (inner) => {
                await add(inner, 'tx-d');
              });
              throw new Error('outer');
            }),
          /outer/,
        );
        assert.deepEqual(await titles(), ['tx-a', 'tx-c']);
        await assert.rejects(
          () =>
            db.transaction(async (tx) => {
              await tx.transaction(async () => undefined, { isolation: 'serializable' });
            }),
          /nested transaction/,
        );
      },
    );

    it('begins a transaction manually and rolls back unless committed', async () => {
      const { db } = await seeded();
      const count = () =>
        db
          .queryable(Post)
          .where((p) => p.title.startsWith('manual-'))
          .count();
      const add = (tx: typeof db, title: string) =>
        tx.insert(Post).values({ userId: 1, title, amount: '1.00' }).execute();
      {
        await using tx = await db.begin();
        await add(tx, 'manual-1');
        await tx.commit();
      }
      assert.equal(await count(), 1);
      {
        // 没提交就离开作用域：自动回滚
        await using tx = await db.begin();
        await add(tx, 'manual-2');
      }
      assert.equal(await count(), 1);
      const tx = await db.begin();
      await add(tx, 'manual-3');
      await tx.rollback();
      await tx.rollback(); // 已结束再回滚什么也不做
      await assert.rejects(() => tx.commit(), /already finished/);
      assert.equal(await count(), 1);
    });

    it(
      'rejects writes in a read-only transaction',
      { skip: options.readOnlyTransactions === false },
      async () => {
        const { db } = await seeded();
        assert.equal(
          await db.transaction((tx) => tx.queryable(Post).count(), { readOnly: true }),
          4,
        );
        await assert.rejects(() =>
          db.transaction(
            (tx) => tx.insert(Post).values({ userId: 1, title: 'ro', amount: '1.00' }).execute(),
            { readOnly: true },
          ),
        );
        // 事务结束后连接恢复可写（SQLite 的 query_only 要被还原）
        await db.insert(Post).values({ userId: 1, title: 'rw', amount: '1.00' }).execute();
        assert.equal(await db.queryable(Post).count(), 5);
      },
    );

    it('stops waiting when the signal is aborted', async () => {
      const { db } = await seeded();
      await assert.rejects(
        () =>
          db
            .withSignal(AbortSignal.abort(new Error('cancelled')))
            .queryable(User)
            .toList(),
        /cancelled/,
      );
      // 没取消的信号不影响结果
      assert.equal(
        (await db.withSignal(new AbortController().signal).queryable(User).toList()).length,
        3,
      );
      await assert.rejects(async () => {
        for await (const _ of db.withSignal(AbortSignal.abort()).queryable(User).stream()) void _;
      });
    });
  });

  describe(`${name}: views`, () => {
    it('reuses and nests projections', async () => {
      const { db } = await seeded();
      const PostCard = defineView(schema, Post, (p) => ({ title: p.title, owner: p.user.name }));
      const UserCard = defineView(schema, User, (u) => ({
        name: u.name,
        company: u.company.name,
        posts: u.posts
          .orderBy((p) => p.id)
          .limit(1)
          .toList(PostCard),
      }));
      const rows = await db
        .queryable(User)
        .orderBy((u) => u.id)
        .select(UserCard)
        .toList();
      assert.deepEqual(rows, [
        { name: 'alice', company: 'acme', posts: [{ title: 'orm tips', owner: 'alice' }] },
        { name: 'bob', company: 'acme', posts: [{ title: 'orm_v2', owner: 'bob' }] },
        { name: 'carol', company: null, posts: [] },
      ]);
      // 视图也能在别的 select 里展开，并且能和 where / join 一起用
      const cards = await db
        .queryable(Post)
        .where((p) => p.id.eq(4))
        .select((p) => ({ ...PostCard(p), id: p.id }))
        .toList();
      assert.deepEqual(cards, [{ title: 'hello', owner: 'bob', id: 4 }]);
    });
  });

  describe(`${name}: column rules`, { skip: !options.extraTables }, () => {
    const doc = (title: string) => ({ title, createdBy: 'ann', secret: 'hello' });

    it('turns delete into an update and hides soft-deleted rows', async () => {
      const { db } = await seeded();
      await db
        .insert(Doc)
        .values([doc('a'), doc('b'), doc('c')])
        .execute();
      assert.equal(
        await db
          .delete(Doc)
          .where((d) => d.id.eq(1))
          .execute(),
        1,
      );
      assert.equal(await db.queryable(Doc).count(), 2);
      // 单条语句关掉过滤，能看到被逻辑删除的行
      const all = await db
        .queryable(Doc)
        .noInterceptor('softDelete')
        .orderBy((d) => d.id)
        .toList();
      assert.deepEqual(
        all.map((d) => [d.title, d.deleted]),
        [
          ['a', true],
          ['b', false],
          ['c', false],
        ],
      );
      // 已经删除的行读不到，再删一次什么也没做；更新也碰不到它
      assert.equal(
        await db
          .delete(Doc)
          .where((d) => d.id.eq(1))
          .execute(),
        0,
      );
      assert.equal(
        await db
          .update(Doc)
          .set({ title: 'x' })
          .where((d) => d.id.eq(1))
          .execute(),
        0,
      );
      // hard() 才是物理删除
      assert.equal(
        await db
          .delete(Doc)
          .where((d) => d.id.eq(1))
          .hard()
          .execute(),
        1,
      );
      assert.equal(await db.queryable(Doc).noInterceptor('softDelete').count(), 2);
    });

    it('fills client defaults on insert and update-time values on update', async () => {
      const { db } = await seeded();
      await db
        .insert(Doc)
        .values([doc('a'), { ...doc('b'), token: 'mine' }])
        .execute();
      const rows = await db
        .queryable(Doc)
        .orderBy((d) => d.id)
        .toList();
      // token 没给就用 $default；status 没给，用库里的默认值 draft；deleted 插入时默认写"未删除"
      assert.deepEqual(
        rows.map((r) => [r.token, r.status, r.deleted, r.version, r.updatedAt]),
        [
          ['tok', 'draft', false, 0, null],
          ['mine', 'draft', false, 0, null],
        ],
      );
      await db
        .update(Doc)
        .set({ title: 'a2' })
        .where((d) => d.id.eq(1))
        .execute();
      assert.equal(
        (
          await db
            .queryable(Doc)
            .where((d) => d.id.eq(1))
            .single()
        ).updatedAt?.toISOString(),
        '2026-05-06T07:08:09.000Z',
      );
      const given = new Date('2030-01-01T00:00:00.000Z');
      await db
        .update(Doc)
        .set({ title: 'b2', updatedAt: given })
        .where((d) => d.id.eq(2))
        .execute();
      assert.equal(
        (
          await db
            .queryable(Doc)
            .where((d) => d.id.eq(2))
            .single()
        ).updatedAt?.toISOString(),
        given.toISOString(),
      );
    });

    it('validates enum values on write and read', async () => {
      const { db } = await seeded();
      await assert.rejects(
        () =>
          db
            .insert(Doc)
            .values({ ...doc('a'), status: 'bogus' as never })
            .execute(),
        /not one of/,
      );
      await db
        .insert(Doc)
        .values({ ...doc('a'), status: 'published' })
        .execute();
      assert.equal((await db.queryable(Doc).single()).status, 'published');
      // 库里被写进了不认识的值：读出时报错，而不是悄悄当成合法值
      await db.sql
        .execute`UPDATE ${db.sql.ident('t_doc')} SET ${db.sql.ident('status')} = ${'weird'}`;
      await assert.rejects(() => db.queryable(Doc).toList(), /not one of/);
    });

    it('guards updates by version and bumps it on every update', async () => {
      const { db } = await seeded();
      await db.insert(Doc).values(doc('a')).execute();
      const stale = await db.queryable(Doc).single();
      assert.equal(stale.version, 0);
      await db
        .update(Doc)
        .entity({ ...stale, title: 'first' })
        .execute();
      assert.equal((await db.queryable(Doc).single()).version, 1);
      // 还拿着版本 0 的旧数据去更新：条件不满足，一行也没改到，抛错
      await assert.rejects(
        () =>
          db
            .update(Doc)
            .entity({ ...stale, title: 'second' })
            .execute(),
        /optimistic lock/,
      );
      assert.equal((await db.queryable(Doc).single()).title, 'first');
      // 表达式更新没有版本条件，但同样让版本加 1，别人手里的旧版本随之失效
      await db
        .update(Doc)
        .set({ title: 'third' })
        .where((d) => d.id.eq(1))
        .execute();
      assert.equal((await db.queryable(Doc).single()).version, 2);
    });

    it('merges versioned updates and still encodes encrypted columns', async () => {
      const { db } = await seeded();
      await db
        .insert(Doc)
        .values([doc('a'), doc('b')])
        .execute();
      const docs = await db
        .queryable(Doc)
        .orderBy((d) => d.id)
        .toList();
      await db
        .update(Doc)
        .entities(docs.map((d) => ({ ...d, title: `${d.title}!`, secret: `new ${d.title}` })))
        .batch()
        .execute();
      const after = await db
        .queryable(Doc)
        .orderBy((d) => d.id)
        .toList();
      assert.deepEqual(
        after.map((d) => [d.title, d.secret, d.version]),
        [
          ['a!', 'new a', 1],
          ['b!', 'new b', 1],
        ],
      );
      // 还拿着版本 0：两行都没改到
      await assert.rejects(
        () => db.update(Doc).entities(docs).batch().execute(),
        /optimistic lock failed: 2 of 2/,
      );
    });

    it('ignores the version when asked and guards deletes by version (official VersionTest)', async () => {
      const { db } = await seeded();
      await db
        .insert(Doc)
        .values([doc('a'), doc('b')])
        .execute();
      const [a, b] = await db
        .queryable(Doc)
        .orderBy((d) => d.id)
        .toList();
      // ignoreVersion：表达式更新不换版本，entity(row) 不要求、也不带版本条件
      await db
        .update(Doc)
        .set({ title: 'a1' })
        .where((d) => d.id.eq(a!.id))
        .ignoreVersion()
        .execute();
      await db
        .update(Doc)
        .ignoreVersion()
        .entity({ ...a!, title: 'a2', version: 41 })
        .execute();
      const after = await db.queryable(Doc).findOrThrow(a!.id);
      assert.deepEqual([after.title, after.version], ['a2', 0]);
      // 带版本的删除：版本不对抛错，对了才删（逻辑删除顺带换版本）
      await assert.rejects(
        () =>
          db
            .delete(Doc)
            .entity({ ...b!, version: 7 })
            .execute(),
        /optimistic lock failed/,
      );
      assert.equal(await db.delete(Doc).entity(b!).execute(), 1);
      const removed = await db.queryable(Doc).noInterceptor('softDelete').findOrThrow(b!.id);
      assert.deepEqual([removed.deleted, removed.version], [true, 1]);
      assert.throws(() => db.delete(Comment).withVersion(1), /has no version column/);
    });

    it('never updates insert-only columns', async () => {
      const { db } = await seeded();
      await db.insert(Doc).values(doc('a')).execute();
      assert.throws(
        () =>
          db
            .update(Doc)
            .set({ createdBy: 'bob' })
            .where((d) => d.id.eq(1))
            .toSQL(),
        /insert-only/,
      );
      const row = await db.queryable(Doc).single();
      await db
        .update(Doc)
        .entity({ ...row, title: 'a2', createdBy: 'bob' })
        .execute();
      assert.equal((await db.queryable(Doc).single()).createdBy, 'ann');
    });

    it('encrypts transparently, including in equality conditions', async () => {
      const { db } = await seeded();
      await db.insert(Doc).values(doc('a')).execute();
      const raw = await db.sql`SELECT ${db.sql.ident('secret')} FROM ${db.sql.ident('t_doc')}`;
      assert.equal(Object.values(raw[0]!)[0], 'uryyb');
      assert.equal((await db.queryable(Doc).single()).secret, 'hello');
      assert.equal(
        await db
          .queryable(Doc)
          .where((d) => d.secret.eq('hello'))
          .count(),
        1,
      );
    });
  });

  describe(`${name}: subqueries, derived tables, unions and CTEs`, () => {
    it('groupJoin: aggregates over a grouped LEFT JOIN match the correlated subqueries', async () => {
      const { db } = await seeded();
      const select = (grouped: boolean) =>
        db
          .queryable(User)
          .orderBy((u) => u.id)
          .select((u) => {
            const posts = grouped ? u.posts.groupJoin() : u.posts;
            return {
              name: u.name,
              posts: posts.count(),
              orm: posts.count((p) => p.title.startsWith('orm')),
              total: posts.sum((p) => p.amount),
              avg: posts.avg((p) => p.amount),
            };
          })
          .toList();
      const rows = await select(true);
      assert.deepEqual(rows, await select(false));
      assert.deepEqual(
        // decimal 的和各库写法不一（SQLite 是浮点），按数值比
        rows.map((r) => [r.name, r.posts, r.orm, r.total === null ? null : Number(r.total)]),
        [
          ['alice', 2, 1, 2010.5],
          ['bob', 2, 1, 4.25],
          ['carol', 0, 0, null],
        ],
      );
    });

    it('implicit subqueries: all, at(i), countDistinct (official sub-query/README)', async () => {
      const { db } = await seeded();
      // 每篇都大于 2 元的人（carol 没有帖子，也算满足）
      const all = await db
        .queryable(User)
        .where((u) => u.posts.all((p) => p.amount.gt('2')))
        .orderBy((u) => u.id)
        .select((u) => u.name)
        .toList();
      assert.deepEqual(all, ['alice', 'carol']);
      const rows = await db
        .queryable(User)
        .orderBy((u) => u.id)
        .select((u) => ({
          latest: u.posts.orderBy((p) => p.id.desc()).at(0).title,
          second: u.posts.orderBy((p) => p.id).at(1).title,
          users: u.posts.countDistinct((p) => p.userId),
        }))
        .toList();
      assert.deepEqual(rows, [
        { latest: 'sql 100%', second: 'sql 100%', users: 1 },
        { latest: 'hello', second: 'hello', users: 1 },
        { latest: null, second: null, users: 0 },
      ]);
      const byLatest = await db
        .queryable(User)
        .where((u) =>
          u.posts
            .orderBy((p) => p.id)
            .at(0)
            .title.startsWith('orm'),
        )
        .select((u) => u.name)
        .toList();
      assert.deepEqual(byLatest.sort(), ['alice', 'bob']);
      assert.throws(
        () =>
          db
            .queryable(User)
            .select((u) => ({ n: u.posts.limit(1).count() }))
            .toSQL(),
        /only applies to toList/,
      );
    });

    it('uses a subquery in in(...) and as a scalar', async () => {
      const { db } = await seeded();
      const q = db.queryable(User).orderBy((u) => u.id);
      // 有帖子的用户 / 没有帖子的用户 / 有大额帖子的用户
      assert.deepEqual(
        (await q.where((u) => u.id.in(db.queryable(Post).select((p) => p.userId))).toList()).map(
          (u) => u.name,
        ),
        ['alice', 'bob'],
      );
      assert.deepEqual(
        (await q.where((u) => u.id.notIn(db.queryable(Post).select((p) => p.userId))).toList()).map(
          (u) => u.name,
        ),
        ['carol'],
      );
      assert.deepEqual(
        (
          await q
            .where((u) =>
              u.id.in(
                db
                  .queryable(Post)
                  .where((p) => p.amount.gt('100'))
                  .select((p) => p.userId),
              ),
            )
            .toList()
        ).map((u) => u.name),
        ['alice'],
      );
      // 标量子查询：金额高于平均值（503.6875）的帖子只有 2000.00 那篇
      const average = db
        .queryable(Post)
        .groupBy(() => ({}))
        .select((g) => g.avg((p) => p.amount));
      assert.deepEqual(
        (
          await db
            .queryable(Post)
            .where((p) => p.amount.gt(average))
            .toList()
        ).map((p) => p.id),
        [2],
      );
    });

    it('rejects subqueries that do not select exactly one column', async () => {
      const { db } = await seeded();
      await assert.rejects(
        () =>
          db
            .queryable(User)
            .where((u) => u.id.in(db.queryable(Post).select((p) => p.userId) as never))
            .where((u) => u.id.in(db.queryable(Post) as never))
            .toList(),
        /exactly one column/,
      );
    });

    it('filters on window results through a derived table (QUALIFY)', async () => {
      const { db } = await seeded();
      const top = db
        .queryable(Post)
        .select((p) => ({
          id: p.id,
          userId: p.userId,
          rn: win.rowNumber((w) => w.partitionBy(p.userId).orderBy(p.amount.desc())),
        }))
        .asTable();
      // 每个用户金额最高的一篇：alice 的 2000.00（id 2）、bob 的 3.00（id 4）
      assert.deepEqual(
        (
          await top
            .where((t) => t.rn.eq(1))
            .orderBy((t) => t.id)
            .toList()
        ).map((t) => t.id),
        [2, 4],
      );
      assert.equal(await top.where((t) => t.rn.eq(1)).count(), 2);
      assert.deepEqual(
        (await top.orderBy((t) => t.id).toPage(2, 3)).rows.map((t) => t.id),
        [4],
      );
      // 先限制再排序：派生表里的 limit 在外层 orderBy 之前生效
      const firstTwo = await db
        .queryable(Post)
        .orderBy((p) => p.id)
        .limit(2)
        .select((p) => ({ id: p.id }))
        .asTable()
        .orderBy((t) => t.id.desc())
        .toList();
      assert.deepEqual(
        firstTwo.map((t) => t.id),
        [2, 1],
      );
    });

    it('unions and unionAlls queries, aligning columns by name', async () => {
      const { db } = await seeded();
      const adults = db
        .queryable(User)
        .where((u) => u.age.gt(20))
        .select((u) => ({ name: u.name, age: u.age }));
      const minors = db
        .queryable(User)
        .where((u) => u.age.lt(20))
        .select((u) => ({ age: u.age, name: u.name }));
      const both = adults.union(minors);
      assert.deepEqual(
        (await both.orderBy((r) => r.name.asc()).toList()).map((r) => [r.name, r.age]),
        [
          ['alice', 30],
          ['carol', 17],
        ],
      );
      assert.equal(await both.count(), 2);
      // UNION 去重，UNION ALL 保留重复
      assert.equal(await adults.union(adults).count(), 1);
      assert.equal(await adults.unionAll(adults).count(), 2);
      // 三个查询接着并（alice、carol、alice），排序后跳过第一行再取两行
      const three = adults.unionAll(minors).unionAll(adults);
      assert.deepEqual(
        (
          await three
            .orderBy((r) => r.name.asc())
            .limit(2)
            .offset(1)
            .toList()
        ).map((r) => r.name),
        ['alice', 'carol'],
      );
    });

    it('rejects unions whose members differ in columns or carry ordering', async () => {
      const { db } = await seeded();
      const names = db.queryable(User).select((u) => ({ name: u.name }));
      await assert.rejects(
        async () => names.union(db.queryable(User).select((u) => ({ id: u.id })) as never).toList(),
        /same columns/,
      );
      await assert.rejects(
        async () =>
          db
            .queryable(User)
            .orderBy((u) => u.id)
            .select((u) => ({ name: u.name }))
            .union(names)
            .toList(),
        /asTable/,
      );
    });

    it('registers CTEs and joins them with real entities, chaining one on another', async () => {
      const { db } = await seeded();
      const adb = db.with(
        'big',
        db
          .queryable(Post)
          .where((p) => p.amount.gt('1'))
          .select((p) => ({ userId: p.userId, amount: p.amount })),
      );
      // 第二个 CTE 建立在第一个之上；WITH 里按依赖顺序排好，参数也按出现顺序绑定
      const bdb = adb.with(
        'totals',
        adb
          .queryable(adb.entity('big'))
          .groupBy((b) => ({ userId: b.userId }))
          .select((g) => ({ userId: g.key.userId, total: g.sum((b) => b.amount) })),
      );
      const rows = await bdb
        .queryable(User)
        .innerJoin(bdb.entity('totals'), (u, t) => t.userId.eq(u.id))
        .where((u) => u.name.ne('nobody'))
        .orderBy((u) => u.id)
        .select((u, t) => ({ name: u.name, total: t.total }))
        .toList();
      assert.deepEqual(
        rows.map((r) => [r.name, Number(r.total)]),
        [
          ['alice', 2010.5],
          ['bob', 4.25],
        ],
      );
      assert.match(bdb.queryable(bdb.entity('totals')).toSQL().sql, /^WITH .*big.*totals/);
    });

    it('runs recursive CTEs', { skip: options.recursiveCte === false }, async () => {
      const { db } = await seeded();
      // 1 到 5 的序列：锚点是 id = 1 的公司，递归部分每次加 1，到 5 为止
      const rdb = db.withRecursive(
        'seq',
        db
          .queryable(Company)
          .where((c) => c.id.eq(1))
          .select((c) => ({ n: c.id })),
        (r, self) =>
          r
            .queryable(self)
            .where((s) => s.n.lt(5))
            .select((s) => ({ n: s.n.plus(1) })),
      );
      assert.deepEqual(
        (
          await rdb
            .queryable(rdb.entity('seq'))
            .orderBy((s) => s.n)
            .toList()
        ).map((s) => s.n),
        [1, 2, 3, 4, 5],
      );
      // 递归结果还能和真实实体 join
      const joined = await rdb
        .queryable(Company)
        .innerJoin(rdb.entity('seq'), (c, s) => s.n.eq(c.id))
        .select((c) => ({ name: c.name }))
        .toList();
      assert.deepEqual(
        joined.map((j) => j.name),
        ['acme', 'globex'],
      );
    });

    it(
      'walks a self-referencing tree: descendantsOf, ancestorsOf and toTree',
      { skip: options.recursiveCte === false || !options.extraTables },
      async () => {
        const { db } = await seeded();
        // 1 总部 ─┬─ 2 研发 ── 4 前端
        //         └─ 3 销售          5 子公司（另一棵树）
        await db
          .insert(Dept)
          .values([
            { id: 1, parentId: null, name: 'hq' },
            { id: 2, parentId: 1, name: 'rd' },
            { id: 3, parentId: 1, name: 'sales' },
            { id: 4, parentId: 2, name: 'web' },
            { id: 5, parentId: null, name: 'sub' },
          ])
          .execute();
        const tree = await db
          .descendantsOf(Dept, 1, { parent: (d) => d.parentId })
          .orderBy((d) => d.id)
          .select((d) => ({ id: d.id, parentId: d.parentId, name: d.name }))
          .toTree({ id: 'id', parent: 'parentId' });
        assert.deepEqual(
          tree.map((node) => [node.name, node.children.map((child) => child.name)]),
          [['hq', ['rd', 'sales']]],
        );
        const ancestors = await db
          .ancestorsOf(Dept, 4, { parent: (d) => d.parentId, self: false })
          .orderBy((d) => d.id)
          .select((d) => d.name)
          .toList();
        assert.deepEqual(ancestors, ['hq', 'rd']);
      },
    );
  });

  describe(`${name}: function library (official func/*)`, () => {
    it('string functions: pad, trim, compare, notStartsWith, text template', async () => {
      const { db } = await seeded();
      const alice = await db
        .queryable(User)
        .where((u) => u.name.eq('alice'))
        .select((u) => ({
          left: u.name.padStart(7, '*'),
          right: u.name.padEnd(7, '-'),
          cut: u.name.padStart(3),
          trimmed: text`  ${u.name}  `.ltrim().rtrim(),
          compare: u.name.compare('bob'),
          same: u.name.compare('alice'),
          label: text`用户 ${u.name}，${u.age} 岁`,
        }))
        .single();
      assert.deepEqual(alice, {
        left: '**alice',
        right: 'alice--',
        cut: 'ali',
        trimmed: 'alice',
        compare: -1,
        same: 0,
        label: '用户 alice，30 岁',
      });
      const names = await db
        .queryable(User)
        .where((u) => [u.name.notStartsWith('a'), u.name.notEndsWith('ol')])
        .select((u) => u.name)
        .toList();
      assert.deepEqual(names, ['bob']);
    });

    it('math functions', async () => {
      const { db } = await seeded();
      const row = await db
        .queryable(Post)
        .where((p) => p.title.eq('orm tips'))
        .select((p) => ({
          sign: p.amount.minus('20').sign(),
          truncated: p.amount.truncate(0),
          power: p.amount.power(2),
          sqrt: p.amount.times(4).sqrt(),
          ln: p.amount.ln(),
          log10: p.amount.times(10).log10(),
          log2: p.amount.minus('2.5').log(2),
          atan2: p.amount.atan2(p.amount),
        }))
        .single();
      assert.equal(row.sign, -1);
      assert.equal(Number(row.truncated), 10);
      assert.equal(row.power, 110.25);
      assert.ok(Math.abs(row.sqrt! - Math.sqrt(42)) < 1e-9);
      assert.ok(Math.abs(row.ln! - Math.log(10.5)) < 1e-9);
      assert.ok(Math.abs(row.log10! - Math.log10(105)) < 1e-9);
      assert.ok(Math.abs(row.log2! - 3) < 1e-9);
      assert.ok(Math.abs(row.atan2! - Math.PI / 4) < 1e-9);
    });

    it('date functions: parts, format, add, diff, now', async () => {
      const { db } = await seeded();
      // 2026-01-02T03:04:05.006Z 是星期五
      const row = await db
        .queryable(User)
        .where((u) => u.name.eq('alice'))
        .select((u) => ({
          hour: u.createdAt.hour(),
          minute: u.createdAt.minute(),
          second: u.createdAt.second(),
          dayOfYear: u.createdAt.dayOfYear(),
          dayOfWeek: u.createdAt.dayOfWeek(),
          iso: u.createdAt.isoDayOfWeek(),
          text: u.createdAt.format('yyyy/MM/dd HH:mm:ss 写入'),
          later: u.createdAt.addHours(2),
          nextYear: u.createdAt.addYears(1),
          byColumn: u.createdAt.add(u.age, 'day'),
          hours: u.createdAt.addHours(5).addMinutes(30).diff(u.createdAt, 'hour'),
          minutes: u.createdAt.diff(u.createdAt.addMinutes(90), 'minute'),
        }))
        .single();
      assert.deepEqual(
        {
          ...row,
          later: row.later.toISOString(),
          nextYear: row.nextYear.toISOString(),
          byColumn: row.byColumn.toISOString(),
        },
        {
          hour: 3,
          minute: 4,
          second: 5,
          dayOfYear: 2,
          dayOfWeek: 5,
          iso: 5,
          text: '2026/01/02 03:04:05 写入',
          later: '2026-01-02T05:04:05.006Z',
          nextYear: '2027-01-02T03:04:05.006Z',
          byColumn: '2026-02-01T03:04:05.006Z',
          hours: 5,
          minutes: -90,
        },
      );
      assert.equal(
        await db
          .queryable(User)
          .where((u) => now().gt(u.createdAt))
          .count(),
        3,
      );
    });

    it('greatest / least ignore NULL', async () => {
      const { db } = await seeded();
      const rows = await db
        .queryable(User)
        .orderBy((u) => u.id)
        .select((u) => ({ hi: greatest(u.age, 20), lo: least(u.age, 20) }))
        .toList();
      assert.deepEqual(rows, [
        { hi: 30, lo: 20 },
        { hi: 20, lo: 20 },
        { hi: 20, lo: 17 },
      ]);
    });

    it('joining: in groups, on navigations and on group joins', async () => {
      const { db } = await seeded();
      const grouped = await db
        .queryable(Post)
        .groupBy((p) => ({ userId: p.userId }))
        .orderBy((g) => g.key.userId)
        .select((g) => ({
          userId: g.key.userId,
          titles: g.joining((p) => p.title, { separator: '|', orderBy: (p) => p.id }),
        }))
        .toList();
      assert.deepEqual(
        grouped.map((r) => r.titles),
        ['orm tips|sql 100%', 'orm_v2|hello'],
      );
      const users = await db
        .queryable(User)
        .orderBy((u) => u.id)
        .select((u) => ({
          titles: u.posts.joining((p) => p.title, { separator: '、', orderBy: (p) => p.id.desc() }),
          grouped: u.posts.groupJoin().joining((p) => p.title, { orderBy: (p) => p.id }),
        }))
        .toList();
      assert.deepEqual(users, [
        { titles: 'sql 100%、orm tips', grouped: 'orm tips,sql 100%' },
        { titles: 'hello、orm_v2', grouped: 'orm_v2,hello' },
        { titles: null, grouped: null },
      ]);
    });

    it('json functions: element, text, length, has (official func/json)', async () => {
      const { db } = await seeded();
      const rows = await db
        .queryable(User)
        .orderBy((u) => u.id)
        .select((u) => ({
          tags: u.attrs.json('tags'),
          first: u.attrs.jsonText('tags', 0),
          has: u.attrs.jsonHas('tags', 0),
        }))
        .toList();
      assert.deepEqual(rows, [
        { tags: ['vip'], first: 'vip', has: true },
        { tags: [], first: null, has: false },
        { tags: [], first: null, has: false },
      ]);
      if (options.jsonLength !== false)
        assert.deepEqual(
          await db
            .queryable(User)
            .orderBy((u) => u.id)
            .select((u) => u.attrs.jsonLength('tags'))
            .toList(),
          [1, 0, 0],
        );
      const vip = await db
        .queryable(User)
        .where((u) => u.attrs.jsonText('tags', 0).eq('vip'))
        .select((u) => u.name)
        .toList();
      assert.deepEqual(vip, ['alice']);
    });

    it('window value functions: firstValue / lastValue / nthValue', async () => {
      const { db } = await seeded();
      const rows = await db
        .queryable(Post)
        .orderBy((p) => p.id)
        .select((p) => ({
          first: win.firstValue(p.title, (w) => w.partitionBy(p.userId).orderBy(p.id)),
          last: win.lastValue(p.title, (w) =>
            w.partitionBy(p.userId).orderBy(p.id).rows('unboundedPreceding', 'unboundedFollowing'),
          ),
        }))
        .toList();
      assert.deepEqual(rows[0], { first: 'orm tips', last: 'sql 100%' });
      assert.deepEqual(rows[3], { first: 'orm_v2', last: 'hello' });
      const nth = db
        .queryable(Post)
        .orderBy((p) => p.id)
        .select((p) => ({
          second: win.nthValue(p.title, 2, (w) =>
            w.partitionBy(p.userId).orderBy(p.id).rows('unboundedPreceding', 'unboundedFollowing'),
          ),
        }));
      if (options.nthValue === false) {
        assert.throws(() => nth.toSQL(), /nthValue\(\) is not supported/);
        return;
      }
      assert.deepEqual(
        (await nth.toList()).map((r) => r.second),
        ['sql 100%', 'sql 100%', 'hello', 'hello'],
      );
    });
  });

  describe(`${name}: explicit joins`, () => {
    it('inner joins two tables and selects from both', async () => {
      const { db } = await seeded();
      // carol 没有帖子，内连接里不出现
      const rows = await db
        .queryable(User)
        .innerJoin(Post, (u, p) => p.userId.eq(u.id))
        .orderBy((_u, p) => p.id)
        .select((u, p) => ({ name: u.name, title: p.title }))
        .toList();
      assert.deepEqual(
        rows.map((r) => [r.name, r.title]),
        [
          ['alice', 'orm tips'],
          ['alice', 'sql 100%'],
          ['bob', 'orm_v2'],
          ['bob', 'hello'],
        ],
      );
    });

    it('left joins and keeps rows without a match', async () => {
      const { db } = await seeded();
      const rows = await db
        .queryable(User)
        .leftJoin(Post, (u, p) => p.userId.eq(u.id))
        .orderBy((u, p) => [u.id, p.id])
        .select((u, p) => ({ name: u.name, title: p.title }))
        .toList();
      assert.equal(rows.length, 5);
      assert.deepEqual(rows.at(-1), { name: 'carol', title: null });
    });

    it('returns whole rows grouped by entity name when nothing is selected', async () => {
      const { db } = await seeded();
      const rows = await db
        .queryable(User)
        .leftJoin(Post, (u, p) => p.userId.eq(u.id))
        .orderBy((u, p) => [u.id, p.id])
        .toList();
      assert.equal(rows[0]!.User.name, 'alice');
      assert.equal(rows[0]!.Post?.title, 'orm tips');
      // left join 没匹配上时整行是 null，而不是一行全是 null 的对象
      assert.equal(rows.at(-1)!.User.name, 'carol');
      assert.equal(rows.at(-1)!.Post, null);
    });

    it('right joins: keeps every row of the new table, earlier tables become nullable', async () => {
      const { db } = await seeded();
      // globex 没有员工：右连接里照样出现，用户一侧为 null
      const rows = await db
        .queryable(User)
        .rightJoin(Company, (u, c) => c.id.eq(u.companyId))
        .orderBy((u, c) => [c.id, u.id])
        .select((u, c) => ({ user: u.name, company: c.name }))
        .toList();
      assert.deepEqual(rows, [
        { user: 'alice', company: 'acme' },
        { user: 'bob', company: 'acme' },
        { user: null, company: 'globex' },
      ]);
      const whole = await db
        .queryable(User)
        .rightJoin(Company, (u, c) => c.id.eq(u.companyId))
        .where((_u, c) => c.name.eq('globex'))
        .toList();
      assert.deepEqual(
        whole.map((r) => [r.User, r.Company.name]),
        [[null, 'globex']],
      );
    });

    it('joins a subquery as a derived table (official sub-query/join-sub-query)', async () => {
      const { db } = await seeded();
      const stats = db
        .queryable(Post)
        .groupBy((p) => ({ userId: p.userId }))
        .select((g) => ({ userId: g.key.userId, posts: g.count(), top: g.max((p) => p.amount) }));
      const rows = await db
        .queryable(User)
        .leftJoin(stats, (u, s) => s.userId.eq(u.id))
        .orderBy((u) => u.id)
        .select((u, s) => ({ name: u.name, posts: s.posts.orElse(0), top: s.top }))
        .toList();
      assert.deepEqual(
        rows.map((r) => [r.name, r.posts, r.top === null ? null : Number(r.top)]),
        [
          ['alice', 2, 2000],
          ['bob', 2, 3],
          ['carol', 0, null],
        ],
      );
      // 没写 select：子查询的行放在 derived 键下
      const whole = await db
        .queryable(User)
        .innerJoin(stats, (u, s) => s.userId.eq(u.id))
        .where((_u, s) => s.posts.ge(2))
        .orderBy((u) => u.id)
        .toList();
      assert.deepEqual(
        whole.map((r) => [r.User.name, r.derived.posts]),
        [
          ['alice', 2],
          ['bob', 2],
        ],
      );
    });

    it('cross joins: every pair, conditions in where', async () => {
      const { db } = await seeded();
      const pairs = await db
        .queryable(Company)
        .crossJoin(Company)
        .where((a, b) => a.id.lt(b.id))
        .select((a, b) => ({ a: a.name, b: b.name }))
        .toList();
      assert.deepEqual(pairs, [{ a: 'acme', b: 'globex' }]);
    });

    it('joins three tables, filters on joined tables and pages', async () => {
      const { db } = await seeded();
      const q = db
        .queryable(User)
        .innerJoin(Post, (u, p) => p.userId.eq(u.id))
        .innerJoin(Comment, (_u, p, c) => c.postId.eq(p.id))
        .where((u, _p, c) => [u.name.eq('alice'), c.body.like('n')])
        .orderBy((_u, _p, c) => c.id);
      // 'nice' 与 'thanks' 都含 n，都挂在 alice 的第 1 篇帖子上
      assert.deepEqual(
        (await q.select((_u, p, c) => ({ title: p.title, body: c.body })).toList()).map(
          (r) => r.body,
        ),
        ['nice', 'thanks'],
      );
      assert.equal(await q.count(), 2);
      assert.equal((await q.select((u) => ({ id: u.id })).toPage(1, 1)).total, 2);
    });

    it('uses navigations of a joined table', async () => {
      const { db } = await seeded();
      // p.user 是 Post 上的多对一导航，隐式 join 排在显式 join 之后
      const rows = await db
        .queryable(User)
        .innerJoin(Post, (u, p) => p.userId.eq(u.id))
        .where((_u, p) => p.user.name.eq('bob'))
        .select((_u, p) => ({ title: p.title, owner: p.user.name }))
        .toList();
      assert.deepEqual(
        rows.map((r) => r.owner),
        ['bob', 'bob'],
      );
    });

    it('groups and aggregates across joined tables', async () => {
      const { db } = await seeded();
      const rows = await db
        .queryable(User)
        .innerJoin(Post, (u, p) => p.userId.eq(u.id))
        .groupBy((u) => ({ name: u.name }))
        .orderBy((g) => g.key.name.asc())
        .select((g) => ({ name: g.key.name, posts: g.count(), total: g.sum((_u, p) => p.amount) }))
        .toList();
      assert.deepEqual(
        rows.map((r) => [r.name, r.posts, Number(r.total)]),
        [
          ['alice', 2, 2010.5],
          ['bob', 2, 4.25],
        ],
      );
      assert.equal(
        Number(
          await db
            .queryable(User)
            .innerJoin(Post, (u, p) => p.userId.eq(u.id))
            .where((u) => u.name.eq('bob'))
            .sum((_u, p) => p.amount),
        ),
        4.25,
      );
    });

    it('joins the same entity twice only when columns are named by select', async () => {
      const { db } = await seeded();
      // 自连接：同公司的不同用户配对
      const pairs = await db
        .queryable(User)
        .innerJoin(User, (a, b) => [b.companyId.eq(a.companyId), b.id.ne(a.id)])
        .orderBy((a, b) => [a.id, b.id])
        .select((a, b) => ({ a: a.name, b: b.name }))
        .toList();
      assert.deepEqual(pairs, [
        { a: 'alice', b: 'bob' },
        { a: 'bob', b: 'alice' },
      ]);
      await assert.rejects(
        () =>
          db
            .queryable(User)
            .innerJoin(User, (a, b) => b.id.eq(a.id))
            .toList(),
        /more than once/,
      );
    });

    it('rejects joins after select and joins without a condition', async () => {
      const { db } = await seeded();
      assert.throws(
        () =>
          db
            .queryable(User)
            .select((u) => ({ id: u.id }))
            .innerJoin(Post, (u, p) => p.userId.eq(u.id)),
        /before select/,
      );
      await assert.rejects(
        () =>
          db
            .queryable(User)
            .innerJoin(Post, () => undefined)
            .toList(),
        /ON condition/,
      );
    });
  });

  describe(`${name}: native SQL and execution hooks`, () => {
    it('runs db.sql with bound values, expanded arrays and quoted identifiers', async () => {
      const { db } = await seeded();
      // 标识符都用 ident：各库的引号不同，HANA 里不加引号的名字还会被折成大写
      const t = db.sql.ident;
      const rows =
        await db.sql`SELECT COUNT(*) FROM ${t('t_user')} WHERE ${t('age')} > ${20} AND ${t('name')} IN (${['alice', 'bob']})`;
      assert.equal(Number(Object.values(rows[0]!)[0]), 1);
      const affected = await db.sql
        .execute`UPDATE ${t('t_post')} SET ${t('title')} = ${'renamed'} WHERE ${t('id')} IN (${[1, 2]})`;
      assert.equal(affected, 2);
      assert.equal(
        await db
          .queryable(Post)
          .where((p) => p.title.eq('renamed'))
          .count(),
        2,
      );
    });

    it('rejects undefined values and empty arrays instead of sending a broken statement', async () => {
      const { db } = await seeded();
      await assert.rejects(() => db.sql`SELECT ${undefined}`, /undefined/);
      await assert.rejects(() => db.sql`SELECT 1 WHERE 1 IN (${[]})`, /empty/);
    });

    it('reports every statement to onExecute, with rows, duration and errors', async () => {
      const env = await seeded();
      const events: ExecutionEvent[] = [];
      const db = createDb({ schema, adapter: env.adapter, onExecute: (e) => events.push(e) });
      await db.queryable(User).toList();
      await db
        .delete(Post)
        .where((p) => p.id.eq(1))
        .execute();
      await assert.rejects(() => db.sql`SELECT * FROM ${db.sql.ident('eqts_no_such_table')}`);
      // 事务里的语句也经过同一个钩子
      await db.transaction(async (tx) => {
        await tx.queryable(Company).count();
      });
      assert.deepEqual(
        events.slice(0, 3).map((e) => [e.kind, e.rows, e.error === undefined]),
        [
          ['query', 3, true],
          ['execute', 1, true],
          ['query', 0, false],
        ],
      );
      assert.ok(events.every((e) => e.durationMs >= 0));
      assert.ok(events.length >= 4 && events.some((e) => e.statement.sql.includes('COUNT')));
    });
  });

  describe(`${name}: root aggregates, decimal arithmetic and insert chunking`, () => {
    it('aggregates a whole query without groupBy', async () => {
      const { db } = await seeded();
      // 种子里四篇帖子的金额：10.50 + 2000.00 + 1.25 + 3.00
      assert.equal(Number(await db.queryable(Post).sum((p) => p.amount)), 2014.75);
      assert.equal(Number(await db.queryable(Post).max((p) => p.amount)), 2000);
      assert.equal(Number(await db.queryable(Post).min((p) => p.amount)), 1.25);
      assert.equal(Number(await db.queryable(Post).avg((p) => p.amount)), 2014.75 / 4);
      assert.equal(await db.queryable(Post).countDistinct((p) => p.userId), 2);
      // where 条件照常生效；排序被丢掉，不会让 PG 报"ORDER BY 不在聚合里"
      assert.equal(
        Number(
          await db
            .queryable(Post)
            .where((p) => p.userId.eq(2))
            .orderBy((p) => p.id)
            .sum((p) => p.amount),
        ),
        4.25,
      );
      assert.equal(await db.queryable(User).sum((u) => u.age), 47);
    });

    it('returns null for aggregates over no rows', async () => {
      const { db } = await seeded();
      const none = db.queryable(Post).where((p) => p.userId.eq(999));
      assert.equal(await none.sum((p) => p.amount), null);
      assert.equal(await none.max((p) => p.amount), null);
      assert.equal(await none.countDistinct((p) => p.userId), 0);
    });

    it('refuses aggregates combined with limit', async () => {
      const { db } = await seeded();
      await assert.rejects(
        () =>
          db
            .queryable(Post)
            .limit(2)
            .sum((p) => p.amount),
        /limit/,
      );
    });

    it('does arithmetic on decimal columns with numbers, decimal text and other columns', async () => {
      const { db } = await seeded();
      const rows = await db
        .queryable(Post)
        .orderBy((p) => p.id)
        .select((p) => ({
          doubled: p.amount.times(2),
          plusText: p.amount.plus('0.50'),
          self: p.amount.minus(p.amount),
        }))
        .toList();
      assert.deepEqual(
        rows.map((r) => [Number(r.doubled), Number(r.plusText), Number(r.self)]),
        [
          [21, 11, 0],
          [4000, 2000.5, 0],
          [2.5, 1.75, 0],
          [6, 3.5, 0],
        ],
      );
      await db
        .update(Post)
        .set((p) => ({ amount: p.amount.plus(1) }))
        .where((p) => p.id.eq(3))
        .execute();
      assert.equal(
        Number(
          (
            await db
              .queryable(Post)
              .where((p) => p.id.eq(3))
              .single()
          ).amount,
        ),
        2.25,
      );
    });

    // 12000 行：单独跑一两秒，全量并发（PGlite 等也在跑）时会超过默认的 5 秒
    it(
      'inserts many rows, splitting them into statements below the parameter limit',
      { timeout: 30_000 },
      async () => {
        const { db } = await seeded();
        // 3 列 × 12000 行 = 36000 个参数，超过 SQLite 的 32766，必须分块；其它库一次也能装下，结果一致
        const rows = Array.from({ length: 12000 }, (_, i) => ({
          userId: 1,
          title: `bulk ${i}`,
          amount: '1.00' as const,
        }));
        assert.equal(await db.insert(Post).values(rows).execute(), 12000);
        assert.equal(
          await db
            .queryable(Post)
            .where((p) => p.title.startsWith('bulk '))
            .count(),
          12000,
        );
      },
    );
  });
}
