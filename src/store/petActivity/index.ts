import { createStoreDiagnostics } from '../_storeDiagnostics';
import { onRiddenPetChange } from '../mountState';
import { getActivePetInfos } from '../pets';
import { buildRuns, type CollapseOptions } from './collapse';
import { liveEnrichDeps } from './enrichLive';
import { ServerLogIngester, subscribeServerLog } from './ingest';
import { MAX_AGE_MS, MAX_EVENTS, pruneEvents } from './persistence';
import { loadEvents, saveEvents } from './storageIo';
import type { ActivityRun, EventValue, PetActivityChange, PetActivityEvent, PetSnap, TargetSnap } from './types';

export type { ActivityRun, EventKind, EventValue, PetActivityChange, PetActivityEvent, PetSnap, TargetSnap } from './types';
export type { CollapseOptions } from './collapse';
export { DEFAULT_GAP_MS } from './collapse';
export { PET_ACTIVITY_UI_KEY } from './persistence';
export { serverEntryKey } from './normalize';

export interface QpmEventInput {
  kind: 'mount' | 'feed' | 'team';
  action: string;
  pet: PetSnap;
  targets?: TargetSnap[];
  values?: Record<string, EventValue>;
}

const diag = createStoreDiagnostics('storePetActivity', 'petActivity');
const PERSIST_DEBOUNCE_MS = 2000;
const QPM_FEED_DEDUPE_MS = 3000;

let started = false;
let events: PetActivityEvent[] = [];
let byId = new Map<string, PetActivityEvent>();
const listeners = new Set<(c: PetActivityChange) => void>();
const cleanups: Array<() => void> = [];
let persistTimer: number | null = null;
let ingester: ServerLogIngester | null = null;
const pendingQpmFeeds: Array<{ petId: string; cropSpecies: string; at: number; event: PetActivityEvent }> = [];

function notify(change: PetActivityChange): void {
  for (const cb of listeners) { try { cb(change); } catch (err) { diag.warn('QPM-STORE-003', { phase: 'notify' }, err); } }
}
function persistNow(): void {
  try { saveEvents(events); } catch (err) { diag.warn('QPM-STORE-004', { what: 'events' }, err); }
}
// One-shot debounce (not polling) — same shape petTeamsLogs used.
function schedulePersist(): void {
  if (persistTimer != null) return;
  persistTimer = window.setTimeout(() => { persistTimer = null; persistNow(); }, PERSIST_DEBOUNCE_MS);
}
function flushPersist(): void {
  if (persistTimer != null) { window.clearTimeout(persistTimer); persistTimer = null; }
  persistNow();
}
function commit(added: PetActivityEvent[], updated: PetActivityEvent[]): void {
  if (!added.length && !updated.length) return;
  for (const e of added) { events.push(e); byId.set(e.id, e); }
  for (const e of updated) { const i = events.findIndex((x) => x.id === e.id); if (i >= 0) events[i] = e; byId.set(e.id, e); }
  if (added.length) events.sort((a, b) => a.ts - b.ts);
  if (events.length > MAX_EVENTS * 1.1) { events = pruneEvents(events, Date.now(), { maxEvents: MAX_EVENTS, maxAgeMs: MAX_AGE_MS }); byId = new Map(events.map((e) => [e.id, e])); }
  schedulePersist();
  notify({ added, updated, cleared: false });
}

/** Matches either id — mountState reports the item id (slotId), instantFeed the entity id (petId). */
function snapFromActive(petItemId: string): PetSnap | null {
  const info = getActivePetInfos().find((p) => p.slotId === petItemId || p.petId === petItemId);
  if (!info || !info.species) return null;
  const base: PetSnap = { id: info.petId ?? petItemId, species: info.species, name: info.name, mutations: info.mutations,
    targetScale: info.targetScale ?? 1, xp: info.xp ?? 0, abilities: info.abilities, str: null, maxStr: null, level: null };
  return { ...base, ...liveEnrichDeps.strOf(base) };
}

function makeQpmEvent(input: QpmEventInput, ts: number): PetActivityEvent {
  return { id: `qpm|${ts}|${input.action}|${input.pet.id}|${Math.random().toString(36).slice(2, 7)}`, ts, source: 'qpm', kind: input.kind,
    action: input.action, family: input.kind, pet: input.pet, targets: input.targets ?? [], values: input.values ?? {}, updatedAt: ts };
}

/** Fills STR/level from catalogs when a snapshot was taken before they were ready. */
export function withPetStr(pet: PetSnap): PetSnap {
  return pet.str == null ? { ...pet, ...liveEnrichDeps.strOf(pet) } : pet;
}

export function logQpmPetEvent(input: QpmEventInput): void {
  commit([makeQpmEvent({ ...input, pet: withPetStr(input.pet) }, Date.now())], []);
}

function onServerLog(raw: unknown[]): void {
  if (!ingester) return;
  const { added, updated } = ingester.ingest(raw);
  // A server feedPet within the dedupe window supersedes the provisional QPM feed row.
  const now = Date.now();
  for (const a of added) {
    if (a.kind !== 'feed') continue;
    const i = pendingQpmFeeds.findIndex((p) => p.petId === a.pet.id && now - p.at <= QPM_FEED_DEDUPE_MS);
    if (i >= 0) { const [p] = pendingQpmFeeds.splice(i, 1); if (p) { events = events.filter((e) => e.id !== p.event.id); byId.delete(p.event.id); } }
  }
  commit(added, updated);
}

function onQpmFeed(e: Event): void {
  const detail = (e as CustomEvent<{ petItemId?: string; cropItemId?: string; cropSpecies?: string | null }>).detail ?? {};
  if (!detail.petItemId) return;
  const pet = snapFromActive(detail.petItemId); if (!pet) return;
  const species = detail.cropSpecies ?? '';
  const event = makeQpmEvent({ kind: 'feed', action: 'qpmFeed', pet,
    targets: species ? [{ kind: 'crop', species, mutations: [], scale: 1 }] : [], values: { cropsCount: 1 } }, Date.now());
  pendingQpmFeeds.push({ petId: pet.id, cropSpecies: species, at: event.ts, event });
  while (pendingQpmFeeds.length > 20) pendingQpmFeeds.shift();
  commit([event], []);
}

export function initPetActivityStore(): void {
  if (started) return;
  started = true;
  diag.register('Loading pet activity from storage');
  try { events = loadEvents(); } catch (err) { events = []; diag.warn('QPM-STORE-001', { phase: 'load' }, err); }
  byId = new Map(events.map((e) => [e.id, e]));
  ingester = new ServerLogIngester((key) => byId.get(key));

  cleanups.push(subscribeServerLog(onServerLog));

  let lastRidden: string | null = null;
  cleanups.push(onRiddenPetChange((petId) => {
    const target = petId ?? lastRidden;
    lastRidden = petId;
    if (!target) return;
    const pet = snapFromActive(target); if (!pet) return;
    logQpmPetEvent({ kind: 'mount', action: petId ? 'mount' : 'dismount', pet });
  }));

  window.addEventListener('qpm:feedPet', onQpmFeed);
  cleanups.push(() => window.removeEventListener('qpm:feedPet', onQpmFeed));
  const unload = (): void => flushPersist();
  window.addEventListener('pagehide', unload); window.addEventListener('beforeunload', unload);
  cleanups.push(() => { window.removeEventListener('pagehide', unload); window.removeEventListener('beforeunload', unload); });

  diag.publishOk('Pet activity store ready', { events: events.length });
}

export function stopPetActivityStore(): void {
  if (!started) return;
  started = false;
  flushPersist();
  for (const fn of cleanups.splice(0)) { try { fn(); } catch { /* teardown */ } }
  ingester = null;
  listeners.clear();
}

export function getPetActivityEvents(): PetActivityEvent[] { return [...events]; }
export function getPetActivityRuns(opts: CollapseOptions): ActivityRun[] { return buildRuns(events, opts); }
export function onPetActivityChange(cb: (c: PetActivityChange) => void): () => void { listeners.add(cb); return () => { listeners.delete(cb); }; }
export function clearPetActivity(): void { events = []; byId = new Map(); flushPersist(); notify({ added: [], updated: [], cleared: true }); }
