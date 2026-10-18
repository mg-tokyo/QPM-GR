import { t } from '../../i18n';
import { storage } from '../../utils/storage';
import { isRecord } from '../../utils/typeGuards';
import type { SpectatorPose, SpectatorViewKind } from './state';

/** A saved camera spot (S §8): the pose in the units of SpectatorPose, and the view it was saved in. */
export interface Waypoint { id: string; name: string; x: number; y: number; alt: number; view: SpectatorViewKind; yaw: number; pitch: number }

export const WAYPOINT_CAP = 20;
export const WAYPOINT_NAME_MAX = 32;

const KEY = 'qpm.spectator.waypoints.v1';
const listeners = new Set<(list: readonly Waypoint[]) => void>();

/** seq: the next default-name number; it only counts up, so "Spot N" is never reused after a delete. */
interface Stored { seq: number; list: Waypoint[] }

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const cleanName = (s: string): string => s.trim().slice(0, WAYPOINT_NAME_MAX).trimEnd();

function parseItem(v: unknown): Waypoint | null {
  if (!isRecord(v)) return null;
  const { id, name, x, y, alt } = v;
  if (typeof id !== 'string' || !id || typeof name !== 'string' || !finite(x) || !finite(y) || !finite(alt)) return null;
  const clean = cleanName(name);
  if (!clean) return null;
  return {
    id, name: clean, x, y, alt, view: v.view === '3d' ? '3d' : '2d', yaw: finite(v.yaw) ? v.yaw : 0, pitch: finite(v.pitch) ? v.pitch : 0,
  };
}

/** Per item: a bad entry or a repeated id is dropped and the rest kept; anything else loads as empty. */
export function parseWaypoints(raw: unknown): Stored {
  const o = isRecord(raw) ? raw : {};
  const list: Waypoint[] = [];
  const ids = new Set<string>();
  for (const v of Array.isArray(o.list) ? o.list : []) {
    const w = parseItem(v);
    if (!w || ids.has(w.id)) continue;
    ids.add(w.id);
    list.push(w);
    if (list.length === WAYPOINT_CAP) break;
  }
  const seq = finite(o.seq) && o.seq >= 1 ? Math.floor(o.seq) : list.length + 1;
  return { seq, list };
}

const read = (): Stored => parseWaypoints(storage.get<unknown>(KEY, null));

function write(next: Stored): void {
  storage.set(KEY, next);
  const snapshot: readonly Waypoint[] = [...next.list];
  for (const cb of [...listeners]) {
    try { cb(snapshot); } catch { /* isolate listeners */ }
  }
}

export const listWaypoints = (): readonly Waypoint[] => read().list;

/** null at the cap: nothing is stored (the caller tells the player). */
export function saveWaypoint(pose: SpectatorPose, view: SpectatorViewKind): Waypoint | null {
  const { seq, list } = read();
  if (list.length >= WAYPOINT_CAP) return null;
  const names = new Set(list.map((w) => w.name));
  const ids = new Set(list.map((w) => w.id));
  let n = seq;
  while (names.has(t('feature.spectator.wp.default', { n }))) n++;
  let id = `wp${n}`;
  for (let k = 1; ids.has(id); k++) id = `wp${n}-${k}`;
  const w: Waypoint = {
    id, name: t('feature.spectator.wp.default', { n }), x: pose.x, y: pose.y, alt: pose.alt, view, yaw: pose.yaw, pitch: pose.pitch,
  };
  write({ seq: n + 1, list: [...list, w] });
  return w;
}

/** An empty name (after trimming) keeps the old one. */
export function renameWaypoint(id: string, name: string): void {
  const clean = cleanName(name);
  const s = read();
  const w = s.list.find((x) => x.id === id);
  if (!clean || !w || w.name === clean) return;
  write({ ...s, list: s.list.map((x) => (x.id === id ? { ...x, name: clean } : x)) });
}

export function deleteWaypoint(id: string): void {
  const s = read();
  if (!s.list.some((w) => w.id === id)) return;
  write({ ...s, list: s.list.filter((w) => w.id !== id) });
}

export function onWaypointsChange(cb: (list: readonly Waypoint[]) => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
