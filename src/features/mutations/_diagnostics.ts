// Shared diagnostics wiring for the mutation-value-tracking feature.
// Internal to src/features/mutations/ — not re-exported. Only used by
// valueTracking.ts today; the mutation-reminder pipeline (tracker.ts +
// reminder/*) has its own subsystem in reminder/_diagnostics.ts.

import { createFeatureDiagnostics } from '../../diagnostics/featureDiagnostics';
import type { Subsystem } from '../../diagnostics/types';

export const MUTATION_VALUE_TRACKING_SUBSYSTEM: Subsystem = 'feature:mutationValueTracking';

const d = createFeatureDiagnostics(MUTATION_VALUE_TRACKING_SUBSYSTEM, 'mutationValueTracking');

export const valueDiag = d.diag;
export const ensureValueTrackingBusRegistered = d.ensureBusRegistered;
export const publishValueTrackingOk = d.publishOk;
export const warnValueTrackingFeature = d.warnFeature;
