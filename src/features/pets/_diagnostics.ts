// Shared diagnostics wiring for the root pets action features (feature:petActions).
// Internal to src/features/pets/ — not re-exported. Covers swap, instantFeed,
// teamActions, sell, sellAll, cropBoostTracker, nativeFeedIntercept.

import { createNamedLogger } from '../../diagnostics/logger';
import { healthBus } from '../../diagnostics/healthBus';
import { buildError } from '../../diagnostics/result';
import type { ErrorCode, Subsystem } from '../../diagnostics/types';

export const PET_ACTIONS_SUBSYSTEM: Subsystem = 'feature:petActions';
const FEATURE_NAME = 'petActions';

export const diag = createNamedLogger(PET_ACTIONS_SUBSYSTEM);

let busRegistered = false;

export function ensureBusRegistered(): void {
  if (busRegistered) return;
  busRegistered = true;
  healthBus.register(PET_ACTIONS_SUBSYSTEM, {
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
    subsystem: PET_ACTIONS_SUBSYSTEM,
    category: 'feature',
    status: 'ok',
    message,
    ...(metrics ? { metrics } : {}),
  });
}

/** Re-attribute FEATURE-* codes (whose declared subsystem is the generic 'feature' placeholder) to feature:petActions. */
export function warnFeature(
  code: ErrorCode,
  ctx: Record<string, unknown>,
  cause?: unknown,
): void {
  ensureBusRegistered();
  const built = buildError(code, { feature: FEATURE_NAME, ...ctx }, cause);
  diag.warn({ ...built, subsystem: PET_ACTIONS_SUBSYSTEM, severity: 'warn' });
}
