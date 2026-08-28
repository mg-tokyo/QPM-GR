// src/websocket/health.ts
// Health-bus wiring + send counters for the websocket subsystem (Phase 2 §13).
// Extracted from api.ts (2026-08-28); api.ts re-exports start/stop so existing
// import sites are unchanged.

import { healthBus } from '../diagnostics/healthBus';
import type { Subsystem, SubsystemHealth } from '../diagnostics/types';
import { visibleInterval } from '../utils/scheduling/timerManager';

const WS_SUBSYSTEM: Subsystem = 'websocket';

export const wsCounters = {
  sends: 0,
  throttles: 0,
  failures: 0,
  invalidPayloads: 0,
  lockerBlocks: 0,
  noConnections: 0,
  enveloped: 0,
};

let diagnosticsStarted = false;
let connectionPollStop: (() => void) | null = null;
let metricsTickStop: (() => void) | null = null;
let connectionEverSeen = false;
let hasConnectionFn: (() => boolean) | null = null;

function snapshotMetrics(): Readonly<Record<string, number>> {
  return { ...wsCounters };
}

function serializeCounters(): string {
  return Object.values(wsCounters).join('|');
}

function publishWsHealth(
  status?: SubsystemHealth['status'],
  message?: string,
): void {
  if (!diagnosticsStarted) return;
  healthBus.publish({
    subsystem: WS_SUBSYSTEM,
    category: 'core',
    ...(status === undefined ? {} : { status }),
    ...(message === undefined ? {} : { message }),
    metrics: snapshotMetrics(),
  });
}

export function maybePublishRecovery(): void {
  if (!diagnosticsStarted) return;
  const current = healthBus.read(WS_SUBSYSTEM);
  if (!current) return;
  if (current.status === 'degraded' || current.status === 'failed') {
    publishWsHealth('recovering', 'Send succeeded — recovering');
  }
}

/**
 * Wire the websocket subsystem into the diagnostics health bus. Idempotent.
 * Must run after initDiagnostics() so the bus exists.
 */
export function startWebsocketHealth(hasConnection: () => boolean): void {
  if (diagnosticsStarted) return;
  diagnosticsStarted = true;
  hasConnectionFn = hasConnection;

  healthBus.register(WS_SUBSYSTEM, {
    category: 'core',
    status: 'starting',
    message: 'Waiting for room connection',
  });

  if (hasConnection()) {
    connectionEverSeen = true;
    publishWsHealth('ok', 'Connected');
  } else {
    connectionPollStop = visibleInterval('qpm-ws-diag-connect', () => {
      if (!hasConnectionFn?.()) return;
      connectionEverSeen = true;
      publishWsHealth('ok', 'Connected');
      if (connectionPollStop) {
        connectionPollStop();
        connectionPollStop = null;
      }
    }, 1500);
  }

  // Slow metrics tick — only publish when counters actually change, so the
  // bus diff stays cheap (§6.4 budget).
  let lastSnapshot = serializeCounters();
  metricsTickStop = visibleInterval('qpm-ws-diag-metrics', () => {
    const snap = serializeCounters();
    if (snap === lastSnapshot) return;
    lastSnapshot = snap;
    publishWsHealth(undefined, connectionEverSeen ? 'Connected' : undefined);
  }, 60_000);
}

export function stopWebsocketHealth(): void {
  if (!diagnosticsStarted) return;
  if (connectionPollStop) {
    connectionPollStop();
    connectionPollStop = null;
  }
  if (metricsTickStop) {
    metricsTickStop();
    metricsTickStop = null;
  }
  hasConnectionFn = null;
  diagnosticsStarted = false;
}
