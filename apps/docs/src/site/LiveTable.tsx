/**
 * 一张能改的表：演练场的数据面板和“示例模型”页共用。单击单元格行内编辑，Enter 或点开别处提交，Esc 放弃；行能删。
 * 和基线比，新增的行绿色、修改的行黄色并写出旧值、删除的行红色留在最后
 */
import { Trash2 } from '@lucide/icons';
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { css } from '@zerodep-dev/vue-tsx-pro-tsx/styles';
import {
  DataTable,
  IconButton,
  isCellEditable,
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
    <span title={`之前是 ${previous}`}>
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

/** LiveTable 的属性 */
export interface LiveTableProps {
  /** 这张表现在的数据 */
  table: TableData;
  /** 比较的基线 */
  baseline: TableData | undefined;
  /** 正在运行或读取：不能编辑 */
  busy: boolean;
  /** 表头写实体的属性名（代码里的名字），默认写库里的列名 */
  propertyHeaders?: boolean;
  /** 改了一格；返回文字是失败的原因 */
  onEdit: (table: TableData, row: DiffedRow, column: string, value: unknown) => Promise<unknown>;
  /** 删了一行 */
  onDelete: (table: TableData, row: DiffedRow) => void;
}

/** 一张能改的表 */
export const LiveTable = _component(
  ({ table, baseline, busy, propertyHeaders = false, onEdit, onDelete }: LiveTableProps) => {
    const rows = _derived(diffRows(table, baseline));

    const columns = _derived.by((): DataTableColumn<DiffedRow>[] => [
      ...table.columns.map((column): DataTableColumn<DiffedRow> => ({
        key: column.name,
        header: propertyHeaders ? column.property : column.name,
        type: column.kind === 'number' ? 'number' : 'text',
        value: (row) => editValue(column, row),
        cell: (row) => renderCell(column, row),
        sortable: true,
        // 表头加上排序图标要放得下，不要省略成 departme…
        minWidth: Math.max(90, column.name.length * 8 + 48),
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
    ]);

    return () => (
      <DataTable
        aria-label={table.table}
        density="compact"
        rows={rows}
        columns={columns}
        getKey={(row) => row.key}
        rowTone={(row) => (row.change ? TONES[row.change] : undefined)}
        onCellChange={(row, key, value) => onEdit(table, row, key, value)}
        propsRoot={{ sx: styles.table }}
        propsCell={(row, column) =>
          isCellEditable(column, row) ? { sx: styles.editable, onClick: editOnClick } : {}
        }
      />
    );
  },
);
