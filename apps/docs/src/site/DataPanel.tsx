/**
 * 演练场下方的数据面板：左边选表，右边是这张表的真实数据，单击单元格行内编辑，行能删。
 * 和上次运行前比，新增的行绿色、修改的行黄色并写出旧值、删除的行红色留在最后，运行做了什么一眼看得出来
 */
import { RotateCcw, Trash2 } from '@lucide/icons';
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { css } from '@zerodep-dev/vue-tsx-pro-tsx/styles';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  Flex,
  H2,
  IconButton,
  isCellEditable,
  Small,
  Tab,
  TabList,
  Tabs,
  type DataTableColumn,
  type RowTone,
} from '@zerodep-dev/vue-tsx-pro-ui';
import {
  cellChanged,
  cellError,
  cellText,
  diffRows,
  type DiffedRow,
  type RowChange,
  type TableColumn,
  type TableData,
} from './tables';

const styles = css.create({
  panel: { gap: '_md', minWidth: 0 },
  bar: { flexWrap: 'wrap', gap: '_sm' },
  title: { flexGrow: 1 },
  tabs: { alignItems: 'stretch', minWidth: 0 },
  // 17 张表刚好放下，不用滚动
  list: { flexShrink: 0, width: '13rem' },
  tabLabel: { display: 'flex', alignItems: 'center', gap: '_xs' },
  body: { flexGrow: 1, minWidth: 0, gap: '_sm' },
  table: { maxHeight: '40rem' },
  editable: { cursor: 'text' },
  old: { textDecorationLine: 'line-through', opacity: 0.65, marginInlineEnd: '_xs' },
  gone: { textDecorationLine: 'line-through' },
  null: { opacity: 0.5, fontStyle: 'italic' },
});

const TONES: Readonly<Record<RowChange, RowTone>> = {
  inserted: 'success',
  updated: 'warning',
  deleted: 'danger',
};

/** 一列的值：排序和编辑器的初始值。数字列按数字排 */
function editValue(column: TableColumn, row: DiffedRow): string | number | null {
  const text = cellText(row.values[column.name]);
  return column.kind === 'number' && text !== null ? Number(text) : text;
}

function renderCell(column: TableColumn, row: DiffedRow) {
  const text = cellText(row.values[column.name]);
  const shown =
    text === null ? (
      <span {...css.attrs(styles.null)}>NULL</span>
    ) : row.change === 'deleted' ? (
      <span {...css.attrs(styles.gone)}>{text}</span>
    ) : (
      text
    );
  if (!cellChanged(row, column.name)) return shown;
  const previous = cellText(row.previous?.[column.name]) ?? 'NULL';
  return (
    <span title={`运行前是 ${previous}`}>
      <span {...css.attrs(styles.old)}>{previous}</span>
      {shown}
    </span>
  );
}

/** 单击进入行内编辑：DataTable 只认双击，开始编辑的方法也没有公开，所以转发成双击。点在编辑器里时不转发 */
function editOnClick(event: MouseEvent) {
  const cell = event.currentTarget as HTMLElement;
  if ((event.target as HTMLElement).closest('input, textarea, select, button')) return;
  cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
}

/** “新增 1 行，修改 2 行”；没有改动时为空 */
function summarize(rows: readonly DiffedRow[]): string {
  const count = (change: RowChange) => rows.filter((row) => row.change === change).length;
  const parts = [
    ['新增', count('inserted')],
    ['修改', count('updated')],
    ['删除', count('deleted')],
  ] as const;
  return parts
    .filter(([, n]) => n > 0)
    .map(([label, n]) => `${label} ${n} 行`)
    .join('，');
}

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

    const diffs = _derived(
      new Map(
        tables.map((table) => [
          table.table,
          diffRows(
            table,
            baseline.find((before) => before.table === table.table),
          ),
        ]),
      ),
    );
    const current = _derived(tables.find((table) => table.table === active) ?? tables[0]);
    const rows = _derived((current && diffs.get(current.table)) ?? []);
    const changedRows = _derived([...diffs.values()].flat().filter((row) => row.change));

    const columns = _derived.by((): DataTableColumn<DiffedRow>[] => {
      const table = current;
      if (!table) return [];
      return [
        ...table.columns.map((column): DataTableColumn<DiffedRow> => ({
          key: column.name,
          header: column.name,
          type: column.kind === 'number' ? 'number' : 'text',
          value: (row) => editValue(column, row),
          cell: (row) => renderCell(column, row),
          sortable: true,
          minWidth: 110,
          editable: (row) => !column.primaryKey && !busy && row.change !== 'deleted',
          validate: (value) => cellError(column, value),
        })),
        {
          key: '__delete',
          header: '',
          width: 56,
          sticky: 'end',
          cell: (row) =>
            row.change === 'deleted' ? null : (
              <IconButton
                size="sm"
                variant="ghost"
                icon={Trash2}
                aria-label="删除这一行"
                disabled={busy}
                onClick={() => onDelete(table, row)}
              />
            ),
        },
      ];
    });

    return () => (
      <Flex direction="column" sx={styles.panel}>
        <Flex align="center" sx={styles.bar}>
          <H2 sx={styles.title}>表里的数据</H2>
          <Small tone="muted">
            {changedRows.length > 0
              ? `和上次运行前比：${summarize(changedRows)}`
              : '和上次运行前比没有改动'}
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
                const changed = summarize(diffs.get(table.table) ?? []);
                return (
                  <Tab key={table.table} value={table.table} title={changed || undefined}>
                    <span {...css.attrs(styles.tabLabel)}>
                      {table.table}
                      {changed && (
                        <Badge tone="warning">
                          {diffs.get(table.table)!.filter((row) => row.change).length}
                        </Badge>
                      )}
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
              <DataTable
                key={current?.table}
                aria-label={current?.table ?? '数据'}
                density="compact"
                rows={rows}
                columns={columns}
                getKey={(row) => row.key}
                loading={tables.length === 0}
                rowTone={(row) => (row.change ? TONES[row.change] : undefined)}
                onCellChange={(row, key, value) => onEdit(current!, row, key, value)}
                propsRoot={{ sx: styles.table }}
                propsCell={(row, column) =>
                  isCellEditable(column, row) ? { sx: styles.editable, onClick: editOnClick } : {}
                }
              />
            )}
          </Flex>
        </Flex>
      </Flex>
    );
  },
);
