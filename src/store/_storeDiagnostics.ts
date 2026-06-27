// src/store/_storeDiagnostics.ts
//
// Shared diagnostics wiring for every src/store/* module (Phase 2 item 2.6).
//
// Stores share a single STORE-* code prefix (§4.4 of diagnostics-design.md);
// `context.store` distinguishes which store fired. This helper:
//   - registers the store as its own bus entry (category: 'store')
//   - publishes 'starting' / 'ok' / 'recovering' (recovery routed through the
//     bus hysteresis machine, §7.2)
//   - emits STORE-001 / STORE-002 / STORE-003 with the calling store's name
//     attached as context.store, while overriding the bus subsystem so each
//     store row is attributed correctly.
//
// Stores never call console.* — they use the returned `log` named logger for
// any debug/info chatter and the warn/error helpers for coded failures.
//
// Design constraints honoured:
//   §5.4 — category: 'store' is the canonical filter; never parse the name.
//   §6.4 — register() + publishOk()/publishMetrics() are O(1); no timers,
//          no allocations beyond the published health object.
//   §7.2 — subsystems never publish 'ok' directly out of degraded/failed
//          (the bus coerces to 'recovering' if needed).

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
 * Build a per-store diagnostics handle.
 *
 * @param subsystem  Bus subsystem id, e.g. 'storeHutch'.
 * @param storeName  Short identifier attached as `context.store` on every
 *                   STORE-* code emitted through this handle, e.g. 'hutch'.
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
    // Override the registry's placeholder subsystem so bus rows attribute to
    // the correct store entry, and force the called severity so the bus
    // status (warn → degraded, error → failed) matches the call site intent.
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
