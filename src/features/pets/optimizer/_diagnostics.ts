// Shared diagnostics wiring for the pet-optimizer feature (feature:petOptimizer).
// Internal to the folder — not re-exported from index.ts.

import { createFeatureDiagnostics } from '../../../diagnostics/featureDiagnostics';
import type { Subsystem } from '../../../diagnostics/types';

export const PET_OPTIMIZER_SUBSYSTEM: Subsystem = 'feature:petOptimizer';

const d = createFeatureDiagnostics(PET_OPTIMIZER_SUBSYSTEM, 'petOptimizer');

export const diag = d.diag;
export const ensureBusRegistered = d.ensureBusRegistered;
export const publishOk = d.publishOk;
export const warnFeature = d.warnFeature;
