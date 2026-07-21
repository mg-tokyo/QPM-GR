// Shared diagnostics wiring for feature:shopRestockAlerts. Scoped to this
// folder's alert lifecycle (in-game restock notifications, sound engine,
// ownership tracking, purchase workflow). The sibling restock window pair
// (../restockWindow.ts, ../restockWindowMeta.ts) uses a separate id
// (feature:shopRestockWindow) via ../restockWindowDiagnostics.ts — the two
// surfaces can break independently in user-visible ways.
// Internal — not re-exported from any index.

import { createFeatureDiagnostics } from '../../../diagnostics/featureDiagnostics';
import type { Subsystem } from '../../../diagnostics/types';

export const SHOP_RESTOCK_ALERTS_SUBSYSTEM: Subsystem = 'feature:shopRestockAlerts';

const d = createFeatureDiagnostics(SHOP_RESTOCK_ALERTS_SUBSYSTEM, 'shopRestockAlerts');

export const diag = d.diag;
export const ensureBusRegistered = d.ensureBusRegistered;
export const publishOk = d.publishOk;
export const warnFeature = d.warnFeature;
