// Shared diagnostics wiring for the garden-filters feature. Internal to
// the folder — not re-exported from index.ts to avoid circular imports
// (controller/pixiStage/speciesView all need warnFeature and index.ts
// imports them).

import { createNamedLogger } from '../../../diagnostics/logger';
import { healthBus } from '../../../diagnostics/healthBus';
import { buildError } from '../../../diagnostics/result';
import type { ErrorCode, Subsystem } from '../../../diagnostics/types';

export const GARDEN_FILTERS_SUBSYSTEM: Subsystem = 'feature:gardenFilters';
const FEATURE_NAME = 'gardenFilters';

export const diag = createNamedLogger(GARDEN_FILTERS_SUBSYSTEM);

let busRegistered = false;

export function ensureBusRegistered(): void {
  if (busRegistered) return;
  busRegistered = true;
  healthBus.register(GARDEN_FILTERS_SUBSYSTEM, {
    category: 'feature',
    status: 'starting',
  });
}

export function publishOk(
  message: string,
  metrics?: Record<string, number | string>,
): void {
  healthBus.publish({
    subsystem: GARDEN_FILTERS_SUBSYSTEM,
    category: 'feature',
    status: 'ok',
    message,
    ...(metrics ? { metrics } : {}),
  });
}

export function warnFeature(
  code: ErrorCode,
  ctx: Record<string, unknown>,
  cause?: unknown,
): void {
  ensureBusRegistered();
  const built = buildError(code, { feature: FEATURE_NAME, ...ctx }, cause);
  diag.warn({ ...built, subsystem: GARDEN_FILTERS_SUBSYSTEM, severity: 'warn' });
}
