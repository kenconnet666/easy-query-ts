/**
 * 演练场：自己改代码，在浏览器里的 PostgreSQL、SQLite 上运行。卡片上的“改一改”把示例带到这里（地址的 #code=）。
 * 代码按 JS 执行：拿到 db、模型里的实体和常用的表达式函数，所以不能写类型标注
 */
import { Play } from '@lucide/icons';
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { css } from '@zerodep-dev/vue-tsx-pro-tsx/styles';
import {
  Alert,
  Button,
  CodeBlock,
  Container,
  Flex,
  Grid,
  H1,
  Paragraph,
  Select,
  Small,
} from '@zerodep-dev/vue-tsx-pro-ui';
import { CodeEditor } from '@zerodep-dev/vue-tsx-pro-ui/code-editor';
import { useRoute } from 'vue-router';
import { dialects, type LiveEngine } from '../site/dialects';
import type { LiveResult } from '../site/live';
import { sqlText } from '../site/sql-text';

const styles = css.create({
  wide: { maxWidth: '100rem' },
  editor: { height: '26rem' },
  page: { gap: '_lg' },
  lead: { maxWidth: '52rem' },
  bar: { flexWrap: 'wrap' },
  select: { width: '11rem' },
  output: { gap: '_md', minWidth: 0 },
});

const STARTER = `await db
  .queryable(Company)
  .where((c) => c.users.any((u) => u.age.ge(30)))
  .select((c) => ({
    name: c.name,
    users: c.users.toList((u) => ({ name: u.name, age: u.age })),
  }))
  .toList();`;

const engines = dialects
  .filter((dialect) => dialect.live)
  .map((dialect) => ({ value: dialect.live as LiveEngine, label: dialect.label }));

/** 表达式体（只有一条 await 语句）补上 return，结果才带得回来 */
function asFunctionBody(code: string): string {
  return /^\s*await\b/.test(code) && !/\breturn\b/.test(code) ? `return ${code}` : code;
}

export default _component(() => {
  const route = useRoute();
  let code = _state(STARTER);
  let engine = _state<LiveEngine>('pglite');
  let running = _state(false);
  let failure = _state<string | undefined>(undefined);
  let live = _state.raw<LiveResult | undefined>(undefined);

  // 卡片带过来的代码在地址的 #code= 里。放在挂载之后读：预渲染的页面没有这段
  _effect(() => {
    const match = /^#code=(.*)$/s.exec(route.hash);
    if (match) code = decodeURIComponent(match[1]!);
  });

  async function run() {
    if (running) return;
    running = true;
    failure = undefined;
    try {
      const { runSource } = await import('../site/live');
      live = await runSource(asFunctionBody(code), engine);
    } catch (error) {
      live = undefined;
      failure = error instanceof Error ? error.message : String(error);
    } finally {
      running = false;
    }
  }

  return () => (
    <Container size="xl" padding="none" sx={styles.wide}>
      <Flex direction="column" sx={styles.page}>
        <H1>演练场</H1>
        <Paragraph tone="muted" sx={styles.lead}>
          代码在你的浏览器里运行，每次都从示例数据重新开始，怎么改都不会弄坏什么。能用的变量：db，模型里的
          Company、User、Post、Comment、Tag、PostTag、Doc，以及
          or、and、not、caseWhen、win、sql、text、greatest、least。这里按 JavaScript
          执行，不能写类型标注。
        </Paragraph>
        <Flex gap="sm" align="center" sx={styles.bar}>
          <Select aria-label="数据库" items={engines} _value={engine} sx={styles.select} />
          <Button icon={Play} loading={running} onClick={() => void run()}>
            运行
          </Button>
          {live && (
            <Small tone="muted">
              用时 {live.ms.toFixed(1)} ms，发出 {live.statements.length} 条语句
            </Small>
          )}
          {running && !live && <Small tone="muted">第一次要下载 WASM，稍等……</Small>}
        </Flex>
        <CodeEditor _value={code} aria-label="代码" sx={styles.editor} />
        {failure && (
          <Alert tone="danger" title="运行失败">
            {failure}
          </Alert>
        )}
        {live && (
          <Grid minItemWidth="28rem" gap="md">
            <CodeBlock code={sqlText(live.statements)} lang="sql" title="实际执行的 SQL" />
            <CodeBlock
              code={live.result ?? '（没有返回值）'}
              lang="json"
              title="结果"
              maxLines={30}
            />
          </Grid>
        )}
      </Flex>
    </Container>
  );
});
