// src/diagnostics/consoleSink.ts — Recursion-safe console writes for
// diagnostics infrastructure that cannot route through the named-logger
// pipeline without forming a cycle (logger → bus → subscriber → logger).
//
// This sits alongside `logger.ts` in `src/diagnostics/` so it satisfies the
// "no raw console.* outside src/diagnostics/" rule from the design.

export function writeInfrastructureWarn(prefix: string, message: string, detail?: unknown): void {
  if (detail !== undefined) {
    // eslint-disable-next-line no-console
    console.warn(`[${prefix}] ${message}`, detail);
    return;
  }
  // eslint-disable-next-line no-console
  console.warn(`[${prefix}] ${message}`);
}

export function writeInfrastructureError(prefix: string, message: string, detail?: unknown): void {
  if (detail !== undefined) {
    // eslint-disable-next-line no-console
    console.error(`[${prefix}] ${message}`, detail);
    return;
  }
  // eslint-disable-next-line no-console
  console.error(`[${prefix}] ${message}`);
}
