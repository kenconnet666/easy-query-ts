/**
 * 代码卡片：一行三栏，TS、它发出的 SQL、结果同时看得到（窄屏时上下排）。方言切一处全站跟着变；
 * PostgreSQL、SQLite 有 WASM 版本，点“运行”在浏览器里真实执行，其余方言只显示构建时渲染的 SQL。
 *
 *   <SqlExample example={filter} title="条件" />
 */
import { PencilLine, Play } from '@lucide/icons';
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { css } from '@zerodep-dev/vue-tsx-pro-tsx/styles';
import {
  Alert,
  Button,
  CodeBlock,
  LinkButton,
  Select,
  Small,
  Text,
} from '@zerodep-dev/vue-tsx-pro-ui';
import { currentDialect, dialectInfo, dialects } from './dialects';
import type { Example } from './example';
import type { LiveResult } from './live';
import { sqlText } from './sql-text';

/** 卡片至少这么宽才放得下三栏 */
const WIDE = '@container (min-width: 60rem)';

const styles = css.create({
  card: {
    // 三栏按卡片自己的宽度决定并排还是上下排，不看窗口：侧栏、目录占掉多少都对
    containerType: 'inline-size',
    borderWidth: '_xs',
    borderStyle: 'solid',
    borderColor: '_borderMuted',
    borderRadius: '_lg',
    backgroundColor: '_surface',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '_sm',
    paddingBlock: '_sm',
    paddingInline: '_lg',
    borderBottomWidth: '_xs',
    borderBottomStyle: 'solid',
    borderBottomColor: '_borderMuted',
    backgroundColor: '_surfaceMuted',
  },
  title: { flexGrow: 1, minWidth: 0 },
  select: { width: '9.5rem' },
  panes: {
    display: 'grid',
    gridTemplateColumns: {
      default: 'minmax(0, 1fr)',
      // 结果多半是短行的 JSON，比两栏代码窄一点
      [WIDE]: 'minmax(0, 1.15fr) minmax(0, 1.15fr) minmax(0, 0.9fr)',
    },
  },
  pane: { display: 'flex', flexDirection: 'column', minWidth: 0 },
  // 栏与栏之间一条线：并排时在左边，上下排时在上面
  divided: {
    borderInlineStartWidth: { default: 0, [WIDE]: '_xs' },
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: '_borderMuted',
    borderBlockStartWidth: { default: '_xs', [WIDE]: 0 },
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: '_borderMuted',
  },
  // 三栏共用卡片的外框，代码块自己不再画框；撑满这一栏，标题栏对齐
  code: { flexGrow: 1, borderWidth: 0, borderRadius: 0, backgroundColor: 'transparent' },
  empty: { padding: '_lg' },
  error: { margin: '_md' },
  footer: {
    display: 'block',
    paddingBlock: '_xs',
    paddingInline: '_lg',
    borderTopWidth: '_xs',
    borderTopStyle: 'solid',
    borderTopColor: '_borderMuted',
  },
});

const dialectOptions = dialects.map((item) => ({ value: item.id, label: item.label }));

/** 引擎的名字 */
const engineLabel = { pglite: 'PostgreSQL（PGlite）', sqlite: 'SQLite（WASM）' } as const;

/** SqlExample 的属性 */
export interface SqlExampleProps {
  /** `*.examples.ts` 里的示例 */
  example: Example;
  /** 卡片标题 */
  title?: string;
}

/** 代码卡片 */
export const SqlExample = _component(({ example, title }: SqlExampleProps) => {
  let running = _state(false);
  let failure = _state<string | undefined>(undefined);
  let live = _state.raw<LiveResult | undefined>(undefined);

  const dialect = _derived(dialectInfo(currentDialect.value));
  // 上次运行的结果属于当时的引擎：换了方言就回到这个方言渲染的内容
  const shown = _derived(live && live.engine === dialect.live ? live : undefined);
  const rendering = _derived(example.dialects[dialect.id]);

  async function run() {
    const engine = dialect.live;
    if (!engine || running) return;
    running = true;
    failure = undefined;
    try {
      const [{ runExample }, build] = await Promise.all([import('./live'), example.load()]);
      live = await runExample(build, engine);
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    } finally {
      running = false;
    }
  }

  return () => {
    const statements = shown?.statements ?? rendering?.statements ?? [];
    const result = shown ? shown.result : example.result;
    return (
      <section {...css.attrs(styles.card)}>
        <div {...css.attrs(styles.header)}>
          <Text weight="semibold" sx={styles.title}>
            {title}
          </Text>
          <Select
            size="sm"
            aria-label="SQL 方言"
            items={dialectOptions}
            _value={currentDialect.value}
            sx={styles.select}
          />
          <LinkButton
            size="sm"
            variant="soft"
            icon={PencilLine}
            href={`/guide/playground#code=${encodeURIComponent(example.code)}`}
          >
            改一改
          </LinkButton>
          <Button
            size="sm"
            icon={Play}
            loading={running}
            disabled={!dialect.live}
            title={
              dialect.live
                ? `在浏览器里的 ${dialect.label} 上运行`
                : `${dialect.label} 没有 WASM 版本，这里只显示 SQL；切到 PostgreSQL 或 SQLite 可以运行`
            }
            onClick={() => void run()}
          >
            运行
          </Button>
        </div>
        <div {...css.attrs(styles.panes)}>
          <div {...css.attrs(styles.pane)}>
            <CodeBlock
              code={example.code}
              lang="ts"
              title="TypeScript"
              propsRoot={{ sx: styles.code }}
            />
          </div>
          <div {...css.attrs(styles.pane, styles.divided)}>
            {rendering?.error && !shown ? (
              <Alert tone="neutral" title={`${dialect.label} 不支持这种写法`} sx={styles.error}>
                {rendering.error}
              </Alert>
            ) : (
              <CodeBlock
                code={sqlText(statements)}
                lang="sql"
                wrap
                title={`SQL · ${dialect.label}`}
                propsRoot={{ sx: styles.code }}
              />
            )}
          </div>
          <div {...css.attrs(styles.pane, styles.divided)}>
            {failure ? (
              <Alert tone="danger" title="运行失败" sx={styles.error}>
                {failure}
              </Alert>
            ) : result === undefined ? (
              <Small tone="muted" sx={styles.empty}>
                这段代码不返回数据
              </Small>
            ) : (
              <CodeBlock
                code={result}
                lang="json"
                wrap
                title="结果"
                maxLines={24}
                propsRoot={{ sx: styles.code }}
              />
            )}
          </div>
        </div>
        <Small tone="muted" sx={styles.footer}>
          {shown
            ? `刚刚在浏览器里的 ${engineLabel[shown.engine]} 上执行，用时 ${shown.ms.toFixed(1)} ms`
            : running
              ? '正在加载浏览器里的数据库，第一次要下载 WASM……'
              : dialect.live
                ? '构建时渲染的 SQL 与示例数据上的结果；点“运行”在浏览器里真实执行'
                : `${dialect.label} 的 SQL 由同一段代码在构建时渲染，不连库；结果来自示例数据`}
        </Small>
      </section>
    );
  };
});
