// Reactive selector for Super Cleanser. Pure event-driven: subscribes to
// selectedItemId / dirtTileIndex / selectedSlotId atoms and re-scopes a
// stateTree subscription to the currently-hovered tile's growSlots. No
// polling, no scanning.

import { subscribeAtomValue, readAtomValueSync } from '../../core/atomRegistry';
import { subscribe as stateTreeSubscribe, selectSync as stateTreeSelectSync } from '../../core/stateTree';
import { getPlayerIdSync } from '../../core/playerContext';
import { subscribeSuperCleanseSettings } from './storage';
import { WEATHER_MUTATIONS, CROP_CLEANSER_TOOL_ID } from './constants';
import { cleanups, listeners, isInitialized, markInitialized } from './state';
import { createNamedLogger } from '../../diagnostics/logger';
import { healthBus } from '../../diagnostics/healthBus';
import { buildError } from '../../diagnostics/result';
import type { ErrorCode, Subsystem } from '../../diagnostics/types';
import type { QuinoaStateSnapshot } from '../../types/gameAtoms';
import type { SuperCleanseSnapshot, SlotView } from './types';

const FEATURE_SUBSYSTEM: Subsystem = 'feature:superCleanser';
const FEATURE_NAME = 'superCleanser';
const diag = createNamedLogger(FEATURE_SUBSYSTEM);
let busRegistered = false;

function ensureBusRegistered(): void {
  if (busRegistered) return;
  busRegistered = true;
  healthBus.register(FEATURE_SUBSYSTEM, { category: 'feature', status: 'starting' });
}

function warnFeature(code: ErrorCode, ctx: Record<string, unknown>, cause?: unknown): void {
  ensureBusRegistered();
  const built = buildError(code, { feature: FEATURE_NAME, ...ctx }, cause);
  diag.warn({ ...built, subsystem: FEATURE_SUBSYSTEM, severity: 'warn' });
}

function publishOk(message: string): void {
  ensureBusRegistered();
  healthBus.publish({
    subsystem: FEATURE_SUBSYSTEM,
    category: 'feature',
    status: 'ok',
    message,
  });
}

const EMPTY_SNAPSHOT: SuperCleanseSnapshot = {
  holdingCleanser: false,
  currentTileIdx: null,
  hoveredSlotId: null,
  hoveredWeatherSet: [],
  slotsOnTile: [],
};

let cached: SuperCleanseSnapshot = EMPTY_SNAPSHOT;
let currentTileSubscription: (() => void) | null = null;
let lastSubscribedTileIdx: number | null = null;

function extractWeatherMutations(raw: unknown): readonly string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const m of raw) {
    if (typeof m === 'string' && (WEATHER_MUTATIONS as readonly string[]).includes(m)) {
      out.push(m);
    }
  }
  return out;
}

function toSlotViews(rawSlots: unknown): readonly SlotView[] {
  if (!Array.isArray(rawSlots)) return [];
  const out: SlotView[] = [];
  for (const s of rawSlots) {
    if (!s || typeof s !== 'object') continue;
    const slotId = (s as { slotId?: unknown }).slotId;
    const species = (s as { species?: unknown }).species;
    const mutations = (s as { mutations?: unknown }).mutations;
    if (typeof slotId !== 'number') continue;
    if (typeof species !== 'string') continue;
    const rawMutations: readonly string[] = Array.isArray(mutations)
      ? mutations.filter((m): m is string => typeof m === 'string')
      : [];
    out.push({
      slotId,
      species,
      mutations: rawMutations,
      weatherMutations: extractWeatherMutations(mutations),
    });
  }
  return out;
}

function emit(): void {
  for (const cb of listeners) {
    try { cb(cached); }
    catch (err) { warnFeature('QPM-FEATURE-004', { what: 'listener:notify' }, err); }
  }
}

function readGrowSlots(state: QuinoaStateSnapshot | null, tileIdx: number, myId: string): unknown {
  const userSlots = state?.child?.data?.userSlots;
  if (!Array.isArray(userSlots)) return null;
  const myIdx = userSlots.findIndex(
    (u) => u && typeof u === 'object' && (u as { playerId?: string }).playerId === myId,
  );
  if (myIdx < 0) return null;
  const slot = userSlots[myIdx];
  if (!slot || typeof slot !== 'object') return null;
  const data = (slot as { data?: unknown }).data;
  if (!data || typeof data !== 'object') return null;
  const garden = (data as { garden?: unknown }).garden;
  if (!garden || typeof garden !== 'object') return null;
  const tileObjects = (garden as { tileObjects?: unknown }).tileObjects;
  if (!tileObjects || typeof tileObjects !== 'object') return null;
  const obj = (tileObjects as Record<string, unknown>)[String(tileIdx)];
  if (!obj || typeof obj !== 'object') return null;
  const slots = (obj as { slots?: unknown }).slots;
  return Array.isArray(slots) ? slots : null;
}

function computeSnapshot(): SuperCleanseSnapshot {
  const selectedItemId = readAtomValueSync('selectedItemId');
  const holdingCleanser = selectedItemId === CROP_CLEANSER_TOOL_ID;

  const tileIdxRaw = readAtomValueSync('dirtTileIndex');
  const currentTileIdx = typeof tileIdxRaw === 'number' ? tileIdxRaw : null;

  const hoveredSlotIdRaw = readAtomValueSync('selectedSlotId');
  const hoveredSlotId = typeof hoveredSlotIdRaw === 'number' ? hoveredSlotIdRaw : null;

  let slotsOnTile: readonly SlotView[] = [];
  if (currentTileIdx != null) {
    const myId = getPlayerIdSync();
    if (myId) {
      const rawSlots = stateTreeSelectSync((state) => readGrowSlots(state, currentTileIdx, myId));
      slotsOnTile = toSlotViews(rawSlots);
    }
  }

  const hoveredWeatherSet: readonly string[] =
    hoveredSlotId != null
      ? (slotsOnTile.find((s) => s.slotId === hoveredSlotId)?.weatherMutations ?? [])
      : [];

  return { holdingCleanser, currentTileIdx, hoveredSlotId, hoveredWeatherSet, slotsOnTile };
}

function recompute(): void {
  cached = computeSnapshot();
  emit();
}

function teardownTileSubscription(): void {
  if (currentTileSubscription) {
    try { currentTileSubscription(); } catch { /* teardown best-effort */ }
    currentTileSubscription = null;
  }
}

function rescopeTileSubscription(tileIdx: number | null): void {
  if (tileIdx === lastSubscribedTileIdx) return;
  lastSubscribedTileIdx = tileIdx;
  teardownTileSubscription();
  if (tileIdx == null) return;
  const myId = getPlayerIdSync();
  if (!myId) return;
  currentTileSubscription = stateTreeSubscribe(
    (state) => readGrowSlots(state, tileIdx, myId),
    () => recompute(),
    `superCleanse:slots:${tileIdx}`,
  );
}

export function startSuperCleanseSelector(): void {
  if (isInitialized()) return;
  markInitialized(true);
  ensureBusRegistered();

  void subscribeAtomValue('selectedItemId', () => recompute()).then((unsub) => {
    if (unsub) cleanups.push(unsub);
  });
  void subscribeAtomValue('dirtTileIndex', (v) => {
    const tileIdx = typeof v === 'number' ? v : null;
    rescopeTileSubscription(tileIdx);
    recompute();
  }).then((unsub) => {
    if (unsub) cleanups.push(unsub);
  });
  void subscribeAtomValue('selectedSlotId', () => recompute()).then((unsub) => {
    if (unsub) cleanups.push(unsub);
  });

  cleanups.push(subscribeSuperCleanseSettings(() => recompute()));

  recompute();
  publishOk('Started');
}

export function stopSuperCleanseSelector(): void {
  if (!isInitialized()) return;
  markInitialized(false);
  teardownTileSubscription();
  lastSubscribedTileIdx = null;
  for (const fn of cleanups) { try { fn(); } catch { /* teardown best-effort */ } }
  cleanups.length = 0;
  listeners.clear();
  cached = EMPTY_SNAPSHOT;
}

export function getSuperCleanseSnapshot(): SuperCleanseSnapshot {
  return cached;
}

export function subscribeSuperCleanseSnapshot(cb: (s: SuperCleanseSnapshot) => void): () => void {
  listeners.add(cb);
  try { cb(cached); }
  catch (err) { warnFeature('QPM-FEATURE-004', { what: 'subscribe:initial_notify' }, err); }
  return () => { listeners.delete(cb); };
}
