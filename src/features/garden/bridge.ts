import { ensureJotaiStore, getAtomByLabel, readAtomValue, getCachedStore } from '../../core/jotaiBridge';
import { subscribeAtomValue } from '../../core/atomRegistry';
import { shareGlobal, readSharedGlobal } from '../../core/pageContext';
import { createFeatureDiagnostics } from '../../diagnostics/featureDiagnostics';
import type { Subsystem } from '../../diagnostics/types';

const FEATURE_SUBSYSTEM: Subsystem = 'feature:gardenBridge';
const { diag, ensureBusRegistered, publishOk, warnFeature } =
  createFeatureDiagnostics(FEATURE_SUBSYSTEM, 'gardenBridge');

const MY_DATA_ATOM_LABEL = 'myDataAtom';
const MAP_ATOM_LABEL = 'mapAtom';
const GLOBAL_CACHE_KEY = '__qpmGardenSnapshot__';
const GLOBAL_MAP_CACHE_KEY = '__qpmMapSnapshot__';

export interface GardenState {
  tileObjects?: Record<string, unknown>;
  boardwalkTileObjects?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface MapSnapshot {
  cols: number;
  rows: number;
  globalTileIdxToDirtTile: Record<number, { dirtTileIdx: number; userSlotIdx: number }>;
  globalTileIdxToBoardwalk: Record<number, { boardwalkTileIdx: number; userSlotIdx: number }>;
  [key: string]: unknown;
}

export type GardenSnapshot = GardenState | null;

let initialized = false;
let cachedGarden: GardenSnapshot = readSharedGlobal<GardenSnapshot>(GLOBAL_CACHE_KEY) ?? null;
let cachedMap: MapSnapshot | null = readSharedGlobal<MapSnapshot>(GLOBAL_MAP_CACHE_KEY) ?? null;
let unsubscribe: (() => void) | null = null;
let myDataAtomRef: unknown = null;
let lastRawMyData: unknown = null;
const listeners = new Set<(state: GardenSnapshot) => void>();
let retryTimer: number | null = null;

const RETRY_DELAY_MS = 1500;

function notifyListeners() {
  shareGlobal(GLOBAL_CACHE_KEY, cachedGarden);
  for (const listener of listeners) {
    try {
      listener(cachedGarden);
    } catch (error) {
      warnFeature('QPM-FEATURE-004', { what: 'listener:snapshot' }, error);
    }
  }
}

function updateCache(next: GardenSnapshot) {
  if (cachedGarden === next) return;
  cachedGarden = next;
  notifyListeners();
}

function extractGarden(value: Record<string, unknown> | null | undefined): GardenSnapshot {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const garden = (value as Record<string, unknown>).garden;
  return (garden as GardenState | null | undefined) ?? null;
}

async function resolveGardenSnapshot(): Promise<GardenSnapshot> {
  const myDataAtom = getAtomByLabel(MY_DATA_ATOM_LABEL);
  if (!myDataAtom) {
    diag.debug('myDataAtom not found (labels may be unavailable)');
    throw new Error('Unable to locate myDataAtom in jotaiAtomCache');
  }

  diag.debug('Found myDataAtom');

  const myData = await readAtomValue<Record<string, unknown> | null>(myDataAtom).catch((error) => {
    warnFeature('QPM-FEATURE-004', { what: 'bridge:readMyData' }, error);
    return null;
  });
  const garden = extractGarden(myData ?? undefined);

  if (garden?.tileObjects) {
    diag.debug(`Garden data loaded (${Object.keys(garden.tileObjects).length} tiles)`);
  } else {
    diag.debug('Garden data empty or invalid');
  }

  return garden;
}

async function resolveMapSnapshot(): Promise<MapSnapshot | null> {
  const mapAtom = getAtomByLabel(MAP_ATOM_LABEL);
  if (!mapAtom) {
    diag.debug('mapAtom not found');
    return null;
  }

  diag.debug('Found mapAtom');

  const map = await readAtomValue<MapSnapshot | null>(mapAtom).catch((error) => {
    warnFeature('QPM-FEATURE-004', { what: 'bridge:readMap' }, error);
    return null;
  });

  if (map && map.cols && map.rows) {
    diag.debug(`Map data loaded (${map.cols}x${map.rows} grid)`);
  } else {
    diag.debug('Map data empty or invalid');
  }

  return map;
}

export async function startGardenBridge(): Promise<void> {
  if (initialized) return;
  initialized = true;
  ensureBusRegistered();

  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }

  try {
    await ensureJotaiStore();
  } catch (error) {
    warnFeature('QPM-FEATURE-003', { what: 'startBridge:jotai' }, error);
    initialized = false;
    if (!retryTimer) {
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        void startGardenBridge();
      }, RETRY_DELAY_MS);
    }
    return;
  }

  try {
    const initial = await resolveGardenSnapshot();
    updateCache(initial);

    // Also load map snapshot (non-critical, doesn't trigger retry if it fails)
    const mapSnapshot = await resolveMapSnapshot();
    if (mapSnapshot) {
      cachedMap = mapSnapshot;
      shareGlobal(GLOBAL_MAP_CACHE_KEY, cachedMap);
    }
  } catch (error) {
    warnFeature('QPM-FEATURE-003', { what: 'startBridge:primeSnapshot' }, error);
    if (!retryTimer) {
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        initialized = false;
        void startGardenBridge();
      }, RETRY_DELAY_MS);
    }
  }

  myDataAtomRef = getAtomByLabel(MY_DATA_ATOM_LABEL);
  if (!myDataAtomRef) {
    warnFeature('QPM-FEATURE-003', { what: 'startBridge:postInitMyDataMissing' });
    initialized = false;
    if (!retryTimer) {
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        void startGardenBridge();
      }, RETRY_DELAY_MS);
    }
    return;
  }

  const unsub = await subscribeAtomValue('myData', (value) => {
    lastRawMyData = value;
    updateCache(extractGarden(value ?? undefined));
  });
  if (unsub) unsubscribe = unsub;

  publishOk('Started', {
    hasSnapshot: cachedGarden ? 1 : 0,
    hasMap: cachedMap ? 1 : 0,
    tiles: cachedGarden?.tileObjects ? Object.keys(cachedGarden.tileObjects).length : 0,
  });
}

export function stopGardenBridge(): void {
  unsubscribe?.();
  unsubscribe = null;
  myDataAtomRef = null;
  lastRawMyData = null;
  initialized = false;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

/**
 * Re-read myDataAtom directly via store.get() and update garden cache if changed.
 * Used by the background atom poller to detect changes when native
 * Jotai subscriptions don't fire (background tabs).
 */
export function forceRefreshGarden(): void {
  if (!myDataAtomRef) return;
  const store = getCachedStore();
  if (!store || store.__polyfill) return;

  try {
    const fresh = store.get(myDataAtomRef);
    if (fresh !== lastRawMyData) {
      lastRawMyData = fresh;
      updateCache(extractGarden((fresh as Record<string, unknown> | null) ?? undefined));
    }
  } catch {}
}

export function getGardenSnapshot(): GardenSnapshot {
  return cachedGarden;
}

export function getMapSnapshot(): MapSnapshot | null {
  return cachedMap;
}

export function onGardenSnapshot(cb: (state: GardenSnapshot) => void, fireImmediately = true): () => void {
  listeners.add(cb);
  if (fireImmediately) {
    try {
      cb(cachedGarden);
    } catch (error) {
      warnFeature('QPM-FEATURE-004', { what: 'listener:immediate' }, error);
    }
  }
  return () => {
    listeners.delete(cb);
  };
}

export function isGardenBridgeReady(): boolean {
  return initialized && !!unsubscribe;
}
