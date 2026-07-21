// Shared diagnostics wiring for the controller feature (feature:controller).
// Internal to src/features/input/controller/ — not re-exported. Covers index,
// controllerFeature, controllerContext, bindings, gamepad.

import { createFeatureDiagnostics } from '../../../diagnostics/featureDiagnostics';
import type { Subsystem } from '../../../diagnostics/types';

export const CONTROLLER_SUBSYSTEM: Subsystem = 'feature:controller';

const d = createFeatureDiagnostics(CONTROLLER_SUBSYSTEM, 'controller');

export const diag = d.diag;
export const ensureBusRegistered = d.ensureBusRegistered;
export const publishOk = d.publishOk;
export const warnFeature = d.warnFeature;
