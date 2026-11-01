/** 声明关系：对一、对多、多对多、自关联、直达、复合键、任意条件 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { CodeBlock } from '@zerodep-dev/vue-tsx-pro-ui';
import { DocPage, Note, P, Points, Section, SimpleTable } from '../../site/content';

const overview = `export const schema = defineSchema(
  { User, Company, Post, Tag, PostTag, Follow, Profile },
  {
    User: (r) => ({
      company: r.one('Company', { from: 'companyId', to: 'id' }),     // 多对一
      profile: r.one('Profile', { from: 'id', to: 'userId' }),        // 一对一
      manager: r.one('User', { from: 'managerId', to: 'id' }),        // 自关联
      posts: r.many('Post', { from: 'id', to: 'authorId' }),          // 一对多
      hotPosts: r.many('Post', { from: 'id', to: 'authorId' }, {
        where: (p) => p.views.ge(1000),                               // 固定条件
      }),
      followers: r.manyToMany('User', {                               // 多对多
        through: 'Follow',
        throughFrom: 'followeeId',
        throughTo: 'followerId',
      }),
    }),
    Profile: (r) => ({
      user: r.one('User', { from: 'userId', to: 'id' }, { required: true }), // 必有：INNER JOIN
    }),
    Post: (r) => ({
      tags: r.manyToMany('Tag', { through: 'PostTag', throughFrom: 'postId', throughTo: 'tagId' }),
    }),
  },
);`;

const required = `// 外键可空：u.company.name 的类型是 string | null，LEFT JOIN
company: r.one('Company', { from: 'companyId', to: 'id' }),

// 确定一定有值：p.user.name 的类型是 string，INNER JOIN，查询也略快
user: r.one('User', { from: 'userId', to: 'id' }, { required: true }),`;

const path = `User: (r) => ({
  roles: r.manyToMany('Role', { through: 'UserRole', throughFrom: 'userId', throughTo: 'roleId' }),
  // 经角色到菜单：用法同一对多，同一个菜单经两个角色到达也只算一次
  menus: r.path('Menu', ['roles', 'menus']),
  // 全是多对一：等同于 u.company.city，目标可空
  city: r.pathOne('City', ['company', 'city']),
}),`;

const composite = `Member: (r) => ({
  notes: r.many('Note', { from: ['tenantId', 'id'], to: ['tenantId', 'memberId'] }),
}),
Note: (r) => ({
  member: r.one('Member', { from: ['tenantId', 'memberId'], to: ['tenantId', 'id'] }),
}),`;

const anyCondition = `User: (r) => ({
  // users.book_ids 存的是 '1,3,7'
  books: r.manyOn('Book', (u, b) => b.id.inCsv(u.bookIds)),
}),
Dept: (r) => ({
  // 路径前缀：/1/2/ 的下级都以它开头
  subtree: r.manyOn('Dept', (d, child) => child.path.startsWith(d.path)),
}),`;

const fk = `shelf: r.one('Shelf', { from: 'shelfId', to: 'id' }, {
  foreignKey: { onDelete: 'cascade' }, // 建表时加外键，名字默认 fk_表_列
}),`;

export default _component(() => () => (
  <DocPage>
    <Section id="overview" title="声明">
      <P text="关系写在 `defineSchema` 的第二个参数里，名字和类型都会带到查询上。`r` 只认 schema 里登记过的实体，`from`、`to` 只认对应实体的列，写错编译不过。两个方向是两个导航，只用一边就只声明一边。" />
      <CodeBlock code={overview} lang="ts" title="schema.ts" />
      <SimpleTable
        head={['写法', '关系', '查询时']}
        rows={[
          ['`r.one`', '多对一、一对一', '点下去，隐式 JOIN，见“对一”'],
          ['`r.many`', '一对多', '`any`、`count`、`toList`，见“对多”'],
          ['`r.manyToMany`', '多对多，经中间表', '和一对多一样，见“多对多”'],
          ['`r.path`、`r.pathOne`', '沿已有的导航走', '和对多、对一一样，见“直达关系”'],
          ['`r.manyOn`、`r.oneOn`', '任意条件', '和对多、对一一样'],
        ]}
      />
      <Note text="全站示例的完整关系见“示例模型”。" />
    </Section>
    <Section id="required" title="可空和必有">
      <P text="外键可空的导航，取到的列也可空；默认是 LEFT JOIN。外键一定有值时声明 `required: true`：变成 INNER JOIN，结果类型不可空。" />
      <CodeBlock code={required} lang="ts" />
      <Note text="`required` 是你对数据的保证。对方的行不存在时这一行会从结果里消失，所以只给外键确实必有值的关系。" />
    </Section>
    <Section id="fixed" title="固定条件">
      <P text="关系的第三个参数 `where` 给导航带上固定条件，用的时候不用再写。常用来声明“已发布的帖子”“有效的订单”这类子集。见“对多”里的 `hotPosts`。" />
    </Section>
    <Section id="many-to-many" title="多对多">
      <P text="中间表也是 schema 里的一个实体，常常是复合主键。`throughFrom`、`throughTo` 是中间表上的列；`from`、`to` 是两边被引用的列，省略时用各自的主键。拦截器（租户、逻辑删除）也作用在中间表上。" />
    </Section>
    <Section id="path" title="直达关系">
      <CodeBlock code={path} lang="ts" />
      <Points
        items={[
          '导航名、终点、种类（经过一对多就必须用 `path`）在 `defineSchema` 时核对。',
          '直达关系不能再引用直达关系，也不能写进 `save` 的 `include`。',
        ]}
      />
    </Section>
    <Section id="composite" title="复合外键">
      <P text="`from`、`to` 写成数组，按位置一一对应，个数不一致在定义时报错。JOIN、子查询、`toList` 的第二条查询都按整组列匹配。多对一里任何一个 `from` 列可空，目标就可空。" />
      <CodeBlock code={composite} lang="ts" />
    </Section>
    <Section id="any-condition" title="任意条件的关系">
      <P text="外键不是等值关系时，比如逗号分隔的列、路径前缀，用 `r.manyOn`、`r.oneOn` 写条件，之后还是普通的导航。这种关系不能写进 `save` 的 `include`。" />
      <CodeBlock code={anyCondition} lang="ts" />
    </Section>
    <Section id="foreign-key" title="外键约束">
      <P text="导航只看声明，不看库里有没有外键。需要库里也有约束时声明 `foreignKey`：建完所有表再 ALTER TABLE ADD CONSTRAINT；SQLite 只能写进建表语句。" />
      <CodeBlock code={fk} lang="ts" />
    </Section>
  </DocPage>
));
