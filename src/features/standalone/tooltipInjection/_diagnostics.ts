// Shared diagnostics wiring for the tooltip-injection feature. Internal to
// the folder — not re-exported from index.ts to avoid circular imports (atoms
// / observer / journalBadges all need warnFeature and index.ts imports them).

import { createNamedLogger } from '../../../diagnostics/logger';
import { healthBus } from '../../../diagnostics/healthBus';
import { buildError } from '../../../diagnostics/result';
import type { ErrorCode, Subsystem } from '../../../diagnostics/types';

export const TOOLTIP_INJECTION_SUBSYSTEM: Subsystem = 'feature:tooltipInjection';
const FEATURE_NAME = 'tooltipInjection';

export const diag = createNamedLogger(TOOLTIP_INJECTION_SUBSYSTEM);

let busRegistered = false;

export function ensureBusRegistered(): void {
  if (busRegistered) return;
  busRegistered = true;
  healthBus.register(TOOLTIP_INJECTION_SUBSYSTEM, {
    category: 'feature',
    status: 'starting',
  });
}

export function publishOk(
  message: string,
  metrics?: Record<string, number | string>,
): void {
  healthBus.publish({
    subsystem: TOOLTIP_INJECTION_SUBSYSTEM,
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
  diag.warn({ ...built, subsystem: TOOLTIP_INJECTION_SUBSYSTEM, severity: 'warn' });
}
