import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeMatrix } from './__test__/fakeMatrix';
import { FakeNode } from './__test__/fakeNode';
import { PixiNode } from './__test__/fakePixi';
import type { Pass } from './frame/frame';
import { installRenderHook, uninstallRenderHook } from './frame/renderHook';
import { NEAR_PLANE, farPlaneFor, type CameraView } from './math/zoomCurve';
import { createRuntime, type FailGuard, type Runtime, type ViewSource, type ViewSourceInput } from './runtime';
import type { GroundTracker } from './scene/ground';
import type { Caps } from './types';

// A World child with PIXI-style prototype accessors, so the overrides can shadow them.
class GameNode {
  private v = true; private z = 0; private a = 1;
  get visible(): boolean { return this.v; } set visible(x: boolean) { this.v = x; }
  get zIndex(): number { return this.z; } set zIndex(x: number) { this.z = x; }
  get alpha(): number { return this.a; } set alpha(x: number) { this.a = x; }
  label: string | null = null;
  destroyed = false;
  parent: unknown = null;
  readonly children: GameNode[] = [];
  x = 0; y = 0;
  readonly localTransform = new FakeMatrix();
  readonly renderGroup = null;
  updateLocalTransform(): void { /* identity */ }
}

const VIEW: CameraView = {
  params: { yaw: 0, pitch: 0.5, dist: 1600, fov: 1, lookH: 120, yOff: 0.12, near: NEAR_PLANE, far: farPlaneFor(101, 60) },
  target: { x: 0, y: 0 },
  tilt: 1,
  hideSelf: false,
  selfAlpha: 1,
  hand: 0,
};

interface Rig {
  rt: Runtime;
  fails: Array<[string, string]>;
  exits: string[];
  renders: number;
  camera: FakeNode;
  world: GameNode;
  /** One stage render: the original draws (and counts) unless `throwOnce` is set. */
  render(throwOnce?: boolean): unknown;
  guard: FailGuard & { stop: boolean };
}

const flatTracker = { isAvatar: () => false, groundY: (_n: unknown, sortY: number) => sortY, riderOf: () => null, feetH: () => 0, eyeH: () => 0, tileOf: () => null } as unknown as GroundTracker;

function rig(passes: Pass[] = [], classes: Record<string, unknown> = {}, tracker: GroundTracker = flatTracker): Rig {
  const camera = new FakeNode();
  const world = new GameNode();
  world.label = 'World';
  world.parent = camera;
  (camera.children as unknown[]).push(world);
  const avatar = new GameNode();
  avatar.label = 'AvatarContainer (p1)';
  avatar.parent = world;
  world.children.push(avatar);
  const tilemap = new GameNode();
  const caps = { scene: { renderer: { screen: { width: 800, height: 600 } }, camera, world, ground: null, weather: null, tilemap, stage: camera }, classes, systems: { map: { cols: 101, rows: 60 } } } as unknown as Caps;
  const fails: Array<[string, string]> = [];
  const guard = { stop: false, fail(phase: string, e: unknown) { fails.push([phase, String((e as Error).message)]); }, paused() { return this.stop; } };
  const rt = createRuntime(caps, passes, tracker, guard);
  rt.setPlayerId('p1');
  const exits: string[] = [];
  rt.onExit((r) => exits.push(r));
  const r: Rig = {
    rt, fails, exits, renders: 0, camera, world, guard,
    render(throwOnce = false) {
      let armed = throwOnce;
      return rt.onStage(() => {
        if (armed) { armed = false; throw new Error('draw'); }
        r.renders++;
        return 'drawn';
      });
    },
  };
  return r;
}

const fixed: ViewSource = () => VIEW;
const pass = (over: Partial<Pass>): Pass => ({ name: 'p', pre() { /* noop */ }, drop() { /* noop */ }, destroy() { /* noop */ }, ...over });

describe('runtime failure routing', () => {
  it('a throwing stage callback is reported, the others still run, and the 2D frame draws', () => {
    const r = rig();
    let later = 0;
    r.rt.onStageRender(() => { throw new Error('cb'); });
    r.rt.onStageRender(() => { later++; });
    expect(r.render()).toBe('drawn');
    expect(r.fails).toEqual([['stage', 'cb']]);
    expect(later).toBe(1);
  });

  it('a throwing view source exits to 2D and the frame draws in 2D', () => {
    const r = rig();
    expect(r.rt.enter(() => { throw new Error('view'); })).toBe(true);
    expect(r.render()).toBe('drawn');
    expect(r.fails).toEqual([['view', 'view']]);
    expect(r.rt.isLive()).toBe(false);
    expect(r.exits).toEqual(['error:view']);
    expect(r.renders).toBe(1);
  });

  it('a source that returns a reason exits with that reason, not as a failure', () => {
    const r = rig();
    r.rt.enter(() => 'zoomed-out');
    r.render();
    expect(r.exits).toEqual(['zoomed-out']);
    expect(r.fails).toEqual([]);
  });

  it('the runtime names its own blocks: camera overlay and missing avatar', () => {
    const r = rig();
    r.rt.enter(fixed);
    r.camera.addChild(new FakeNode());
    r.render();
    expect(r.exits).toEqual(['camera-overlay']);
    const r2 = rig();
    r2.rt.enter(fixed);
    r2.rt.setPlayerId('someone-else');
    r2.render();
    expect(r2.exits).toEqual(['no-avatar']);
  });

  it('a pass whose pre throws: restored, reported as pre, drawn in 2D', () => {
    const r = rig([pass({ pre() { throw new Error('pre'); } })]);
    r.rt.enter(fixed);
    r.render();
    expect(r.fails).toEqual([['pre', 'pre']]);
    expect(r.exits).toEqual(['error:pre']);
    expect(r.renders).toBe(1);
    expect(r.rt.ov.count()).toBe(0);
  });

  it('a render that throws in 3D is redrawn in 2D once', () => {
    const r = rig();
    r.rt.enter(fixed);
    expect(r.render(true)).toBe('drawn');
    expect(r.fails).toEqual([['render', 'draw']]);
    expect(r.renders).toBe(1);
  });

  it('a pass whose post throws is reported after the 3D frame restored', () => {
    const r = rig([pass({ post() { throw new Error('post'); } })]);
    r.rt.enter(fixed);
    r.render();
    expect(r.fails).toEqual([['post', 'post']]);
    expect(r.rt.isLive()).toBe(false);
    expect(r.camera.scale.x).toBe(1);
  });

  it('post-render and frame listeners route their throws', () => {
    const r = rig();
    r.rt.onPostRender(() => { throw new Error('hover'); });
    r.rt.onFrame(() => { throw new Error('frame'); });
    r.rt.enter(fixed);
    r.render();
    expect(r.fails.map((f) => f[0])).toEqual(['postRender', 'frame']);
  });

  it('fail() from an addon exits 3D and reaches the guard', () => {
    const r = rig();
    r.rt.enter(fixed);
    r.rt.fail('pick', new Error('pick'));
    expect(r.rt.isLive()).toBe(false);
    expect(r.exits).toEqual(['error:pick']);
    expect(r.fails).toEqual([['pick', 'pick']]);
  });

  it('a throwing exit listener is counted and the other listeners still run', () => {
    const r = rig();
    r.rt.onExit(() => { throw new Error('exit'); });
    let after = 0;
    r.rt.onExit(() => { after++; });
    r.rt.enter(fixed);
    r.rt.exit('debug');
    expect(r.fails).toEqual([['exit', 'exit']]);
    expect(after).toBe(1);
  });

  it('an exit listener that throws inside a failure exit is not counted twice', () => {
    const r = rig();
    r.rt.onExit(() => { throw new Error('exit'); });
    r.rt.enter(fixed);
    r.rt.fail('pick', new Error('pick'));
    expect(r.fails).toEqual([['pick', 'pick']]);
  });

  it('a paused guard refuses enter', () => {
    const r = rig();
    r.guard.stop = true;
    expect(r.rt.enter(fixed)).toBe(false);
  });

  it('a block exits 3D with its reason and refuses entry until lifted (context loss, A R5)', () => {
    const r = rig();
    r.rt.enter(fixed);
    r.rt.block('context-lost', true);
    expect(r.rt.isLive()).toBe(false);
    expect(r.exits).toEqual(['context-lost']);
    expect(r.rt.blockedReason()).toBe('context-lost');
    expect(r.rt.enter(fixed)).toBe(false);
    r.rt.block('context-lost', false);
    expect(r.rt.blockedReason()).toBeNull();
    expect(r.rt.enter(fixed)).toBe(true);
    expect(r.fails).toEqual([]);
  });

  it('a hook fight leaves 3D and keeps it off for the rest of the install (A R7)', () => {
    const r = rig();
    r.rt.enter(fixed);
    r.rt.hookFight('applyInputZoom');
    expect(r.exits).toEqual(['hook-fight']);
    expect(r.rt.blockedReason()).toBe('hook-fight');
    expect(r.rt.enter(fixed)).toBe(false);
  });
});

describe('follow/self split (spectator Task 12, S §5.1)', () => {
  const addAvatar = (r: Rig, id: string): GameNode => {
    const n = new GameNode();
    n.label = `AvatarContainer (${id})`;
    n.parent = r.world;
    r.world.children.push(n);
    return n;
  };
  /** A rig whose passes and source record what each frame followed. */
  function watched(tracker?: GroundTracker) {
    const avatars: unknown[] = [];
    const grounds: unknown[] = [];
    const r = rig([pass({ pre(ctx) { avatars.push(ctx.avatar); } })], {}, tracker);
    const free: ViewSource = Object.assign((i: ViewSourceInput) => { grounds.push(i.ground); return VIEW; }, { requiresAvatar: false });
    const normal: ViewSource = (i) => { grounds.push(i.ground); return VIEW; };
    const p1 = r.world.children.find((c) => c.label === 'AvatarContainer (p1)')!;
    return { r, avatars, grounds, free, normal, p1, p2: addAvatar(r, 'p2') };
  }

  it('a source that needs no avatar runs without yours and follows nothing until told', () => {
    const w = watched();
    w.r.rt.setPlayerId('gone');
    expect(w.r.rt.blockedReason()).toBe('no-avatar');
    expect(w.r.rt.blockedReason(w.free)).toBeNull();
    expect(w.r.rt.enter(w.normal)).toBe(false);
    expect(w.r.rt.enter(w.free)).toBe(true);
    w.r.render();
    expect(w.r.exits).toEqual([]);
    expect(w.avatars).toEqual([null]);
    expect(w.grounds).toEqual([null]);
    expect(w.r.rt.followed()).toBeNull();
    // While it drives, the runtime's own blocked reason is its source's.
    expect(w.r.rt.blockedReason()).toBeNull();
  });

  it('setFollow picks the followed avatar for that source; the normal camera always follows yours', () => {
    const w = watched();
    w.r.rt.setFollow('p2');
    w.r.rt.enter(w.free);
    w.r.render();
    expect(w.avatars).toEqual([w.p2]);
    expect(w.r.rt.followed()).toBe(w.p2);
    w.r.rt.exit('debug');
    w.r.rt.setFollow('p2');
    w.r.rt.enter(w.normal);
    w.r.render();
    expect(w.avatars).toEqual([w.p2, w.p1]);
    expect(w.r.rt.avatar()).toBe(w.p1);
  });

  it('the followed avatar drives the ground point the source gets (the ground tracker reads it, not yours)', () => {
    const asked: unknown[] = [];
    const tracker = { ...flatTracker, groundY: (n: unknown, sortY: number) => { asked.push(n); return sortY; } } as unknown as GroundTracker;
    const w = watched(tracker);
    w.p2.x = 900; w.p2.y = 700;
    w.r.rt.setFollow('p2');
    w.r.rt.enter(w.free);
    w.r.render();
    expect(asked).toEqual([w.p2]);
    expect(w.grounds[0]).toMatchObject({ x: 900, y: 700 });
  });

  it('a followed player who leaves gives frames with no avatar, not an exit', () => {
    const w = watched();
    w.r.rt.setFollow('p2');
    w.r.rt.enter(w.free);
    w.r.render();
    w.r.world.children.splice(w.r.world.children.indexOf(w.p2), 1);
    w.p2.parent = null;
    w.r.render();
    expect(w.avatars).toEqual([w.p2, null]);
    expect(w.r.exits).toEqual([]);
  });

  it('a followed avatar that is gone is looked for again only once World gains or loses a child (no scan per frame)', () => {
    const w = watched();
    w.r.rt.setFollow('p3');
    w.r.rt.enter(w.free);
    const kids = w.r.world.children;
    let scans = 0;
    const find = kids.find.bind(kids);
    Object.defineProperty(kids, 'find', { value: (...a: Parameters<typeof find>) => { scans++; return find(...a); }, configurable: true });
    for (let i = 0; i < 5; i++) w.r.render();
    expect(scans).toBe(1);
    const p3 = addAvatar(w.r, 'p3');
    w.r.render();
    expect(scans).toBe(2);
    expect(w.avatars[w.avatars.length - 1]).toBe(p3);
  });

  it('every exit clears the follow: the next entry follows nothing until told again', () => {
    const w = watched();
    w.r.rt.setFollow('p2');
    w.r.rt.enter(w.free);
    w.r.render();
    w.r.rt.exit('debug');
    w.r.rt.enter(w.free);
    w.r.render();
    expect(w.avatars).toEqual([w.p2, null]);
  });

  it('the camera-steered walk offsets your own avatar only', () => {
    const tracker = { ...flatTracker, tileOf: () => ({ x: 1, y: 1 }) } as unknown as GroundTracker;
    const w = watched(tracker);
    let asked = 0;
    w.r.rt.setSteer({ offsetAt: () => { asked++; return false; } });
    w.r.rt.setFollow('p2');
    w.r.rt.enter(w.free);
    w.r.render();
    expect(asked).toBe(0);
    w.r.rt.setFollow('p1');
    w.r.render();
    expect(asked).toBe(1);
    w.r.rt.exit('debug');
    w.r.rt.enter(w.normal);
    w.r.render();
    expect(asked).toBe(2);
  });
});

describe('perf Task 3: every way out of 3D leaves held tile views drawn on their 2D base (Review focus 1)', () => {
  // A tile view held through ctx.persist the way the entity pass places tiles; each render walks it like PIXI.
  function held(arm: { pre?: boolean; post?: boolean; view?: boolean }) {
    const tile = new PixiNode(5000, 4000, 1);
    const tiles = pass({
      name: 'tiles',
      pre(ctx) { ctx.persist.apply(tile.node, 640, 300, 0.5, 0.5); },
      post() { if (arm.post) throw new Error('post'); },
    });
    const thrower = pass({ name: 'late', pre() { if (arm.pre) throw new Error('pre'); } });
    const r = rig([tiles, thrower], { Container: PixiNode });
    const draw = (throwOnce = false): unknown => {
      let armed = throwOnce;
      return r.rt.onStage(() => {
        if (armed) { armed = false; throw new Error('draw'); }
        tile.render();
        return 'drawn';
      });
    };
    r.rt.enter(() => (arm.view ? 'zoomed-out' : VIEW));
    for (let i = 0; i < 3; i++) draw();
    expect(tile.drawn()).toEqual([640, 300, 0.5, 0.5]);
    expect(tile.fields()).toEqual([5000, 4000, 1, 1]);
    return { r, tile, draw };
  }
  const BASE = [5000, 4000, 1, 1];

  const paths: Array<[string, (h: ReturnType<typeof held>, arm: { pre?: boolean; post?: boolean; view?: boolean }) => void]> = [
    ['exit', (h) => { h.r.rt.exit('debug'); h.draw(); }],
    ['source exit', (h, arm) => { arm.view = true; h.draw(); }],
    ['error:pre', (h, arm) => { arm.pre = true; h.draw(); }],
    ['error:render', (h) => { h.draw(true); }],
    ['error:post', (h, arm) => { arm.post = true; h.draw(); h.draw(); }],
    ['fail', (h) => { h.r.rt.fail('pick', new Error('pick')); h.draw(); }],
    ['context loss', (h) => { h.r.rt.block('context-lost', true); h.draw(); }],
    ['hook fight', (h) => { h.r.rt.hookFight('render'); h.draw(); }],
    ['reinstall / stop / Enabled off (destroy)', (h) => { h.r.rt.destroy(); h.draw(); }],
  ];
  for (const [name, leave] of paths) {
    it(name, () => {
      const arm: { pre?: boolean; post?: boolean; view?: boolean } = {};
      const h = held(arm);
      leave(h, arm);
      expect(h.r.rt.isLive()).toBe(false);
      expect(h.tile.fields()).toEqual(BASE);
      expect(h.tile.drawn()).toEqual(BASE);
    });
  }

  it('the self-test fails on a node without the internals: the tile is set and restored as before', () => {
    const r = rig([], {});
    r.rt.enter(fixed);
    r.render();
    expect(r.rt.frame.passStats().persist).toMatchObject({ enabled: false, held: 0 });
  });
});

describe('runtime watchdog (A PF4: a liveness stamp, not a timer per frame)', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('leaves 3D one second after the last 3D frame, never while frames keep coming', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    vi.stubGlobal('document', { visibilityState: 'visible' });
    const r = rig();
    r.rt.enter(fixed);
    for (let i = 0; i < 20; i++) { r.render(); vi.advanceTimersByTime(100); }
    expect(r.rt.isLive()).toBe(true);
    vi.advanceTimersByTime(850);
    expect(r.rt.isLive()).toBe(true);
    // No QPM render hook in this rig: the watchdog finds it absent.
    vi.advanceTimersByTime(200);
    expect(r.exits).toEqual(['hook-lost']);
  });

  it('keeps checking after a re-wrap brings no frame back, until the budget calls it a fight (A R7)', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    vi.stubGlobal('document', { visibilityState: 'visible' });
    const r = rig();
    const host: { render: () => void } = { render: () => undefined };
    installRenderHook(host, r.camera, r.rt.onStage);
    try {
      r.rt.enter(fixed);
      r.render();
      // A script that puts its own render back on top, bypassing ours, before any 3D frame runs.
      for (let i = 0; i < 8 && r.rt.isLive(); i++) { host.render = () => undefined; vi.advanceTimersByTime(1100); }
      expect(r.exits).toEqual(['hook-fight']);
      expect(r.rt.blockedReason()).toBe('hook-fight');
    } finally { uninstallRenderHook(); }
  });

  it('an entry that never gets a 3D frame is still checked (A R7)', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    vi.stubGlobal('document', { visibilityState: 'visible' });
    const r = rig();
    r.rt.enter(fixed);
    vi.advanceTimersByTime(1100);
    // No QPM render hook in this rig: the watchdog finds it absent.
    expect(r.exits).toEqual(['hook-lost']);
  });

  it('a hidden page keeps the check alive for when it is shown again', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const doc = { visibilityState: 'hidden' };
    vi.stubGlobal('document', doc);
    const r = rig();
    r.rt.enter(fixed);
    r.render();
    vi.advanceTimersByTime(3000);
    expect(r.rt.isLive()).toBe(true);
    doc.visibilityState = 'visible';
    vi.advanceTimersByTime(1100);
    // No QPM render hook in this rig: the watchdog finds it absent.
    expect(r.exits).toEqual(['hook-lost']);
  });

  it('arms one timer per second of frames, not one per frame', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const r = rig();
    const set = vi.spyOn(globalThis, 'setTimeout');
    r.rt.enter(fixed);
    for (let i = 0; i < 60; i++) { r.render(); vi.advanceTimersByTime(16); }
    expect(set.mock.calls.length).toBeLessThanOrEqual(2);
    set.mockRestore();
  });
});
