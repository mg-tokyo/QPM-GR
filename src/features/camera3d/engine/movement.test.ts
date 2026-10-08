import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { XY } from '../math/camera';
import type { Runtime, SteerSource } from '../runtime';
import type { DirectionalInputLike } from '../types';

const mem = vi.hoisted(() => new Map<string, unknown>());
vi.mock('../../../utils/storage', () => ({
  storage: {
    get: (k: string, d: unknown = null) => (mem.has(k) ? mem.get(k) : d),
    set: (k: string, v: unknown) => { mem.set(k, v); },
  },
}));

import { setCamera3dSetting } from '../settings';
import { installCameraRelativeMovement, quarterOf, rotateDirKeys } from './movement';

const D = Math.PI / 180;
const OFFSET: Readonly<Record<string, XY>> = { up: { x: 0, y: -1 }, right: { x: 1, y: 0 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 } };

/** The game's MovementSystem as far as the wrapper sees it: movePlayer on the prototype, its own collision check. */
class FakeMover {
  pos: XY = { x: 0, y: 0 };
  calls: string[] = [];
  open: (x: number, y: number) => boolean = () => true;
  movePlayer(dir: string, p: XY): boolean {
    this.calls.push(dir);
    const o = OFFSET[dir]!;
    if (!this.open(p.x + o.x, p.y + o.y)) return false;
    this.pos = { x: p.x + o.x, y: p.y + o.y };
    return true;
  }
}

interface Rig { rt: Runtime; mover: FakeMover; di: DirectionalInputLike; ctx: { params: { yaw: number } }; steer(): SteerSource | null; setLive(v: boolean): void; exit(): void; fails: string[] }

function rig(withMover = true): Rig {
  const mover = new FakeMover();
  const di: DirectionalInputLike = { keysPressed: [], updateDirectionState() { /* game */ } };
  const ctx = { params: { yaw: 0 } };
  let live = true;
  let steer: SteerSource | null = null;
  const exits = new Set<(r: string) => void>();
  const fails: string[] = [];
  const rt = {
    caps: { systems: { mover: withMover ? mover : null, directionalInput: di } },
    frame: { ctx: () => ctx },
    isLive: () => live,
    fail: (p: string) => { fails.push(p); live = false; },
    setSteer: (s: SteerSource | null) => { steer = s; },
    onExit: (cb: (r: string) => void) => { exits.add(cb); return () => { exits.delete(cb); }; },
    onFrame: () => () => undefined,
  } as unknown as Runtime;
  return {
    rt, mover, di, ctx, fails, steer: () => steer, setLive: (v) => { live = v; },
    exit: () => { live = false; for (const cb of exits) cb('debug'); },
  };
}

/** The game's input tick calling its own movePlayer `n` times with whatever direction its key state holds. */
function tick(r: Rig, n: number, gameDir = 'up'): number {
  let stepped = 0;
  for (let i = 0; i < n; i++) if (r.mover.movePlayer(gameDir, r.mover.pos)) stepped++;
  return stepped;
}

describe('camera-steered steps (P15 a; M1, M2)', () => {
  beforeEach(() => mem.clear());

  it('steers each of the game\'s steps along the camera heading: W at yaw 30° averages 30°', () => {
    const r = rig();
    installCameraRelativeMovement(r.rt);
    r.di.keysPressed = ['KeyW'];
    r.ctx.params.yaw = 30 * D;
    expect(tick(r, 40)).toBe(40);
    expect(Math.abs(Math.atan2(r.mover.pos.x, -r.mover.pos.y) / D - 30)).toBeLessThan(2);
  });

  it('W+D walks the diagonal; opposite keys take no step, and QPM never adds a step of its own', () => {
    const r = rig();
    installCameraRelativeMovement(r.rt);
    r.di.keysPressed = ['KeyW', 'KeyD'];
    tick(r, 20);
    expect(r.mover.pos).toEqual({ x: 10, y: -10 });
    r.di.keysPressed = ['KeyW', 'KeyS'];
    const before = r.mover.calls.length;
    expect(tick(r, 3)).toBe(0);
    // Not even tried: the game's own step never runs while the keys cancel.
    expect(r.mover.calls.length - before).toBe(0);
  });

  it('a step the game refuses goes along the wall when the heading leans that way', () => {
    const r = rig();
    installCameraRelativeMovement(r.rt);
    r.mover.open = (_x, y) => y >= 0;
    r.di.keysPressed = ['KeyW', 'KeyD'];
    tick(r, 6);
    expect(r.mover.pos).toEqual({ x: 6, y: 0 });
  });

  it('no direction key (the touch D-pad), 3D off or camMove off: the game\'s own step, untouched', () => {
    const r = rig();
    installCameraRelativeMovement(r.rt);
    r.ctx.params.yaw = 90 * D;
    tick(r, 1, 'left');
    expect(r.mover.calls).toEqual(['left']);
    r.di.keysPressed = ['KeyW'];
    r.setLive(false);
    tick(r, 1, 'up');
    setCamera3dSetting('camMove', false);
    r.setLive(true);
    tick(r, 1, 'up');
    expect(r.mover.calls).toEqual(['left', 'up', 'up']);
  });

  it('offers the planned point for the landing tile while keys are down, and drops it on release or exit', () => {
    const r = rig();
    installCameraRelativeMovement(r.rt);
    r.di.keysPressed = ['KeyW'];
    r.ctx.params.yaw = 30 * D;
    tick(r, 1);
    const out = { x: 0, y: 0 };
    expect(r.steer()!.offsetAt(r.mover.pos, out)).toBe(true);
    expect(Math.hypot(out.x, out.y)).toBeGreaterThan(0);
    expect(r.steer()!.offsetAt({ x: 99, y: 99 }, out)).toBe(false);
    r.di.keysPressed = [];
    expect(r.steer()!.offsetAt(r.mover.pos, out)).toBe(false);
    r.di.keysPressed = ['KeyW'];
    r.exit();
    r.setLive(true);
    expect(r.steer()!.offsetAt(r.mover.pos, out)).toBe(false);
  });

  it('keeps offering the previous step\'s point while the avatar view still shows the tile before (it reads the frame-start position)', () => {
    const r = rig();
    installCameraRelativeMovement(r.rt);
    r.di.keysPressed = ['KeyW'];
    r.ctx.params.yaw = 30 * D;
    tick(r, 1);
    const first = { ...r.mover.pos };
    const out = { x: 0, y: 0 };
    r.steer()!.offsetAt(first, out);
    const firstOff = { ...out };
    tick(r, 1);
    // The step frame: the game moved on, the view has not.
    expect(r.steer()!.offsetAt(first, out)).toBe(true);
    expect(out).toEqual(firstOff);
    expect(r.steer()!.offsetAt(r.mover.pos, out)).toBe(true);
  });

  it('keys up ends the walk: a new one from the same tile never shows the old walk\'s point (review 2026-10-06)', () => {
    const r = rig();
    installCameraRelativeMovement(r.rt);
    r.di.keysPressed = ['KeyD'];
    r.ctx.params.yaw = 30 * D;
    tick(r, 3);
    const stop = { ...r.mover.pos };
    const out = { x: 0, y: 0 };
    expect(r.steer()!.offsetAt(stop, out)).toBe(true);
    expect(Math.hypot(out.x, out.y)).toBeGreaterThan(0);
    // A frame with no key down, then a press the other way: the step frame's view still shows the tile it left.
    r.di.keysPressed = [];
    r.steer()!.offsetAt(stop, out);
    r.di.keysPressed = ['KeyA'];
    tick(r, 1);
    expect(r.steer()!.offsetAt(stop, out)).toBe(false);
    expect(r.steer()!.offsetAt(r.mover.pos, out)).toBe(true);
  });

  it('uninstall puts the game\'s step back; one displaced by another script passes through and stays theirs', () => {
    const r = rig();
    const off = installCameraRelativeMovement(r.rt);
    expect(Object.prototype.hasOwnProperty.call(r.mover, 'movePlayer')).toBe(true);
    off();
    expect(Object.prototype.hasOwnProperty.call(r.mover, 'movePlayer')).toBe(false);
    expect(r.steer()).toBeNull();

    const r2 = rig();
    const off2 = installCameraRelativeMovement(r2.rt);
    const ours = r2.mover.movePlayer;
    const theirs = function (this: unknown, d: string, p: XY): boolean { return ours.call(this, d, p); };
    r2.mover.movePlayer = theirs;
    off2();
    expect(r2.mover.movePlayer).toBe(theirs);
    r2.di.keysPressed = ['KeyD'];
    tick(r2, 1, 'up');
    expect(r2.mover.calls).toEqual(['up']);
  });

  it('without the game\'s movePlayer, keys keep the quarter-turn snap (spec D5)', () => {
    const r = rig(false);
    let seen: string[] = [];
    const proto = { updateDirectionState(this: DirectionalInputLike) { seen = [...this.keysPressed]; } };
    Object.setPrototypeOf(r.di, proto);
    delete (r.di as unknown as Record<string, unknown>).updateDirectionState;
    const off = installCameraRelativeMovement(r.rt);
    r.ctx.params.yaw = 90 * D;
    r.di.keysPressed = ['KeyW'];
    r.di.updateDirectionState();
    expect(seen).toEqual(['ArrowRight']);
    off();
    expect(Object.prototype.hasOwnProperty.call(r.di, 'updateDirectionState')).toBe(false);
  });
});

describe('camera-relative movement helpers (the D5 fallback)', () => {
  it('snaps the yaw to the nearest quarter turn, wrapping both ways', () => {
    expect([0, 44, 46, 90, 180, 270, 360, -90, -1].map((d) => quarterOf(d * D))).toEqual([0, 0, 1, 1, 2, 3, 0, 3, 0]);
  });

  it('turns direction keys by the quarter and leaves other keys alone', () => {
    expect(rotateDirKeys(['KeyW'], 0)).toEqual(['ArrowUp']);
    expect(rotateDirKeys(['KeyW', 'ShiftLeft'], 1)).toEqual(['ArrowRight', 'ShiftLeft']);
    expect(rotateDirKeys(['ArrowUp', 'KeyA'], 2)).toEqual(['ArrowDown', 'ArrowRight']);
    expect(rotateDirKeys(['KeyS', 'KeyD'], 3)).toEqual(['ArrowRight', 'ArrowUp']);
  });
});
