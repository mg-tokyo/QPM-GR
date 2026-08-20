import { storage } from '../../../utils/storage';
import { createNamedLogger } from '../../../diagnostics/logger';
import { TD_BALANCE_VERSION } from '../constants';
import type { MatchSnapshot } from '../types';
import {
  AUTO_REF,
  CLASSIC_TRACK_ID,
  LEGACY_SAVE_GAME_KEY,
  MAX_SAVE_SLOTS,
  TD_SAVES_KEY,
  sameRef,
  type SaveEntry,
  type SaveSlotRef,
  type TDSavesV1,
} from './types';

const log = createNamedLogger('td-saves');

let state: TDSavesV1 | null = null;
// Slot the current run is bound to. null = unbound → autosaves go to `autosave`.
let activeSlot: SaveSlotRef | null = null;
const changeSubs = new Set<() => void>();

function freshState(): TDSavesV1 {
  return { version: 1, autosave: null, slots: Array.from({ length: MAX_SAVE_SLOTS }, () => null) };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isSnapshotShape(v: unknown): v is MatchSnapshot {
  if (!isRecord(v)) return false;
  return typeof v.round === 'number'
    && typeof v.cash === 'number'
    && typeof v.lives === 'number'
    && v.lives > 0
    && Array.isArray(v.towers);
}

// 'stale' = well-formed but from another balance version (dropped, counted for the toast).
function readEntry(v: unknown): SaveEntry | 'stale' | null {
  if (!isRecord(v)) return null;
  const balanceVersion = v.balanceVersion;
  const savedAt = v.savedAt;
  const snapshot = v.snapshot;
  const trackId = v.trackId;
  if (typeof balanceVersion !== 'number' || typeof savedAt !== 'number') return null;
  if (!isSnapshotShape(snapshot)) return null;
  if (balanceVersion !== TD_BALANCE_VERSION) return 'stale';
  return {
    savedAt,
    balanceVersion,
    trackId: typeof trackId === 'string' ? trackId : CLASSIC_TRACK_ID,
    snapshot,
  };
}

interface LoadResult {
  readonly state: TDSavesV1;
  readonly wiped: number;
  readonly dirty: boolean;
}

function loadFromStorage(): LoadResult {
  const raw = storage.get<unknown>(TD_SAVES_KEY, null);
  const next = freshState();
  if (raw === null || raw === undefined) return { state: next, wiped: 0, dirty: false };
  if (!isRecord(raw) || raw.version !== 1 || !Array.isArray(raw.slots)) {
    const backupKey = `${TD_SAVES_KEY}.corrupt.${Date.now()}`;
    try {
      storage.set(backupKey, raw);
      log.warn('QPM-TDSAVE-001', { backedUpTo: backupKey });
    } catch (e) {
      log.error('QPM-TDSAVE-001', { backupFailed: true, error: String(e) });
    }
    return { state: next, wiped: 0, dirty: true };
  }
  let wiped = 0;
  let dirty = raw.slots.length !== MAX_SAVE_SLOTS;
  const auto = readEntry(raw.autosave);
  if (auto === 'stale') { wiped++; dirty = true; }
  else if (auto) next.autosave = auto;
  else if (raw.autosave !== null && raw.autosave !== undefined) dirty = true;
  for (let i = 0; i < MAX_SAVE_SLOTS; i++) {
    const rawSlot: unknown = raw.slots[i];
    const e = readEntry(rawSlot);
    if (e === 'stale') { wiped++; dirty = true; continue; }
    if (e) next.slots[i] = e;
    else if (rawSlot !== null && rawSlot !== undefined) dirty = true;
  }
  return { state: next, wiped, dirty };
}

// Legacy single-slot autosave → autosave entry (only if none exists yet).
// The old key is removed whether or not anything was migrated.
function migrateLegacy(s: TDSavesV1): { migrated: boolean; wiped: number } {
  const raw = storage.get<unknown>(LEGACY_SAVE_GAME_KEY, null);
  if (raw === null || raw === undefined) return { migrated: false, wiped: 0 };
  storage.remove(LEGACY_SAVE_GAME_KEY);
  if (!isRecord(raw)) return { migrated: false, wiped: 0 };
  const balanceVersion = raw.balanceVersion;
  const snapshot = raw.snapshot;
  if (typeof balanceVersion !== 'number' || !isSnapshotShape(snapshot)) {
    return { migrated: false, wiped: 0 };
  }
  if (balanceVersion !== TD_BALANCE_VERSION) return { migrated: false, wiped: 1 };
  if (s.autosave !== null) return { migrated: false, wiped: 0 };
  s.autosave = {
    savedAt: Date.now(),
    balanceVersion,
    trackId: CLASSIC_TRACK_ID,
    snapshot,
  };
  return { migrated: true, wiped: 0 };
}

function persist(): void {
  if (state) storage.set(TD_SAVES_KEY, state);
}

function fire(): void {
  for (const cb of changeSubs) {
    try { cb(); } catch { /* subscriber best-effort */ }
  }
}

// Idempotent. Returns how many entries were dropped for balance-version
// mismatch on THIS call (0 on repeat calls) so the launcher can toast once.
export function initTdSaves(): number {
  if (state !== null) return 0;
  const loaded = loadFromStorage();
  const legacy = migrateLegacy(loaded.state);
  state = loaded.state;
  const wiped = loaded.wiped + legacy.wiped;
  if (wiped > 0) log.warn('QPM-TDSAVE-002', { wiped, balanceVersion: TD_BALANCE_VERSION });
  if (loaded.dirty || legacy.migrated || wiped > 0) persist();
  return wiped;
}

export function stopTdSaves(): void {
  state = null;
  activeSlot = null;
  changeSubs.clear();
}

function ensureState(): TDSavesV1 {
  if (state === null) initTdSaves();
  if (state === null) state = freshState();
  return state;
}

export function listSlots(): ReadonlyArray<SaveEntry | null> {
  return ensureState().slots;
}

export function getAutosave(): SaveEntry | null {
  return ensureState().autosave;
}

export function getEntry(ref: SaveSlotRef): SaveEntry | null {
  const s = ensureState();
  if (ref.kind === 'auto') return s.autosave;
  return s.slots[ref.index] ?? null;
}

export function hasAnySave(): boolean {
  const s = ensureState();
  return s.autosave !== null || s.slots.some((e) => e !== null);
}

export function getActiveSlot(): SaveSlotRef | null {
  return activeSlot;
}

export function bindActiveSlot(ref: SaveSlotRef | null): void {
  activeSlot = ref;
}

export function unbindActiveSlot(): void {
  activeSlot = null;
}

export function onSavesChanged(cb: () => void): () => void {
  changeSubs.add(cb);
  return () => { changeSubs.delete(cb); };
}

// Only between-rounds state persists — Set<string> on projectile hitIds and
// mid-flight positions don't round-trip through JSON. A mid-round save thus
// resumes at the START of the current round with current towers/cash/lives.
function cleanSnapshot(snap: MatchSnapshot): MatchSnapshot {
  return {
    ...snap,
    phase: 'preRound',
    balloons: [],
    projectiles: [],
    pendingPlacement: null,
    selectedTowerId: null,
    paused: false,
  };
}

function isSaveable(snap: MatchSnapshot): boolean {
  return (snap.phase === 'inRound' || snap.phase === 'preRound') && snap.lives > 0;
}

function writeEntry(ref: SaveSlotRef, snap: MatchSnapshot): SaveEntry {
  const s = ensureState();
  const entry: SaveEntry = {
    savedAt: Date.now(),
    balanceVersion: TD_BALANCE_VERSION,
    trackId: snap.trackId,
    snapshot: cleanSnapshot(snap),
  };
  if (ref.kind === 'auto') s.autosave = entry;
  else s.slots[ref.index] = entry;
  persist();
  fire();
  return entry;
}

// Explicit user save into a numbered slot. Binds the run to that slot. An
// unbound run's autosave entry is cleared — the run now lives in the slot.
export function saveRunToSlot(index: number, snap: MatchSnapshot): SaveEntry | null {
  if (!Number.isInteger(index) || index < 0 || index >= MAX_SAVE_SLOTS) return null;
  if (!isSaveable(snap)) return null;
  const s = ensureState();
  if (activeSlot === null && s.autosave !== null) s.autosave = null;
  activeSlot = { kind: 'slot', index };
  return writeEntry(activeSlot, snap);
}

// Round-end / quit / unload autosave. Bound runs overwrite their slot;
// unbound runs overwrite the single autosave entry.
export function autosaveRun(snap: MatchSnapshot): void {
  if (!isSaveable(snap)) return;
  writeEntry(activeSlot ?? AUTO_REF, snap);
}

// Move the autosave entry into the first empty numbered slot, if any.
// Returns the slot index used, or null if there was no autosave OR all slots
// were full. Fires a single change notification.
export function promoteAutosaveToFreeSlot(): number | null {
  const s = ensureState();
  if (s.autosave === null) return null;
  const idx = s.slots.findIndex((e) => e === null);
  if (idx < 0) return null;
  s.slots[idx] = s.autosave;
  s.autosave = null;
  persist();
  fire();
  return idx;
}

export function deleteSave(ref: SaveSlotRef): void {
  const s = ensureState();
  if (ref.kind === 'auto') s.autosave = null;
  else if (ref.index >= 0 && ref.index < MAX_SAVE_SLOTS) s.slots[ref.index] = null;
  if (sameRef(activeSlot, ref)) activeSlot = null;
  persist();
  fire();
}
