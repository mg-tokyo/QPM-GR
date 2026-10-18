import { describe, expect, it } from 'vitest';
import { cullOf } from '../__test__/cullOf';
import { FakeNode } from '../__test__/fakeNode';
import { DrawnTable, FullSaves } from '../frame/drawn';
import type { FrameCtx } from '../frame/frame';
import { PersistTable } from '../frame/persist';
import { makeBasis } from '../math/camera';
import { createEntityPass } from './entities';
import { isFollowedOrMount } from './ground';

// Spectator Task 12 (S §5.1): FrameCtx.avatar is the followed avatar. Under the spectator it can be another player's, or
// none in free cam; your own avatar is then an ordinary figure.
const W = 1000, H = 600, fov = (20 * Math.PI) / 180, k = 1.5;
const SHIFT = { x: 100, y: -50 };

function tilted(world: FakeNode, avatar: unknown): FrameCtx {
  const fpx = H / 2 / Math.tan(fov / 2);
  const params = { yaw: 0, pitch: (30 * Math.PI) / 180, dist: fpx / k, fov, lookH: 0, yOff: 0, near: 40, far: 9000 };
  const basis = makeBasis(params, 5000, 4000, W, H);
  const ov = { put: () => undefined, drop: () => undefined, raw: () => true, gameValue: () => 0 };
  return {
    basis, target: { x: 5000, y: 4000 }, params, out: [0, 0, 0], ov, reCull: true, roll: -1, capMask: 0, W, H,
    cull: cullOf(basis, params, W, H), drawn: new DrawnTable(), saves: new FullSaves(), dx: 0, dz: -1, frameNo: 1,
    persist: new PersistTable(false), tilt: 1, exactKeys: false, selfShift: SHIFT, hideSelf: false, selfAlpha: 1, hand: 0,
    avatar, avatarKey: null, avatarUpper: null, avatarGround: null, camStill: false,
    caps: { scene: { world: world.node }, classes: { Texture: { WHITE: {} } } },
  } as unknown as FrameCtx;
}

function room() {
  const world = new FakeNode();
  const mine = world.addChild(new FakeNode(4900, 4000).withTexture(100, 100, 1));
  mine.label = 'AvatarContainer (p1)';
  const theirs = world.addChild(new FakeNode(5100, 4000).withTexture(100, 100, 1));
  theirs.label = 'AvatarContainer (p2)';
  const faded: unknown[] = [];
  const pass = createEntityPass({
    skip: new WeakSet(), buildings: null, layers: null, standRow: null, afterPlace: null, placeMask: null, held: null,
    fade: (_c, n) => { faded.push(n); }, isSelf: isFollowedOrMount({ riderOf: () => null }),
  });
  return { world, mine, theirs, faded, pass };
}

describe('entity pass with the follow/self split', () => {
  it('another player followed: occlusion and the follow shift come from them; your avatar gets the proximity fade', () => {
    const shifted = room(), plain = room();
    const ctx = tilted(shifted.world, shifted.theirs.node);
    shifted.pass.pre(ctx);
    plain.pass.pre(tilted(plain.world, null));
    expect(ctx.avatarKey).not.toBeNull();
    expect(ctx.avatarGround?.x).toBeCloseTo(5100 + SHIFT.x, 6);
    expect(shifted.faded).toEqual([shifted.mine.node]);
    // Your own avatar is drawn where it stands; theirs on the follow point.
    expect(shifted.mine.x).toBeCloseTo(plain.mine.x, 6);
    expect(shifted.theirs.x).not.toBeCloseTo(plain.theirs.x, 3);
  });

  it('nothing followed: no occlusion source, every avatar is an ordinary faded figure, nothing shifted', () => {
    const r = room();
    const ctx = tilted(r.world, null);
    expect(() => r.pass.pre(ctx)).not.toThrow();
    expect(ctx.avatarKey).toBeNull();
    expect(ctx.avatarUpper).toBeNull();
    expect(ctx.avatarGround).toBeNull();
    expect(r.faded).toEqual([r.mine.node, r.theirs.node]);
  });

  it('first person under another player hides their body, never yours', () => {
    const r = room();
    const puts: unknown[][] = [];
    const ctx = { ...tilted(r.world, r.theirs.node), hideSelf: true, ov: { put: (...a: unknown[]) => { puts.push(a); }, drop: () => undefined, raw: () => true, gameValue: () => 0 } } as unknown as FrameCtx;
    r.pass.pre(ctx);
    expect(puts).toContainEqual(['visible', r.theirs.node, false]);
    expect(puts).not.toContainEqual(['visible', r.mine.node, false]);
  });
});
