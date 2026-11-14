/**
 * PG 协议的国产库：驱动同样用 node-postgres，方言继承 PG 方言后覆盖差异。
 * - openGauss / GaussDB：没有 IDENTITY 列（用 BIGSERIAL）、没有 ON CONFLICT（upsert 写成 ON DUPLICATE KEY UPDATE）、没有多参数的 unnest
 * - 人大金仓 KingbaseES（PG 模式初始化）：语法与 PG 一致，IDENTITY、ON CONFLICT 都有
 */
import type { ColumnOptions, ConflictNode, FunctionRenderer } from '@zerodep-dev/easy-query-ts';
import { PostgresDialect } from './dialect.ts';

/** openGauss 的方言：与 PostgreSQL 的差异（upsert、JSON、没有的函数） */
export class OpenGaussDialect extends PostgresDialect {
  override readonly name: string = 'opengauss';

  /** 自增列写成 SERIAL / BIGSERIAL（不支持 GENERATED … AS IDENTITY） */
  override columnType(kind: string, o: ColumnOptions): string {
    if (o.generated && !o.dbType) return kind === 'int' ? 'SERIAL' : 'BIGSERIAL';
    return super.columnType(kind, o);
  }

  override identity(): string {
    return '';
  }

  /** 没有多参数的 unnest（function unnest(bigint[], …) does not exist）：批量插入照旧是 VALUES */
  override readonly arrayInsertFrom: number | undefined = undefined;

  /** ON DUPLICATE KEY UPDATE 不能带条件 */
  override readonly conditionalUpsert = false;

  /** upsert 写成 ON DUPLICATE KEY UPDATE（冲突列由表上的主键 / 唯一约束决定） */
  override onConflict(c: ConflictNode): string {
    if (c.update.length === 0) return ' ON DUPLICATE KEY UPDATE NOTHING';
    return ` ON DUPLICATE KEY UPDATE ${c.update.map((u) => `${this.quote(u)} = VALUES(${this.quote(u)})`).join(', ')}`;
  }

  /** 7.0 没有 websearch_to_tsquery 和 cardinality：全文检索用到时报不支持，数组长度换成 array_length（空数组是 NULL） */
  protected override functions(): Record<string, FunctionRenderer> {
    const { 'pg.ts_match': _match, 'pg.ts_rank': _rank, ...functions } = super.functions();
    return { ...functions, array_length: (a) => `coalesce(array_length(${a[0]}, 1), 0)` };
  }

  /** 没有 attidentity：默认值取序列的就是自增列 */
  protected override readonly introspectedIdentity = `coalesce(pg_get_expr(d.adbin, d.adrelid), '') LIKE 'nextval(%'`;

  /** 读出的 SERIAL 列类型是 integer / bigint */
  protected override normalizeType(type: string): string {
    return super.normalizeType(
      type.replace(/^bigserial$/i, 'bigint').replace(/^serial$/i, 'integer'),
    );
  }
}

/** 人大金仓（PG 模式）的方言：与 PostgreSQL 的差异 */
export class KingbaseDialect extends PostgresDialect {
  override readonly name: string = 'kingbase';
}
