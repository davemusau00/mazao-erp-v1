import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestMetrics {
  readonly requestId: string;
  readonly startedAt: number;
  poolWaitMs: number;
  queryMs: number;
  queryCount: number;
  handlerStartedAt?: number;
  handlerMs?: number;
  serializationStartedAt?: number;
  serializationMs?: number;
  responseBytes?: number;
}

export const requestMetricsStorage = new AsyncLocalStorage<RequestMetrics>();

export function recordPoolWait(durationMs: number, target = requestMetricsStorage.getStore()) {
  const metrics = target;
  if (metrics) metrics.poolWaitMs += Math.max(0, durationMs);
}

export function recordDatabaseQuery(durationMs: number, target = requestMetricsStorage.getStore()) {
  const metrics = target;
  if (!metrics) return;
  metrics.queryMs += Math.max(0, durationMs);
  metrics.queryCount += 1;
}

export function elapsedMs(startedAt: number, endedAt = performance.now()) {
  return Math.max(0, endedAt - startedAt);
}

export function milliseconds(value: number | undefined) {
  return Math.max(0, value ?? 0).toFixed(1);
}
