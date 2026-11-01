# TS：预编译查询（db.prepare）

热点接口每次都拼一遍查询链、渲染一遍 SQL。`db.prepare` 只渲染一次，之后每次只换参数：

```ts
const byAge = db.prepare((p: { min: number; prefix: string }) =>
  db
    .queryable(User)
    .where((u) => [u.age.ge(p.min), u.name.startsWith(p.prefix)])
    .select((u) => ({ name: u.name })),
);

byAge.sql; // 渲染好的 SQL
await byAge.toList({ min: 18, prefix: 'a' }); // { name: string }[]
await byAge.first({ min: 0, prefix: 'c' });
byAge.toList({ min: 'x', prefix: 'a' }); // 类型错误
```

- 在回调参数上标出 `p` 的类型；`p` 的每个属性是同名的占位值，结果类型与原查询一样。
- 参数照常经过列的编码（日期、JSON、加密列）；`like` / `startsWith` / `endsWith` 的转义与 `%` 在执行时加上。
- 占位值只能当标量用：不能参与构建时的判断（`p.x ? … : …`）、不能展开成 `in` 列表。
- 带 `toList()` 导航或 fill 的查询要再查一次，不能预编译，`prepare` 时直接报错。
- 缺参数在执行时报错：`prepared query: no value for 'x'`。

测试见 `test/test/prepare.test.ts`。
