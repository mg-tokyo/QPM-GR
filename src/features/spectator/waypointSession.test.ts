// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  mem: new Map<string, unknown>(),
  menus: [] as Array<{ src: import('./ui/waypointMenu').WaypointMenuSource; renders: number; destroyed: boolean; ended: number }>,
}));
vi.mock('../../utils/storage', () => ({
  storage: {
    get: (k: string, d: unknown = null) => (h.mem.has(k) ? h.mem.get(k) : d),
    set: (k: string, v: unknown) => { h.mem.set(k, v); },
  },
}));
vi.mock('../../i18n', () => ({
  t: (k: string, v?: Record<string, unknown>) => (k === 'feature.spectator.wp.default' ? `Spot ${String(v?.n)}` : v ? `${k} ${JSON.stringify(v)}` : k),
}));
vi.mock('./ui/waypointMenu', () => ({
  createWaypointMenu: (src: import('./ui/waypointMenu').WaypointMenuSource) => {
    const m = { src, renders: 0, destroyed: false, ended: 0 };
    h.menus.push(m);
    return {
      el: document.createElement('div'), render: () => { m.renders++; }, endEdit: () => { m.ended++; }, destroy: () => { m.destroyed = true; },
    };
  },
}));

import type { GridPosition } from '../../types/gameAtoms';
import type { SpectatorPose, SpectatorViewKind } from './state';
import { installWaypoints, type WaypointDeps, type WaypointSession } from './waypointSession';
import { listWaypoints, saveWaypoint, WAYPOINT_CAP } from './waypoints';

let pose: SpectatorPose | null;
let view: SpectatorViewKind;
let busy: boolean;
let refuse: boolean;
let flights: Array<[GridPosition, number | null]>;
let notices: string[];
let toasts: Array<[string, number]>;
let menuEls: Array<HTMLElement | null>;
let onClose: (() => void) | undefined;
let closes: number;
let wp: WaypointSession;

function deps(): WaypointDeps {
  return {
    pose: () => pose, view: () => view, busy: () => busy,
    flyTo: (p, tile) => { if (refuse) return false; flights.push([p, tile]); return true; },
    notice: (text) => { notices.push(text); },
    toast: (text, ms) => { toasts.push([text, ms]); },
    saveKey: () => 'B',
    setMenu: (el, close) => { menuEls.push(el); onClose = close; },
    closeMenu: () => { closes++; },
  };
}

const menu = () => h.menus.at(-1)!;
const at = (x: number, y = 5, alt = 64): SpectatorPose => ({ x, y, alt, yaw: 0, pitch: 0 });

beforeEach(() => {
  h.mem.clear();
  h.menus.length = 0;
  pose = at(10);
  view = '2d';
  busy = false;
  refuse = false;
  flights = [];
  notices = [];
  toasts = [];
  menuEls = [];
  closes = 0;
  wp = installWaypoints(deps());
});

describe('spectator waypoint session', () => {
  it('hands the bar its menu at once; B saves where the camera is, says so, and marks it current', () => {
    expect(menuEls).toHaveLength(1);
    expect(menuEls[0]).toBeInstanceOf(HTMLElement);
    // The popover closing ends a rename being typed (it commits).
    onClose?.();
    expect(menu().ended).toBe(1);
    const before = menu().renders;
    wp.save();
    expect(listWaypoints()).toEqual([expect.objectContaining({ name: 'Spot 1', x: 10, y: 5, alt: 64, view: '2d' })]);
    expect(toasts).toEqual([['feature.spectator.wp.saved {"name":"Spot 1"}', 2000]]);
    expect(menu().src.currentId()).toBe(listWaypoints()[0]!.id);
    expect(menu().renders).toBeGreaterThan(before);
  });

  it(`B at ${WAYPOINT_CAP} saves nothing and tells the player (notify)`, () => {
    for (let i = 0; i < WAYPOINT_CAP; i++) saveWaypoint(at(i), '2d');
    wp.save();
    expect(listWaypoints()).toHaveLength(WAYPOINT_CAP);
    expect(notices).toEqual([`feature.spectator.wp.full {"max":${WAYPOINT_CAP}}`]);
    expect(toasts).toEqual([]);
  });

  it('B waits while the camera is busy (the game has it, or spectating flies home), and with no pose', () => {
    busy = true;
    wp.save();
    busy = false;
    pose = null;
    wp.save();
    expect(listWaypoints()).toEqual([]);
    expect(toasts).toEqual([]);
  });

  it('. and , fly through them in order from the current one and wrap; each says where it goes', () => {
    const [a, b, c] = [saveWaypoint(at(1), '2d')!, saveWaypoint(at(2, 5, 78), '2d')!, saveWaypoint(at(3), '2d')!];
    wp.cycle(1);
    wp.cycle(1);
    wp.cycle(1);
    wp.cycle(1);
    wp.cycle(-1);
    expect(flights.map(([p]) => p.x)).toEqual([1, 2, 3, 1, 3]);
    expect(flights[1]).toEqual([{ x: 2, y: 5 }, 78]);
    expect(toasts.map(([s]) => s)).toEqual([a, b, c, a, c].map((w) => `feature.spectator.wp.flying {"name":"${w.name}"}`));
    expect(toasts[0]![1]).toBe(1500);
    expect(menu().src.currentId()).toBe(c.id);
    // , with no current one starts from the last; after a save the new one is current.
    wp.uninstall();
    flights = [];
    wp = installWaypoints(deps());
    wp.cycle(-1);
    expect(flights.map(([p]) => p.x)).toEqual([3]);
    wp.save();
    wp.cycle(1);
    expect(flights.map(([p]) => p.x)).toEqual([3, 1]);
  });

  it('a 3D waypoint opens straight down at its spot with the zoom you have (Phase A)', () => {
    saveWaypoint({ x: 7, y: 8, alt: 900, yaw: 45, pitch: -30 }, '3d');
    wp.cycle(1);
    expect(flights).toEqual([[{ x: 7, y: 8 }, null]]);
  });

  it('. with none saved says how to save one; a refused fly leaves the current one and says nothing', () => {
    wp.cycle(1);
    expect(notices).toEqual(['feature.spectator.wp.empty {"key":"B"}']);
    const a = saveWaypoint(at(1), '2d')!;
    refuse = true;
    wp.cycle(1);
    expect(toasts).toEqual([]);
    expect(menu().src.currentId()).toBeNull();
    refuse = false;
    expect(wp.fly(a.id)).toBe(true);
    expect(menu().src.currentId()).toBe(a.id);
  });

  it('the menu flies to a row and closes without a toast; renames and deletes go to the store and redraw it', () => {
    const a = saveWaypoint(at(1), '2d')!;
    menu().src.fly(a.id);
    expect(flights).toHaveLength(1);
    expect(closes).toBe(1);
    expect(toasts).toEqual([]);
    expect(wp.fly('nope')).toBe(false);
    const before = menu().renders;
    menu().src.rename(a.id, 'Home');
    expect(listWaypoints()[0]!.name).toBe('Home');
    menu().src.remove(a.id);
    expect(listWaypoints()).toEqual([]);
    expect(menu().renders).toBe(before + 2);
    menu().src.save();
    expect(listWaypoints()).toHaveLength(1);
    expect(menu().src.saveKey()).toBe('B');
    expect(menu().src.list()).toEqual(listWaypoints());
  });

  it('uninstall takes the menu from the bar first, then destroys it; later changes draw nothing; twice is harmless', () => {
    const m = menu();
    const el = menuEls[0];
    wp.uninstall();
    wp.uninstall();
    expect(menuEls).toEqual([el, null]);
    expect(m.destroyed).toBe(true);
    const n = m.renders;
    saveWaypoint(at(1), '2d');
    expect(m.renders).toBe(n);
    wp.save();
    wp.cycle(1);
    expect(flights).toEqual([]);
  });
});
