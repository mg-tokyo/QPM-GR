// Shared diagnostics wiring for the turtle-timer feature (feature:turtleTimer).
// Internal to the folder — not re-exported from index.ts. Mirrors the
// pets/_diagnostics.ts precedent (row 6.11 session 1).

import { createNamedLogger } from '../../../diagnostics/logger';
import { healthBus } from '../../../diagnostics/healthBus';
import { buildError } from '../../../diagnostics/result';
import type { ErrorCode, Subsystem } from '../../../diagnostics/types';

export const TURTLE_TIMER_SUBSYSTEM: Subsystem = 'feature:turtleTimer';
const FEATURE_NAME = 'turtleTimer';

export const diag = createNamedLogger(TURTLE_TIMER_SUBSYSTEM);

let busRegistered = false;

export function ensureBusRegistered(): void {
  if (busRegistered) return;
  busRegistered = true;
  healthBus.register(TURTLE_TIMER_SUBSYSTEM, {
    category: 'feature',
    status: 'starting',
  });
}

export function publishOk(
  message: string,
  metrics?: Record<string, number | string>,
): void {
  ensureBusRegistered();
  healthBus.publish({
    subsystem: TURTLE_TIMER_SUBSYSTEM,
    category: 'feature',
    status: 'ok',
    message,
    ...(metrics ? { metrics } : {}),
  });
}

/** Re-attribute FEATURE-* codes (whose registry subsystem is the generic 'feature' placeholder) to feature:turtleTimer. */
export function warnFeature(
  code: ErrorCode,
  ctx: Record<string, unknown>,
  cause?: unknown,
): void {
  ensureBusRegistered();
  const built = buildError(code, { feature: FEATURE_NAME, ...ctx }, cause);
  diag.warn({ ...built, subsystem: TURTLE_TIMER_SUBSYSTEM, severity: 'warn' });
}
