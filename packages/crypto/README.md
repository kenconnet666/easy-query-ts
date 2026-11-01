# @zerodep-dev/easy-query-ts-crypto

列加密的现成策略：`aesEncryption()`（AES-128 / 192 / 256，CBC）、`sm4Encryption()`（国密 SM4，CBC），密文是 Base64，配合核心的 `col.string().encrypted(…)` 用。

```ts
import { aesEncryption } from '@zerodep-dev/easy-query-ts-crypto';

const phone = aesEncryption({
  key: process.env.PHONE_KEY!,
  iv: process.env.PHONE_IV!,
  searchable: true,
});
const User = entity('t_user', {
  id: col.bigint().primaryKey(),
  phone: col.string().encrypted(phone),
});

await db
  .queryable(User)
  .where((u) => u.phone.like('8888'))
  .toList(); // 搜索词加密后匹配密文
```

`searchable: true` 时按 Java 版的可分段写法加密（从每个字符起取满 4 个单位，中文与 emoji 算 2 个，逐段加密再拼起来），
至少 4 个单位的搜索词能用 `like` / `startsWith` / `endsWith`。分段与编码与 Java 版一致，同样的密钥能读 Java 版写的数据。

只在 Node（`node:crypto`）里用；需要同时安装核心包 `@zerodep-dev/easy-query-ts`。许可证：Apache-2.0。
