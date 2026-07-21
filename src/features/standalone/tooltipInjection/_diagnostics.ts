// Shared diagnostics wiring for the tooltip-injection feature. Internal to
// the folder — not re-exported from index.ts to avoid circular imports (atoms
// / observer / journalBadges all need warnFeature and index.ts imports them).

import { createFeatureDiagnostics } from '../../../diagnostics/featureDiagnostics';
import type { Subsystem } from '../../../diagnostics/types';

export const TOOLTIP_INJECTION_SUBSYSTEM: Subsystem = 'feature:tooltipInjection';

const d = createFeatureDiagnostics(TOOLTIP_INJECTION_SUBSYSTEM, 'tooltipInjection');

export const diag = d.diag;
export const ensureBusRegistered = d.ensureBusRegistered;
export const publishOk = d.publishOk;
export const warnFeature = d.warnFeature;
