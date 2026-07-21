// Shared diagnostics wiring for the turtle-timer feature (feature:turtleTimer).
// Internal to the folder — not re-exported from index.ts.

import { createFeatureDiagnostics } from '../../../diagnostics/featureDiagnostics';
import type { Subsystem } from '../../../diagnostics/types';

export const TURTLE_TIMER_SUBSYSTEM: Subsystem = 'feature:turtleTimer';

const d = createFeatureDiagnostics(TURTLE_TIMER_SUBSYSTEM, 'turtleTimer');

export const diag = d.diag;
export const ensureBusRegistered = d.ensureBusRegistered;
export const publishOk = d.publishOk;
export const warnFeature = d.warnFeature;
