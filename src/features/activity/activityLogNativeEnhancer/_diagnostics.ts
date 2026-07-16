// Shared diagnostics wiring for the activity-log native enhancer feature.
// Internal to the folder — not re-exported from index.ts to avoid circular
// imports (modal / patchHooks all need warnFeature and index.ts imports them).

import { createNamedLogger } from '../../../diagnostics/logger';
import { healthBus } from '../../../diagnostics/healthBus';
import { buildError } from '../../../diagnostics/result';
import type { ErrorCode, Subsystem } from '../../../diagnostics/types';

export const ACTIVITY_LOG_SUBSYSTEM: Subsystem = 'feature:activityLog';
const FEATURE_NAME = 'activityLog';

export const diag = createNamedLogger(ACTIVITY_LOG_SUBSYSTEM);

let busRegistered = false;

export function ensureBusRegistered(): void {
  if (busRegistered) return;
  busRegistered = true;
  healthBus.register(ACTIVITY_LOG_SUBSYSTEM, {
    category: 'feature',
    status: 'starting',
  });
}

export function publishOk(
  message: string,
  metrics?: Record<string, number | string>,
): void {
  healthBus.publish({
    subsystem: ACTIVITY_LOG_SUBSYSTEM,
    category: 'feature',
    status: 'ok',
    message,
    ...(metrics ? { metrics } : {}),
  });
}

/** Re-attribute FEATURE-* codes (whose declared subsystem is the generic 'feature' placeholder) to this feature's bus row. */
export function warnFeature(
  code: ErrorCode,
  ctx: Record<string, unknown>,
  cause?: unknown,
): void {
  const built = buildError(code, { feature: FEATURE_NAME, ...ctx }, cause);
  diag.warn({ ...built, subsystem: ACTIVITY_LOG_SUBSYSTEM, severity: 'warn' });
}
