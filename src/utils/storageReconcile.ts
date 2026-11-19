import { listLocalKeys } from './storageBackends';
import { STORAGE_RECONCILE_KEY } from './storageKeys';
import { isMirrorAvailable, mirrorGet, mirrorKeys, mirrorSavedAt } from './storageMirror';

// Writes made while GM was unreachable reached only this origin's mirror and localStorage.
// At init under a GM runtime, push those back to the shared GM copy when they are newer
// than what GM last received (last writer wins, by the mirror row's savedAt).
// Known limits (plan T7): removals made while GM was unreachable come back; a key whose
// localStorage write failed on quota waits for its next write; nothing runs without IndexedDB.

/** The GM backend, sync or async, seen as async. Values are the raw JSON strings storage writes. */
export interface ReconcileGm {
  get(key: string): Promise<string | null>;
  set(key: string, raw: string): Promise<void>;
  /** Absent when the manager has no listValues; the seed never runs then. */
  list?(): Promise<string[]>;
}

export interface ReconcileMarker {
  v: 1;
  origins: string[];
  stamps: Record<string, number>;
}

export function parseReconcileMarker(raw: string | null): ReconcileMarker {
  const out: ReconcileMarker = { v: 1, origins: [], stamps: {} };
  if (raw == null) return out;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return out; }
  if (!parsed || typeof parsed !== 'object') return out;
  const record = parsed as { v?: unknown; origins?: unknown; stamps?: unknown };
  if (record.v !== 1) return out;
  if (Array.isArray(record.origins)) out.origins = record.origins.filter((o): o is string => typeof o === 'string');
  if (record.stamps && typeof record.stamps === 'object') {
    for (const [key, stamp] of Object.entries(record.stamps)) {
      if (typeof stamp === 'number' && Number.isFinite(stamp)) out.stamps[key] = stamp;
    }
  }
  return out;
}

async function readGm(gm: ReconcileGm, key: string): Promise<{ ok: boolean; raw: string | null }> {
  try {
    return { ok: true, raw: await gm.get(key) };
  } catch {
    return { ok: false, raw: null };
  }
}

/**
 * Must run after the mirror hydrates and before the localStorage copies are deleted.
 * `gm` is null under the `local-storage` runtime. Resolves to the number of keys pushed; never throws.
 */
export async function reconcileGmStore(gm: ReconcileGm | null, isQpmKey: (key: string) => boolean): Promise<number> {
  if (!gm || !isMirrorAvailable()) return 0;

  const candidates = listLocalKeys().filter((key) => key !== STORAGE_RECONCILE_KEY && isQpmKey(key) && mirrorGet(key) != null);
  if (candidates.length === 0) return 0;

  const markerRead = await readGm(gm, STORAGE_RECONCILE_KEY);
  if (!markerRead.ok) return 0;
  const marker = parseReconcileMarker(markerRead.raw);

  let pushed = 0;
  for (const key of candidates) {
    const raw = mirrorGet(key);
    const savedAt = mirrorSavedAt(key);
    if (raw == null || savedAt == null) continue;
    const stamp = marker.stamps[key];
    if (stamp !== undefined && savedAt <= stamp) continue;
    const current = await readGm(gm, key);
    if (!current.ok || current.raw === raw) continue;
    try {
      await gm.set(key, raw);
    } catch {
      continue;
    }
    marker.stamps[key] = savedAt;
    pushed++;
  }

  if (pushed > 0) {
    try { await gm.set(STORAGE_RECONCILE_KEY, JSON.stringify(marker)); } catch {}
  }
  return pushed;
}

async function pushRow(gm: ReconcileGm, marker: ReconcileMarker, key: string, raw: string, savedAt: number): Promise<boolean> {
  try {
    await gm.set(key, raw);
  } catch {
    return false;
  }
  marker.stamps[key] = savedAt;
  return true;
}

// A new value store (a .weavermod install is a new SMM record) starts empty while the
// origin's mirror still holds the user's settings: copy them in, then let each other origin
// add what the store lacks once. A store with QPM keys and no seeding origin is an existing
// install; only the T7 rules apply there, so a removal on one origin is not undone by another.
/**
 * Run before `reconcileGmStore`, whose marker (`origins: []`) would otherwise read as an
 * existing install. Resolves to the number of keys pushed; never throws.
 */
export async function seedGmStore(gm: ReconcileGm | null, isQpmKey: (key: string) => boolean, origin: string): Promise<number> {
  if (!gm?.list || !isMirrorAvailable() || !origin) return 0;

  const markerRead = await readGm(gm, STORAGE_RECONCILE_KEY);
  if (!markerRead.ok) return 0;
  const rowKeys = mirrorKeys().filter((key) => key !== STORAGE_RECONCILE_KEY && isQpmKey(key));
  let marker: ReconcileMarker;
  let pushed = 0;

  if (markerRead.raw == null) {
    let listed: string[];
    try { listed = await gm.list(); } catch { return 0; }
    if (listed.some(isQpmKey)) return 0;
    marker = { v: 1, origins: [origin], stamps: {} };
    for (const key of rowKeys) {
      const raw = mirrorGet(key);
      const savedAt = mirrorSavedAt(key);
      if (raw == null || savedAt == null) continue;
      if (await pushRow(gm, marker, key, raw, savedAt)) pushed++;
    }
  } else {
    marker = parseReconcileMarker(markerRead.raw);
    if (marker.origins.length === 0 || marker.origins.includes(origin)) return 0;
    for (const key of rowKeys) {
      const raw = mirrorGet(key);
      const savedAt = mirrorSavedAt(key);
      if (raw == null || savedAt == null) continue;
      const current = await readGm(gm, key);
      if (!current.ok || current.raw === raw) continue;
      const stamp = marker.stamps[key];
      const newer = stamp !== undefined && savedAt > stamp;
      if (current.raw != null && !newer) continue;
      if (await pushRow(gm, marker, key, raw, savedAt)) pushed++;
    }
    marker.origins.push(origin);
  }

  try { await gm.set(STORAGE_RECONCILE_KEY, JSON.stringify(marker)); } catch {}
  return pushed;
}
