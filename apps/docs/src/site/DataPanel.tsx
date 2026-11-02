/**
 * 演练场下方的数据面板：左边选表，右边是这张表的真实数据（LiveTable），运行做了什么一眼看得出来
 */
import { RotateCcw } from '@lucide/icons';
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { css } from '@zerodep-dev/vue-tsx-pro-tsx/styles';
import {
  Alert,
  Badge,
  Button,
  Flex,
  H2,
  Small,
  Tab,
  TabList,
  Tabs,
} from '@zerodep-dev/vue-tsx-pro-ui';
import { LiveTable } from './LiveTable';
import { diffRows, summarize, type DiffedRow, type TableData } from './tables';

const styles = css.create({
  panel: { gap: '_md', minWidth: 0 },
  bar: { flexWrap: 'wrap', gap: '_sm' },
  title: { flexGrow: 1 },
  tabs: { alignItems: 'stretch', minWidth: 0 },
  // 17 张表刚好放下，不用滚动
  list: { flexShrink: 0, width: '13rem' },
  tabLabel: { display: 'flex', alignItems: 'center', gap: '_xs' },
  body: { flexGrow: 1, minWidth: 0, gap: '_sm' },
});

/** DataPanel 的属性 */
export interface DataPanelProps {
  /** 所有表现在的数据；还没读出来时为空 */
  tables: readonly TableData[];
  /** 比较的基线：上次运行前的样子 */
  baseline: readonly TableData[];
  /** 正在运行或读取：不能编辑 */
  busy: boolean;
  /** 改了一格；返回文字是失败的原因 */
  onEdit: (table: TableData, row: DiffedRow, column: string, value: unknown) => Promise<unknown>;
  /** 删了一行 */
  onDelete: (table: TableData, row: DiffedRow) => void;
  /** 点了“重置数据” */
  onReset: () => void;
}

/** 数据面板 */
export const DataPanel = _component(
  ({ tables, baseline, busy, onEdit, onDelete, onReset }: DataPanelProps) => {
    let active = _state('');

    const before = (table: TableData) => baseline.find((item) => item.table === table.table);
    const diffs = _derived(
      new Map(tables.map((table) => [table.table, diffRows(table, before(table))])),
    );
    const current = _derived(tables.find((table) => table.table === active) ?? tables[0]);
    const changed = _derived(summarize([...diffs.values()].flat()));

    return () => (
      <Flex direction="column" sx={styles.panel}>
        <Flex align="center" sx={styles.bar}>
          <H2 sx={styles.title}>表里的数据</H2>
          <Small tone="muted">
            {changed ? `和上次运行前比：${changed}` : '和上次运行前比没有改动'}
          </Small>
          <Button
            size="sm"
            variant="soft"
            icon={RotateCcw}
            disabled={busy}
            onClick={() => onReset()}
          >
            重置数据
          </Button>
        </Flex>
        <Small tone="muted">
          这里是库里的原始值：加密列是密文，逻辑删除的行也在。单击单元格直接改，Enter 提交，Esc
          放弃，主键不能改。改动直接发
          UPDATE，不经过拦截器和列规则。绿色是新增，黄色是修改（划掉的是旧值），红色是删除。
        </Small>
        <Flex sx={styles.tabs} gap="md">
          <Tabs orientation="vertical" _value={active}>
            <TabList aria-label="表" sx={styles.list}>
              {tables.map((table) => {
                const rows = diffs.get(table.table) ?? [];
                const count = rows.filter((row) => row.change).length;
                return (
                  <Tab key={table.table} value={table.table} title={summarize(rows) || undefined}>
                    <span {...css.attrs(styles.tabLabel)}>
                      {table.table}
                      {count > 0 && <Badge tone="warning">{count}</Badge>}
                    </span>
                  </Tab>
                );
              })}
            </TabList>
          </Tabs>
          <Flex direction="column" sx={styles.body}>
            {current?.error ? (
              <Alert tone="danger" title={`读不出 ${current.table}`}>
                {current.error}（点“重置数据”可以恢复）
              </Alert>
            ) : (
              current && (
                <LiveTable
                  key={current.table}
                  table={current}
                  baseline={before(current)}
                  busy={busy}
                  onEdit={onEdit}
                  onDelete={onDelete}
                />
              )
            )}
          </Flex>
        </Flex>
      </Flex>
    );
  },
);
