/** 列规则一章的示例：都用模型里的 Doc 表 */
import { example } from '../../site/example.ts';
import { Doc } from '../../site/model.ts';

export const softRead = example((db) =>
  db
    .queryable(Doc)
    .select((d) => d.title)
    .toList(),
);

export const softDelete = example((db) =>
  db
    .delete(Doc)
    .where((d) => d.id.eq(2))
    .execute(),
);

export const seeDeleted = example(async (db) => {
  await db
    .delete(Doc)
    .where((d) => d.id.eq(2))
    .execute();

  return db
    .queryable(Doc)
    .noInterceptor('softDelete')
    .select((d) => ({ title: d.title, deleted: d.deleted }))
    .toList();
});

export const hardDelete = example((db) =>
  db
    .delete(Doc)
    .where((d) => d.id.eq(2))
    .hard()
    .execute(),
);

export const optimistic = example((db) =>
  db
    .update(Doc)
    .set({ title: '接入指南（第二版）' })
    .where((d) => d.id.eq(1))
    .withVersion(0)
    .execute(),
);

export const conflict = example(async (db) => {
  await db
    .update(Doc)
    .set({ title: '别人先改了' })
    .where((d) => d.id.eq(1))
    .withVersion(0)
    .execute();

  // 手里还是旧版本 0：一行都改不到，抛错
  return db
    .update(Doc)
    .set({ title: '我后改的' })
    .where((d) => d.id.eq(1))
    .withVersion(0)
    .execute()
    .catch((error: Error) => `被拦下了：${error.message}`);
});
