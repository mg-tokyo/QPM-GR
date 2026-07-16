// Shared diagnostics wiring for the shop enhancer feature. Internal to the
// enhancer/ folder — not re-exported from index.ts.

import { createNamedLogger } from '../../../diagnostics/logger';
import { healthBus } from '../../../diagnostics/healthBus';
import { buildError } from '../../../diagnostics/result';
import type { ErrorCode, Subsystem } from '../../../diagnostics/types';

export const SHOP_ENHANCER_SUBSYSTEM: Subsystem = 'feature:shopEnhancer';
const FEATURE_NAME = 'shopEnhancer';

export const diag = createNamedLogger(SHOP_ENHANCER_SUBSYSTEM);

let busRegistered = false;

export function ensureBusRegistered(): void {
  if (busRegistered) return;
  busRegistered = true;
  healthBus.register(SHOP_ENHANCER_SUBSYSTEM, {
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
    subsystem: SHOP_ENHANCER_SUBSYSTEM,
    category: 'feature',
    status: 'ok',
    message,
    ...(metrics ? { metrics } : {}),
  });
}

/** Re-attribute FEATURE-* codes (whose declared subsystem is the generic 'feature' placeholder) to feature:shopEnhancer. */
export function warnFeature(
  code: ErrorCode,
  ctx: Record<string, unknown>,
  cause?: unknown,
): void {
  ensureBusRegistered();
  const built = buildError(code, { feature: FEATURE_NAME, ...ctx }, cause);
  diag.warn({ ...built, subsystem: SHOP_ENHANCER_SUBSYSTEM, severity: 'warn' });
}
