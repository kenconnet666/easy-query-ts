# TS：可复用的通用条件（defineScope）

按租户过滤、只看未删除、名字前缀这类条件，在很多实体上都一样。`defineScope` 只声明它依赖的列（结构类型），
任何有这些列的实体都能用：

```ts
const ofTenant = defineScope<{ tenantId: number }, [tenantId: number]>((row, id) =>
  row.tenantId.eq(id),
);
const live = defineScope<{ deletedAt: Date | null }>((row) => row.deletedAt.isNull());

await db.queryable(Order).apply(ofTenant, 7).apply(live).toList();
db.queryable(Company).apply(ofTenant, 7); // 类型错误：Company 没有 tenantId 列
db.queryable(Order).apply(ofTenant, 'x'); // 类型错误：参数要是数字
```

- 声明的列类型要与实体的列一致，可空的列写成 `T | null`。
- 条件拿到的是普通的列表达式，能用的方法与 `where` 里一样；`apply` 等同于加一条 `where`，可以连着用。
- 想让每条查询都自动带上的（租户隔离），仍然用拦截器；scope 用在"有时要、写法到处一样"的条件。

测试见 `test/test/scope.test.ts`。
