import { beforeEach, describe, expect, it, vi } from 'vitest';

const mem = vi.hoisted(() => new Map<string, unknown>());
vi.mock('../../utils/storage', () => ({
  storage: {
    get: (k: string, d: unknown = null) => (mem.has(k) ? mem.get(k) : d),
    set: (k: string, v: unknown) => { mem.set(k, v); },
    remove: (k: string) => { mem.delete(k); },
  },
}));
vi.mock('../../i18n', () => ({ t: (k: string, v?: Record<string, unknown>) => (k === 'feature.spectator.wp.default' ? `Spot ${String(v?.n)}` : k) }));

import type { SpectatorPose } from './state';
import {
  deleteWaypoint, listWaypoints, onWaypointsChange, parseWaypoints, renameWaypoint, saveWaypoint, WAYPOINT_CAP, WAYPOINT_NAME_MAX,
} from './waypoints';

const KEY = 'qpm.spectator.waypoints.v1';
const pose = (x: number, y = 5): SpectatorPose => ({ x, y, alt: 64, yaw: 0, pitch: 0 });
const names = (): string[] => listWaypoints().map((w) => w.name);

describe('spectator waypoints', () => {
  beforeEach(() => mem.clear());

  it('saves the pose and view, round-trips through storage, and lists in saved order', () => {
    const a = saveWaypoint(pose(10, 4), '2d');
    const b = saveWaypoint({ x: 3, y: 9, alt: 900, yaw: 45, pitch: -30 }, '3d');
    expect(a).toMatchObject({ name: 'Spot 1', x: 10, y: 4, alt: 64, view: '2d', yaw: 0, pitch: 0 });
    expect(b).toMatchObject({ name: 'Spot 2', view: '3d', alt: 900, yaw: 45, pitch: -30 });
    expect(a?.id).not.toBe(b?.id);
    expect(listWaypoints()).toEqual([a, b]);
    // A fresh parse of what was stored gives the same list (a reload).
    expect(parseWaypoints(JSON.parse(JSON.stringify(mem.get(KEY)))).list).toEqual([a, b]);
  });

  it(`stops at ${WAYPOINT_CAP}: the next save returns null and stores nothing`, () => {
    for (let i = 0; i < WAYPOINT_CAP; i++) expect(saveWaypoint(pose(i), '2d')).not.toBeNull();
    const before = mem.get(KEY);
    expect(saveWaypoint(pose(99), '2d')).toBeNull();
    expect(listWaypoints()).toHaveLength(WAYPOINT_CAP);
    expect(mem.get(KEY)).toBe(before);
  });

  it('default names count on after deletes, across a reload, and skip a name already taken', () => {
    saveWaypoint(pose(1), '2d');
    saveWaypoint(pose(2), '2d');
    const third = saveWaypoint(pose(3), '2d');
    deleteWaypoint(third!.id);
    expect(saveWaypoint(pose(4), '2d')?.name).toBe('Spot 4');
    mem.set(KEY, JSON.parse(JSON.stringify(mem.get(KEY))));
    renameWaypoint(listWaypoints()[0]!.id, 'Spot 5');
    expect(saveWaypoint(pose(5), '2d')?.name).toBe('Spot 6');
    for (const w of listWaypoints()) deleteWaypoint(w.id);
    expect(saveWaypoint(pose(6), '2d')?.name).toBe('Spot 7');
  });

  it(`rename trims, keeps at most ${WAYPOINT_NAME_MAX} characters, and ignores an empty name or an unknown id`, () => {
    const w = saveWaypoint(pose(1), '2d')!;
    renameWaypoint(w.id, '   Near the shop  ');
    expect(names()).toEqual(['Near the shop']);
    renameWaypoint(w.id, 'x'.repeat(WAYPOINT_NAME_MAX + 10));
    expect(names()).toEqual(['x'.repeat(WAYPOINT_NAME_MAX)]);
    renameWaypoint(w.id, '   ');
    renameWaypoint('nope', 'Other');
    expect(names()).toEqual(['x'.repeat(WAYPOINT_NAME_MAX)]);
  });

  it('delete removes one; an unknown id changes nothing', () => {
    const a = saveWaypoint(pose(1), '2d')!;
    const b = saveWaypoint(pose(2), '2d')!;
    deleteWaypoint(a.id);
    deleteWaypoint('nope');
    expect(listWaypoints()).toEqual([b]);
  });

  it('a corrupt stored value loads as empty without throwing; bad items are dropped, good ones kept', () => {
    for (const junk of ['nope', 42, null, [], { list: 'x' }, { seq: 'x', list: null }]) {
      mem.set(KEY, junk);
      expect(listWaypoints()).toEqual([]);
    }
    const good = { id: 'a', name: 'Home', x: 1, y: 2, alt: 64, view: '2d', yaw: 0, pitch: 0 };
    mem.set(KEY, {
      seq: 3,
      list: [
        good, { ...good, id: 'a' }, { ...good, id: 'b', x: Number.NaN }, { ...good, id: 'c', name: '  ' }, { ...good, id: '' }, 'junk',
        { ...good, id: 'd', view: 'iso', yaw: 'x', pitch: undefined, name: `  ${'y'.repeat(50)}` },
      ],
    });
    expect(listWaypoints()).toEqual([good, { ...good, id: 'd', view: '2d', yaw: 0, pitch: 0, name: 'y'.repeat(WAYPOINT_NAME_MAX) }]);
    // A save after a corrupt load still works and never reuses an id.
    expect(saveWaypoint(pose(1), '2d')?.id).not.toMatch(/^(a|d)$/);
  });

  it(`a stored list longer than ${WAYPOINT_CAP} keeps the first ${WAYPOINT_CAP}`, () => {
    const list = Array.from({ length: WAYPOINT_CAP + 5 }, (_, i) => ({ id: `w${i}`, name: `W${i}`, x: i, y: 0, alt: 64, view: '2d', yaw: 0, pitch: 0 }));
    mem.set(KEY, { seq: 30, list });
    expect(listWaypoints().map((w) => w.id)).toEqual(list.slice(0, WAYPOINT_CAP).map((w) => w.id));
  });

  it('listeners hear every change with the new list, and stop after unsubscribing', () => {
    const seen: string[][] = [];
    const off = onWaypointsChange((list) => { seen.push(list.map((w) => w.name)); });
    const w = saveWaypoint(pose(1), '2d')!;
    renameWaypoint(w.id, 'Home');
    renameWaypoint(w.id, 'Home');
    deleteWaypoint(w.id);
    off();
    saveWaypoint(pose(2), '2d');
    expect(seen).toEqual([['Spot 1'], ['Home'], []]);
  });

  it('a throwing listener never blocks the others or the write', () => {
    const seen: number[] = [];
    const offs = [onWaypointsChange(() => { throw new Error('boom'); }), onWaypointsChange((l) => { seen.push(l.length); })];
    expect(() => saveWaypoint(pose(1), '2d')).not.toThrow();
    expect(seen).toEqual([1]);
    for (const off of offs) off();
  });
});
