// Shared diagnostics wiring for the garden-filters feature. Internal to
// the folder — not re-exported from index.ts to avoid circular imports
// (controller/pixiStage/speciesView all need warnFeature and index.ts
// imports them).

import { createFeatureDiagnostics } from '../../../diagnostics/featureDiagnostics';
import type { Subsystem } from '../../../diagnostics/types';

export const GARDEN_FILTERS_SUBSYSTEM: Subsystem = 'feature:gardenFilters';

const d = createFeatureDiagnostics(GARDEN_FILTERS_SUBSYSTEM, 'gardenFilters');

export const diag = d.diag;
export const ensureBusRegistered = d.ensureBusRegistered;
export const publishOk = d.publishOk;
export const warnFeature = d.warnFeature;
