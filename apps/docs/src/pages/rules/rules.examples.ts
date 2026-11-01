/** 逻辑删除、乐观锁、自动填充、加密、多租户、拦截器几章的示例 */
import { example } from '../../site/example.ts';
import {
  auditLog,
  Doc,
  Tag,
  Ticket,
  User,
} from '../../site/model.ts';

// ---- 逻辑删除

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

export const softThenRead = example(async (db) => {
  await db
    .delete(Doc)
    .where((d) => d.id.eq(2))
    .execute();

  return db
    .queryable(Doc)
    .select((d) => d.title)
    .toList();
});

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

export const softUpdateSkips = example(async (db) => {
  await db
    .delete(Doc)
    .where((d) => d.id.eq(2))
    .execute();

  // 已删除的行更新不到
  return db
    .update(Doc)
    .set({ title: '改不到' })
    .where((d) => d.id.eq(2))
    .execute();
});

export const softInNavigation = example(async (db) => {
  await db
    .delete(Doc)
    .where((d) => d.id.eq(2))
    .execute();

  return db
    .queryable(User)
    .whereKeys([1, 2])
    .select((u) => ({
      name: u.name,
      docs: u.docs.count(),
      withDeleted: u.docs
        .noInterceptor('softDelete')
        .count(),
      titles: u.docs.toList((d) => d.title),
    }))
    .toList();
});

export const softRestore = example(async (db) => {
  await db
    .delete(Doc)
    .where((d) => d.id.eq(2))
    .execute();

  // 恢复：更新也要先关掉过滤
  await db
    .update(Doc)
    .noInterceptor('softDelete')
    .set({ deleted: false })
    .where((d) => d.id.eq(2))
    .execute();

  return db.queryable(Doc).count();
});

// ---- 乐观锁

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

export const versionEntity = example(async (db) => {
  const doc = await db.queryable(Doc).findOrThrow(1);

  await db
    .update(Doc)
    .entity({ ...doc, title: '改一次' })
    .execute();

  return db.queryable(Doc).findOrThrow(1);
});

export const versionChanges = example(async (db) => {
  const before = await db.queryable(Doc).findOrThrow(1);

  // 只写变了的列，同样带版本条件
  return db
    .update(Doc)
    .changes(before, { ...before, title: '只改标题' })
    .execute();
});

export const staleEntity = example(async (db) => {
  const mine = await db.queryable(Doc).findOrThrow(1);
  const theirs = await db.queryable(Doc).findOrThrow(1);

  await db
    .update(Doc)
    .entity({ ...theirs, title: '别人保存了' })
    .execute();

  return db
    .update(Doc)
    .entity({ ...mine, title: '我也保存' })
    .execute()
    .catch((error: Error) => error.message);
});

export const versionBumps = example(async (db) => {
  // 没带版本条件的更新也换版本：别人手里的旧版本随之失效
  await db
    .update(Doc)
    .set({ title: '批量改' })
    .where((d) => d.id.eq(1))
    .execute();

  return db.queryable(Doc).findOrThrow(1);
});

export const ignoreVersion = example(async (db) => {
  await db
    .update(Doc)
    .set({ title: '管理端修正' })
    .where((d) => d.id.eq(1))
    .ignoreVersion()
    .execute();

  return db.queryable(Doc).findOrThrow(1);
});

export const deleteVersion = example((db) =>
  db
    .delete(Doc)
    .where((d) => d.id.eq(1))
    .withVersion(5)
    .execute()
    .catch((error: Error) => error.message),
);

// ---- 自动填充

export const insertDefaults = example((db) =>
  db
    .insert(Doc)
    .values({ title: '新文档', createdBy: '林晓' })
    .returnEntity(),
);

export const onUpdateFills = example(async (db) => {
  await db
    .update(Doc)
    .set({ title: '改个标题' })
    .where((d) => d.id.eq(1))
    .execute();

  return db.queryable(Doc).findOrThrow(1);
});

export const insertOnlyBlocked = example(async (db) => {
  const doc = await db.queryable(Doc).findOrThrow(1);

  // entity(row) 自动跳过 insertOnly 的列：看 SQL 一栏没有 created_by
  await db
    .update(Doc)
    .entity({ ...doc, createdBy: '别人', title: '换标题' })
    .execute();

  return db.queryable(Doc).findOrThrow(1);
});

export const touchFills = example(async (db) => {
  await db
    .update(Ticket)
    .set({ title: '发票抬头写错了（已处理）' })
    .where((t) => t.id.eq(1))
    .execute();

  return db
    .queryable(Ticket)
    .where((t) => t.id.eq(1))
    .select((t) => ({
      title: t.title,
      touchedAt: t.touchedAt,
    }))
    .first();
});

// ---- 加密

export const encryptedRead = example((db) =>
  db
    .queryable(Ticket)
    .select((t) => ({ title: t.title, contact: t.contact }))
    .limit(2)
    .toList(),
);

export const encryptedRaw = example(
  (db) =>
    db.sql<{ contact: string }>`
    SELECT contact FROM t_ticket ORDER BY id LIMIT 2
  `,
);

export const encryptedWrite = example((db) =>
  db
    .insert(Ticket)
    .values({ title: '新工单', contact: '13700000000' })
    .returnEntity(),
);

export const encryptedWhere = example((db) =>
  db
    .queryable(Ticket)
    .where((t) => t.contact.eq('13800000001'))
    .select((t) => t.title)
    .toList(),
);

// ---- 多租户

export const tenantRead = example((db) =>
  db
    .queryable(Ticket)
    .select((t) => ({
      tenantId: t.tenantId,
      title: t.title,
    }))
    .toList(),
);

export const tenantCount = example((db) =>
  db.queryable(Ticket).count(),
);

export const tenantInsert = example((db) =>
  db
    .insert(Ticket)
    .values({ title: '新工单', contact: '13700000000' })
    .returnEntity(),
);

export const tenantUpdate = example((db) =>
  db
    .update(Ticket)
    .set({ title: '改不到别的租户' })
    .where((t) => t.title.eq('登录不上'))
    .execute(),
);

export const tenantDelete = example((db) =>
  db
    .delete(Ticket)
    .where((t) => t.id.eq(4))
    .execute(),
);

export const tenantSkip = example((db) =>
  db
    .queryable(Ticket)
    .noInterceptor('tenant')
    .select((t) => ({
      tenantId: t.tenantId,
      title: t.title,
    }))
    .toList(),
);

export const tenantSkipAll = example((db) =>
  db
    .withInterceptors({ skip: 'all' })
    .queryable(Ticket)
    .count(),
);

export const tenantSkipByName = example((db) =>
  db
    .withInterceptors({ skip: ['tenant'] })
    .queryable(Ticket)
    .count(),
);

// ---- 拦截器

export const auditOff = example(async (db) => {
  auditLog.length = 0;
  await db.insert(Tag).values({ name: '不记录' }).execute();

  return { log: auditLog };
});

export const auditOn = example(async (db) => {
  auditLog.length = 0;
  await db
    .insert(Tag)
    .useInterceptor('audit')
    .values({ name: '记录' })
    .execute();
  await db
    .update(Tag)
    .useInterceptor('audit')
    .set({ name: '改了' })
    .where((t) => t.id.le(2))
    .execute();
  await db
    .delete(Tag)
    .useInterceptor('audit')
    .where((t) => t.id.eq(6))
    .execute();

  return { log: auditLog };
});

export const auditForDb = example(async (db) => {
  auditLog.length = 0;
  const audited = db.withInterceptors({ use: ['audit'] });
  await audited
    .update(Tag)
    .set({ name: '整段都记' })
    .where((t) => t.id.eq(1))
    .execute();

  return { log: auditLog };
});
