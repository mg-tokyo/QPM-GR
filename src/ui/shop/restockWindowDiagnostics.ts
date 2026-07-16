// Shared diagnostics wiring for feature:shopRestockWindow. Scoped to the
// Shop Restock schedule window (restockWindow.ts + restockWindowMeta.ts),
// whose failure surface is the external Ariedam /data fetch + the per-refresh
// fetchRestockData call. Separate id from feature:shopRestockAlerts
// (restockAlerts/_diagnostics.ts) because the two surfaces can break
// independently: Ariedam DNS failure ≠ sound engine autoplay-blocked ≠
// ownership listener throw. Internal — not re-exported.

import { createNamedLogger } from '../../diagnostics/logger';
import { healthBus } from '../../diagnostics/healthBus';
import { buildError } from '../../diagnostics/result';
import type { ErrorCode, Subsystem } from '../../diagnostics/types';

export const SHOP_RESTOCK_WINDOW_SUBSYSTEM: Subsystem = 'feature:shopRestockWindow';
const FEATURE_NAME = 'shopRestockWindow';

export const diag = createNamedLogger(SHOP_RESTOCK_WINDOW_SUBSYSTEM);

let busRegistered = false;

export function ensureBusRegistered(): void {
  if (busRegistered) return;
  busRegistered = true;
  healthBus.register(SHOP_RESTOCK_WINDOW_SUBSYSTEM, {
    category: 'feature',
    status: 'starting',
  });
}

/** Re-attribute FEATURE-* codes (placeholder subsystem: 'feature') to feature:shopRestockWindow. */
export function warnFeature(
  code: ErrorCode,
  ctx: Record<string, unknown>,
  cause?: unknown,
): void {
  ensureBusRegistered();
  const built = buildError(code, { feature: FEATURE_NAME, ...ctx }, cause);
  diag.warn({ ...built, subsystem: SHOP_RESTOCK_WINDOW_SUBSYSTEM, severity: 'warn' });
}
