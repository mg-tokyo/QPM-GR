// Shared diagnostics wiring for src/store/* modules. Stores share a STORE-* code prefix
// (§4.4 diagnostics-design.md); `context.store` distinguishes which store fired.
// Stores never call console.* — use the returned `log` logger, and warn/error for coded failures.
// Store-side WS send failures stay at log.debug — sendRoomAction already emits WS-* with the
// reason; add a STORE-* attribution code only if store senders multiply (2026-07-15; mountState is the sole sender).

import { healthBus } from '../diagnostics/healthBus';
import { createNamedLogger, type NamedLogger } from '../diagnostics/logger';
import { buildError } from '../diagnostics/result';
import type {
  ErrorCode,
  QpmError,
  Severity,
  Subsystem,
  SubsystemHealth,
} from '../diagnostics/types';

export type StoreMetrics = Readonly<Record<string, number | string>>;

export interface StoreDiagnostics {
  /** Bus subsystem id (e.g. 'storeHutch'). */
  readonly subsystem: Subsystem;
  /** Underlying named logger for non-coded debug/info chatter. */
  readonly log: NamedLogger;
  /** Idempotent — registers the store with the bus as 'starting'. */
  register(message?: string): void;
  /** Publish a healthy state (status 'ok'). Bus coerces to 'recovering' if previously degraded/failed. */
  publishOk(message?: string, metrics?: StoreMetrics): void;
  /** Publish an updated message/metrics without changing status — for state transitions per §7.2. */
  publishMetrics(message?: string, metrics?: StoreMetrics): void;
  /** Emit a STORE-* code at warn severity (bus → degraded). */
  warn(code: ErrorCode, context?: Record<string, unknown>, cause?: unknown): void;
  /** Emit a STORE-* code at error severity (bus → failed). */
  error(code: ErrorCode, context?: Record<string, unknown>, cause?: unknown): void;
}

/**
 * @param subsystem Bus subsystem id, e.g. 'storeHutch'.
 * @param storeName Short id attached as `context.store` on every STORE-* code, e.g. 'hutch'.
 */
export function createStoreDiagnostics(
  subsystem: Subsystem,
  storeName: string,
): StoreDiagnostics {
  const logger = createNamedLogger(subsystem);

  function buildSharedError(
    code: ErrorCode,
    severity: Severity,
    context?: Record<string, unknown>,
    cause?: unknown,
  ): QpmError {
    const mergedContext = { store: storeName, ...(context ?? {}) };
    const built = buildError(code, mergedContext, cause);
    // Override placeholder subsystem/severity so bus rows attribute correctly.
    return { ...built, subsystem, severity };
  }

  return {
    subsystem,
    log: logger,
    register(message): void {
      healthBus.register(subsystem, {
        category: 'store',
        status: 'starting',
        ...(message === undefined ? {} : { message }),
      });
    },
    publishOk(message, metrics): void {
      healthBus.publish({
        subsystem,
        category: 'store',
        status: 'ok',
        ...(message === undefined ? {} : { message }),
        ...(metrics === undefined ? {} : { metrics }),
      });
    },
    publishMetrics(message, metrics): void {
      const input: Parameters<typeof healthBus.publish>[0] = {
        subsystem,
        category: 'store',
      };
      if (message !== undefined) input.message = message;
      if (metrics !== undefined) input.metrics = metrics;
      healthBus.publish(input);
    },
    warn(code, context, cause): void {
      logger.warn(buildSharedError(code, 'warn', context, cause));
    },
    error(code, context, cause): void {
      logger.error(buildSharedError(code, 'error', context, cause));
    },
  };
}

/** Re-export for callers that want to type their own state transitions. */
export type { SubsystemHealth };
