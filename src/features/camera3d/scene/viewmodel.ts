import { TILE } from '../constants';
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
  /** The item is at most this fraction of the screen width (a portrait canvas would otherwise size it by height). */
  maxW: number;
  /** Spec §6.9 item 5: keep the item drawn, frozen, through the game's 500 ms action hide (live gate G9). */
  holdSuppressed: boolean;
}

// Right of the in-canvas hotbar (x 21–79 %, y ≥ 85 % at 1278 × 656, live 2026-10-03).
export const defaultViewmodelTune = (): ViewmodelTune => ({
  handFrac: 0.55, carryMaxH: 0.4, hand: { x: 0.87, y: 0.74 }, carry: { x: 0.84, y: 0.99 }, maxW: 0.35, holdSuppressed: false,
});

export interface Pose { k: number; x: number; y: number; overhead: boolean }
/** The item's box about its rest point, in avatar units. */
export interface ItemExtent { minX: number; maxX: number; minY: number; maxY: number }
export interface Rect { x: number; y: number; w: number; h: number }

// Without the item's bounds: one tile about the rest point in hand, one tile standing on it carried.
const TILE_HAND: ItemExtent = { minX: -TILE / 2, maxX: TILE / 2, minY: -TILE / 2, maxY: TILE / 2 };
const TILE_CARRY: ItemExtent = { minX: -TILE / 2, maxX: TILE / 2, minY: -TILE, maxY: 0 };
const MARGIN = 8;
// The hotbar panel rests at the bottom (live 1419: top 66 % at 903 × 303, 78 % at 1278 × 579); higher, the drawer is open.
const HOTBAR_MIN_Y = 0.5;

/** Scale and position of the avatar container that put the item's rest point (offX, offY) on its anchor, then inside
 * the canvas and clear of the hotbar: beside it when there is room, else above it (A W5). raise < 1: lowered toward a
 * pose with the whole item below the screen. */
export function viewmodelPose(offX: number, offY: number, e: ItemExtent, W: number, H: number, t: ViewmodelTune, raise = 1, hotbar: Rect | null = null): Pose {
  const overhead = offY < 0;
  let k = (t.handFrac * H) / TILE;
  if (overhead) k = Math.min(k, (t.carryMaxH * H) / Math.max(1, e.maxY - e.minY));
  k = Math.min(k, (t.maxW * W) / Math.max(1, e.maxX - e.minX));
  const a = overhead ? t.carry : t.hand;
  let rx = Math.max(MARGIN - k * e.minX, Math.min(a.x * W, W - MARGIN - k * e.maxX));
  let ry = Math.max(MARGIN - k * e.minY, Math.min(a.y * H, H - k * e.maxY));
  if (hotbar && hotbar.y >= HOTBAR_MIN_Y * H) {
    const x0 = hotbar.x - MARGIN, x1 = hotbar.x + hotbar.w + MARGIN, y0 = hotbar.y - MARGIN, y1 = hotbar.y + hotbar.h + MARGIN;
    if (rx + k * e.maxX > x0 && rx + k * e.minX < x1 && ry + k * e.maxY > y0 && ry + k * e.minY < y1) {
      const beside = x1 - k * e.minX;
      if (beside + k * e.maxX <= W - MARGIN) rx = Math.max(rx, beside);
      else ry = Math.min(ry, y0 - k * e.maxY);
    }
  }
  const drop = raise < 1 ? (H - (ry + k * e.minY) + 1) * (1 - raise) : 0;
  return { k, x: rx - k * offX, y: ry - k * offY + drop, overhead };
}

/** The hotbar panel's screen rect (capabilities.ts resolveHotbar), read per call (0.005 ms live) into one reused rect. A
 * missing or destroyed panel is looked up again at most every RETRY calls. */
export function createHotbarProbe(resolve: () => Node3 | null): () => Rect | null {
  const RETRY = 120;
  const out: Rect = { x: 0, y: 0, w: 0, h: 0 };
  let row: Node3 | null = null;
  let wait = 0;
  let bounds: unknown = undefined; // PIXI fills a passed Bounds instead of allocating one per call
  return () => {
    if (row && (row.destroyed || !row.parent)) row = null;
    if (!row) {
      if (wait > 0) { wait--; return null; }
      row = resolve();
      if (!row) { wait = RETRY - 1; return null; }
    }
    const b = row.getBounds?.(false, bounds);
    if (!b) return null;
    bounds = b;
    out.x = b.x; out.y = b.y; out.w = b.width; out.h = b.height;
    return out;
  };
}

interface BoundsLike { minX: number; maxX: number; minY: number; maxY: number }
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
export function createHeldHandler(
  tune: ViewmodelTune, onDrift: (what: string) => void, layAreas: (ctx: FrameCtx, owner: Node3, lp: Placement) => void, hotbar: () => Rect | null = () => null,
): HeldHandler {
  let parts: HeldParts | null = null;
  let area: Node3 | null = null;
  let body: Node3 | null = null;
  let suppressed: Node3 | null = null;
  let fit: { root: unknown; e: ItemExtent | null } = { root: undefined, e: null };
  let mode: Mode = 'off';
  let drifted = false;
  let lastK = 0;
  const fpLp = newPlacement();
  // The push-in fade's nodes: the body and the hand's art, never its area grid (it lies on the floor, areaMarks.ts
  // multiplies ancestor alpha, so fading the avatar container would fade the ward grid out and back in at the switch).
  const faded: Node3[] = [];
  let fadedN = 0;
  const next: Node3[] = [];

  const drift = (what: string): void => {
    mode = 'fallback';
    if (drifted) return;
    drifted = true;
    onDrift(what);
  };

  // The art root sits on the rest point (live 1419: Sprite at currentOffset, anchor 0.5) at its own scale (crops 0.5),
  // drawn about its pivot.
  const extentOf = (h: HeldVisualLike, overhead: boolean): ItemExtent => {
    const root = h.heldVisual?.root ?? null;
    if (fit.root !== root) {
      const b = root?.getLocalBounds?.();
      const sx = Math.abs(root?.scale.x ?? 1), sy = Math.abs(root?.scale.y ?? 1), px = root?.pivot.x ?? 0, py = root?.pivot.y ?? 0;
      fit = {
        root,
        e: b && b.maxX > b.minX && b.maxY > b.minY ? { minX: (b.minX - px) * sx, maxX: (b.maxX - px) * sx, minY: (b.minY - py) * sy, maxY: (b.maxY - py) * sy } : null,
      };
    }
    return fit.e ?? (overhead ? TILE_CARRY : TILE_HAND);
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

  function unfade(ctx: FrameCtx): void {
    for (let i = 0; i < fadedN; i++) ctx.ov.drop('alpha', faded[i]!);
    fadedN = 0;
  }

  function fadeParts(ctx: FrameCtx, avatar: Node3, alpha: number): void {
    let n = 0;
    if (parts) {
      next[n++] = parts.body;
      const areaNode = parts.held.areaIndicator?.container ?? null;
      for (const c of parts.held.children) if (c !== areaNode) next[n++] = c;
    } else {
      next[n++] = avatar;
    }
    for (let i = 0; i < fadedN; i++) {
      const f = faded[i]!;
      let kept = false;
      for (let j = 0; j < n && !kept; j++) kept = next[j] === f;
      if (!kept) ctx.ov.drop('alpha', f);
    }
    for (let j = 0; j < n; j++) {
      const c = next[j]!;
      faded[j] = c;
      ctx.ov.put('alpha', c, alpha * ctx.ov.gameValue<number>('alpha', c));
    }
    fadedN = n;
  }

  return {
    begin(ctx) {
      parts = ctx.avatar ? heldPartsOf(ctx.avatar) : null;
      area = parts ? areaOf(parts.held) : null;
    },
    firstPerson(ctx, avatar) {
      if (fadedN) unfade(ctx);
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
      const p = viewmodelPose(offX, offY, extentOf(held, offY < 0), ctx.W, ctx.H, tune, ctx.hand, hotbar());
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
    fadeSelf(ctx, avatar, alpha) {
      if (alpha < 1) fadeParts(ctx, avatar, alpha);
      else if (fadedN) unfade(ctx);
    },
    drop() {
      faded.length = 0; next.length = 0; fadedN = 0;
      parts = null; area = null; body = null; suppressed = null;
      mode = 'off'; lastK = 0;
      fit = { root: undefined, e: null };
    },
    stats: () => ({ held: mode, heldK: +lastK.toFixed(3), heldArea: area ? area.children.length : 0 }),
  };
}
