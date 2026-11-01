/** 站点导航：侧栏、路由、搜索、翻页、页面标题与简介都用这一份 */
import type { Component } from 'vue';

/** 导航里的一页 */
export interface NavPage {
  readonly path: string;
  readonly title: string;
  /** 一句话简介：页面开头、搜索结果都显示；反引号里的是行内代码 */
  readonly description: string;
  readonly component: () => Promise<{ default: Component }>;
}

/** 侧栏的一组 */
export interface NavSection {
  readonly label: string;
  readonly pages: readonly NavPage[];
}

export const sections: readonly NavSection[] = [
  {
    label: '开始',
    pages: [
      {
        path: '/guide/quick-start',
        title: '快速开始',
        description:
          '两分钟跑起来：写第一条查询，再安装、定义实体。下面的代码可以直接在浏览器里运行。',
        component: () => import('../pages/guide/QuickStart'),
      },
      {
        path: '/guide/model',
        title: '示例模型',
        description:
          '全站示例共用的模型和数据：公司、部门、用户、帖子、评论、标签、关注、订单，关系一览和全部数据。',
        component: () => import('../pages/guide/Model'),
      },
      {
        path: '/guide/playground',
        title: '演练场',
        description:
          '自己改代码，在浏览器里的 PostgreSQL、SQLite 上运行。卡片右上角的“改一改”把示例带到这里。',
        component: () => import('../pages/Playground'),
      },
      {
        path: '/guide/practice',
        title: '完整例子：社区首页',
        description: '用一个真实页面串起来：列表、详情、发帖、榜单，每条查询都能运行。',
        component: () => import('../pages/guide/Practice'),
      },
      {
        path: '/guide/config',
        title: '创建 Db 与配置',
        description: '`createDb` 的选项、派生的 Db、请求上下文，以及各个包的入口。',
        component: () => import('../pages/guide/Config'),
      },
      {
        path: '/guide/testing',
        title: '测试',
        description: 'SQLite 内存库、PGlite、断言 SQL、SQL 快照和类型测试，不用 mock Db。',
        component: () => import('../pages/guide/Testing'),
      },
      {
        path: '/guide/terms',
        title: '术语',
        description: '隐式 join、对象树、聚合根、方言……文档里的词都是什么意思。',
        component: () => import('../pages/guide/Terms'),
      },
      {
        path: '/guide/best-practices',
        title: '最佳实践与常见问题',
        description: '实体怎么设计、什么时候用什么写法，以及大家常问的问题。',
        component: () => import('../pages/guide/BestPractices'),
      },
      {
        path: '/guide/java',
        title: '与 Java 版的对应',
        description: '从 easy-query（Java）过来：注解、方法分别对应这里的什么写法，在哪一章。',
        component: () => import('../pages/guide/Java'),
      },
    ],
  },
  {
    label: '模型',
    pages: [
      {
        path: '/model/entity',
        title: '实体与列',
        description: '声明表和列：修饰器、索引、外键、值对象、品牌类型，以及从实体取类型。',
        component: () => import('../pages/model/Entity'),
      },
      {
        path: '/model/types',
        title: '列类型',
        description: '内置类型和它们在各库的映射；金额、日期、枚举、JSON、UUID，以及自定义类型。',
        component: () => import('../pages/model/ColumnTypes'),
      },
      {
        path: '/model/union',
        title: '多态实体',
        description: '几种子类型共用一张表：`entity.union`，结果类型按判别列收窄。',
        component: () => import('../pages/model/Union'),
      },
    ],
  },
  {
    label: '查询',
    pages: [
      {
        path: '/query/basics',
        title: '条件、排序与分页',
        description:
          '`where` 里写条件，数组就是 AND；没填的条件自动跳过；`toPage` 一次拿到总数和这一页。',
        component: () => import('../pages/query/Basics'),
      },
      {
        path: '/query/join',
        title: '显式 join 与表别名',
        description:
          '`innerJoin`、`leftJoin`、`rightJoin`、`crossJoin`：自连接、join 子查询，以及别名怎么来的。',
        component: () => import('../pages/query/Join'),
      },
      {
        path: '/query/advanced',
        title: '分组、窗口与子查询',
        description: '聚合、HAVING、CASE、窗口函数、子查询、联合，以及在哪里插原生 SQL。',
        component: () => import('../pages/query/Advanced'),
      },
      {
        path: '/query/table',
        title: '列表页查询',
        description:
          '表格的筛选、排序、分页一次接好：`filterBy`、`sortBy`、`table`，只认登记过的列。',
        component: () => import('../pages/query/Table'),
      },
      {
        path: '/query/json',
        title: 'JSON 列',
        description: '读写整列、按路径取值和筛选，路径按列的类型检查。',
        component: () => import('../pages/query/Json'),
      },
      {
        path: '/query/computed',
        title: '计算属性',
        description: '拼接、状态、跨表聚合，声明一次，之后像一列那样用。',
        component: () => import('../pages/query/Computed'),
      },
      {
        path: '/query/reuse',
        title: '复用查询',
        description: '查询对象不可变、通用条件、预编译。',
        component: () => import('../pages/query/Reuse'),
      },
      {
        path: '/func',
        title: '函数',
        description: '字符串、日期、数学、JSON：写在列上，按方言渲染，类型跟着列走。',
        component: () => import('../pages/func/Functions'),
      },
      {
        path: '/query/raw',
        title: '原生 SQL',
        description: '`sql` 片段、`db.sql` 整条语句、`toSQL` 看语句、`explain`、优化器提示。',
        component: () => import('../pages/query/Raw'),
      },
    ],
  },
  {
    label: '导航',
    pages: [
      {
        path: '/navigate/relations',
        title: '隐式 join 与子查询',
        description: '声明一次关系，之后查询里直接点。对一是 join，对多是子查询。',
        component: () => import('../pages/navigate/Navigate'),
      },
      {
        path: '/navigate/tree',
        title: '对象树与视图',
        description: '`select` 里写 `toList` 得到嵌套结果，一层一条查询，没有 N+1。',
        component: () => import('../pages/navigate/Tree'),
      },
    ],
  },
  {
    label: '写入',
    pages: [
      {
        path: '/write/basics',
        title: '增删改',
        description: '插入、upsert、表达式更新、经导航的条件，以及断言改到的行数。',
        component: () => import('../pages/write/Write'),
      },
      {
        path: '/write/save',
        title: '聚合保存',
        description:
          '`db.save` 保存一棵对象树：各种关系怎么存、移除的子项怎么办、没有主键时怎么认。',
        component: () => import('../pages/write/Save'),
      },
      {
        path: '/write/transaction',
        title: '事务与锁',
        description: '回调式与手动事务、保存点、提交后的动作、行锁、咨询锁。',
        component: () => import('../pages/write/Transaction'),
      },
      {
        path: '/write/validate',
        title: '校验',
        description: '由实体生成校验器：必填、长度、枚举都来自列的声明，不用再写一遍。',
        component: () => import('../pages/write/Validate'),
      },
      {
        path: '/write/rules',
        title: '列规则与拦截器',
        description: '逻辑删除、乐观锁、多租户、审计：声明一次，所有读写都生效。',
        component: () => import('../pages/write/Rules'),
      },
    ],
  },
  {
    label: '运维',
    pages: [
      {
        path: '/schema/ddl',
        title: '建表与迁移',
        description: '由实体建表，同步与迁移，由库生成实体，SQL 快照。',
        component: () => import('../pages/schema/Ddl'),
      },
      {
        path: '/scale/cache',
        title: '二级缓存',
        description: '本机缓存与 Redis 缓存，三种部署；Redis 与消息通知由你按接口接入。',
        component: () => import('../pages/scale/Cache'),
      },
      {
        path: '/scale/sharding',
        title: '分库分表',
        description: '实体声明分片规则，查询按条件裁剪，写入按行路由。',
        component: () => import('../pages/scale/Sharding'),
      },
      {
        path: '/scale/runtime',
        title: '读写分离与可观测',
        description: '读写分离、只读 Db、超时与取消、链路追踪、N+1 与慢查询。',
        component: () => import('../pages/scale/Runtime'),
      },
      {
        path: '/scale/performance',
        title: '性能',
        description: '先看 SQL，再按症状选写法：N+1、子表统计、流式读取、批量写入和护栏。',
        component: () => import('../pages/scale/Performance'),
      },
      {
        path: '/scale/tables',
        title: '动态表名与模块',
        description: '换表、换 schema、跨库链接；大项目按模块组合 schema，运行时再挂载。',
        component: () => import('../pages/scale/Tables'),
      },
      {
        path: '/scale/databases',
        title: '支持的数据库',
        description: '十几种数据库的方言包和驱动，一套代码部署到不同版本。',
        component: () => import('../pages/scale/Databases'),
      },
      {
        path: '/scale/dialects',
        title: '方言差异',
        description: '能力写进类型、按版本渲染、各库的连接方式和要注意的地方。',
        component: () => import('../pages/scale/Dialects'),
      },
    ],
  },
];

export const allPages: readonly NavPage[] = sections.flatMap((section) => section.pages);

/** 一页所在的组 */
export const sectionOf = (page: NavPage): string =>
  sections.find((section) => section.pages.includes(page))?.label ?? '';
