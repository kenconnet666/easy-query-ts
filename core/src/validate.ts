/**
 * 由实体生成 Standard Schema 校验器（ROADMAP 18.2.2）：插入、更新、整行三种形状，规则全部来自列的声明，不用再写一遍。
 * 实现的是 Standard Schema 的 `~standard`，表单库、框架的 action、tRPC 一类接收 zod / valibot 的地方都能直接用：
 * ```ts
 * const v = validators(User)
 * const result = v.insert['~standard'].validate(input)   // { value } 或 { issues: [{ message, path: ['name'] }] }
 * ```
 * 规则：必填（不可空、不是自增、没有默认值的列插入时必须给）、可空、类型（字符串 / 整数 / 小数文字 / 布尔 / 日期 / 时间 / Date / 二进制）、
 * 字符串长度（`col.string(50)`）、DECIMAL 的位数（`col.decimal(12, 2)`）、枚举与 JSON 列自带的校验器（交给列的编码检查）、多余的字段。
 * 值对象（embed）按嵌套路径报。校验只检查不转换：通过时 value 就是输入
 */
import {
  Embedded,
  type AnyColumn,
  type Entity,
  type Fields,
  type Insert,
  type Row,
  type StandardSchema,
  type Update,
} from './schema.ts';

export interface Issue {
  readonly message: string;
  readonly path: readonly (string | number)[];
}

/** 实体的三种校验器 */
export interface EntityValidators<E extends Entity> {
  /** 插入的输入：必填列要给，自增、有默认值、可空的可省 */
  readonly insert: StandardSchema<Insert<E>>;
  /** 更新的输入：都可省，给了的要合法 */
  readonly update: StandardSchema<Update<E>>;
  /** 整行：每一列都要有（可空的可以是 null） */
  readonly row: StandardSchema<Row<E>>;
}

type Mode = 'insert' | 'update' | 'row';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;
const DECIMAL = /^-?\d+(\.\d+)?$/;
const INTEGER = /^-?\d+$/;

/** 实体的插入、更新、整行校验器（Standard Schema） */
export function validators<E extends Entity>(entity: E): EntityValidators<E> {
  const make = (mode: Mode) => ({
    '~standard': {
      version: 1 as const,
      vendor: 'easy-query',
      validate: (value: unknown) => {
        const issues: Issue[] = [];
        checkObject(entity.fields, value, mode, [], issues);
        return issues.length > 0 ? { issues } : { value };
      },
    },
  });
  return {
    insert: make('insert') as never,
    update: make('update') as never,
    row: make('row') as never,
  };
}

function checkObject(
  fields: Fields,
  value: unknown,
  mode: Mode,
  path: readonly (string | number)[],
  issues: Issue[],
): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    issues.push({ message: 'expected an object', path });
    return;
  }
  const input = value as Record<string, unknown>;
  for (const key of Object.keys(input))
    if (!(key in fields)) issues.push({ message: 'unknown field', path: [...path, key] });
  for (const [key, field] of Object.entries(fields)) {
    const at = [...path, key];
    const v = input[key];
    if (field instanceof Embedded) {
      if (v === undefined) {
        if (mode === 'row') issues.push({ message: 'required', path: at });
      } else if (v === null) {
        if (!allNullable(field.fields)) issues.push({ message: 'cannot be null', path: at });
      } else checkObject(field.fields, v, mode, at, issues);
      continue;
    }
    const column = field as AnyColumn;
    const o = column.options;
    if (v === undefined) {
      const optional = mode === 'update' || (mode === 'insert' && insertOptional(column));
      if (!optional) issues.push({ message: 'required', path: at });
      continue;
    }
    if (v === null) {
      if (!o.nullable) issues.push({ message: 'cannot be null', path: at });
      continue;
    }
    const message = checkValue(column, v);
    if (message) issues.push({ message, path: at });
  }
}

/** 插入时可省：可空、自增、库里有默认值、客户端补值（$default、逻辑删除、版本列），与 Insert 类型的规则一致 */
function insertOptional(column: AnyColumn): boolean {
  const o = column.options;
  return (
    o.nullable || o.generated || o.hasDefault || !!o.defaultFn || !!o.softDelete || !!o.version
  );
}

function allNullable(fields: Fields): boolean {
  return Object.values(fields).every((f) =>
    f instanceof Embedded ? allNullable(f.fields) : (f as AnyColumn).options.nullable,
  );
}

/** 一个值合不合列的类型；不合格时返回原因 */
function checkValue(column: AnyColumn, v: unknown): string | undefined {
  const o = column.options;
  const shape = ((): string | undefined => {
    switch (column.codec.kind) {
      case 'string':
        if (typeof v !== 'string') return 'expected a string';
        if (o.length !== undefined && [...v].length > o.length)
          return `must be at most ${o.length} characters`;
        return undefined;
      case 'int':
        return typeof v === 'number' && Number.isInteger(v) ? undefined : 'expected an integer';
      case 'bigint':
        return (typeof v === 'number' && Number.isSafeInteger(v)) ||
          typeof v === 'bigint' ||
          (typeof v === 'string' && INTEGER.test(v))
          ? undefined
          : 'expected an integer';
      case 'decimal': {
        const text = typeof v === 'number' ? String(v) : typeof v === 'string' ? v : undefined;
        // 扩展类型（decimal.js 等）的值对象交给列的编码检查
        if (text === undefined) return typeof v === 'object' ? undefined : 'expected a decimal';
        if (!DECIMAL.test(text)) return 'expected a decimal';
        const [whole = '', fraction = ''] = text.replace('-', '').split('.');
        if (o.scale !== undefined && fraction.length > o.scale)
          return `must have at most ${o.scale} decimal places`;
        if (
          o.precision !== undefined &&
          whole.replace(/^0+/, '').length > o.precision - (o.scale ?? 0)
        )
          return `must have at most ${o.precision - (o.scale ?? 0)} integer digits`;
        return undefined;
      }
      case 'double':
        return typeof v === 'number' && Number.isFinite(v) ? undefined : 'expected a number';
      case 'boolean':
        return typeof v === 'boolean' ? undefined : 'expected a boolean';
      case 'date':
        return typeof v === 'string' && DATE.test(v) && !Number.isNaN(Date.parse(v))
          ? undefined
          : typeof v === 'object'
            ? undefined
            : 'expected a date (YYYY-MM-DD)';
      case 'time':
        return (typeof v === 'string' && TIME.test(v)) || typeof v === 'object'
          ? undefined
          : 'expected a time (HH:MM:SS)';
      case 'datetime':
        return v instanceof Date
          ? Number.isNaN(v.getTime())
            ? 'invalid date'
            : undefined
          : typeof v === 'object'
            ? undefined
            : 'expected a Date';
      case 'bytes':
        return v instanceof Uint8Array ? undefined : 'expected bytes (Uint8Array)';
      default:
        return undefined;
    }
  })();
  if (shape) return shape;
  // 枚举、带校验器的 JSON 列、扩展类型：列的编码自己会检查，抛出的错误就是原因
  if (column.codec.encode) {
    try {
      column.codec.encode(v as never);
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }
  return undefined;
}
