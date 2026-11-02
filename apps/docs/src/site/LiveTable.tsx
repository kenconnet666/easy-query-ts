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
  ValueChange,
  type DataTableColumn,
  type RowChanges,
  type RowTone,
} from '@zerodep-dev/vue-tsx-pro-ui';
import {
  cellError,
  cellText,
  diffTable,
  type DiffedRow,
  type TableColumn,
  type TableData,
} from './tables';

const styles = css.create({
  table: { maxHeight: '40rem' },
  // 改过的格不折行：表格的行高一样
  change: { flexWrap: 'nowrap' },
  gone: { textDecorationLine: 'line-through' },
  null: { opacity: 0.5, fontStyle: 'italic' },
});

const TONES: Readonly<Record<keyof RowChanges, RowTone>> = {
  inserted: 'success',
  updated: 'warning',
  deleted: 'danger',
};

/** 一列的值：排序和编辑器的初始值。数字列按数字排 */
function editValue(column: TableColumn, row: DiffedRow): string | number | null {
  const text = cellText(row.row[column.name]);
  return column.kind === 'number' && text !== null ? Number(text) : text;
}

function renderCell(column: TableColumn, row: DiffedRow) {
  const text = cellText(row.row[column.name]);
  const shown =
    text === null ? (
      <span {...css.attrs(styles.null)}>NULL</span>
    ) : row.change === 'deleted' ? (
      <span {...css.attrs(styles.gone)}>{text}</span>
    ) : (
      text
    );
  if (!row.changedFields?.includes(column.name)) return shown;
  return (
    <ValueChange
      before={cellText(row.before?.[column.name]) ?? 'NULL'}
      after={shown}
      sx={styles.change}
    />
  );
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
    const rows = _derived(diffTable(table, baseline));

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
        header: '操作',
        width: 72,
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
        editTrigger="click"
        propsRoot={{ sx: styles.table }}
      />
    );
  },
);
