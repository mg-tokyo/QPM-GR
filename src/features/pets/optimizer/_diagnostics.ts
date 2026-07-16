// Shared diagnostics wiring for the pet-optimizer feature (feature:petOptimizer).
// Internal to the folder — not re-exported from index.ts. Mirrors the
// pets/turtleTimer/_diagnostics.ts precedent (row 6.11 session 2).

import { createNamedLogger } from '../../../diagnostics/logger';
import { healthBus } from '../../../diagnostics/healthBus';
import { buildError } from '../../../diagnostics/result';
import type { ErrorCode, Subsystem } from '../../../diagnostics/types';

export const PET_OPTIMIZER_SUBSYSTEM: Subsystem = 'feature:petOptimizer';
const FEATURE_NAME = 'petOptimizer';

export const diag = createNamedLogger(PET_OPTIMIZER_SUBSYSTEM);

let busRegistered = false;

export function ensureBusRegistered(): void {
  if (busRegistered) return;
  busRegistered = true;
  healthBus.register(PET_OPTIMIZER_SUBSYSTEM, {
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
    subsystem: PET_OPTIMIZER_SUBSYSTEM,
    category: 'feature',
    status: 'ok',
    message,
    ...(metrics ? { metrics } : {}),
  });
}

/** Re-attribute FEATURE-* codes (whose registry subsystem is the generic 'feature' placeholder) to feature:petOptimizer. */
export function warnFeature(
  code: ErrorCode,
  ctx: Record<string, unknown>,
  cause?: unknown,
): void {
  ensureBusRegistered();
  const built = buildError(code, { feature: FEATURE_NAME, ...ctx }, cause);
  diag.warn({ ...built, subsystem: PET_OPTIMIZER_SUBSYSTEM, severity: 'warn' });
}
