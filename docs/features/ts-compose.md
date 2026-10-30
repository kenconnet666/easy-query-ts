# TS：schema 组合（mergeSchemas、db.mount）

大项目按模块各写一份 `defineSchema`，模块之间互不 import；在应用入口合成一份，或在运行时给已有的 Db 再挂一组（插件、按需加载）。

```ts
// accounts/schema.ts：账号模块，不知道内容模块
export const accounts = defineSchema({ Company, User, Role, UserRole }, { User: (r) => ({ company: … }) });
// content/schema.ts：内容模块
export const content = defineSchema({ Post, Comment }, { Post: (r) => ({ comments: … }) });

// app/db.ts：合成一份；跨模块的关系写在第二个参数里，构造器能看到所有模块的实体
export const schema = mergeSchemas([accounts, content], {
  Post: (r) => ({ author: r.one('User', { from: 'userId', to: 'id' }) }),
  User: (r) => ({
    posts: r.many('Post', { from: 'id', to: 'userId' }),
    comments: r.path('Comment', ['posts', 'comments']), // 直达关系可以经过别的模块的导航
  }),
});
export const db = createDb({ schema, adapter });

// 运行时再挂一组：共用连接、拦截器、取消信号与事务
const all = db.mount(content, { Post: (r) => ({ author: r.one('User', { from: 'userId', to: 'id' }) }) });
await db.transaction(async (tx) => {
  await tx.mount(content).insert(Post).values(row).execute(); // 与 tx 在同一个事务里
});
```

## 类型

- 合并后的实体、各模块自己的导航、跨模块的导航全部推出，查询里 `u.posts.any(…)`、`p.author.company.name` 照常补全。
- 实体键在几组里重名：调用处报错，错误里写出重名的键（`'error: these entity keys appear in more than one schema': "Company"`）。
- 跨模块的导航与已有的导航或列重名：调用处报错（`'error: these navigations already exist': "User.name"`）。
- 跨模块的关系要写在调用处（内联），构造器 `r` 才有上下文类型；`mergeSchemas`、`mount` 的写法一样。

## 运行时

同样的检查在运行时也有（例如从 JS 调用）：实体键重名、同一个实体对象登记成两个键、导航重名、列名写错、直达关系走不通，都在合并时报出。
`defineSchema` 与 `mergeSchemas` 共用同一段关系解析，行为一致。

Java 版 easy-query 没有对应的能力（实体靠类路径扫描，没有模块边界）。
