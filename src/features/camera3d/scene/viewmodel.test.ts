import { describe, expect, it } from 'vitest';
import { FakeMatrix } from '../__test__/fakeMatrix';
import { FakeNode } from '../__test__/fakeNode';
import { DrawnTable, FullSaves } from '../frame/drawn';
import type { FrameCtx } from '../frame/frame';
import { makeBasis } from '../math/camera';
import type { Node3 } from '../types';
import type { Placement } from './entities';
import { VIEWMODEL_Z, areaOf, createHeldHandler, defaultViewmodelTune, heldPartsOf, viewmodelPose } from './viewmodel';

const noLay = (): void => undefined;

const W = 1000, H = 600;
const tune = defaultViewmodelTune();

// Live 1381 shape: AvatarContainer → AvatarRotation + HeldItemVisual → area container (y 192) → tiles.
function avatarWithHand() {
  const avatar = new FakeNode(5000, 3900);
  avatar.label = 'AvatarContainer (1)';
  const body = avatar.addChild(new FakeNode());
  body.label = 'AvatarRotation';
  const hand = avatar.addChild(new FakeNode());
  hand.label = 'HeldItemVisual';
  const area = hand.addChild(new FakeNode(0, 192, 1, [new FakeNode(0, -256), new FakeNode(256, 0)]));
  const held = Object.assign(hand, { currentOffsetX: 76.8, currentOffsetY: 128, currentItemId: 'SnowWardShard', areaIndicator: { container: area } });
  return { avatar, body, held, area };
}

function fpCtx(avatar: FakeNode) {
  const puts: Array<[string, unknown, unknown]> = [];
  const drops: Array<[string, unknown]> = [];
  const ov = { put: (k: string, n: unknown, v: unknown) => { puts.push([k, n, v]); }, drop: (k: string, n: unknown) => { drops.push([k, n]); }, raw: () => true, gameValue: () => 0 };
  const params = { yaw: 0, pitch: (2 * Math.PI) / 180, dist: 1, fov: (70 * Math.PI) / 180, lookH: 170, yOff: 0, near: 20, far: 31000 };
  const ctx = {
    W, H, params, basis: makeBasis(params, 5000, 4092, W, H), out: [0, 0, 0], ov, saves: new FullSaves(), drawn: new DrawnTable(),
    now: 1000, frameNo: 1, target: { x: 5000, y: 4092 }, avatar: avatar.node, hideSelf: true, caps: { classes: { Matrix: FakeMatrix } },
  } as unknown as FrameCtx;
  return { ctx, puts, drops };
}

describe('viewmodelPose', () => {
  it("puts an in-hand item's rest point on the hand anchor at the hand scale", () => {
    const p = viewmodelPose(76.8, 128, 150, W, H, tune);
    expect(p.overhead).toBe(false);
    expect(p.k).toBeCloseTo((0.55 * H) / 256, 9);
    expect(p.x + p.k * 76.8).toBeCloseTo(0.87 * W, 9);
    expect(p.y + p.k * 128).toBeCloseTo(0.74 * H, 9);
  });
  it('caps a tall carried item and stands its bottom on the carry anchor', () => {
    const p = viewmodelPose(0, -64, 253, W, H, tune);
    expect(p.overhead).toBe(true);
    expect(p.k).toBeCloseTo((0.4 * H) / 253, 9);
    expect(p.x).toBeCloseTo(0.84 * W, 9);
    expect(p.y - p.k * 64).toBeCloseTo(0.99 * H, 9);
  });
  it('keeps the hand scale for a short carried item', () => {
    expect(viewmodelPose(0, -64, 40, W, H, tune).k).toBeCloseTo((0.55 * H) / 256, 9);
  });
});

describe('heldPartsOf / areaOf', () => {
  it('finds the body and the hand by their game labels', () => {
    const { avatar, body, held, area } = avatarWithHand();
    const p = heldPartsOf(avatar.node);
    expect(p?.body).toBe(body.node);
    expect(p?.held).toBe(held.node);
    expect(areaOf(p!.held)).toBe(area.node);
  });
  it('returns null when the game renamed a part, and no area for an empty indicator', () => {
    const { avatar, held, area } = avatarWithHand();
    held.label = 'HeldItem';
    expect(heldPartsOf(avatar.node)).toBeNull();
    held.label = 'HeldItemVisual';
    area.children.length = 0;
    expect(areaOf(heldPartsOf(avatar.node)!.held)).toBeNull();
  });
});

describe('createHeldHandler (first person)', () => {
  it('hides only the body, raises the avatar above every card and pins the hand on its anchor', () => {
    const { avatar, body } = avatarWithHand();
    const { ctx, puts } = fpCtx(avatar);
    const h = createHeldHandler(defaultViewmodelTune(), () => undefined, noLay);
    h.begin(ctx);
    expect(h.firstPerson(ctx, avatar.node)).toBe(true);
    expect(puts).toContainEqual(['visible', body.node, false]);
    expect(puts).toContainEqual(['zIndex', avatar.node, VIEWMODEL_Z]);
    const p = viewmodelPose(76.8, 128, 256, W, H, defaultViewmodelTune());
    expect(avatar.scale.x).toBeCloseTo(p.k, 9);
    expect(avatar.x + p.k * 76.8).toBeCloseTo(0.87 * W, 9);
    ctx.saves.restoreAll();
    expect([avatar.x, avatar.y, avatar.scale.x]).toEqual([5000, 3900, 1]);
  });

  it("hands the pinned avatar to the area layer with its 2D place and the pose's scale ratio", () => {
    const { avatar } = avatarWithHand();
    const { ctx } = fpCtx(avatar);
    const laid: Array<{ owner: Node3; x2d: number; fy2d: number; mm: number; k: number }> = [];
    const lay = (_c: FrameCtx, owner: Node3, lp: Placement): void => { laid.push({ owner, x2d: lp.x2d, fy2d: lp.fy2d, mm: lp.mm, k: avatar.scale.x }); };
    const h = createHeldHandler(defaultViewmodelTune(), () => undefined, lay);
    h.begin(ctx);
    h.firstPerson(ctx, avatar.node);
    const p = viewmodelPose(76.8, 128, 256, W, H, defaultViewmodelTune());
    expect(laid.length).toBe(1);
    // areaMarks reads owner.scale.x / lp.mm as the 2D scale (1 here) and the pinned transform as the drawn one.
    expect(laid[0]!.owner).toBe(avatar.node);
    expect([laid[0]!.x2d, laid[0]!.fy2d]).toEqual([5000, 3900]);
    expect(laid[0]!.k).toBeCloseTo(p.k, 9);
    expect(laid[0]!.k / laid[0]!.mm).toBeCloseTo(1, 9);
  });

  it('reports drift once and declines when the pose fields are missing', () => {
    const { avatar, held } = avatarWithHand();
    Reflect.deleteProperty(held, 'currentOffsetX');
    const { ctx } = fpCtx(avatar);
    const seen: string[] = [];
    const h = createHeldHandler(defaultViewmodelTune(), (w) => { seen.push(w); }, noLay);
    h.begin(ctx);
    expect(h.firstPerson(ctx, avatar.node)).toBe(false);
    expect(h.firstPerson(ctx, avatar.node)).toBe(false);
    expect(seen).toEqual(['offsets']);
  });

  it('release drops the body override', () => {
    const { avatar, body } = avatarWithHand();
    const { ctx, drops } = fpCtx(avatar);
    const h = createHeldHandler(defaultViewmodelTune(), () => undefined, noLay);
    h.begin(ctx);
    h.firstPerson(ctx, avatar.node);
    h.release(ctx);
    expect(drops).toContainEqual(['visible', body.node]);
  });
});
