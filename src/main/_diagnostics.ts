// Shared diagnostics wiring for boot phases (row 6.22). Internal to
// src/main — not re-exported from any barrel; phases.ts and globalApis.ts
// import it directly.

import { createNamedLogger } from '../diagnostics/logger';
import { healthBus } from '../diagnostics/healthBus';
import type { ErrorCode, Subsystem } from '../diagnostics/types';

export const INIT_SUBSYSTEM: Subsystem = 'init';

export const diag = createNamedLogger(INIT_SUBSYSTEM);

let busRegistered = false;

export function ensureBusRegistered(): void {
  if (busRegistered) return;
  busRegistered = true;
  healthBus.register(INIT_SUBSYSTEM, {
    category: 'core',
    status: 'starting',
  });
}

export function publishOk(
  message: string,
  metrics?: Record<string, number | string>,
): void {
  ensureBusRegistered();
  healthBus.publish({
    subsystem: INIT_SUBSYSTEM,
    category: 'core',
    status: 'ok',
    message,
    ...(metrics ? { metrics } : {}),
  });
}

export function warnCore(
  code: ErrorCode,
  ctx: Record<string, unknown>,
  cause?: unknown,
): void {
  ensureBusRegistered();
  diag.warn(code, ctx, cause);
}
