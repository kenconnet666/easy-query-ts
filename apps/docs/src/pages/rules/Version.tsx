/** 乐观锁 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { CodeBlock } from '@zerodep-dev/vue-tsx-pro-ui';
import { DocPage, Note, P, Section, SimpleTable } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import {
  conflict,
  deleteVersion,
  ignoreVersion,
  optimistic,
  staleEntity,
  versionBumps,
  versionChanges,
  versionEntity,
} from './rules.examples.ts';

const declare = `version: col.int().version(), // 整数列每次加 1，插入时是 0

// 别的类型给规则
version: col.string(36).version({ initial: '0', next: () => crypto.randomUUID() }),`;

export default _component(() => () => (
  <DocPage>
    <Section id="declare" title="声明">
      <P text="编辑表单打开时读到版本，保存时带上：被别人改过就改不到行，直接报错，不会悄悄覆盖。" />
      <CodeBlock code={declare} lang="ts" />
      <SimpleTable
        head={['写法', '版本条件', '换版本']}
        rows={[
          ['`set(...).withVersion(v)`', '有', '有'],
          ['`entity(row)`、`changes(before, after)`', '有，版本来自行', '有'],
          ['`set(...)`（表达式、批量）', '没有', '有：别人手里的旧版本随之失效'],
          ['`set(...).ignoreVersion()`', '没有', '没有'],
          ['`delete(X).withVersion(v)`、`entity(row)`', '有', '逻辑删除时有'],
          ['`delete(X).where(...)`（逻辑删除）', '没有', '有：逻辑删除是一次更新'],
        ]}
      />
    </Section>
    <Section id="with-version" title="带版本更新">
      <P text="`withVersion` 带上手里的版本：条件里比较版本，同时写入下一个版本。" />
      <SqlExample example={optimistic} title="带版本更新" />
      <P text="一行都没改到，说明被别人抢先了，直接抛错。" />
      <SqlExample example={conflict} title="版本过期时被拦下" />
    </Section>
    <Section id="entity" title="按实体更新">
      <P text="查出来改完再存时，版本在行里，自动带上。" />
      <SqlExample example={versionEntity} title="entity：版本加了 1" />
      <SqlExample example={versionChanges} title="changes：只写变了的列，同样带版本" />
      <SqlExample example={staleEntity} title="两个人同时编辑，后保存的被拦下" />
    </Section>
    <Section id="other" title="别的更新">
      <P text="没带版本的更新也换版本，所以手里拿着旧版本的人保存时会失败。" />
      <SqlExample example={versionBumps} title="版本照样加一" />
      <P text="管理端的批量修正不想让别人的版本失效时，写 `.ignoreVersion()`：不带条件、不换版本。" />
      <SqlExample example={ignoreVersion} title="版本不变" />
    </Section>
    <Section id="delete" title="删除">
      <SqlExample example={deleteVersion} title="版本不对，删不掉" />
      <Note text="ClickHouse 的 mutation 报不出影响的行数，乐观锁的检查不可用。冲突很多时用行锁，见“锁”。" />
    </Section>
  </DocPage>
));
