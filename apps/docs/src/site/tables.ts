/**
 * 演练场的数据面板：库里的表和行，以及和基线（上次运行前的样子）比出来的改动。
 * 行是库里的原始值，不经过列的 codec：加密列看到的是密文，逻辑删除的行也在。这个文件不依赖 ORM
 */

/** 一行：库里的列名 → 原始值 */
export type RawRow = Readonly<Record<string, unknown>>;

/** 编辑时怎么解析输入 */
export type CellKind = 'text' | 'number' | 'boolean' | 'json';

/** 一列 */
export interface TableColumn {
  /** 库里的列名 */
  readonly name: string;
  /** 实体上的属性路径：代码里的名字 */
  readonly property: string;
  readonly kind: CellKind;
  readonly nullable: boolean;
  /** 主键：用它定位行，不能编辑 */
  readonly primaryKey: boolean;
  readonly enumValues?: readonly string[];
}

/** 一张表现在的数据 */
export interface TableData {
  readonly table: string;
  readonly columns: readonly TableColumn[];
  readonly rows: readonly RawRow[];
  /** 读不出来的原因：代码把表删了之类，重置数据就回来了 */
  readonly error?: string;
}

/** 这一行和基线比怎么了 */
export type RowChange = 'inserted' | 'updated' | 'deleted';

/** 显示用的一行：删除了的行也留着，标出来 */
export interface DiffedRow {
  readonly key: string;
  readonly values: RawRow;
  readonly change?: RowChange;
  /** 修改了的行在基线里的样子 */
  readonly previous?: RawRow;
}

/** 单元格的文字；NULL 是 null */
export function cellText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'object' ? JSON.stringify(value) : String(value as string | number);
}

function rowKey(table: TableData, row: RawRow): string {
  return JSON.stringify(
    table.columns.filter((column) => column.primaryKey).map((c) => cellText(row[c.name])),
  );
}

/** 主键列的值：定位这一行 */
export function keyOf(table: TableData, row: RawRow): RawRow {
  const key = table.columns.filter((column) => column.primaryKey).map((c) => c.name);
  return Object.fromEntries(key.map((name) => [name, row[name]]));
}

/** 这一列的值变了 */
export function cellChanged(row: DiffedRow, column: string): boolean {
  return (
    row.change === 'updated' && cellText(row.previous?.[column]) !== cellText(row.values[column])
  );
}

/** 现在的行，每行标上和基线比的改动；删除了的行排在最后 */
export function diffRows(current: TableData, baseline: TableData | undefined): DiffedRow[] {
  const before = new Map((baseline?.rows ?? []).map((row) => [rowKey(current, row), row]));
  const rows = current.rows.map((values): DiffedRow => {
    const key = rowKey(current, values);
    const previous = before.get(key);
    before.delete(key);
    if (!baseline) return { key, values };
    if (!previous) return { key, values, change: 'inserted' };
    const same = current.columns.every(
      (column) => cellText(previous[column.name]) === cellText(values[column.name]),
    );
    return same ? { key, values } : { key, values, change: 'updated', previous };
  });
  const deleted = [...before].map(([key, values]): DiffedRow => ({
    key,
    values,
    change: 'deleted',
  }));
  return [...rows, ...deleted];
}

/** “新增 1 行，修改 2 行”；没有改动时为空 */
export function summarize(rows: readonly DiffedRow[]): string {
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

/** 输入的值不合法时的原因 */
export function cellError(column: TableColumn, input: unknown): string | undefined {
  const text = cellText(input) ?? '';
  if (text === '') {
    const blankIsValue = column.kind === 'text' && !column.enumValues;
    return column.nullable || blankIsValue ? undefined : '这一列不能为空';
  }
  if (column.enumValues && !column.enumValues.includes(text))
    return `只能是 ${column.enumValues.join('、')}`;
  if (column.kind === 'boolean' && !/^(true|false|0|1)$/.test(text)) return '只能是 true 或 false';
  if (column.kind === 'json') {
    try {
      JSON.parse(text);
    } catch {
      return '不是合法的 JSON';
    }
  }
  return undefined;
}

/** 输入换成要绑定的值。空着：可空的列是 NULL，文字列是空字符串 */
export function cellValue(column: TableColumn, input: unknown): string | number | boolean | null {
  const text = cellText(input) ?? '';
  if (text === '') return column.nullable ? null : '';
  if (column.kind === 'number') return Number(text);
  if (column.kind === 'boolean') return text === 'true' || text === '1';
  return text;
}
