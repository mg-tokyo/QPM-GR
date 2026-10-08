import { describe, expect, it } from 'vitest';
import { FakeMatrix } from '../__test__/fakeMatrix';
import { FakeNode } from '../__test__/fakeNode';
import { DrawnTable, FullSaves } from '../frame/drawn';
import type { FrameCtx } from '../frame/frame';
import { makeBasis } from '../math/camera';
import type { Node3 } from '../types';
import type { Placement } from './entities';
import { VIEWMODEL_Z, areaOf, createHeldHandler, createHotbarProbe, defaultViewmodelTune, heldPartsOf, viewmodelPose, type ItemExtent } from './viewmodel';

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
  // The art root: the live 1419 Shovel's bounds (anchor 0.5 on the rest point).
  const root = Object.assign(new FakeNode(76.8, 128), { getLocalBounds: () => ({ minX: -65.5, minY: -68, maxX: 65.5, maxY: 68 }) });
  const held = Object.assign(hand, { currentOffsetX: 76.8, currentOffsetY: 128, currentItemId: 'SnowWardShard', areaIndicator: { container: area }, heldVisual: { root } });
  return { avatar, body, held, area };
}

function fpCtx(avatar: FakeNode) {
  const puts: Array<[string, unknown, unknown]> = [];
  const drops: Array<[string, unknown]> = [];
  const ov = { put: (k: string, n: unknown, v: unknown) => { puts.push([k, n, v]); }, drop: (k: string, n: unknown) => { drops.push([k, n]); }, raw: () => true, gameValue: () => 0 };
  const params = { yaw: 0, pitch: (2 * Math.PI) / 180, dist: 1, fov: (70 * Math.PI) / 180, lookH: 170, yOff: 0, near: 20, far: 31000 };
  const ctx = {
    W, H, params, basis: makeBasis(params, 5000, 4092, W, H), out: [0, 0, 0], ov, saves: new FullSaves(), drawn: new DrawnTable(),
    now: 1000, frameNo: 1, target: { x: 5000, y: 4092 }, avatar: avatar.node, hideSelf: true, selfAlpha: 0, hand: 1, caps: { classes: { Matrix: FakeMatrix } },
  } as unknown as FrameCtx;
  return { ctx, puts, drops };
}

// Item extents about the rest point, in avatar units: in hand the item's centre (a 150-tall item), carried its bottom.
const inHand = (h: number): ItemExtent => ({ minX: -128, maxX: 128, minY: -h / 2, maxY: h / 2 });
const carried = (h: number): ItemExtent => ({ minX: -128, maxX: 128, minY: -h, maxY: 0 });
// The live 1419 Shovel: anchor 0.5, local bounds ±65.5 × ±68, rest point (76.8, 128).
const SHOVEL: ItemExtent = { minX: -65.5, maxX: 65.5, minY: -68, maxY: 68 };
const box = (p: { k: number; x: number; y: number }, offX: number, offY: number, e: ItemExtent) => ({
  L: p.x + p.k * (offX + e.minX), R: p.x + p.k * (offX + e.maxX), T: p.y + p.k * (offY + e.minY), B: p.y + p.k * (offY + e.maxY),
});

describe('viewmodelPose', () => {
  it("puts an in-hand item's rest point on the hand anchor at the hand scale", () => {
    const p = viewmodelPose(76.8, 128, SHOVEL, W, H, tune);
    expect(p.overhead).toBe(false);
    expect(p.k).toBeCloseTo((0.55 * H) / 256, 9);
    expect(p.x + p.k * 76.8).toBeCloseTo(0.87 * W, 9);
    expect(p.y + p.k * 128).toBeCloseTo(0.74 * H, 9);
  });
  it('caps a tall carried item and stands its bottom on the carry anchor', () => {
    const p = viewmodelPose(0, -64, carried(253), W, H, tune);
    expect(p.overhead).toBe(true);
    expect(p.k).toBeCloseTo((0.4 * H) / 253, 9);
    expect(p.x).toBeCloseTo(0.84 * W, 9);
    expect(p.y - p.k * 64).toBeCloseTo(0.99 * H, 9);
  });
  it('keeps the hand scale for a short carried item', () => {
    expect(viewmodelPose(0, -64, carried(40), W, H, tune).k).toBeCloseTo((0.55 * H) / 256, 9);
  });
  it('rises from fully below the screen into place as the push-in arrives (P2 a), monotone, at rest at both ends', () => {
    for (const [offY, e] of [[128, inHand(256)], [-64, carried(253)]] as const) {
      const rest = viewmodelPose(76.8, offY, e, W, H, tune);
      expect(viewmodelPose(76.8, offY, e, W, H, tune, 1)).toEqual(rest);
      const low = viewmodelPose(76.8, offY, e, W, H, tune, 0);
      expect(low.x).toBe(rest.x);
      expect(box(low, 76.8, offY, e).T).toBeGreaterThanOrEqual(H);
      let last = low.y;
      for (let r = 0.02; r <= 1; r += 0.02) { const y = viewmodelPose(76.8, offY, e, W, H, tune, r).y; expect(y).toBeLessThanOrEqual(last + 1e-9); last = y; }
      const near1 = viewmodelPose(76.8, offY, e, W, H, tune, 0.999).y - rest.y;
      expect(near1).toBeLessThan(1e-3 * H);
    }
  });
});

// A W5: sized and placed for the canvas the game draws in (live 1419 hotbar panels, frame + badge, reaching below the
// screen: (272, 451) 734 wide on 1278×579, (132, 201) 640 wide on the Discord 903×303 panel).
describe('viewmodelPose (aspect ratio and hotbar, A W5)', () => {
  it('leaves the tuned 1278×656 pose untouched for a real item', () => {
    const hotbar = { x: 272, y: 520, w: 734, h: 909 };
    const p = viewmodelPose(76.8, 128, SHOVEL, 1278, 656, tune, 1, hotbar);
    expect(p.k).toBeCloseTo((0.55 * 656) / 256, 9);
    expect(p.x + p.k * 76.8).toBeCloseTo(0.87 * 1278, 9);
    expect(p.y + p.k * 128).toBeCloseTo(0.74 * 656, 9);
  });
  it('caps the item width on a portrait canvas and keeps it inside', () => {
    const p = viewmodelPose(76.8, 128, SHOVEL, 600, 1000, tune, 1, { x: 48, y: 900, w: 504, h: 800 });
    const b = box(p, 76.8, 128, SHOVEL);
    expect(b.R - b.L).toBeLessThanOrEqual(0.35 * 600 + 1e-9);
    expect(b.L).toBeGreaterThanOrEqual(0);
    expect(b.R).toBeLessThanOrEqual(600);
    expect(b.B).toBeLessThanOrEqual(900);
  });
  it('moves right of the hotbar on the Discord panel when there is room', () => {
    const hb = { x: 132, y: 201, w: 640, h: 743 };
    const p = viewmodelPose(76.8, 128, SHOVEL, 903, 303, tune, 1, hb);
    const b = box(p, 76.8, 128, SHOVEL);
    expect(b.L).toBeGreaterThanOrEqual(hb.x + hb.w);
    expect(b.R).toBeLessThanOrEqual(903);
    expect(p.k).toBeCloseTo((0.55 * 303) / 256, 9);
  });
  it('rises above the hotbar when there is no room beside it', () => {
    const hb = { x: 100, y: 239, w: 760, h: 60 };
    const p = viewmodelPose(76.8, 128, SHOVEL, 903, 303, tune, 1, hb);
    const b = box(p, 76.8, 128, SHOVEL);
    expect(b.B).toBeLessThanOrEqual(hb.y);
    expect(b.R).toBeLessThanOrEqual(903);
  });
  it('ignores a hotbar row high on the screen (the inventory drawer is open)', () => {
    const p = viewmodelPose(76.8, 128, SHOVEL, 903, 303, tune, 1, { x: 132, y: 60, w: 640, h: 743 });
    expect(p).toEqual(viewmodelPose(76.8, 128, SHOVEL, 903, 303, tune, 1, null));
  });
  it('pulls an item back from the right edge on a narrow canvas', () => {
    const b = box(viewmodelPose(76.8, 128, inHand(256), 400, 700, tune), 76.8, 128, inHand(256));
    expect(b.R).toBeLessThanOrEqual(400);
    expect(b.L).toBeGreaterThanOrEqual(0);
  });
});

describe('createHotbarProbe', () => {
  const bounded = (x: number) => Object.assign(new FakeNode(), { getBounds: () => ({ x, y: 500, width: 600, height: 60 }) });
  it('reads the row each call and re-resolves a destroyed one, retrying a miss only every 120 calls', () => {
    let calls = 0;
    let row: FakeNode | null = bounded(10);
    new FakeNode().addChild(row);
    const probe = createHotbarProbe(() => { calls++; return row?.node ?? null; });
    expect(probe()).toEqual({ x: 10, y: 500, w: 600, h: 60 });
    expect(probe()?.x).toBe(10);
    expect(calls).toBe(1);
    row.destroy();
    row = null;
    expect(probe()).toBeNull();
    for (let i = 0; i < 119; i++) probe();
    expect(calls).toBe(2);
    row = bounded(20);
    new FakeNode().addChild(row);
    expect(probe()?.x).toBe(20);
    expect(calls).toBe(3);
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
    const p = viewmodelPose(76.8, 128, SHOVEL, W, H, defaultViewmodelTune());
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
    const p = viewmodelPose(76.8, 128, SHOVEL, W, H, defaultViewmodelTune());
    expect(laid.length).toBe(1);
    // areaMarks reads owner.scale.x / lp.mm as the 2D scale (1 here) and the pinned transform as the drawn one.
    expect(laid[0]!.owner).toBe(avatar.node);
    expect([laid[0]!.x2d, laid[0]!.fy2d]).toEqual([5000, 3900]);
    expect(laid[0]!.k).toBeCloseTo(p.k, 9);
    expect(laid[0]!.k / laid[0]!.mm).toBeCloseTo(1, 9);
  });

  it("sizes the item from its root's bounds at the root's own scale (live 1419: crops draw at 0.5)", () => {
    const { avatar, held } = avatarWithHand();
    const root = Object.assign(new FakeNode(0, 115, 0.5), { getLocalBounds: () => ({ minX: -128, minY: -128, maxX: 128, maxY: 128 }) });
    Object.assign(held, { heldVisual: { root }, currentOffsetX: 0, currentOffsetY: 115.2, currentItemId: 'Delphinium' });
    const { ctx } = fpCtx(avatar);
    Object.assign(ctx, { W: 400, H: 700 });
    const h = createHeldHandler(defaultViewmodelTune(), () => undefined, noLay);
    h.begin(ctx);
    h.firstPerson(ctx, avatar.node);
    expect(avatar.scale.x).toBeCloseTo((0.35 * 400) / 128, 9);
  });

  it("measures the item about the root's pivot", () => {
    const { avatar, held } = avatarWithHand();
    const root = Object.assign(new FakeNode(0, 115, 0.5), { getLocalBounds: () => ({ minX: -128, minY: -128, maxX: 128, maxY: 128 }) });
    root.pivot.set(0, 600);
    Object.assign(held, { heldVisual: { root }, currentOffsetX: 0, currentOffsetY: 115.2, currentItemId: 'Delphinium' });
    const { ctx } = fpCtx(avatar);
    Object.assign(ctx, { H: 300 });
    const h = createHeldHandler(defaultViewmodelTune(), () => undefined, noLay);
    h.begin(ctx);
    h.firstPerson(ctx, avatar.node);
    // Drawn 364–236 above the rest point: at the 0.74 anchor its top would leave the screen, so it rests on the margin.
    const k = avatar.scale.x, top = avatar.y + k * (115.2 + (-128 - 600) * 0.5);
    expect(top).toBeCloseTo(8, 6);
  });

  it('keeps the item clear of the hotbar the probe reports', () => {
    const place = (hotbar: { x: number; y: number; w: number; h: number } | null): number => {
      const { avatar } = avatarWithHand();
      const { ctx } = fpCtx(avatar);
      const h = createHeldHandler(defaultViewmodelTune(), () => undefined, noLay, () => hotbar);
      h.begin(ctx);
      h.firstPerson(ctx, avatar.node);
      return avatar.y;
    };
    const hb = { x: 100, y: 520, w: 880, h: 60 };
    const y = place(hb), k = (0.55 * H) / 256;
    expect(y).toBeLessThan(place(null));
    expect(y + k * (128 + 68)).toBeLessThanOrEqual(hb.y);
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

describe('createHeldHandler (push-in self fade, P2 a)', () => {
  function withItem() {
    const r = avatarWithHand();
    const art = r.held.addChild(new FakeNode());
    art.label = 'HeldItemMorph';
    return { ...r, art };
  }
  const alphaOf = (puts: Array<[string, unknown, unknown]>, n: unknown): unknown => puts.filter((p) => p[0] === 'alpha' && p[1] === n).at(-1)?.[2];

  it("fades the body and the item art, never the hand's area grid (a floor indicator, not part of the body)", () => {
    const { avatar, body, art, area } = withItem();
    const { ctx, puts } = fpCtx(avatar);
    (ctx.ov as unknown as { gameValue: () => number }).gameValue = () => 1;
    const h = createHeldHandler(defaultViewmodelTune(), () => undefined, noLay);
    h.begin(ctx);
    h.fadeSelf(ctx, avatar.node, 0.4);
    expect(alphaOf(puts, body.node)).toBeCloseTo(0.4, 9);
    expect(alphaOf(puts, art.node)).toBeCloseTo(0.4, 9);
    expect(alphaOf(puts, area.node)).toBeUndefined();
    expect(alphaOf(puts, avatar.node)).toBeUndefined();
  });

  it('scales by the game alpha, and hands every faded node back at full alpha and on first person', () => {
    const { avatar, body, art } = withItem();
    const { ctx, puts, drops } = fpCtx(avatar);
    (ctx.ov as unknown as { gameValue: () => number }).gameValue = () => 0.5;
    const h = createHeldHandler(defaultViewmodelTune(), () => undefined, noLay);
    h.begin(ctx);
    h.fadeSelf(ctx, avatar.node, 0.4);
    expect(alphaOf(puts, body.node)).toBeCloseTo(0.2, 9);
    h.fadeSelf(ctx, avatar.node, 1);
    expect(drops).toContainEqual(['alpha', body.node]);
    expect(drops).toContainEqual(['alpha', art.node]);
    drops.length = 0;
    h.fadeSelf(ctx, avatar.node, 0.3);
    h.firstPerson(ctx, avatar.node);
    expect(drops).toContainEqual(['alpha', art.node]);
  });

  it('drops a node that left the hand (item switched mid-fade), and fades the whole avatar when the parts drifted', () => {
    const { avatar, held, art } = withItem();
    const { ctx, puts, drops } = fpCtx(avatar);
    const h = createHeldHandler(defaultViewmodelTune(), () => undefined, noLay);
    h.begin(ctx);
    h.fadeSelf(ctx, avatar.node, 0.5);
    held.children.splice(held.children.indexOf(art), 1);
    h.fadeSelf(ctx, avatar.node, 0.5);
    expect(drops).toContainEqual(['alpha', art.node]);
    held.label = 'HeldItem';
    h.begin(ctx);
    h.fadeSelf(ctx, avatar.node, 0.5);
    expect(alphaOf(puts, avatar.node)).toBeDefined();
  });

  it('first person lowers the item below the screen while the hand is still rising', () => {
    const { avatar } = withItem();
    const { ctx } = fpCtx(avatar);
    const h = createHeldHandler(defaultViewmodelTune(), () => undefined, noLay);
    h.begin(ctx);
    (ctx as { hand: number }).hand = 0;
    h.firstPerson(ctx, avatar.node);
    const low = avatar.y;
    ctx.saves.restoreAll();
    (ctx as { hand: number }).hand = 1;
    h.firstPerson(ctx, avatar.node);
    // The whole item (the Shovel's top is 68 above its rest point) is below the screen, then rests well above it.
    expect(low + avatar.scale.x * (128 - 68)).toBeGreaterThanOrEqual(H);
    expect(low).toBeGreaterThan(avatar.y + 0.25 * H);
  });
});
