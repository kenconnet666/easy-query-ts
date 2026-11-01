/** JSON 列 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { CodeBlock } from '@zerodep-dev/vue-tsx-pro-ui';
import { DocPage, Note, P, Points, Section, SimpleTable } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import {
  jsonAppend,
  jsonHasIndex,
  jsonOrderBy,
  jsonReadWhole,
  jsonRemoveItem,
  jsonSetItem,
} from './extras.examples.ts';
import { jsonLength, jsonPath, jsonRead, jsonWrite } from './more.examples.ts';

const declare = `const Profile = entity('t_profile', {
  userId: col.bigint().primaryKey(),
  skills: col.json<string[]>(), // 类型写在泛型里，读出来就是 string[]
});

// 也可以交给 zod 这类校验库：读写时校验
const Settings = entity('t_settings', {
  id: col.int().primaryKey(),
  value: col.json(settingsSchema),
});`;

const objects = `const Account = entity('t_account', {
  id: col.bigint().primaryKey().generated(),
  prefs: col.json<{ level: number; nickname?: string; tags: string[] }>(),
});

// 路径按类型检查：写错键、值的类型不对都编译不过
db.queryable(Account).where((a) => a.prefs.jsonNumber('level').ge(2));
db.queryable(Account).where((a) => a.prefs.jsonText('nickname').like('小'));
db.queryable(Account).where((a) => a.prefs.jsonHas('nickname'));

// 一条 UPDATE 改 JSON 的一处，不用读出来改完再整个写回
db.update(Account).set((a) => ({ prefs: a.prefs.jsonSet(['level'], 2) }));
db.update(Account).set((a) => ({ prefs: a.prefs.jsonRemove('nickname') }));
db.update(Account).set((a) => ({ prefs: a.prefs.jsonMerge({ level: 3, tags: [] }) })); // 浅合并
db.update(Account).set((a) => ({ prefs: a.prefs.jsonAppend(['tags'], 'vip') }));`;

const some = `// 数组里有满足条件的元素：同一个元素同时满足所有条件
db.queryable(Order).where((o) =>
  o.payload.jsonSome(['items'], { sku: col.string(), qty: col.int() }, (item) => [
    item.sku.eq('A1'),
    item.qty.gt(2),
  ]),
);`;

const dialect = `// 方言专属的写法从入口取
Pg.jsonb(u.attrs).hasKey('vip');
Pg.jsonb(o.payload).pathExists('$.items[*] ? (@.qty > 2)');
MySQL.json(u.attrs).contains({ vip: true });`;

export default _component(() => () => (
  <DocPage>
    <Section id="declare" title="声明">
      <P text="`col.json<T>()` 按方言建 JSON、JSONB 或文本列，写入时序列化，读出时解析。切换方言看建表语句可以到“列类型”。" />
      <CodeBlock code={declare} lang="ts" />
    </Section>
    <Section id="read" title="读写整列">
      <SqlExample example={jsonRead} title="读出来就是数组" />
      <SqlExample example={jsonReadWhole} title="整行" />
      <SqlExample example={jsonWrite} title="整列写回" />
    </Section>
    <Section id="path" title="取里面的值">
      <P text="路径函数把 JSON 里的值取出来，能放进结果、条件和排序。路径按列的 TS 类型检查：对象写键，数组写下标。" />
      <SimpleTable
        head={['方法', '含义']}
        rows={[
          ['`json(...路径)`', '取路径处的 JSON 值'],
          ['`jsonText(...路径)`', '取成文字，比较、`like` 时用'],
          ['`jsonNumber`、`jsonBoolean`', '取成数字、布尔'],
          ['`jsonHas(...路径)`', '路径存在'],
          ['`jsonLength(...路径)`', '数组长度'],
          ['`jsonSome(路径, 列, 条件)`', '数组里有满足条件的元素'],
          ['`jsonSet`、`jsonRemove`、`jsonMerge`、`jsonAppend`', '只改一部分，写进 `set`'],
        ]}
      />
      <SqlExample example={jsonLength} title="数组长度：条件和结果" />
      <SqlExample example={jsonOrderBy} title="按长度排序" />
      <SqlExample example={jsonPath} title="按下标取值" />
      <SqlExample example={jsonHasIndex} title="路径存在：至少有三个技能" />
      <CodeBlock code={objects} lang="ts" title="对象的路径" />
    </Section>
    <Section id="update" title="只改一部分">
      <P text="一条 UPDATE 里改 JSON 的某一处，并发时不会互相覆盖。切换方言看：PG 是 jsonb_set，MySQL 是 JSON_SET，SQLite 是 json_set。" />
      <SqlExample example={jsonAppend} title="数组末尾加一项" />
      <SqlExample example={jsonSetItem} title="改第一项" />
      <SqlExample example={jsonRemoveItem} title="删第一项" />
    </Section>
    <Section id="some" title="按元素过滤">
      <P text="`jsonSome` 把对象的数组展开成行再过滤，第二个参数声明元素有哪些键，只能写元素上有的键。示例模型的 JSON 列是字符串数组，所以这里没有做成能运行的卡片。" />
      <CodeBlock code={some} lang="ts" title="对象的数组" />
      <Points
        items={[
          'PG 用 `jsonb_to_recordset`，MySQL 用 `JSON_TABLE`，SQLite 用 `json_each`，别的方言渲染时报不支持。',
          '数组不在（NULL、路径不存在）时为假。',
        ]}
      />
    </Section>
    <Section id="dialect" title="方言专属">
      <CodeBlock code={dialect} lang="ts" />
      <Note text="能用普通列就用普通列：JSON 适合结构不固定、不常按它查询的数据。要按它查询时，记得按方言建索引：PG 的 GIN，MySQL 的多值索引，见“实体与列”。Db2 没有 `jsonLength`，渲染时报错，不会悄悄变成别的语义。" />
    </Section>
  </DocPage>
));
