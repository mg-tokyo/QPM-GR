import { healthBus } from '../../diagnostics/healthBus';
import { createNamedLogger } from '../../diagnostics/logger';
import type { Subsystem, SubsystemHealth } from '../../diagnostics/types';
import { pageWindow } from '../pageContext';
import type { CaptureMode } from './types';
import { getLastCaptureMode } from './state';

const JOTAI_SUBSYSTEM: Subsystem = 'jotaiBridge';
export const diagLog = createNamedLogger('jotaiBridge');

let diagnosticsStarted = false;
let lastReportedMode: CaptureMode | null = null;

const captureListeners = new Set<(mode: CaptureMode) => void>();

/** Fires after every capture-mode transition (aries/shared/fiber/write/cache-read/none). */
export function onJotaiCapture(cb: (mode: CaptureMode) => void): () => void {
  captureListeners.add(cb);
  return () => { captureListeners.delete(cb); };
}

const MODE_TO_STATUS: Record<CaptureMode, SubsystemHealth['status']> = {
  aries: 'ok',
  shared: 'ok',
  fiber: 'ok',
  write: 'ok',
  'cache-read': 'degraded',
  none: 'failed',
};

const MODE_TO_MESSAGE: Record<CaptureMode, string> = {
  aries: 'Captured via Aries Mod store',
  shared: 'Captured via shared global store',
  fiber: 'Captured via React fiber walk',
  write: 'Captured via write-once patch',
  'cache-read': 'Read-only cache-read fallback (polyfill)',
  none: 'No store available — polyfill that throws',
};

/**
 * Wire the jotaiBridge subsystem into the diagnostics health bus. Idempotent.
 * Must run after initDiagnostics() so the bus exists.
 */
export function startJotaiBridgeDiagnostics(): void {
  if (diagnosticsStarted) return;
  diagnosticsStarted = true;
  healthBus.register(JOTAI_SUBSYSTEM, {
    category: 'core',
    status: 'starting',
    message: 'Awaiting first ensureJotaiStore() resolution',
  });

  // If a capture already happened before diagnostics started, replay it now.
  const prior = getLastCaptureMode();
  if (prior !== null) {
    reportJotaiCapture(prior);
  }
}

export function stopJotaiBridgeDiagnostics(): void {
  if (!diagnosticsStarted) return;
  diagnosticsStarted = false;
  lastReportedMode = null;
}

export function reportJotaiCapture(mode: CaptureMode): void {
  if (!diagnosticsStarted) return;
  if (mode === lastReportedMode) return;
  lastReportedMode = mode;

  const status = MODE_TO_STATUS[mode];
  const message = MODE_TO_MESSAGE[mode];

  healthBus.publish({
    subsystem: JOTAI_SUBSYSTEM,
    category: 'core',
    status,
    message,
    metrics: { source: mode },
  });

  // 'none' tier is a true failure — fire JOTAI-001 for the error buffer.
  // Other tiers (including cache-read) are recorded via metrics.source per
  // JOTAI-002 — info-severity, no error-buffer noise.
  if (mode === 'none') {
    diagLog.error('QPM-JOTAI-001', {
      ariesPresent: !!(pageWindow as any)?.AriesMod,
    });
  }

  for (const l of captureListeners) { try { l(mode); } catch { /* isolated */ } }
}
