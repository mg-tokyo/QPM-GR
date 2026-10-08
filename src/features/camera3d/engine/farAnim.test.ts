import { describe, expect, it, vi } from 'vitest';
import { TILE } from '../constants';
import type { FrameCtx } from '../frame/frame';
import { FakeNode } from '../__test__/fakeNode';
import { FAR_PX, NEAR_PX, createFarAnim, isFar, type FarAnimDeps } from './farAnim';

class FakeRive {
  isPaused = false;
  destroyed = false;
  readonly calls: string[] = [];
  constructor(public parent: FakeNode | null) {}
  pause(): void { if (this.destroyed || this.isPaused) return; this.isPaused = true; this.calls.push('pause'); }
  resume(): void { if (this.destroyed || !this.isPaused) return; this.isPaused = false; this.calls.push('resume'); }
}

const ov = { gameValue: (k: string, n: object) => (n as Record<string, unknown>)[k] };
// The camera sits 30 tiles away: distances must come from the look target, not from it.
const ctxAt = (frameNo: number, avatar: FakeNode | null = null, reCull = false, target = { x: 0, y: 0 }): FrameCtx =>
  ({ frameNo, reCull, ov, avatar: avatar?.node ?? null, target, basis: { C: [30 * TILE, 300, 0] } }) as unknown as FrameCtx;
const tick = async (): Promise<void> => { await Promise.resolve(); };

function scene() {
  const world = new FakeNode();
  const working = new Set<FakeRive>();
  // A root on the World at (x, y) tiles with a Rive sprite one container below it (PetView/AvatarView shape).
  const add = (x: number, y: number): { root: FakeNode; s: FakeRive } => {
    const root = world.addChild(new FakeNode(x * TILE, y * TILE));
    root.zIndex = y * TILE * 1e4;
    const s = new FakeRive(root.addChild(new FakeNode()));
    working.add(s);
    return { root, s };
  };
  const report = vi.fn();
  const mounts = new Map<FakeNode, FakeNode>();
  const tracker = { hooked: true };
  const deps: FarAnimDeps = {
    world: world.node,
    each: (fn) => { for (const s of working) if (!s.isPaused) fn(s); },
    tracking: () => tracker.hooked,
    isSelf: (ctx, n) => ctx.avatar !== null && (n === ctx.avatar || mounts.get(n as unknown as FakeNode)?.node === ctx.avatar),
    report,
  };
  return { world, working, add, deps, report, mounts, tracker };
}

/** One 3D frame: the pass decides in pre and acts in post. */
function frame(f: ReturnType<typeof createFarAnim>, ctx: FrameCtx): void { f.pre(ctx); f.post?.(ctx); }

describe('isFar', () => {
  it('turns far past 10 tiles and back near only inside 9 (1-tile hysteresis)', () => {
    const d2 = (tiles: number): number => (tiles * TILE) ** 2;
    expect(FAR_PX).toBe(10 * TILE);
    expect(NEAR_PX).toBe(9 * TILE);
    expect(isFar(d2(10.01), false)).toBe(true);
    expect(isFar(d2(9.99), false)).toBe(false);
    expect(isFar(d2(9.5), true)).toBe(true);
    expect(isFar(d2(8.99), true)).toBe(false);
  });
});

describe('createFarAnim', () => {
  it('full (the default) never pauses or resumes anything', () => {
    const sc = scene();
    const far = sc.add(20, 0);
    const f = createFarAnim(sc.deps);
    for (let n = 0; n < 20; n++) frame(f, ctxAt(n, null, n === 0));
    expect(f.mode()).toBe('full');
    expect(far.s.calls).toEqual([]);
  });

  it('off pauses far pets and players after the render, never in pre', () => {
    const sc = scene();
    const far = sc.add(12, 0), near = sc.add(5, 0);
    const f = createFarAnim(sc.deps);
    f.setMode('off');
    f.pre(ctxAt(1));
    expect(far.s.calls).toEqual([]);
    f.post?.(ctxAt(1));
    expect(far.s.calls).toEqual(['pause']);
    expect(near.s.calls).toEqual([]);
    expect(f.stats()).toMatchObject({ mode: 'off', far: 1, paused: 1 });
  });

  it('leaves the followed avatar, its mount, sprites outside World and sprites paused by others alone', () => {
    const sc = scene();
    const self = sc.add(15, 0), mount = sc.add(15, 1), other = sc.add(15, 2);
    sc.mounts.set(mount.root, self.root);
    const loose = new FakeRive(null);
    sc.working.add(loose);
    const foreign = sc.add(14, 0);
    foreign.s.isPaused = true;
    const f = createFarAnim(sc.deps);
    f.setMode('off');
    frame(f, ctxAt(1, self.root));
    expect(self.s.calls).toEqual([]);
    expect(mount.s.calls).toEqual([]);
    expect(loose.calls).toEqual([]);
    expect(other.s.calls).toEqual(['pause']);
    f.drop();
    expect(foreign.s.isPaused).toBe(true);
  });

  it('re-decides on re-cull frames and every 8th frame only', () => {
    const sc = scene();
    const f = createFarAnim(sc.deps);
    f.setMode('off');
    frame(f, ctxAt(1));
    const late = sc.add(12, 0);
    for (let n = 2; n < 8; n++) frame(f, ctxAt(n));
    expect(late.s.calls).toEqual([]);
    frame(f, ctxAt(8));
    expect(late.s.calls).toEqual(['pause']);
    const jump = sc.add(13, 0);
    frame(f, ctxAt(9, null, true));
    expect(jump.s.calls).toEqual(['pause']);
  });

  it('resumes after the render once back inside 9 tiles, and holds between 9 and 10', async () => {
    const sc = scene();
    const p = sc.add(12, 0);
    const f = createFarAnim(sc.deps);
    f.setMode('off');
    frame(f, ctxAt(8));
    p.root.x = 9.5 * TILE;
    frame(f, ctxAt(16));
    expect(p.s.isPaused).toBe(true);
    p.root.x = 8.5 * TILE;
    f.pre(ctxAt(24));
    expect(p.s.isPaused).toBe(true);
    f.post?.(ctxAt(24));
    expect(p.s.calls).toEqual(['pause', 'resume']);
    await tick();
    expect(p.s.calls).toEqual(['pause', 'resume']);
  });

  it('measures from the ground point (sort y), not the container y', () => {
    const sc = scene();
    const a = sc.add(0, 9.5);
    a.root.zIndex = 10.5 * TILE * 1e4;
    const f = createFarAnim(sc.deps);
    f.setMode('off');
    frame(f, ctxAt(8));
    expect(a.s.calls).toEqual(['pause']);
  });

  it('measures from the look target, not the camera (PC13: the camera sits far back when zoomed out)', () => {
    const sc = scene();
    const nearYou = sc.add(5, 0), nearCam = sc.add(29, 0), farYou = sc.add(-12, 0);
    const f = createFarAnim(sc.deps);
    f.setMode('off');
    frame(f, ctxAt(8));
    expect(nearYou.s.calls).toEqual([]);
    expect(nearCam.s.calls).toEqual(['pause']);
    expect(farYou.s.calls).toEqual(['pause']);
    frame(f, ctxAt(16, null, false, { x: -12 * TILE, y: 0 }));
    expect(farYou.s.calls).toEqual(['pause', 'resume']);
  });

  it('reports once and pauses nothing while the Rive tracker has not hooked the game', () => {
    const sc = scene();
    const a = sc.add(12, 0);
    sc.tracker.hooked = false;
    const f = createFarAnim(sc.deps);
    f.setMode('off');
    for (let n = 8; n <= 24; n += 8) frame(f, ctxAt(n));
    expect(a.s.calls).toEqual([]);
    expect(sc.report).toHaveBeenCalledTimes(1);
    expect(sc.report.mock.calls[0]?.[0]).toMatchObject({ kind: 'tracker' });
    sc.tracker.hooked = true;
    frame(f, ctxAt(32));
    expect(a.s.calls).toEqual(['pause']);
  });

  it('frees the snapshot of a paused sprite the game stopped drawing, and forgets destroyed ones', () => {
    const sc = scene();
    const hidden = sc.add(12, 0), gone = sc.add(13, 0);
    const f = createFarAnim(sc.deps);
    f.setMode('off');
    frame(f, ctxAt(8));
    hidden.root.visible = false;
    gone.s.destroyed = true;
    frame(f, ctxAt(16));
    expect(hidden.s.calls).toEqual(['pause', 'resume']);
    expect(gone.s.calls).toEqual(['pause']);
    expect(f.stats().paused).toBe(0);
  });

  it('never retries a pause the game cancelled, and reports it once', () => {
    const sc = scene();
    const a = sc.add(12, 0), b = sc.add(14, 0);
    const f = createFarAnim(sc.deps);
    f.setMode('off');
    frame(f, ctxAt(8));
    a.s.isPaused = false; b.s.isPaused = false;
    for (let n = 16; n <= 40; n += 8) frame(f, ctxAt(n));
    expect(a.s.calls).toEqual(['pause']);
    expect(b.s.calls).toEqual(['pause']);
    expect(sc.report).toHaveBeenCalledTimes(1);
    expect(sc.report.mock.calls[0]?.[0]).toMatchObject({ kind: 'refused' });
    expect(f.stats().refused).toBe(2);
  });

  it('resumes everything one microtask after drop, setMode(full) or destroy, never inside the call', async () => {
    for (const leave of ['drop', 'full', 'destroy'] as const) {
      const sc = scene();
      const a = sc.add(12, 0), b = sc.add(15, 3);
      const f = createFarAnim(sc.deps);
      f.setMode('off');
      frame(f, ctxAt(8));
      if (leave === 'drop') f.drop(); else if (leave === 'full') f.setMode('full'); else f.destroy();
      expect(a.s.isPaused).toBe(true);
      await tick();
      expect(a.s.calls).toEqual(['pause', 'resume']);
      expect(b.s.calls).toEqual(['pause', 'resume']);
      expect(f.stats().paused).toBe(0);
      f.drop(); f.destroy();
      await tick();
      expect(a.s.calls).toEqual(['pause', 'resume']);
    }
  });

  it('a 3D session after drop starts clean and pauses again', async () => {
    const sc = scene();
    const a = sc.add(12, 0);
    const f = createFarAnim(sc.deps);
    f.setMode('off');
    frame(f, ctxAt(8));
    f.drop();
    await tick();
    frame(f, ctxAt(1, null, true));
    expect(a.s.calls).toEqual(['pause', 'resume', 'pause']);
  });

  it('resumes a paused sprite whose root became the followed avatar', () => {
    const sc = scene();
    const a = sc.add(12, 0);
    const f = createFarAnim(sc.deps);
    f.setMode('off');
    frame(f, ctxAt(8));
    frame(f, ctxAt(16, a.root));
    expect(a.s.calls).toEqual(['pause', 'resume']);
  });
});
