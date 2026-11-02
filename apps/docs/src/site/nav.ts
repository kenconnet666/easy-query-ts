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
          '自己改代码，在浏览器里的 PostgreSQL、SQLite 上运行，看表里的数据怎么变，也能直接改。卡片右上角的“改一改”把示例带到这里。',
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
        description: '声明表和列：修饰器、索引、外键、品牌类型，以及从实体取类型。',
        component: () => import('../pages/model/Entity'),
      },
      {
        path: '/model/types',
        title: '列类型',
        description: '内置类型和它们在各库的映射；金额、日期、枚举、JSON、UUID，以及自定义类型。',
        component: () => import('../pages/model/ColumnTypes'),
      },
      {
        path: '/model/relations',
        title: '关系',
        description: '对一、对多、多对多、直达、复合外键、任意条件：关系怎么声明。',
        component: () => import('../pages/model/Relations'),
      },
      {
        path: '/model/embed',
        title: '值对象',
        description: '地址、金额这样总是一起出现的几列：代码里是嵌套对象，库里是平铺的列。',
        component: () => import('../pages/model/Embed'),
      },
      {
        path: '/model/computed',
        title: '计算属性',
        description: '拼接、状态、跨表聚合，声明一次，之后像一列那样用。',
        component: () => import('../pages/model/Computed'),
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
        title: '基础查询',
        description: '取一行、取多行、选列、去重、数一数。`select` 什么形状，结果就是什么形状。',
        component: () => import('../pages/query/Basics'),
      },
      {
        path: '/query/where',
        title: '条件',
        description: '比较方式、模糊匹配、或者和取反、空值；没填的条件自动跳过。',
        component: () => import('../pages/query/Where'),
      },
      {
        path: '/query/page',
        title: '排序与分页',
        description: '`orderBy`、`limit`、`toPage`，按导航和表达式排序，游标翻页。',
        component: () => import('../pages/query/Page'),
      },
      {
        path: '/query/join',
        title: '显式 join 与表别名',
        description:
          '`innerJoin`、`leftJoin`、`rightJoin`、`crossJoin`：自连接、join 子查询，以及别名怎么来的。',
        component: () => import('../pages/query/Join'),
      },
      {
        path: '/query/group',
        title: '分组与聚合',
        description: '`groupBy`、`having`、各种聚合、字符串聚合、小计与总计。',
        component: () => import('../pages/query/Group'),
      },
      {
        path: '/query/window',
        title: '窗口函数',
        description: '排名、累计、占比、移动平均、前后行，每组取前几名。',
        component: () => import('../pages/query/Window'),
      },
      {
        path: '/query/subquery',
        title: '子查询与联合',
        description: '`in`、标量子查询、`asTable` 派生表、`union`、`unionAll`。',
        component: () => import('../pages/query/Subquery'),
      },
      {
        path: '/query/cte',
        title: 'CTE 与递归',
        description: '`db.with`、`withRecursive`：先算好一张表再查，一层层往下或往上走。',
        component: () => import('../pages/query/Cte'),
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
        description: '读写整列、按路径取值和筛选、只改一部分，路径按列的类型检查。',
        component: () => import('../pages/query/Json'),
      },
      {
        path: '/query/reuse',
        title: '复用查询',
        description: '查询对象不可变、封装成函数、通用条件、预编译。',
        component: () => import('../pages/query/Reuse'),
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
    label: '函数',
    pages: [
      {
        path: '/func',
        title: '函数总览',
        description: '写在列上，按方言渲染，类型跟着列走。全部函数一览。',
        component: () => import('../pages/func/Functions'),
      },
      {
        path: '/func/string',
        title: '字符串函数',
        description: '大小写、拼接、截取、查找、替换、补齐。',
        component: () => import('../pages/func/Strings'),
      },
      {
        path: '/func/date',
        title: '日期与时间函数',
        description: '取年月日、格式化、加减、相差、截断。',
        component: () => import('../pages/func/Dates'),
      },
      {
        path: '/func/number',
        title: '数字函数',
        description: '四则运算、取整、数学函数、取大取小。',
        component: () => import('../pages/func/Numbers'),
      },
      {
        path: '/func/conditional',
        title: '空值与条件',
        description: '`orElse`、`nullIf`、`caseWhen`、`compare`、`cast`。',
        component: () => import('../pages/func/Conditional'),
      },
      {
        path: '/func/dialect',
        title: '方言专属函数',
        description:
          '`Pg`、`MySQL`、`MsSql`、`Hana` 四个入口的完整列表，别的库怎么办，自己怎么加。',
        component: () => import('../pages/func/Dialect'),
      },
    ],
  },
  {
    label: '导航',
    pages: [
      {
        path: '/navigate/to-one',
        title: '对一：隐式 join',
        description: '声明过的关系直接点下去：条件、排序、分组、结果里都能用，用到才 join。',
        component: () => import('../pages/navigate/ToOne'),
      },
      {
        path: '/navigate/to-many',
        title: '对多：隐式子查询',
        description:
          '`any`、`count`、`sum`、`at`，生成 EXISTS 和相关子查询；聚合多时用 `groupJoin`。',
        component: () => import('../pages/navigate/ToMany'),
      },
      {
        path: '/navigate/many-to-many',
        title: '多对多',
        description: '和一对多一样用，中间表由框架 join。',
        component: () => import('../pages/navigate/ManyToMany'),
      },
      {
        path: '/navigate/path',
        title: '直达关系',
        description: '`r.path` 跨过中间几层，当一个导航用，自动去重。',
        component: () => import('../pages/navigate/Path'),
      },
      {
        path: '/navigate/tree',
        title: '对象树',
        description: '`select` 里写 `toList` 得到嵌套结果，一层一条查询，没有 N+1。',
        component: () => import('../pages/navigate/Tree'),
      },
      {
        path: '/navigate/view',
        title: '视图',
        description: '`defineView` 把形状存下来复用，能嵌套，类型就是 DTO。',
        component: () => import('../pages/navigate/View'),
      },
      {
        path: '/navigate/tree-data',
        title: '树形数据',
        description: '自己指向自己的表：全部下级、全部上级，拼成树。',
        component: () => import('../pages/navigate/TreeData'),
      },
      {
        path: '/navigate/fill',
        title: '按键填充',
        description: '`fillMany`、`fillOne`：不声明关系也能拼，还能跨库。',
        component: () => import('../pages/navigate/Fill'),
      },
    ],
  },
  {
    label: '写入',
    pages: [
      {
        path: '/write/insert',
        title: '插入',
        description: '一行、多行、拿回主键和整行、从查询插入。',
        component: () => import('../pages/write/Insert'),
      },
      {
        path: '/write/upsert',
        title: '存在就更新',
        description: '`onConflict`、`merge`、`ignore`，带条件的覆盖，各库写法差别很大。',
        component: () => import('../pages/write/Upsert'),
      },
      {
        path: '/write/update',
        title: '更新',
        description: '改列、表达式更新、经导航的条件、断言行数、按实体更新、批量。',
        component: () => import('../pages/write/Update'),
      },
      {
        path: '/write/delete',
        title: '删除',
        description: '按条件删、防误删、按实体删、分批删、删一棵树。',
        component: () => import('../pages/write/Delete'),
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
        title: '事务',
        description: '回调式与手动事务、保存点、隔离级别、提交后的动作。',
        component: () => import('../pages/write/Transaction'),
      },
      {
        path: '/write/lock',
        title: '锁',
        description: '锁一行、查询加锁、抢任务、咨询锁与通知。',
        component: () => import('../pages/write/Lock'),
      },
      {
        path: '/write/validate',
        title: '校验',
        description: '由实体生成校验器：必填、长度、枚举都来自列的声明，不用再写一遍。',
        component: () => import('../pages/write/Validate'),
      },
    ],
  },
  {
    label: '列规则',
    pages: [
      {
        path: '/rules/soft-delete',
        title: '逻辑删除',
        description: '删除变成更新，读、改、删自动过滤，导航和子查询也带。',
        component: () => import('../pages/rules/SoftDelete'),
      },
      {
        path: '/rules/version',
        title: '乐观锁',
        description: '带版本条件更新，被别人改过就报错，不会悄悄覆盖。',
        component: () => import('../pages/rules/Version'),
      },
      {
        path: '/rules/autofill',
        title: '自动填充',
        description: '`$default`、`$onUpdate`、`insertOnly`、`touch`：时间和操作人不用手写。',
        component: () => import('../pages/rules/AutoFill'),
      },
      {
        path: '/rules/encrypt',
        title: '加密列',
        description: '应用里加解密的 `encrypted`，库里转换的 `sqlConvert`。',
        component: () => import('../pages/rules/Encrypt'),
      },
      {
        path: '/rules/tenant',
        title: '多租户',
        description: '查询、更新、删除自动带上当前租户，新增自动补上。',
        component: () => import('../pages/rules/Tenant'),
      },
      {
        path: '/rules/interceptor',
        title: '拦截器',
        description: '加条件、补值、写入后审计：自己写一个，语句上开关。',
        component: () => import('../pages/rules/Interceptor'),
      },
    ],
  },
  {
    label: '运维',
    pages: [
      {
        path: '/schema/ddl',
        title: '建表与同步',
        description: '由实体建表，索引、生成列，同步只增不删。',
        component: () => import('../pages/schema/Ddl'),
      },
      {
        path: '/schema/migrate',
        title: '迁移',
        description: '生成、评审、执行迁移，数据迁移，由库生成实体。',
        component: () => import('../pages/schema/Migrate'),
      },
      {
        path: '/scale/cache',
        title: '二级缓存',
        description: '本机缓存与 Redis 缓存，三种部署；Redis 与消息通知由你按接口接入。',
        component: () => import('../pages/scale/Cache'),
      },
      {
        path: '/scale/sharding',
        title: '分表',
        description: '实体声明分片规则，查询按条件裁剪，写入按行路由。',
        component: () => import('../pages/scale/Sharding'),
      },
      {
        path: '/scale/shard-db',
        title: '分库',
        description: '`shardDatabases` 按键路由，跨库归并排序、分页、聚合。',
        component: () => import('../pages/scale/ShardDb'),
      },
      {
        path: '/scale/replicas',
        title: '读写分离与只读',
        description: '从库轮询、强制走主库，`readonly` 在类型上去掉写入。',
        component: () => import('../pages/scale/Replicas'),
      },
      {
        path: '/scale/cancel',
        title: '超时与取消',
        description: '`withTimeout`、`withSignal`，PostgreSQL、MySQL 还会在服务端终止语句。',
        component: () => import('../pages/scale/Cancel'),
      },
      {
        path: '/scale/observe',
        title: '日志与可观测',
        description: '`log`、`onExecute`、OpenTelemetry、抓 N+1 和慢查询、执行计划。',
        component: () => import('../pages/scale/Observe'),
      },
      {
        path: '/scale/performance',
        title: '性能',
        description: '先看 SQL，再按症状选写法：N+1、子表统计、流式读取、批量写入和护栏。',
        component: () => import('../pages/scale/Performance'),
      },
      {
        path: '/scale/tables',
        title: '动态表名',
        description: '换表、换 schema、跨库链接，schema 里没有的表。',
        component: () => import('../pages/scale/Tables'),
      },
      {
        path: '/scale/modules',
        title: '模块组合',
        description: '大项目按模块写 schema，合成一份，运行时再挂载。',
        component: () => import('../pages/scale/Modules'),
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
