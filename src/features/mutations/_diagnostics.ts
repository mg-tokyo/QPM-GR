// Shared diagnostics wiring for the mutation-value-tracking feature.
// Internal to src/features/mutations/ — not re-exported. Only used by
// valueTracking.ts today; the mutation-reminder pipeline (tracker.ts +
// reminder/*) has its own subsystem in reminder/_diagnostics.ts.

import { createNamedLogger } from '../../diagnostics/logger';
import { healthBus } from '../../diagnostics/healthBus';
import { buildError } from '../../diagnostics/result';
import type { ErrorCode, Subsystem } from '../../diagnostics/types';

export const MUTATION_VALUE_TRACKING_SUBSYSTEM: Subsystem = 'feature:mutationValueTracking';
const FEATURE_NAME = 'mutationValueTracking';

export const valueDiag = createNamedLogger(MUTATION_VALUE_TRACKING_SUBSYSTEM);

let busRegistered = false;

export function ensureValueTrackingBusRegistered(): void {
  if (busRegistered) return;
  busRegistered = true;
  healthBus.register(MUTATION_VALUE_TRACKING_SUBSYSTEM, {
    category: 'feature',
    status: 'starting',
  });
}

export function publishValueTrackingOk(
  message: string,
  metrics?: Record<string, number | string>,
): void {
  ensureValueTrackingBusRegistered();
  healthBus.publish({
    subsystem: MUTATION_VALUE_TRACKING_SUBSYSTEM,
    category: 'feature',
    status: 'ok',
    message,
    ...(metrics ? { metrics } : {}),
  });
}

export function warnValueTrackingFeature(
  code: ErrorCode,
  ctx: Record<string, unknown>,
  cause?: unknown,
): void {
  ensureValueTrackingBusRegistered();
  const built = buildError(code, { feature: FEATURE_NAME, ...ctx }, cause);
  valueDiag.warn({ ...built, subsystem: MUTATION_VALUE_TRACKING_SUBSYSTEM, severity: 'warn' });
}
