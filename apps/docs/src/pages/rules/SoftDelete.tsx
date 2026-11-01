/** 逻辑删除 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { CodeBlock } from '@zerodep-dev/vue-tsx-pro-ui';
import { DocPage, Note, P, Points, Section } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import {
  hardDelete,
  seeDeleted,
  softDelete,
  softInNavigation,
  softRead,
  softRestore,
  softThenRead,
  softUpdateSkips,
} from './rules.examples.ts';

const declare = `const Doc = entity('t_doc', {
  id: col.bigint().primaryKey().generated(),
  title: col.string(100),
  deleted: col.boolean().softDelete(), // 布尔列：false 是没删除，true 是已删除
});

// 整数列默认 0、1；别的类型显式给
deletedAt: col.datetime().nullable().softDelete({ active: null, deleted: () => new Date() }),

// 删除人、删除时间：逻辑删除时一并写入，物理删除不写
deletedBy: col.string(50).nullable().$onDelete(() => currentUser()),`;

export default _component(() => () => (
  <DocPage>
    <Section id="declare" title="声明">
      <P text="列上加 `softDelete()`，其余的代码不用改。下面的例子都用模型里的文档表。每个实体只支持一个逻辑删除列。" />
      <CodeBlock code={declare} lang="ts" />
    </Section>
    <Section id="read" title="读">
      <P text="查询自动带上“没删除”的条件。" />
      <SqlExample example={softRead} title="读：自动过滤" />
      <P text="导航、子查询、`toList` 的第二条查询、多对多的中间表都带，不会漏。条件放在导航自己的 ON 或子查询里，不会把主表的行过滤掉。" />
      <SqlExample example={softInNavigation} title="导航上也过滤；单个导航可以关" />
    </Section>
    <Section id="write" title="删和改">
      <P text="`delete` 变成 UPDATE，条件不变。" />
      <SqlExample example={softDelete} title="删：变成 UPDATE" />
      <SqlExample example={softThenRead} title="删完再读，少了一行" />
      <P text="更新也只动没删除的行。" />
      <SqlExample example={softUpdateSkips} title="已删除的行改不到" />
    </Section>
    <Section id="see" title="看已删除的、恢复、真删">
      <P text="逻辑删除是内置的拦截器，名字叫 `softDelete`，单条语句可以关。" />
      <SqlExample example={seeDeleted} title="看到已删除的行" />
      <SqlExample example={softRestore} title="恢复：更新时也要先关掉过滤" />
      <P text="真的要从库里删掉用 `hard()`，已被逻辑删除的行也会删掉。" />
      <SqlExample example={hardDelete} title="物理删除" />
      <Points
        items={[
          '`db.withInterceptors({ skip: ["softDelete"] })` 关掉一段。',
          '`createDb({ hardDelete: "forbid" })`：没有逻辑删除列的实体 delete 要显式 `.hard()` 才执行，防止误删。',
        ]}
      />
      <Note text="唯一约束不认逻辑删除：已删除的行还占着值。常见做法是把删除标记放进唯一索引，或者用部分索引 `where: 'deleted = false'`。" />
    </Section>
  </DocPage>
));
