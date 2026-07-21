// Shared diagnostics wiring for the activity-log native enhancer feature.
// Internal to the folder — not re-exported from index.ts to avoid circular
// imports (modal / patchHooks all need warnFeature and index.ts imports them).

import { createFeatureDiagnostics } from '../../../diagnostics/featureDiagnostics';
import type { Subsystem } from '../../../diagnostics/types';

export const ACTIVITY_LOG_SUBSYSTEM: Subsystem = 'feature:activityLog';

const d = createFeatureDiagnostics(ACTIVITY_LOG_SUBSYSTEM, 'activityLog');

export const diag = d.diag;
export const ensureBusRegistered = d.ensureBusRegistered;
export const publishOk = d.publishOk;
export const warnFeature = d.warnFeature;
