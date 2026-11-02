/**
 * 页面上那份能改的数据：演练场和“示例模型”页共用。库在 live.ts 里，一个引擎一份，所以两页看到的是同一份。
 * tables 是库里现在的数据，baseline 是比较的基线，读取和写入都在这里，页面只管显示
 */
import { shallowRef } from 'vue';
import type { LiveEngine } from './dialects';
import { cellText, cellValue, keyOf, type DiffedRow, type TableData } from './tables';

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** 打开、读取、修改一份数据 */
export function useLiveData() {
  const tables = shallowRef<readonly TableData[]>([]);
  const baseline = shallowRef<readonly TableData[]>([]);
  const loading = shallowRef(false);
  const failure = shallowRef<string | undefined>(undefined);
  let engine: LiveEngine | undefined;

  const live = () => import('./live');

  /** 改完重新读，比较的基线不变 */
  async function refresh() {
    const { readTables } = await live();
    tables.value = await readTables(engine!);
  }

  /** 换引擎：读这个引擎现在的数据，它就是基线 */
  async function open(selected: LiveEngine) {
    engine = selected;
    loading.value = true;
    tables.value = [];
    failure.value = undefined;
    try {
      const { readTables } = await live();
      const data = await readTables(selected);
      // 读的时候又换了引擎：这份数据已经不是当前的了
      if (selected !== engine) return;
      tables.value = data;
      baseline.value = data;
    } catch (error) {
      failure.value = message(error);
    } finally {
      loading.value = false;
    }
  }

  /** 放回示例数据 */
  async function reset() {
    failure.value = undefined;
    loading.value = true;
    try {
      const { resetData } = await live();
      tables.value = await resetData(engine!);
      baseline.value = tables.value;
    } catch (error) {
      failure.value = message(error);
    } finally {
      loading.value = false;
    }
  }

  /** 改一格。返回文字是失败的原因（库的报错），留在编辑器上 */
  async function edit(table: TableData, row: DiffedRow, name: string, input: unknown) {
    const column = table.columns.find((candidate) => candidate.name === name)!;
    const value = cellValue(column, input);
    if (cellText(value) === cellText(row.values[name])) return undefined;
    const { updateCell } = await live();
    try {
      await updateCell(engine!, table.table, keyOf(table, row.values), name, value);
      await refresh();
      return undefined;
    } catch (error) {
      return message(error);
    }
  }

  /** 删一行 */
  async function remove(table: TableData, row: DiffedRow) {
    failure.value = undefined;
    const { deleteRow } = await live();
    try {
      await deleteRow(engine!, table.table, keyOf(table, row.values));
      await refresh();
    } catch (error) {
      failure.value = message(error);
    }
  }

  /** 运行之前调用：现在的数据成为基线，运行改了什么就和它比 */
  async function markBaseline() {
    const { readTables } = await live();
    baseline.value = await readTables(engine!);
  }

  return { tables, baseline, loading, failure, open, refresh, reset, edit, remove, markBaseline };
}
