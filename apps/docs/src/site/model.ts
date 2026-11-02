/**
 * 全站示例共用的业务模型：一个技术社区。公司、部门、员工，用户发帖、评论、互相关注，社区商店卖课程和会员。
 * 文档里每段代码都跑在这套模型与 seed-data.ts 的数据上：构建时算出 SQL 与结果，浏览器里点“运行”时真的执行
 */
import {
  byMod,
  byMonth,
  caseWhen,
  col,
  defineComputed,
  defineSchema,
  entity,
  embed,
  tenant,
  text,
  touch,
  type Db,
  type Interceptor,
} from '@zerodep-dev/easy-query-ts';
import { seedData } from './seed-data.ts';

export const Company = entity('t_company', {
  id: col.bigint().primaryKey().generated(),
  name: col.string(50),
  city: col.string(20),
});

export const Department = entity('t_department', {
  id: col.bigint().primaryKey().generated(),
  companyId: col.bigint(),
  parentId: col.bigint().nullable(),
  name: col.string(50),
});

export const User = entity('t_user', {
  id: col.bigint().primaryKey().generated(),
  name: col.string(50),
  age: col.int().nullable(),
  companyId: col.bigint().nullable(),
  departmentId: col.bigint().nullable(),
  managerId: col.bigint().nullable(),
  level: col.enum(['junior', 'senior', 'lead'] as const),
  joinedAt: col.date(),
});

export const Profile = entity('t_profile', {
  userId: col.bigint().primaryKey(),
  bio: col.string(200),
  skills: col.json<string[]>(),
  website: col.string(100).nullable(),
});

export const Category = entity('t_category', {
  id: col.bigint().primaryKey().generated(),
  parentId: col.bigint().nullable(),
  name: col.string(30),
});

export const Post = entity('t_post', {
  id: col.bigint().primaryKey().generated(),
  authorId: col.bigint(),
  categoryId: col.bigint(),
  title: col.string(100),
  status: col.enum(['draft', 'published'] as const),
  views: col.int(),
  publishedAt: col.date().nullable(),
});

export const Comment = entity('t_comment', {
  id: col.bigint().primaryKey().generated(),
  postId: col.bigint(),
  authorId: col.bigint(),
  parentId: col.bigint().nullable(),
  body: col.string(200),
  likes: col.int(),
});

export const Tag = entity('t_tag', {
  id: col.bigint().primaryKey().generated(),
  name: col.string(30),
});

export const PostTag = entity('t_post_tag', {
  postId: col.bigint().primaryKey(),
  tagId: col.bigint().primaryKey(),
});

export const Follow = entity('t_follow', {
  followerId: col.bigint().primaryKey(),
  followeeId: col.bigint().primaryKey(),
});

export const Product = entity('t_product', {
  id: col.bigint().primaryKey().generated(),
  name: col.string(50),
  price: col.decimal(10, 2),
  stock: col.int(),
});

export const Order = entity('t_order', {
  id: col.bigint().primaryKey().generated(),
  userId: col.bigint(),
  status: col.enum(['pending', 'paid', 'shipped', 'cancelled'] as const),
  createdAt: col.datetime(),
});

export const OrderItem = entity('t_order_item', {
  orderId: col.bigint().primaryKey(),
  productId: col.bigint().primaryKey(),
  quantity: col.int(),
  price: col.decimal(10, 2),
});

/** 用到列规则的文档表：逻辑删除、乐观锁、只插入、更新时填值（“列规则”一章的示例） */
export const Doc = entity('t_doc', {
  id: col.bigint().primaryKey().generated(),
  title: col.string(100),
  deleted: col.boolean().softDelete(),
  version: col.int().version(),
  createdBy: col.string(50).insertOnly(),
  updatedAt: col
    .datetime()
    .nullable()
    .$onUpdate(() => new Date('2026-11-01T08:00:00Z')),
});

/** 门店：地址是值对象，在库里展开成几列（“实体与列”一章） */
export const Shop = entity('t_shop', {
  id: col.bigint().primaryKey().generated(),
  name: col.string(50),
  address: embed({
    city: col.string(20),
    street: col.string(100).nullable(),
    geo: embed({ lat: col.double(), lng: col.double() }, { prefix: 'geo_' }),
  }),
});

/** 支付记录：几种支付方式共用一张表，kind 区分（“多态实体”一章） */
export const Payment = entity.union('t_payment', 'kind', {
  base: {
    id: col.bigint().primaryKey().generated(),
    orderId: col.bigint(),
    amount: col.decimal(10, 2),
  },
  variants: {
    card: { cardNo: col.string(19), holder: col.string(50).nullable() },
    wechat: { openId: col.string(40) },
  },
});

/** 按用户取模分四张表（“分表”一章）：不在 schema 里，也不建表，卡片只渲染 SQL */
export const Log = entity(
  't_log',
  { id: col.bigint().primaryKey(), userId: col.bigint(), message: col.string(200) },
  { sharding: byMod('userId', 4) },
);

/** 按月分表（“分表”一章）：同上 */
export const Bill = entity(
  't_bill',
  { id: col.bigint().primaryKey(), createdAt: col.datetime(), amount: col.decimal(10, 2) },
  {
    sharding: byMonth('createdAt', { from: '2025-01', to: () => new Date('2025-06-01T00:00:00Z') }),
  },
);

/** 工单：多租户、自动填充的时间、加密的联系方式（“多租户”“自动填充”“加密”几章） */
export const Ticket = entity('t_ticket', {
  id: col.bigint().primaryKey().generated(),
  // 插入时由 tenant 拦截器填：类型上可省
  tenantId: col.int().defaulted(),
  title: col.string(100),
  contact: col.string(100).encrypted({
    // 示例用的可逆变换：确定性的，所以能按密文比较。真实项目换成 AES 这类加密
    encrypt: (plain) => `enc:${plain.split('').reverse().join('')}`,
    decrypt: (cipher) => cipher.slice(4).split('').reverse().join(''),
  }),
  touchedAt: col.datetime().nullable(),
});

declare module '@zerodep-dev/easy-query-ts' {
  interface InterceptorNames {
    audit: true;
  }
}

/** 示例里记下的写入：“拦截器”一章看它 */
export const auditLog: string[] = [];

/** 示例 Db 上的拦截器：工单只看 1 号租户；审计默认关着，语句上 useInterceptor('audit') 才生效 */
export const interceptors: readonly Interceptor[] = [
  tenant('tenantId', () => 1),
  touch('touchedAt', () => new Date('2026-11-01T08:00:00Z')),
  {
    name: 'audit',
    enabled: false,
    afterWrite(event) {
      auditLog.push(`${event.kind} ${event.entity.table}：${event.affected} 行`);
    },
  },
];

const relations = defineSchema(
  {
    Company,
    Department,
    User,
    Profile,
    Category,
    Post,
    Comment,
    Tag,
    PostTag,
    Follow,
    Product,
    Order,
    OrderItem,
    Doc,
    Shop,
    Payment,
    Ticket,
  },
  {
    Company: (r) => ({
      users: r.many('User', { from: 'id', to: 'companyId' }),
      departments: r.many('Department', { from: 'id', to: 'companyId' }),
      // 直达关系：经员工到帖子，用法同一对多
      posts: r.path('Post', ['users', 'posts']),
    }),
    Department: (r) => ({
      company: r.one('Company', { from: 'companyId', to: 'id' }),
      // 自关联：上级部门和下级部门
      parent: r.one('Department', { from: 'parentId', to: 'id' }),
      children: r.many('Department', { from: 'id', to: 'parentId' }),
      users: r.many('User', { from: 'id', to: 'departmentId' }),
    }),
    User: (r) => ({
      company: r.one('Company', { from: 'companyId', to: 'id' }),
      department: r.one('Department', { from: 'departmentId', to: 'id' }),
      // 全是多对一的直达关系：等同于 u.department.company
      departmentCompany: r.pathOne('Company', ['department', 'company']),
      // 一对一：资料表的主键就是用户 id
      profile: r.one('Profile', { from: 'id', to: 'userId' }),
      // 自关联：上级和直属下属
      manager: r.one('User', { from: 'managerId', to: 'id' }),
      reports: r.many('User', { from: 'id', to: 'managerId' }),
      // 自关联的多对多：经关注表，两个方向各是一个导航
      followers: r.manyToMany('User', {
        through: 'Follow',
        throughFrom: 'followeeId',
        throughTo: 'followerId',
      }),
      following: r.manyToMany('User', {
        through: 'Follow',
        throughFrom: 'followerId',
        throughTo: 'followeeId',
      }),
      posts: r.many('Post', { from: 'id', to: 'authorId' }),
      comments: r.many('Comment', { from: 'id', to: 'authorId' }),
      orders: r.many('Order', { from: 'id', to: 'userId' }),
      // 不是主键的关联：文档记的是创建人的名字。文档有逻辑删除，导航上也只看没删除的
      docs: r.many('Doc', { from: 'name', to: 'createdBy' }),
      // 直达关系：经订单到买过的商品，同一个商品只算一次
      products: r.path('Product', ['orders', 'products']),
      // 固定条件的一对多：只算阅读量过千的帖子
      hotPosts: r.many('Post', { from: 'id', to: 'authorId' }, { where: (p) => p.views.ge(1000) }),
      // 一对多里取一条当一对一：最新的帖子、阅读量最高的帖子
      latestPost: r.oneOfMany('Post', 'posts', { orderBy: (p) => p.id.desc() }),
      topPost: r.oneOfMany('Post', 'posts', { orderBy: (p) => p.views.desc() }),
    }),
    Profile: (r) => ({
      // 资料一定属于某个用户。写了 required 才是 INNER JOIN，结果类型不可空；不写都是 LEFT JOIN
      user: r.one('User', { from: 'userId', to: 'id' }, { required: true }),
    }),
    Category: (r) => ({
      parent: r.one('Category', { from: 'parentId', to: 'id' }),
      children: r.many('Category', { from: 'id', to: 'parentId' }),
      posts: r.many('Post', { from: 'id', to: 'categoryId' }),
    }),
    Post: (r) => ({
      author: r.one('User', { from: 'authorId', to: 'id' }),
      category: r.one('Category', { from: 'categoryId', to: 'id' }),
      comments: r.many('Comment', { from: 'id', to: 'postId' }),
      tags: r.manyToMany('Tag', { through: 'PostTag', throughFrom: 'postId', throughTo: 'tagId' }),
    }),
    Comment: (r) => ({
      post: r.one('Post', { from: 'postId', to: 'id' }),
      author: r.one('User', { from: 'authorId', to: 'id' }),
      // 自关联：回复的是哪条、有哪些回复
      parent: r.one('Comment', { from: 'parentId', to: 'id' }),
      replies: r.many('Comment', { from: 'id', to: 'parentId' }),
    }),
    Tag: (r) => ({
      posts: r.manyToMany('Post', {
        through: 'PostTag',
        throughFrom: 'tagId',
        throughTo: 'postId',
      }),
    }),
    Product: (r) => ({
      items: r.many('OrderItem', { from: 'id', to: 'productId' }),
    }),
    Order: (r) => ({
      user: r.one('User', { from: 'userId', to: 'id' }),
      items: r.many('OrderItem', { from: 'id', to: 'orderId' }),
      payments: r.many('Payment', { from: 'id', to: 'orderId' }),
      products: r.manyToMany('Product', {
        through: 'OrderItem',
        throughFrom: 'orderId',
        throughTo: 'productId',
      }),
    }),
    OrderItem: (r) => ({
      order: r.one('Order', { from: 'orderId', to: 'id' }),
      product: r.one('Product', { from: 'productId', to: 'id' }),
    }),
    Payment: (r) => ({
      order: r.one('Order', { from: 'orderId', to: 'id' }),
    }),
  },
);

/** 计算属性：拼接、状态、跨表聚合，之后像一列那样用（“计算属性”一章） */
export const schema = defineComputed(relations, 'User', {
  label: (u) => text`${u.name}（${u.company.name}）`,
  stage: (u) => caseWhen(u.age.ge(18), '成年').when(u.age.isNull(), '未知').else('未成年'),
  postCount: (u) => u.posts.count(),
});

/** 放进示例数据：建好表之后调用，主键从 1 起 */
export async function seed(db: Db<typeof schema>): Promise<void> {
  await db
    .insert(Company)
    .values([...seedData.Company])
    .execute();
  await db
    .insert(Department)
    .values([...seedData.Department])
    .execute();
  await db
    .insert(User)
    .values([...seedData.User])
    .execute();
  await db
    .insert(Profile)
    .values(seedData.Profile.map((row) => ({ ...row, skills: [...row.skills] })))
    .execute();
  await db
    .insert(Category)
    .values([...seedData.Category])
    .execute();
  await db
    .insert(Post)
    .values([...seedData.Post])
    .execute();
  await db
    .insert(Comment)
    .values([...seedData.Comment])
    .execute();
  await db
    .insert(Tag)
    .values([...seedData.Tag])
    .execute();
  await db
    .insert(PostTag)
    .values([...seedData.PostTag])
    .execute();
  await db
    .insert(Follow)
    .values([...seedData.Follow])
    .execute();
  await db
    .insert(Product)
    .values([...seedData.Product])
    .execute();
  await db
    .insert(Order)
    .values(seedData.Order.map((row) => ({ ...row, createdAt: new Date(row.createdAt) })))
    .execute();
  await db
    .insert(OrderItem)
    .values([...seedData.OrderItem])
    .execute();
  await db
    .insert(Doc)
    .values([...seedData.Doc])
    .execute();
  await db
    .insert(Shop)
    .values([...seedData.Shop])
    .execute();
  await db
    .insert(Payment)
    .values([...seedData.Payment])
    .execute();
  await db
    .insert(Ticket)
    .values([...seedData.Ticket])
    .execute();
}
