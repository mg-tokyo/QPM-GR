// src/diagnostics/logger.ts — Named loggers + transports (§6)
//
// This is the single allowed home for raw console.* in the codebase.
// Every other file must use a named logger.

import { notify } from '../core/notifications';
import { readSharedGlobal, shareGlobal } from '../core/pageContext';
import { lookupCode } from './codes';
import { errorBuffer } from './errorBuffer';
import { healthBus } from './healthBus';
import { buildError } from './result';
import type {
  ErrorCode,
  ErrorCodeDefinition,
  QpmError,
  Severity,
} from './types';

// Local helper type — keeps the external types.ts free of UI concerns.
export type NotificationLevel = 'info' | 'success' | 'warn' | 'error';

const VERBOSE_LOGS_FLAG = '__QPM_VERBOSE_LOGS';

const SEVERITY_THROTTLE_MS: Record<Severity, number> = {
  info: 60_000,
  warn: 30_000,
  error: 10_000,
  fatal: 0,
};

const lastNotifiedAt = new Map<ErrorCode, number>();

export function isVerboseLogsEnabled(): boolean {
  return readSharedGlobal<boolean>(VERBOSE_LOGS_FLAG) === true;
}

export function setVerboseLogsEnabled(enabled: boolean): void {
  shareGlobal(VERBOSE_LOGS_FLAG, enabled);
}

/**
 * Variadic console write used by the legacy `utils/logger.ts` shim so the
 * "no raw console.* outside src/diagnostics/logger.ts" rule holds while
 * still producing the historical `[prefix] arg1 arg2 ...` formatting.
 * Not for use by new code — reach for createNamedLogger() instead.
 */
export function writeShimConsole(prefix: string, args: readonly unknown[]): void {
  // eslint-disable-next-line no-console
  console.log(`[${prefix}]`, ...args);
}

function severityToConsole(severity: Severity): (...args: unknown[]) => void {
  switch (severity) {
    case 'info': return console.log.bind(console);
    case 'warn': return console.warn.bind(console);
    case 'error':
    case 'fatal': return console.error.bind(console);
  }
}

function severityToNotificationLevel(severity: Severity): NotificationLevel {
  switch (severity) {
    case 'info': return 'info';
    case 'warn': return 'warn';
    case 'error':
    case 'fatal': return 'error';
  }
}

function shouldNotify(def: ErrorCodeDefinition): boolean {
  if (!def.notifyUser) return false;
  const throttleMs = def.notifyThrottleMs ?? SEVERITY_THROTTLE_MS[def.severity];
  if (throttleMs <= 0) return true; // fatal default
  const last = lastNotifiedAt.get(def.code);
  const now = Date.now();
  if (last !== undefined && now - last < throttleMs) return false;
  lastNotifiedAt.set(def.code, now);
  return true;
}

function fanOut(error: QpmError, prefix: string): void {
  // 1) console transport
  const consoleFn = severityToConsole(error.severity);
  const verbose = isVerboseLogsEnabled();
  // For info/debug-equivalent, gate on verbose; warn+ always print.
  if (error.severity === 'info' && !verbose) {
    // skip console for info unless verbose
  } else {
    if (error.context !== undefined || error.cause !== undefined) {
      const detail: Record<string, unknown> = {};
      if (error.context !== undefined) detail.context = error.context;
      if (error.cause !== undefined) detail.cause = error.cause;
      consoleFn(`[${prefix}] ${error.code} ${error.message}`, detail);
    } else {
      consoleFn(`[${prefix}] ${error.code} ${error.message}`);
    }
  }

  // 2) error-buffer transport (skip pure info to keep buffer signal-heavy)
  if (error.severity !== 'info') {
    errorBuffer.record(error);
  }

  // 3) health-bus transport — degrade the subsystem per severity.
  const def = lookupCode(error.code);
  if (def) {
    const status =
      def.severity === 'fatal' ? 'failed'
      : def.severity === 'error' ? 'failed'
      : def.severity === 'warn' ? 'degraded'
      : undefined;
    if (status) {
      healthBus.publish({
        subsystem: error.subsystem,
        category: def.category,
        status,
        lastError: error,
      });
    }

    // 4) notification transport (gated per §9)
    if (shouldNotify(def)) {
      try {
        notify({
          feature: error.subsystem,
          level: severityToNotificationLevel(error.severity),
          message: `${def.title} (${error.code})`,
        });
      } catch {
        // notify is best-effort.
      }
    }
  }
}

export interface NamedLogger {
  readonly name: string;
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(code: ErrorCode, context?: Record<string, unknown>, cause?: unknown): void;
  warn(error: QpmError): void;
  error(code: ErrorCode, context?: Record<string, unknown>, cause?: unknown): void;
  error(error: QpmError): void;
  fatal(code: ErrorCode, context?: Record<string, unknown>, cause?: unknown): void;
  fatal(error: QpmError): void;
}

function isQpmError(x: unknown): x is QpmError {
  return !!x && typeof x === 'object'
    && typeof (x as QpmError).code === 'string'
    && typeof (x as QpmError).subsystem === 'string'
    && typeof (x as QpmError).severity === 'string';
}

function resolveError(
  forced: Severity,
  arg1: ErrorCode | QpmError,
  arg2?: Record<string, unknown>,
  cause?: unknown,
): QpmError {
  if (isQpmError(arg1)) return arg1;
  const built = buildError(arg1 as ErrorCode, arg2, cause);
  // Force severity to match the logger method called (warn/error/fatal).
  if (built.severity !== forced) {
    return { ...built, severity: forced };
  }
  return built;
}

export function createNamedLogger(name: string): NamedLogger {
  const writeConsole = (message: string, context?: Record<string, unknown>): void => {
    if (context !== undefined) {
      // eslint-disable-next-line no-console
      console.log(`[${name}]`, message, context);
    } else {
      // eslint-disable-next-line no-console
      console.log(`[${name}]`, message);
    }
  };

  return {
    name,

    debug(message: string, context?: Record<string, unknown>): void {
      if (!isVerboseLogsEnabled()) return;
      writeConsole(message, context);
    },

    info(message: string, context?: Record<string, unknown>): void {
      writeConsole(message, context);
    },

    warn(
      codeOrError: ErrorCode | QpmError,
      context?: Record<string, unknown>,
      cause?: unknown,
    ): void {
      const error = resolveError('warn', codeOrError, context, cause);
      fanOut(error, name);
    },

    error(
      codeOrError: ErrorCode | QpmError,
      context?: Record<string, unknown>,
      cause?: unknown,
    ): void {
      const error = resolveError('error', codeOrError, context, cause);
      fanOut(error, name);
    },

    fatal(
      codeOrError: ErrorCode | QpmError,
      context?: Record<string, unknown>,
      cause?: unknown,
    ): void {
      const error = resolveError('fatal', codeOrError, context, cause);
      fanOut(error, name);
    },
  };
}
