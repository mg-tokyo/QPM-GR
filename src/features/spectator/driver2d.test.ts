import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ mem: new Map<string, unknown>(), writes: [] as Array<[string, unknown]>, refuse: new Set<string>() }));
vi.mock('../../core/gameState', () => ({
  readSync: (k: string) => (h.mem.has(k) ? h.mem.get(k) : null),
  writeSync: (k: string, v: unknown) => {
    if (h.refuse.has(k)) return false;
    h.mem.set(k, v);
    h.writes.push([k, v]);
    return true;
  },
}));
vi.mock('../../diagnostics/perfMonitor', () => ({ recordProbe: () => {} }));

import type { GridPosition } from '../../types/gameAtoms';
import { createFakeTicker, createFakeZoomSys } from './__test__/fakeGame';
import { installDriver2d, type Driver2d } from './driver2d';
import type { FlightInput } from './pose/flight';
import { createSpectatorStore, type SpectatorStore } from './state';

const other = { ownerName: 'gameDialog', token: 'gameDialog:1', allowMovementKeys: 'none' };
const still: FlightInput = { fx: 0, fy: 0, up: 0, fast: false };
let ticker: ReturnType<typeof createFakeTicker>;
let zoomSys: ReturnType<typeof createFakeZoomSys>;
let store: SpectatorStore;
let input: FlightInput;
let cam: GridPosition | null;
let liveZoom: ReturnType<typeof createFakeZoomSys>['zoom'] | null;
const ends: Array<[string, unknown]> = [];
const pauses: string[] = [];
const displaced: number[] = [];
let detaches = 0;
let frames: number[] = [];
let frameThrows = false;

const target = (): unknown => h.mem.get('cutsceneCameraTarget');
const owners = (): unknown[] => h.mem.get('keyboardCaptureOwners') as unknown[];
const targetWrites = (): number => h.writes.filter((w) => w[0] === 'cutsceneCameraTarget').length;
const flush = (): Promise<void> => new Promise((r) => { queueMicrotask(r); });

function install(): Driver2d {
  return installDriver2d(
    store,
    {
      engine: {}, ticker, zoomSys, viewSize: () => ({ w: 1278, h: 632 }), cameraPoint: () => cam, notifyActivity: () => {},
      liveZoom: () => liveZoom,
      avatars: { views: new Map() },
      pointer: { isCanvas: () => false, toGlobal: () => null, overUi: () => false, toGrid: () => null },
    },
    {
      input: () => input, speed: () => 600,
      onPause: (r) => { pauses.push(r); },
      onDisplaced: (n) => { displaced.push(n); },
      onEnd: (r, e) => { ends.push([r, e]); },
      onDetach: () => { detaches++; },
      frame: (now) => { if (frameThrows) throw new Error('director'); frames.push(now); },
    },
  );
}

beforeEach(() => {
  h.mem.clear();
  h.writes.length = 0;
  ends.length = 0;
  pauses.length = 0;
  displaced.length = 0;
  detaches = 0;
  frames = [];
  frameThrows = false;
  h.mem.set('localPresence', 'seated');
  h.mem.set('cutsceneCameraTarget', null);
  h.mem.set('cameraTarget', { x: 24, y: 23.75 });
  h.mem.set('activeCutscene', null);
  h.mem.set('tramJourney', null);
  h.mem.set('keyboardCaptureOwners', [other]);
  h.mem.set('zoomIntent', null);
  ticker = createFakeTicker();
  zoomSys = createFakeZoomSys((t) => { h.mem.set('zoomIntent', t); });
  store = createSpectatorStore();
  input = still;
  cam = null;
  liveZoom = zoomSys.zoom;
  h.refuse.clear();
});

describe('2D driver: writes the game refuses or replaces', () => {
  it('a refused owner write fails the install, and mid-session ends spectating as an error, not a run of displacements', async () => {
    h.refuse.add('keyboardCaptureOwners');
    expect(() => install()).toThrow(/owner/);
    expect(ticker.priorities()).toEqual([]);
    h.refuse.clear();
    install();
    ticker.tick();
    h.mem.set('keyboardCaptureOwners', [other]);
    h.refuse.add('keyboardCaptureOwners');
    ticker.tick(3);
    await flush();
    expect(displaced).toEqual([1]);
    expect(ends).toHaveLength(1);
    expect(ends[0]![0]).toBe('error');
  });

  it('the frame hook runs after each step on the game clock, never once spectating is ending, and its throw ends it', async () => {
    const d = install();
    ticker.tick(2);
    expect(frames).toEqual([ticker.deltaMS, 2 * ticker.deltaMS]);
    frameThrows = true;
    ticker.tick();
    await flush();
    expect(ends.map((e) => e[0])).toEqual(['error']);
    frameThrows = false;
    ticker.tick();
    expect(frames).toHaveLength(2);
    d.uninstall();
  });

  it('after an engine swap the zoom is restored on the controller that runs now', () => {
    const d = install();
    d.stepZoom(-1);
    const next = createFakeZoomSys((t) => { h.mem.set('zoomIntent', t); }, 60 / 1.3);
    liveZoom = next.zoom;
    d.uninstall();
    expect(next.zoom.intentTileSize).toBe(60);
    expect(h.mem.get('zoomIntent')).toBeNull();
  });
});

describe('2D driver', () => {
  it('takes the keyboard with its own owner, listens before the engine, and writes nothing until a frame', () => {
    const d = install();
    expect(owners()).toHaveLength(2);
    expect(owners()[0]).toBe(other);
    expect(owners()[1]).toMatchObject({ ownerName: 'qpm-spectator', allowMovementKeys: 'none' });
    expect(ticker.priorities()).toEqual([1]);
    expect(targetWrites()).toBe(0);
    expect(d.pose()).toMatchObject({ x: 24, y: 23.75, alt: 60 });
  });

  it('starts where the camera is drawn when that is readable', () => {
    cam = { x: 30.25, y: 12.5 };
    expect(install().pose()).toMatchObject({ x: 30.25, y: 12.5 });
  });

  it('writes the target only on frames where the pose moved', () => {
    const d = install();
    ticker.tick();
    expect(target()).toEqual({ x: 24, y: 23.75 });
    const n = targetWrites();
    ticker.tick(3);
    expect(targetWrites()).toBe(n);
    input = { ...still, fy: 1 };
    ticker.tick(15);
    const p = target() as GridPosition;
    expect(p.x).toBe(24);
    expect(23.75 - p.y).toBeGreaterThan(3.5);
    expect(d.pose()).toMatchObject({ x: p.x, y: p.y });
  });

  it('uninstall releases only what QPM still holds, restores the zoom exactly, and is idempotent', () => {
    const d = install();
    ticker.tick();
    d.stepZoom(-1);
    expect(h.mem.get('zoomIntent')).toBeCloseTo(60 / 1.3, 6);
    d.uninstall();
    expect(target()).toBeNull();
    expect(owners()).toEqual([other]);
    expect(zoomSys.zoom.intentTileSize).toBe(60);
    expect(h.mem.get('zoomIntent')).toBeNull();
    expect(ticker.priorities()).toEqual([]);
    d.uninstall();
    expect(owners()).toEqual([other]);
  });

  it('a target that is no longer QPM\'s write is left alone at uninstall', () => {
    const d = install();
    ticker.tick();
    h.mem.set('cutsceneCameraTarget', { x: 50, y: 30 });
    d.uninstall();
    expect(target()).toEqual({ x: 50, y: 30 });
  });

  it('while the game UI owns input the owner steps out and flying pauses; the camera holds', () => {
    const d = install();
    ticker.tick();
    zoomSys.blocked = true;
    input = { ...still, fy: 1 };
    ticker.tick(5);
    expect(owners()).toEqual([other]);
    expect(store.get().paused).toBe('ui');
    expect(target()).toEqual({ x: 24, y: 23.75 });
    d.stepZoom(-1);
    expect(zoomSys.zoom.intentTileSize).toBe(60);
    zoomSys.blocked = false;
    ticker.tick();
    expect(owners()).toHaveLength(2);
    expect(store.get().paused).toBeNull();
    expect(displaced).toEqual([]);
  });

  it('puts back a displaced owner and reports it; the third displacement ends spectating', async () => {
    install();
    ticker.tick();
    h.mem.set('keyboardCaptureOwners', [other]);
    ticker.tick();
    expect(owners()).toHaveLength(2);
    expect(displaced).toEqual([1]);
    for (let i = 0; i < 2; i++) { h.mem.set('keyboardCaptureOwners', [other]); ticker.tick(); }
    await flush();
    expect(displaced).toEqual([1, 2, 3]);
    expect(ends).toEqual([['owner-displaced', undefined]]);
  });

  it('a cutscene: QPM lets go of its target, pauses once, then flies back from where the game left the camera', () => {
    const d = install();
    input = { ...still, fy: 1 };
    ticker.tick(10);
    input = still;
    ticker.tick(5);
    const pose = d.pose();
    h.mem.set('activeCutscene', {});
    ticker.tick();
    expect(target()).toBeNull();
    expect(store.get().paused).toBe('cutscene');
    h.mem.set('cutsceneCameraTarget', { x: 70, y: 40 });
    ticker.tick(5);
    expect(target()).toEqual({ x: 70, y: 40 });
    expect(pauses).toEqual(['cutscene']);
    h.mem.set('activeCutscene', null);
    h.mem.set('cutsceneCameraTarget', null);
    cam = { x: 24, y: 23.75 };
    ticker.tick();
    expect(store.get().paused).toBeNull();
    expect(target()).toEqual({ x: 24, y: 23.75 });
    ticker.tick(30);
    expect(target()).toEqual({ x: pose.x, y: pose.y });
    expect(pauses).toEqual(['cutscene']);
  });

  it('a key pressed as the resume fly starts flies on from where the game left the camera, not the old pose', () => {
    install();
    ticker.tick();
    h.mem.set('activeCutscene', {});
    ticker.tick();
    h.mem.set('activeCutscene', null);
    cam = { x: 70, y: 40 };
    input = { ...still, fx: 1 };
    ticker.tick();
    const p = target() as GridPosition;
    expect(p.x).toBeGreaterThanOrEqual(70);
    expect(p.x).toBeLessThan(70.25);
    expect(p.y).toBe(40);
  });

  it('a foreign target pauses without being touched and resumes once it is cleared', () => {
    install();
    ticker.tick();
    h.mem.set('cutsceneCameraTarget', { x: 50, y: 30 });
    ticker.tick(3);
    expect(target()).toEqual({ x: 50, y: 30 });
    expect(store.get().paused).toBe('foreign');
    expect(pauses).toEqual(['foreign']);
    h.mem.set('cutsceneCameraTarget', null);
    ticker.tick();
    expect(store.get().paused).toBeNull();
  });

  it('a tram ride releases the target so the tram camera and its zoom run', () => {
    install();
    ticker.tick();
    h.mem.set('tramJourney', {});
    ticker.tick();
    expect(target()).toBeNull();
    expect(store.get().paused).toBe('tram');
  });

  it('losing the seat ends spectating once, outside the frame, and later frames do nothing', async () => {
    install();
    ticker.tick();
    h.mem.set('localPresence', 'unseated');
    ticker.tick(3);
    expect(ends).toEqual([]);
    await flush();
    expect(ends).toEqual([['presence', undefined]]);
  });

  it('a throwing frame ends spectating once as an error', async () => {
    install();
    zoomSys.shouldBlockZoom = () => { throw new Error('boom'); };
    ticker.tick(3);
    await flush();
    expect(ends).toHaveLength(1);
    expect(ends[0]![0]).toBe('error');
    expect(ends[0]![1]).toBeInstanceOf(Error);
  });

  it('flying home ignores input, eases the zoom back, lands on the avatar point and ends', async () => {
    const d = install();
    ticker.tick();
    d.stepZoom(-1);
    input = { ...still, fx: 1 };
    ticker.tick(10);
    d.flyHome({ x: 24, y: 23.75 });
    expect(d.homing()).toBe(true);
    expect(zoomSys.stepped).toEqual([60]);
    d.stepZoom(-1);
    expect(zoomSys.zoom.intentTileSize).toBe(60);
    ticker.tick(30);
    expect(target()).toEqual({ x: 24, y: 23.75 });
    await flush();
    expect(ends).toEqual([['home', undefined]]);
  });

  it('stepZoom drives the game keyboard zoom: -1 out, +1 in', () => {
    const d = install();
    d.stepZoom(1);
    expect(zoomSys.zoom.intentTileSize).toBeCloseTo(78, 6);
    d.stepZoom(-1);
    expect(zoomSys.zoom.intentTileSize).toBeCloseTo(60, 6);
  });
});

describe('2D driver: following', () => {
  // A player walking east at 4 tiles per second of frame time.
  const walker = (calls: number[] = []) => (frameMs: number): GridPosition => {
    calls.push(frameMs);
    return { x: 40 + (frameMs / 1000) * 4, y: 20 };
  };

  it('flies to the player, lands on where they are by then (no jump), then stays locked on', () => {
    const d = install();
    ticker.tick();
    const calls: number[] = [];
    const src = walker(calls);
    d.setFollowSource(src);
    expect(d.following()).toBe(true);
    ticker.tick(40);
    const frameMs = ticker.lastTime + ticker.elapsedMS;
    expect(target()).toEqual(src(frameMs));
    ticker.tick();
    expect(target()).toEqual(src(ticker.lastTime + ticker.elapsedMS));
    // The source is asked for the game's frame time, the clock its avatars glide on (live 1448).
    expect(calls.at(-2)).toBe(ticker.lastTime + ticker.elapsedMS);
  });

  it('follows through a game window (only flying pauses)', () => {
    const d = install();
    d.setFollowSource(() => ({ x: 30, y: 30 }));
    ticker.tick(40);
    zoomSys.blocked = true;
    d.setFollowSource(() => ({ x: 31, y: 30 }));
    ticker.tick(40);
    expect(target()).toEqual({ x: 31, y: 30 });
  });

  it('WASD detaches where the camera is, once, and flies free from there', () => {
    const d = install();
    d.setFollowSource(() => ({ x: 30, y: 30 }));
    ticker.tick(40);
    input = { ...still, fx: 1 };
    ticker.tick();
    expect(detaches).toBe(1);
    expect(d.following()).toBe(false);
    const p = target() as GridPosition;
    expect(p.y).toBe(30);
    expect(p.x).toBeGreaterThan(30);
    expect(p.x).toBeLessThan(30.25);
    ticker.tick(5);
    expect(detaches).toBe(1);
  });

  it('dropping the source stays put; a source with no position holds the camera', () => {
    const d = install();
    d.setFollowSource(() => ({ x: 30, y: 30 }));
    ticker.tick(40);
    d.setFollowSource(null);
    const n = targetWrites();
    ticker.tick(5);
    expect(targetWrites()).toBe(n);
    expect(target()).toEqual({ x: 30, y: 30 });
    d.setFollowSource(() => null);
    ticker.tick(5);
    expect(targetWrites()).toBe(n);
    expect(detaches).toBe(0);
  });

  it('a drag pans free cam against the drag at the screen scale', () => {
    const d = install();
    ticker.tick();
    d.panBy(120, -60);
    ticker.tick();
    expect(target()).toEqual({ x: 22, y: 24.75 });
    ticker.tick(3);
    expect(target()).toEqual({ x: 22, y: 24.75 });
  });

  it('after a cutscene it flies back to where the player is now', () => {
    const d = install();
    let x = 30;
    d.setFollowSource(() => ({ x, y: 30 }));
    ticker.tick(40);
    h.mem.set('activeCutscene', {});
    ticker.tick();
    expect(target()).toBeNull();
    x = 35;
    h.mem.set('activeCutscene', null);
    cam = { x: 50, y: 30 };
    ticker.tick(40);
    expect(target()).toEqual({ x: 35, y: 30 });
    expect(d.following()).toBe(true);
  });
});

describe('2D driver: waypoint fly-to', () => {
  it('drops the follow, eases the zoom, flies the normal fly-to and stays there in free cam', () => {
    const d = install();
    d.setFollowSource(() => ({ x: 30, y: 30 }));
    ticker.tick(40);
    expect(d.flyTo({ x: 60, y: 40 }, 78)).toBe(true);
    expect(d.following()).toBe(false);
    expect(zoomSys.stepped).toEqual([78]);
    ticker.tick(5);
    const mid = target() as GridPosition;
    expect(mid.x).toBeGreaterThan(30);
    expect(mid.x).toBeLessThan(60);
    // Mid-fly the pose carries the zoom the game shows (a B pressed now saves it), not the zoom the fly began at.
    expect(d.pose().alt).toBe(78);
    ticker.tick(30);
    expect(target()).toEqual({ x: 60, y: 40 });
    ticker.tick(5);
    expect(target()).toEqual({ x: 60, y: 40 });
    expect(detaches).toBe(0);
  });

  it('a key stops it where it is; no tile size (a 3D spot) or the same zoom leaves the zoom alone', () => {
    const d = install();
    ticker.tick();
    expect(d.flyTo({ x: 60, y: 40 }, null)).toBe(true);
    expect(d.flyTo({ x: 60, y: 40 }, 60.2)).toBe(true);
    expect(zoomSys.stepped).toEqual([]);
    ticker.tick(5);
    const at = target() as GridPosition;
    input = { ...still, fx: 1 };
    ticker.tick();
    input = still;
    ticker.tick(40);
    const p = target() as GridPosition;
    expect(p.x).toBeGreaterThan(at.x);
    expect(p.x).toBeLessThan(40);
  });

  it('a key already held when it starts does not stop it (it lands, then flies on); letting go and pressing again does', () => {
    const d = install();
    ticker.tick();
    input = { ...still, fx: 1 };
    ticker.tick(2);
    expect(d.flyTo({ x: 60, y: 40 }, null)).toBe(true);
    ticker.tick(40);
    const landed = target() as GridPosition;
    expect(landed.y).toBe(40);
    expect(landed.x).toBeGreaterThan(60);
    expect(d.flyTo({ x: 30, y: 30 }, null)).toBe(true);
    ticker.tick(3);
    input = still;
    ticker.tick();
    input = { ...still, fx: 1 };
    ticker.tick();
    input = still;
    ticker.tick(40);
    expect((target() as GridPosition).y).toBeGreaterThan(36);
  });

  it('refused while the game has the camera, while flying home, and for a non-finite spot; a pick before the frame wins', () => {
    const d = install();
    ticker.tick();
    h.mem.set('activeCutscene', {});
    ticker.tick();
    expect(d.flyTo({ x: 60, y: 40 }, 78)).toBe(false);
    expect(zoomSys.stepped).toEqual([]);
    h.mem.set('activeCutscene', null);
    ticker.tick(40);
    expect(d.flyTo({ x: Number.NaN, y: 40 }, 78)).toBe(false);
    expect(d.flyTo({ x: 60, y: 40 }, null)).toBe(true);
    d.setFollowSource(() => ({ x: 30, y: 30 }));
    ticker.tick(40);
    expect(target()).toEqual({ x: 30, y: 30 });
    d.flyHome({ x: 24, y: 23.75 });
    expect(d.flyTo({ x: 60, y: 40 }, 78)).toBe(false);
  });
});
