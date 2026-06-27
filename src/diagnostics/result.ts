// src/diagnostics/result.ts — Result<T, E> helpers (§5.3)

import type { ErrorCode, QpmError, Result, Severity, Subsystem } from './types';
import { lookupCode } from './codes';

export function Ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function Err(code: ErrorCode, ctx?: Record<string, unknown>, cause?: unknown): Result<never, QpmError> {
  return { ok: false, error: buildError(code, ctx, cause) };
}

export function isOk<T, E>(r: Result<T, E>): r is { ok: true; value: T } {
  return r.ok === true;
}

export function isErr<T, E>(r: Result<T, E>): r is { ok: false; error: E } {
  return r.ok === false;
}

/**
 * Build a QpmError from a registered code. Falls back to a synthetic
 * QPM-UNKNOWN-000 entry if the code is unregistered — never throws so
 * misuse cannot kill the caller.
 */
export function buildError(code: ErrorCode, ctx?: Record<string, unknown>, cause?: unknown): QpmError {
  const def = lookupCode(code);
  const subsystem: Subsystem = def?.subsystem ?? 'unknown';
  const severity: Severity = def?.severity ?? 'error';
  const message = def?.description ?? def?.title ?? code;
  const error: QpmError = {
    code,
    subsystem,
    severity,
    message,
    ...(ctx === undefined ? {} : { context: ctx }),
    ...(cause === undefined ? {} : { cause }),
    timestamp: Date.now(),
  };
  return error;
}
