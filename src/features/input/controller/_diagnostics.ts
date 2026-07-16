// Shared diagnostics wiring for the controller feature (feature:controller).
// Internal to src/features/input/controller/ — not re-exported. Covers index,
// controllerFeature, controllerContext, bindings, gamepad.

import { createNamedLogger } from '../../../diagnostics/logger';
import { healthBus } from '../../../diagnostics/healthBus';
import { buildError } from '../../../diagnostics/result';
import type { ErrorCode, Subsystem } from '../../../diagnostics/types';

export const CONTROLLER_SUBSYSTEM: Subsystem = 'feature:controller';
const FEATURE_NAME = 'controller';

export const diag = createNamedLogger(CONTROLLER_SUBSYSTEM);

let busRegistered = false;

export function ensureBusRegistered(): void {
  if (busRegistered) return;
  busRegistered = true;
  healthBus.register(CONTROLLER_SUBSYSTEM, {
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
    subsystem: CONTROLLER_SUBSYSTEM,
    category: 'feature',
    status: 'ok',
    message,
    ...(metrics ? { metrics } : {}),
  });
}

/** Re-attribute FEATURE-* codes (declared subsystem 'feature' placeholder) to feature:controller. */
export function warnFeature(
  code: ErrorCode,
  ctx: Record<string, unknown>,
  cause?: unknown,
): void {
  ensureBusRegistered();
  const built = buildError(code, { feature: FEATURE_NAME, ...ctx }, cause);
  diag.warn({ ...built, subsystem: CONTROLLER_SUBSYSTEM, severity: 'warn' });
}
