// Internal — not re-exported from index.ts. Sibling files (helpers.ts +
// index.ts) need warnRiveEngine / publishOk without pulling helpers.ts's
// runtime deps back into the diagnostics module.

import { healthBus } from '../diagnostics/healthBus';
import { createNamedLogger } from '../diagnostics/logger';
import { buildError } from '../diagnostics/result';
import type { ErrorCode, Subsystem } from '../diagnostics/types';

export const RIVE_ENGINE_SUBSYSTEM: Subsystem = 'riveEngine';
export const diag = createNamedLogger(RIVE_ENGINE_SUBSYSTEM);

let busRegistered = false;

function ensureBusRegistered(): void {
  if (busRegistered) return;
  busRegistered = true;
  healthBus.register(RIVE_ENGINE_SUBSYSTEM, {
    category: 'core',
    status: 'starting',
    message: 'Awaiting runtime capture',
  });
}

export function startRiveEngineDiagnostics(): void {
  ensureBusRegistered();
}

export function publishOk(
  message: string,
  metrics?: Record<string, number | string>,
): void {
  ensureBusRegistered();
  healthBus.publish({
    subsystem: RIVE_ENGINE_SUBSYSTEM,
    category: 'core',
    status: 'ok',
    message,
    ...(metrics ? { metrics } : {}),
  });
}

export function warnRiveEngine(
  code: ErrorCode,
  context: Record<string, unknown>,
  cause?: unknown,
): void {
  ensureBusRegistered();
  const built = buildError(code, context, cause);
  diag.warn({ ...built, subsystem: RIVE_ENGINE_SUBSYSTEM, severity: 'warn' });
}
