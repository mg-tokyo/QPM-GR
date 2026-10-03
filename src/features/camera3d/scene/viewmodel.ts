import type { FrameCtx } from '../frame/frame';
import type { Node3, XY } from '../types';
import { holdThroughOnRender, newPlacement, type HeldHandler, type Placement } from './entities';

// Above every entity depth key (|key| ≤ 4.2e8, math/depth.ts); overlay layers are detached while tilted (layers.ts).
export const VIEWMODEL_Z = 1e11;

export interface ViewmodelTune {
  /** In hand: one tile is this fraction of the screen height. */
  handFrac: number;
  /** Carried overhead: the item is at most this fraction of the screen height. */
  carryMaxH: number;
  /** Screen fractions: the in-hand item's rest point (its centre), the carried item's rest point (its bottom). */
  hand: XY;
  carry: XY;
  /** Spec §6.9 item 5: keep the item drawn, frozen, through the game's 500 ms action hide (live gate G9). */
  holdSuppressed: boolean;
}

// Right of the in-canvas hotbar (x 21–79 %, y ≥ 85 % at 1278 × 656, live 2026-10-03).
export const defaultViewmodelTune = (): ViewmodelTune => ({
  handFrac: 0.55, carryMaxH: 0.4, hand: { x: 0.87, y: 0.74 }, carry: { x: 0.84, y: 0.99 }, holdSuppressed: false,
});

export interface Pose { k: number; x: number; y: number; overhead: boolean }

/** Scale and position of the avatar container that put the item's rest point (offX, offY) on its anchor. */
export function viewmodelPose(offX: number, offY: number, itemH: number, W: number, H: number, t: ViewmodelTune): Pose {
  const overhead = offY < 0;
  let k = (t.handFrac * H) / 256;
  if (overhead && itemH > 0) k = Math.min(k, (t.carryMaxH * H) / itemH);
  const a = overhead ? t.carry : t.hand;
  return { k, x: a.x * W - k * offX, y: a.y * H - k * offY, overhead };
}

interface BoundsLike { minY: number; maxY: number }
export interface HeldVisualLike extends Node3 {
  currentOffsetX?: unknown;
  currentOffsetY?: unknown;
  currentItemId?: unknown;
  suppressUntil?: unknown;
  heldVisual?: { root?: (Node3 & { getLocalBounds?(): BoundsLike }) | null } | null;
  areaIndicator?: { container?: Node3 | null } | null;
}
export interface HeldParts { body: Node3; held: HeldVisualLike }

/** The body and the hand of an avatar container (live 1381: `AvatarRotation`, `HeldItemVisual`). */
export function heldPartsOf(avatar: Node3): HeldParts | null {
  let body: Node3 | null = null;
  let held: HeldVisualLike | null = null;
  for (const c of avatar.children) {
    if (c.label === 'AvatarRotation') body = c;
    else if (c.label === 'HeldItemVisual') held = c as HeldVisualLike;
  }
  return body && held ? { body, held } : null;
}

/** The hand's area indicator (ward coverage, plant activation tiles) while it is a non-empty child of the hand. */
export function areaOf(held: HeldVisualLike): Node3 | null {
  const c = held.areaIndicator?.container;
  return c && c.parent === held && c.children.length > 0 ? c : null;
}

type Mode = 'off' | 'fp' | 'tp' | 'fallback';

/** layAreas: `LayerHandler.layAreas` (areaMarks.ts lays the hand's grid flat, like every other area grid). */
export function createHeldHandler(tune: ViewmodelTune, onDrift: (what: string) => void, layAreas: (ctx: FrameCtx, owner: Node3, lp: Placement) => void): HeldHandler {
  let parts: HeldParts | null = null;
  let area: Node3 | null = null;
  let body: Node3 | null = null;
  let suppressed: Node3 | null = null;
  let fit: { item: unknown; h: number } = { item: undefined, h: 256 };
  let mode: Mode = 'off';
  let drifted = false;
  let lastK = 0;
  const fpLp = newPlacement();

  const drift = (what: string): void => {
    mode = 'fallback';
    if (drifted) return;
    drifted = true;
    onDrift(what);
  };

  const itemHeight = (h: HeldVisualLike): number => {
    if (fit.item !== h.currentItemId) {
      const b = h.heldVisual?.root?.getLocalBounds?.();
      fit = { item: h.currentItemId, h: b ? Math.max(1, b.maxY - b.minY) : 256 };
    }
    return fit.h;
  };

  function holdSuppressed(ctx: FrameCtx, held: HeldVisualLike): void {
    const until = held.suppressUntil;
    if (typeof until === 'number' && until > ctx.now && held.heldVisual) {
      ctx.ov.put('visible', held, true);
      suppressed = held;
    } else if (suppressed) {
      ctx.ov.drop('visible', suppressed);
      suppressed = null;
    }
  }

  function unpin(ctx: FrameCtx): void {
    if (body) { ctx.ov.drop('visible', body); body = null; }
    if (suppressed) { ctx.ov.drop('visible', suppressed); suppressed = null; }
  }

  return {
    begin(ctx) {
      parts = ctx.avatar ? heldPartsOf(ctx.avatar) : null;
      area = parts ? areaOf(parts.held) : null;
    },
    firstPerson(ctx, avatar) {
      if (!parts) { drift('parts'); return false; }
      const { held } = parts;
      const offX = held.currentOffsetX, offY = held.currentOffsetY;
      if (typeof offX !== 'number' || typeof offY !== 'number') { drift('offsets'); return false; }
      mode = 'fp';
      ctx.ov.drop('visible', avatar);
      ctx.ov.put('visible', parts.body, false);
      body = parts.body;
      ctx.ov.put('zIndex', avatar, VIEWMODEL_Z);
      const ax = avatar.x, ay = avatar.y, s2d = avatar.scale.x;
      const p = viewmodelPose(offX, offY, itemHeight(held), ctx.W, ctx.H, tune);
      lastK = p.k;
      ctx.saves.save(avatar);
      avatar.scale.set(p.k, p.k);
      avatar.position.set(p.x, p.y);
      holdThroughOnRender(ctx, avatar, p.x, p.y, p.k, p.k);
      // The hand's area tiles (ward coverage) lie on the floor (areaMarks.ts), laid after the pin: areaMarks reads the
      // grid's 2D chain from (x2d, fy2d, scale / mm), not from the pinned avatar.
      if (s2d > 0) { fpLp.x2d = ax; fpLp.fy2d = ay; fpLp.mm = p.k / s2d; layAreas(ctx, avatar, fpLp); }
      if (tune.holdSuppressed) holdSuppressed(ctx, held);
      return true;
    },
    release(ctx) {
      if (body || suppressed) unpin(ctx);
      mode = 'tp';
    },
    drop() {
      parts = null; area = null; body = null; suppressed = null;
      mode = 'off'; lastK = 0;
      fit = { item: undefined, h: 256 };
    },
    stats: () => ({ held: mode, heldK: +lastK.toFixed(3), heldArea: area ? area.children.length : 0 }),
  };
}
