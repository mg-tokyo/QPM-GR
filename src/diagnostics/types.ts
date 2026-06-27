// src/diagnostics/types.ts — Diagnostics core types (Phase 1, design §5)

/**
 * Subsystem identifier — the canonical list lives in the design's §4.4 registry
 * table. New subsystems are added here as they register with the bus.
 *
 * Naming conventions (see §5.1):
 *   core         — camelCase module name      e.g. atomRegistry
 *   store        — `store{Name}`              e.g. storeHutch
 *   ui           — dotted `ui.{area}`         e.g. ui.window
 *   integration  — `integration{Name}`        e.g. integrationAries
 *   service      — `service{Name}`            e.g. serviceAriesPlayers
 *   feature      — colon-prefixed              e.g. feature:petSwap
 *
 * Filtering across the bus is by the `category` field on SubsystemHealth, not
 * by string-parsing the identifier.
 */
export type Subsystem = string;

export type SubsystemCategory = 'core' | 'store' | 'ui' | 'integration' | 'service' | 'feature';

export type SubsystemStatus = 'starting' | 'ok' | 'recovering' | 'degraded' | 'failed';

export type ErrorCode = `QPM-${string}-${string}`;

export type Severity = 'info' | 'warn' | 'error' | 'fatal';

export interface ErrorCodeDefinition {
  readonly code: ErrorCode;
  readonly subsystem: Subsystem;
  readonly category: SubsystemCategory;
  readonly severity: Severity;
  readonly title: string;
  readonly description: string;
  readonly userAction?: string;
  readonly devNotes?: string;
  readonly sinceVersion?: string;
  /** Per-§9: codes default to false; flip to true only with all 3 criteria. */
  readonly notifyUser?: boolean;
  /** Override the per-severity default throttle (ms). */
  readonly notifyThrottleMs?: number;
}

export interface QpmError {
  readonly code: ErrorCode;
  readonly subsystem: Subsystem;
  readonly severity: Severity;
  readonly message: string;
  readonly context?: Record<string, unknown>;
  readonly cause?: unknown;
  readonly timestamp: number;
}

export type Result<T, E = QpmError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export interface SubsystemHealth {
  readonly subsystem: Subsystem;
  readonly category: SubsystemCategory;
  readonly status: SubsystemStatus;
  readonly message?: string;
  readonly lastError?: QpmError;
  readonly metrics?: Readonly<Record<string, number | string>>;
  readonly lastUpdate: number;
}

/** Public read-only contract exposed as window.QPM_DIAGNOSTICS_V1 (§11). */
export interface DiagnosticsPublicApi {
  readonly version: string;
  readonly healthBus: {
    read(subsystem: Subsystem): SubsystemHealth | undefined;
    readAll(): readonly SubsystemHealth[];
    subscribe(cb: (h: SubsystemHealth) => void): () => void;
    aggregate(): 'ok' | 'degraded' | 'failed';
  };
  readonly codes: {
    lookup(code: ErrorCode): ErrorCodeDefinition | undefined;
  };
}

/** Aggregate status — recovering counts as degraded (§7.1). */
export type AggregateStatus = 'ok' | 'degraded' | 'failed';

export interface ErrorBufferEntry {
  readonly code: ErrorCode;
  readonly subsystem: Subsystem;
  readonly severity: Severity;
  readonly message: string;
  readonly context?: Record<string, unknown>;
  readonly causeText?: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
}
