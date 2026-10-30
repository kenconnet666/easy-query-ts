/**
 * 各方言共用的测试实体与种子数据。建表语句各方言自己写（类型不同），列名一致。
 */
import {
  col,
  defineSchema,
  entity,
  uuidv7,
  type Adapter,
  type Db,
  type Statement,
} from '@zerodep-dev/easy-query-ts';
import {
  calendarDate,
  calendarDateTime,
  timeOfDay,
  zonedDateTime,
} from '@zerodep-dev/easy-query-ts-date';
import { decimalJs } from '@zerodep-dev/easy-query-ts-decimal';

export const Company = entity('t_company', {
  id: col.bigint().primaryKey().generated(),
  name: col.string(),
});

export const User = entity('t_user', {
  id: col.bigint().primaryKey().generated(),
  name: col.string(),
  age: col.int().nullable(),
  companyId: col.bigint().nullable(),
  attrs: col.json<{ tags: string[] }>().defaulted(),
  createdAt: col.datetime(),
});

export const Post = entity('t_post', {
  id: col.bigint().primaryKey().generated(),
  userId: col.bigint(),
  title: col.string(),
  amount: col.decimal(12, 2),
});

export const Comment = entity('t_comment', {
  id: col.bigint().primaryKey().generated(),
  postId: col.bigint(),
  body: col.string(),
});

/**
 * 扩展列类型的往返：decimal.js、64 位整数、@internationalized/date 的四种类型。
 * 只有开了 extensionTypes 的实库套件会建这张表（HANA 暂未验证）。
 */
export const Ext = entity('t_ext', {
  id: col.bigint().primaryKey().generated(),
  amount: decimalJs(12, 2),
  big: col.bigint({ mode: 'bigint' }),
  day: calendarDate(),
  startsAt: calendarDateTime(),
  at: zonedDateTime('Asia/Shanghai'),
  clock: timeOfDay(),
  raw: col.bytes(),
});

/** 多对多：角色，经 UserRole 中间表与用户相连 */
export const Role = entity('t_role', {
  id: col.bigint().primaryKey().generated(),
  name: col.string(),
});

export const UserRole = entity('t_user_role', {
  userId: col.bigint().primaryKey(),
  roleId: col.bigint().primaryKey(),
});

/** 复合外键：成员以 (tenantId, id) 为主键，笔记按这一对列引用成员——只比较 id 会把别的租户的成员当成同一个人 */
export const Member = entity('t_member', {
  tenantId: col.int().primaryKey(),
  id: col.int().primaryKey(),
  name: col.string(),
});

export const Note = entity('t_note', {
  id: col.bigint().primaryKey().generated(),
  tenantId: col.int(),
  memberId: col.int(),
  body: col.string(),
});

/** 自关联的树：部门的上级是另一个部门（descendantsOf、ancestorsOf、toTree 的用例） */
export const Dept = entity('t_dept', {
  id: col.bigint().primaryKey(),
  parentId: col.bigint().nullable(),
  name: col.string(),
});

/** 凯撒位移 13：确定性的"加密"，测试透明加解密用 */
export const rot13 = {
  encrypt: (v: string): string =>
    v.replace(/[a-z]/gi, (c) => {
      const base = c <= 'Z' ? 65 : 97;
      return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
    }),
  decrypt: (v: string): string => rot13.encrypt(v),
};

/** 用到全部列修饰器的实体：逻辑删除、乐观锁、客户端默认值、更新时填值、只插入、枚举、透明加密 */
export const Doc = entity('t_doc', {
  id: col.bigint().primaryKey().generated(),
  title: col.string(),
  status: col.enum(['draft', 'published'] as const).defaulted(),
  deleted: col.boolean().softDelete(),
  version: col.int().version(),
  createdBy: col.string().insertOnly(),
  token: col.string().$default(() => 'tok'),
  updatedAt: col
    .datetime()
    .nullable()
    .$onUpdate(() => new Date('2026-05-06T07:08:09.000Z')),
  secret: col.string().encrypted(rot13),
});

/** 建表（代码优先）用的实体：各种类型、自增主键、唯一约束、库里的默认值。不在 schema 里，只在建表测试里用 */
export const Gadget = entity('t_gadget', {
  id: col.bigint().primaryKey().generated(),
  name: col.string(50).unique(),
  price: col.decimal(10, 2),
  qty: col.int().dbDefault('0'),
  active: col.boolean(),
  born: col.date().nullable(),
  seenAt: col.datetime(),
  tags: col.json<string[]>(),
  photo: col.bytes().nullable(),
});

/** uuid 主键（客户端按时间有序生成）、uuid 外键与无符号整数：建表与往返的用例（ROADMAP 19.1） */
export const Token = entity('t_token', {
  id: col.uuid().primaryKey().$default(uuidv7),
  owner: col.uuid().nullable(),
  hits: col.bigint().unsigned(),
});

export const schema = defineSchema(
  { Company, User, Post, Comment, Ext, Role, UserRole, Member, Note, Doc, Dept },
  {
    Company: (r) => ({
      users: r.many('User', { from: 'id', to: 'companyId' }),
      // 直达关系：公司经员工到帖子
      posts: r.path('Post', ['users', 'posts']),
    }),
    User: (r) => ({
      company: r.one('Company', { from: 'companyId', to: 'id' }),
      posts: r.many('Post', { from: 'id', to: 'userId' }),
      roles: r.manyToMany('Role', {
        through: 'UserRole',
        throughFrom: 'userId',
        throughTo: 'roleId',
      }),
      // 有共同角色的人（含自己）
      peers: r.path('User', ['roles', 'users']),
      // 任意条件的关系：本人的大额帖子
      bigPosts: r.manyOn('Post', (u, p) => [p.userId.eq(u.id), p.amount.gt('100')]),
    }),
    Role: (r) => ({
      users: r.manyToMany('User', {
        through: 'UserRole',
        throughFrom: 'roleId',
        throughTo: 'userId',
      }),
    }),
    Member: (r) => ({
      notes: r.many('Note', { from: ['tenantId', 'id'], to: ['tenantId', 'memberId'] }),
    }),
    Note: (r) => ({
      member: r.one('Member', { from: ['tenantId', 'memberId'], to: ['tenantId', 'id'] }),
    }),
    Post: (r) => ({
      user: r.one('User', { from: 'userId', to: 'id' }),
      comments: r.many('Comment', { from: 'id', to: 'postId' }),
      company: r.pathOne('Company', ['user', 'company']),
      // 任意条件的多对一：作者（等同 user）
      author: r.oneOn('User', (p, u) => u.id.eq(p.userId)),
    }),
    Comment: (r) => ({ post: r.one('Post', { from: 'postId', to: 'id' }) }),
  },
);

export type TestDb = Db<typeof schema>;

/** 一个空库（已建表）+ 执行过的语句 */
export interface TestEnv {
  readonly db: TestDb;
  readonly statements: Statement[];
  /** 同一个连接，用来另建带拦截器的 db */
  readonly adapter: Adapter;
}

/** 两家公司、三个用户（一个无公司）、四篇帖子、两条评论；返回后清空语句记录 */
export async function seed(env: TestEnv): Promise<TestEnv> {
  const { db } = env;
  const acme = Number(await db.insert(Company).values({ name: 'acme' }).returnId());
  await db.insert(Company).values({ name: 'globex' }).execute();
  const t = new Date('2026-01-02T03:04:05.006Z');
  const alice = Number(
    await db
      .insert(User)
      .values({ name: 'alice', age: 30, companyId: acme, attrs: { tags: ['vip'] }, createdAt: t })
      .returnId(),
  );
  const bob = Number(
    await db
      .insert(User)
      .values({ name: 'bob', age: null, companyId: acme, attrs: { tags: [] }, createdAt: t })
      .returnId(),
  );
  await db
    .insert(User)
    .values({ name: 'carol', age: 17, companyId: null, attrs: { tags: [] }, createdAt: t })
    .execute();
  await db
    .insert(Post)
    .values([
      { userId: alice, title: 'orm tips', amount: '10.50' },
      { userId: alice, title: 'sql 100%', amount: '2000.00' },
      { userId: bob, title: 'orm_v2', amount: '1.25' },
      { userId: bob, title: 'hello', amount: '3.00' },
    ])
    .execute();
  await db
    .insert(Comment)
    .values([
      { postId: 1, body: 'nice' },
      { postId: 1, body: 'thanks' },
    ])
    .execute();
  env.statements.length = 0;
  return env;
}

/** 建表语句的文本测试用：注释、索引、外键（不在 schema 里，各方言的 sql.test 单独建 Db） */
export const Shelf = entity(
  't_shelf',
  { id: col.bigint().primaryKey().generated(), name: col.string(50).comment("书架's 名") },
  { comment: '书架' },
);
export const Book = entity(
  't_book',
  {
    id: col.bigint().primaryKey().generated(),
    shelfId: col.bigint(),
    title: col.string(100),
  },
  { indexes: [{ columns: ['shelfId', 'title'], unique: true }] },
);
export const ddlSchema = defineSchema(
  { Shelf, Book },
  {
    Book: (r) => ({
      shelf: r.one('Shelf', { from: 'shelfId', to: 'id' }, { foreignKey: { onDelete: 'cascade' } }),
    }),
  },
);
