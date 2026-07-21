// Shared diagnostics wiring for the root pets action features (feature:petActions).
// Internal to src/features/pets/ — not re-exported. Covers swap, instantFeed,
// teamActions, sell, sellAll, cropBoostTracker, nativeFeedIntercept.

import { createFeatureDiagnostics } from '../../diagnostics/featureDiagnostics';
import type { Subsystem } from '../../diagnostics/types';

export const PET_ACTIONS_SUBSYSTEM: Subsystem = 'feature:petActions';

const d = createFeatureDiagnostics(PET_ACTIONS_SUBSYSTEM, 'petActions');

export const diag = d.diag;
export const ensureBusRegistered = d.ensureBusRegistered;
export const publishOk = d.publishOk;
export const warnFeature = d.warnFeature;
