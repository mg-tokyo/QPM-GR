// Diagnostics bus wiring (Phase 2 item 2.3)

import { healthBus } from '../../diagnostics/healthBus';
import { createNamedLogger } from '../../diagnostics/logger';
import type { Subsystem, SubsystemHealth } from '../../diagnostics/types';
import { PARTIAL_GRACE_MS, READY_WATCHDOG_MS } from './constants';
import { capturedCatalogs, readiness } from './state';

const CATALOGS_SUBSYSTEM: Subsystem = 'catalogs';
export const diagLog = createNamedLogger('catalogs');

// Live holder — read by readyState.ts (ready notification) and enrichment.ts (warn gating).
export const diagState: {
  started: boolean;
  startedAt: number;
  readyWatchdogTimer: ReturnType<typeof setTimeout> | null;
  partialCheckTimer: ReturnType<typeof setTimeout> | null;
} = {
  started: false,
  startedAt: 0,
  readyWatchdogTimer: null,
  partialCheckTimer: null,
};

function countLoadedCatalogs(): { loaded: number; total: number; missing: string[] } {
  const slots: Array<[string, unknown]> = [
    ['itemCatalog', capturedCatalogs.itemCatalog],
    ['decorCatalog', capturedCatalogs.decorCatalog],
    ['mutationCatalog', capturedCatalogs.mutationCatalog],
    ['eggCatalog', capturedCatalogs.eggCatalog],
    ['petCatalog', capturedCatalogs.petCatalog],
    ['petAbilities', capturedCatalogs.petAbilities],
    ['plantCatalog', capturedCatalogs.plantCatalog],
    ['weatherCatalog', capturedCatalogs.weatherCatalog],
    ['cosmeticCatalog', capturedCatalogs.cosmeticCatalog],
  ];
  const missing = slots.filter(([, slot]) => slot === null).map(([name]) => name);
  return { loaded: slots.length - missing.length, total: slots.length, missing };
}

export function publishCatalogsHealth(): void {
  if (!diagState.started) return;
  const { loaded, total, missing } = countLoadedCatalogs();
  const missingSuffix = missing.length > 0 ? ` (missing: ${missing.join(', ')})` : '';
  const message = readiness.catalogsReady
    ? `${loaded}/${total} catalogs loaded${missingSuffix}`
    : `Capturing… (${loaded}/${total} so far)`;
  const status: SubsystemHealth['status'] | undefined = readiness.catalogsReady ? 'ok' : undefined;
  healthBus.publish({
    subsystem: CATALOGS_SUBSYSTEM,
    category: 'core',
    ...(status === undefined ? {} : { status }),
    message,
    metrics: { loaded, total, ready: readiness.catalogsReady ? 1 : 0 },
  });
}

function listMissingEssentials(): string[] {
  const missing: string[] = [];
  if (!capturedCatalogs.petCatalog) missing.push('petCatalog');
  if (!capturedCatalogs.plantCatalog) missing.push('plantCatalog');
  if (!capturedCatalogs.eggCatalog) missing.push('eggCatalog');
  if (!capturedCatalogs.petAbilities) missing.push('petAbilities');
  return missing;
}

export function schedulePartialCheck(): void {
  if (!diagState.started) return;
  if (diagState.partialCheckTimer !== null) return;
  diagState.partialCheckTimer = setTimeout(() => {
    diagState.partialCheckTimer = null;
    if (!diagState.started) return;
    const missing = listMissingEssentials();
    if (missing.length > 0) {
      diagLog.warn('QPM-CATALOG-002', { missing });
    }
  }, PARTIAL_GRACE_MS);
}

function startReadyWatchdog(): void {
  if (diagState.readyWatchdogTimer !== null) return;
  diagState.readyWatchdogTimer = setTimeout(() => {
    diagState.readyWatchdogTimer = null;
    if (!diagState.started) return;
    if (readiness.catalogsReady) return;
    const elapsedMs = Date.now() - diagState.startedAt;
    diagLog.error('QPM-CATALOG-001', {
      elapsedMs,
      capturedSoFar: countLoadedCatalogs().loaded,
    });
  }, READY_WATCHDOG_MS);
}

/**
 * Wire the catalogs subsystem into the diagnostics health bus. Idempotent.
 * Must run after initDiagnostics() so the bus exists. Safe to call before
 * initCatalogLoader() — the watchdog measures time-to-ready from this call.
 */
export function startCatalogsDiagnostics(): void {
  if (diagState.started) return;
  diagState.started = true;
  diagState.startedAt = Date.now();

  healthBus.register(CATALOGS_SUBSYSTEM, {
    category: 'core',
    status: 'starting',
    message: 'Waiting for game catalogs',
  });

  if (readiness.catalogsReady) {
    // Catalog capture finished before diagnostics started (unusual but harmless).
    publishCatalogsHealth();
    schedulePartialCheck();
    return;
  }

  startReadyWatchdog();
}

export function stopCatalogsDiagnostics(): void {
  if (!diagState.started) return;
  if (diagState.readyWatchdogTimer !== null) {
    clearTimeout(diagState.readyWatchdogTimer);
    diagState.readyWatchdogTimer = null;
  }
  if (diagState.partialCheckTimer !== null) {
    clearTimeout(diagState.partialCheckTimer);
    diagState.partialCheckTimer = null;
  }
  diagState.started = false;
}
