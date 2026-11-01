/** 加密列：应用里加解密与库里转换 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { CodeBlock } from '@zerodep-dev/vue-tsx-pro-ui';
import { DocPage, Note, P, Points, Section, SimpleTable } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import { encryptedRaw, encryptedRead, encryptedWhere, encryptedWrite } from './rules.examples.ts';

const declare = `const Ticket = entity('t_ticket', {
  id: col.bigint().primaryKey().generated(),
  contact: col.string(100).encrypted({
    encrypt: (plain) => aes.encrypt(plain),   // 写入前
    decrypt: (cipher) => aes.decrypt(cipher), // 读出后
  }),
});`;

const ready = `import { aesEncryption, sm4Encryption } from '@zerodep-dev/easy-query-ts-crypto';

const phone = aesEncryption({ key: process.env.PHONE_KEY!, iv: process.env.PHONE_IV! }); // AES-128、192、256，按密钥长度
const idCard = sm4Encryption({ key: process.env.SM4_KEY!, iv: process.env.SM4_IV! });    // 国密 SM4

const User = entity('t_user', {
  id: col.bigint().primaryKey().generated(),
  phone: col.string(100).encrypted(phone),
  idCard: col.string(100).encrypted(idCard),
});`;

const searchable = `// 可分段搜索：从每个字符起取满 4 个单位（中文、emoji 算 2 个），逐段加密再拼起来
const phone = aesEncryption({ key, iv, searchable: true });

phone: col.string(600).encrypted(phone),

// 至少 4 个单位的搜索词能用 like、startsWith、endsWith：搜索词加密后匹配密文
await db.queryable(User).where((u) => u.phone.like('8888')).toList();`;

const convert = `// 在库里加解密：like、排序、函数都能用，密钥要进 SQL
phone: col.string(100).sqlConvert({
  read: (column) => sql<string>\`AES_DECRYPT(\${column}, \${key})\`,
  write: (value) => sql<string>\`AES_ENCRYPT(\${value}, \${key})\`,
}),`;

export default _component(() => () => (
  <DocPage>
    <Section id="encrypted" title="在应用里加解密">
      <P text="`encrypted` 写入前加密、读出后解密，代码里看到的都是明文，库里存的是密文。只用于字符串列。" />
      <CodeBlock code={declare} lang="ts" />
      <SqlExample example={encryptedRead} title="读：明文" />
      <P text="绕过实体直接查，就能看到库里存的样子。示例用的是一个把文字倒过来的假加密。" />
      <SqlExample example={encryptedRaw} title="库里存的是密文" />
      <P text="看 SQL 一栏的参数：写进去的已经是密文。" />
      <SqlExample example={encryptedWrite} title="写：参数是密文" />
    </Section>
    <Section id="crypto" title="现成的策略">
      <P text="`-crypto` 包给出 AES-CBC、SM4-CBC 的实现，密文是 Base64，分段与编码和 Java 版一致，同样的密钥能读 Java 版写的数据。只在 Node 里用（`node:crypto`）；核心只定义接口，不依赖它。" />
      <CodeBlock code={ready} lang="ts" />
    </Section>
    <Section id="where" title="按它查询">
      <P text="`eq` 会把参数加密后比较，所以加密策略必须是确定性的：同一段明文每次的密文相同。随机 IV 的加密不能用在 `eq` 条件里。" />
      <SqlExample example={encryptedWhere} title="按手机号查：参数加密后比较" />
      <P text="`like` 只在策略声明 `searchable`（可分段加密）时可用，否则报错。代价是密文变长（每个字符 24 个字符），固定 IV 也会暴露相同的片段。" />
      <CodeBlock code={searchable} lang="ts" />
    </Section>
    <Section id="sql-convert" title="在库里转换">
      <P text="`sqlConvert` 的 `read` 包住读这一列的每个地方，`write` 包住写进去的值，转换后的值仍按列的类型解码。" />
      <CodeBlock code={convert} lang="ts" />
      <SimpleTable
        head={['', '`encrypted`', '`sqlConvert`']}
        rows={[
          ['在哪里算', '应用', '数据库'],
          ['密钥', '不进 SQL', '进 SQL（作为参数）'],
          ['按它查询', '只能等值，或可分段的 like', '`like`、排序、函数都能用'],
          ['索引', '等值能用', '通常用不上'],
          ['RETURNING', '解密后返回', '`returning()` 报错，`returnEntity()` 改为插入后查回'],
        ]}
      />
      <Points
        items={['`encrypt`、`decrypt` 是同步函数。', '`db.sql` 不经过列的编解码，读到的是密文。']}
      />
      <Note text="改加密策略不会自动迁移旧数据：写一条迁移，逐行解密再加密。" />
    </Section>
  </DocPage>
));
