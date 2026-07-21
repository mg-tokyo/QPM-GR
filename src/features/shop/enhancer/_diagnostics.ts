// Shared diagnostics wiring for the shop enhancer feature. Internal to the
// enhancer/ folder — not re-exported from index.ts.

import { createFeatureDiagnostics } from '../../../diagnostics/featureDiagnostics';
import type { Subsystem } from '../../../diagnostics/types';

export const SHOP_ENHANCER_SUBSYSTEM: Subsystem = 'feature:shopEnhancer';

const d = createFeatureDiagnostics(SHOP_ENHANCER_SUBSYSTEM, 'shopEnhancer');

export const diag = d.diag;
export const ensureBusRegistered = d.ensureBusRegistered;
export const publishOk = d.publishOk;
export const warnFeature = d.warnFeature;
