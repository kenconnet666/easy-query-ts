/**
 * 链路追踪（ROADMAP 18.3.4）：每条语句一个 OpenTelemetry span，属性按数据库的语义约定（db.system.name、db.query.text……）：
 * ```ts
 * import { trace } from '@opentelemetry/api'
 * createDb({ schema, adapter, onExecute: statementSpans(trace.getTracer('app')) })
 * ```
 * 核心不依赖 @opentelemetry/api：只用到 Tracer 的 startSpan，按结构类型对接。span 在语句结束后补记（开始时间往前推耗时），
 * 父 span 是发起语句时的活动 span。参数不进 span（可能有敏感数据）
 */
import type { ExecutionEvent } from './session.ts';

/** 用到的 OpenTelemetry Tracer 的部分；`trace.getTracer(name)` 的返回值可以直接传 */
export interface SpanTracer {
  startSpan(
    name: string,
    options: {
      readonly kind: number;
      readonly startTime: number;
      readonly attributes: Readonly<Record<string, string | number>>;
    },
  ): {
    setStatus(status: { code: number; message?: string }): unknown;
    recordException(error: Error | string): unknown;
    end(endTime?: number): unknown;
  };
}

/** SpanKind.CLIENT、SpanStatusCode.ERROR 的值（照抄 @opentelemetry/api，免得依赖它） */
const CLIENT = 2;
const ERROR = 2;

/** 方言名 → 语义约定里 db.system.name 的值；没列出的用方言名本身 */
const SYSTEMS: Readonly<Record<string, string>> = {
  postgres: 'postgresql',
  sqlserver: 'microsoft.sql_server',
  oracle: 'oracle.db',
  db2: 'ibm.db2',
  hana: 'sap.hana',
};

/** 每条语句一个 span 的 onExecute 钩子 */
export function statementSpans(tracer: SpanTracer): (event: ExecutionEvent) => void {
  return (event) => {
    const now = Date.now();
    const system = SYSTEMS[event.dialect] ?? event.dialect;
    const operation = /^\s*(\w+)/.exec(event.statement.sql)?.[1]?.toUpperCase();
    const attributes: Record<string, string | number> = {
      'db.system.name': system,
      'db.query.text': event.statement.sql,
    };
    if (operation) attributes['db.operation.name'] = operation;
    if (event.kind === 'query' && !event.error)
      attributes['db.response.returned_rows'] = event.rows;
    const span = tracer.startSpan(operation ?? system, {
      kind: CLIENT,
      startTime: now - event.durationMs,
      attributes,
    });
    if (event.error) {
      // 驱动抛的不一定是 Error
      const error =
        event.error instanceof Error ? event.error : new Error(JSON.stringify(event.error));
      span.recordException(error);
      span.setStatus({ code: ERROR, message: error.message });
    }
    span.end(now);
  };
}
