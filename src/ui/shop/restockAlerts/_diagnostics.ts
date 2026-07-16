// Shared diagnostics wiring for feature:shopRestockAlerts. Scoped to this
// folder's alert lifecycle (in-game restock notifications, sound engine,
// ownership tracking, purchase workflow). The sibling restock window pair
// (../restockWindow.ts, ../restockWindowMeta.ts) uses a separate id
// (feature:shopRestockWindow) via ../restockWindowDiagnostics.ts — the two
// surfaces can break independently in user-visible ways.
// Internal — not re-exported from any index.

import { createNamedLogger } from '../../../diagnostics/logger';
import { healthBus } from '../../../diagnostics/healthBus';
import { buildError } from '../../../diagnostics/result';
import type { ErrorCode, Subsystem } from '../../../diagnostics/types';

export const SHOP_RESTOCK_ALERTS_SUBSYSTEM: Subsystem = 'feature:shopRestockAlerts';
const FEATURE_NAME = 'shopRestockAlerts';

export const diag = createNamedLogger(SHOP_RESTOCK_ALERTS_SUBSYSTEM);

let busRegistered = false;

export function ensureBusRegistered(): void {
  if (busRegistered) return;
  busRegistered = true;
  healthBus.register(SHOP_RESTOCK_ALERTS_SUBSYSTEM, {
    category: 'feature',
    status: 'starting',
  });
}

export function publishOk(message: string): void {
  ensureBusRegistered();
  healthBus.publish({
    subsystem: SHOP_RESTOCK_ALERTS_SUBSYSTEM,
    category: 'feature',
    status: 'ok',
    message,
  });
}

/** Re-attribute FEATURE-* codes (placeholder subsystem: 'feature') to feature:shopRestockAlerts. */
export function warnFeature(
  code: ErrorCode,
  ctx: Record<string, unknown>,
  cause?: unknown,
): void {
  ensureBusRegistered();
  const built = buildError(code, { feature: FEATURE_NAME, ...ctx }, cause);
  diag.warn({ ...built, subsystem: SHOP_RESTOCK_ALERTS_SUBSYSTEM, severity: 'warn' });
}
