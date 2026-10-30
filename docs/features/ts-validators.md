# TS：由实体生成校验器（Standard Schema）

列上已经写了类型、可空、默认值、长度、小数位、枚举、JSON 结构，表单和接口的校验不用再写一遍：

```ts
const v = validators(User);
v.insert['~standard'].validate(input); // { value } 或 { issues: [{ message: 'required', path: ['name'] }] }
v.update; // 都可省，给了的要合法
v.row; // 每一列都要有
```

三个校验器都实现了 [Standard Schema](https://standardschema.dev) 的 `~standard`：组件库的表单、框架的 action、tRPC、react-hook-form 的
standard-schema 解析器等接收 zod / valibot / arktype 的地方都能直接用。反方向也通：`col.json(zodSchema)` 读写 JSON 列时用外部校验器。

## 规则

| 规则                      | 来自                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 必填                      | 插入时不可空、不是自增、没有默认值（库里的 `defaulted()`、客户端的 `$default`、逻辑删除、版本列）的列；与 `Insert<E>` 类型一致 |
| 可空                      | `nullable()`；值对象整个给 null 要求它的列都可空                                                                               |
| 类型                      | 字符串、整数、64 位整数（数字 / bigint / 数字文字）、小数文字、浮点、布尔、`YYYY-MM-DD`、`HH:MM:SS`、`Date`、`Uint8Array`      |
| 长度、位数                | `col.string(50)` 按字符数；`col.decimal(12, 2)` 的整数位与小数位                                                               |
| 枚举、JSON 结构、扩展类型 | 交给列的编码检查，错误信息原样带出                                                                                             |
| 多余字段                  | 实体里没有的键                                                                                                                 |

校验只检查不转换：通过时 `value` 就是输入。值对象（`embed`）的问题按嵌套路径报（`address.city`）。测试见 `test/test/validators.test.ts`。
