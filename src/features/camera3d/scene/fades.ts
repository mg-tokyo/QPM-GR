import { EXACT_PITCH, type FrameCtx } from '../frame/frame';
import type { Node3, XY } from '../types';
import type { PartFade } from './buildings';

const TILE = 256;
const TAU_MS = 150;
const FULL_FADE_PITCH = (60 * Math.PI) / 180;
export const OCCLUDE_ALPHA = 0.35;

/** 0 at ≥ EXACT_PITCH (the camera is straight above the view centre, s = 0 must match 2D), 1 at ≤ 60°. */
export function fadeWeight(pitch: number): number {
  return Math.min(1, Math.max(0, (EXACT_PITCH - pitch) / (EXACT_PITCH - FULL_FADE_PITCH)));
}

export interface ScreenRect { x0: number; y0: number; x1: number; y1: number }

// Proximity bands in tiles from the camera. First person stands at eye height inside its own tile: only what the
// camera is in fades (user 2026-10-03: a plant one tile away went half transparent).
const PROX_THIRD = { from: 0.5, to: 1.5 } as const;
const PROX_FIRST = { from: 0.15, to: 0.6 } as const;

/** D8: proximity fade and occlusion fade, whichever is stronger. */
export function fadeTarget(rect: ScreenRect | null, key: number, avatarKey: number | null, avatarUpper: XY | null, distPx: number, firstPerson = false): number {
  const band = firstPerson ? PROX_FIRST : PROX_THIRD;
  const prox = Math.min(1, Math.max(0, (distPx - band.from * TILE) / ((band.to - band.from) * TILE)));
  const covers = !!rect && !!avatarUpper && avatarKey !== null && key > avatarKey
    && avatarUpper.x >= rect.x0 && avatarUpper.x <= rect.x1 && avatarUpper.y >= rect.y0 && avatarUpper.y <= rect.y1;
  return Math.min(prox, covers ? OCCLUDE_ALPHA : 1);
}

export function easeAlpha(cur: number, target: number, dtMs: number): number {
  return target + (cur - target) * Math.exp(-Math.max(0, dtMs) / TAU_MS);
}

export function spriteScreenRect(n: Node3, out: ScreenRect = { x0: 0, y0: 0, x1: 0, y1: 0 }): ScreenRect | null {
  if (!n.texture || !n.anchor) return null;
  const w = n.texture.orig.width * n.scale.x, h = n.texture.orig.height * n.scale.y;
  const x0 = n.x - n.anchor.x * w, y0 = n.y - n.anchor.y * h;
  out.x0 = Math.min(x0, x0 + w); out.y0 = Math.min(y0, y0 + h); out.x1 = Math.max(x0, x0 + w); out.y1 = Math.max(y0, y0 + h);
  return out;
}

export interface Fader { factor(ctx: FrameCtx, node: Node3, key: number, gx: number, gy: number, occlude?: boolean): number; drop(): void }

export function createFader(): Fader {
  const cur = new Map<Node3, number>();
  const scratch: ScreenRect = { x0: 0, y0: 0, x1: 0, y1: 0 };
  let lastFrame = -1, lastNow = 0, dt = 16;
  return {
    factor(ctx, node, key, gx, gy, occlude = true) {
      if (ctx.frameNo !== lastFrame) { dt = lastNow ? Math.min(100, ctx.now - lastNow) : 16; lastNow = ctx.now; lastFrame = ctx.frameNo; }
      const w = fadeWeight(ctx.params.pitch);
      const prev = cur.get(node);
      if (w === 0 && prev === undefined) return 1;
      const dist = Math.hypot(gx - ctx.basis.C[0], gy - ctx.basis.C[2]);
      // Per card per frame: the rect only matters for a card in front of the avatar, and is never allocated.
      const canOcclude = occlude && ctx.avatarUpper !== null && ctx.avatarKey !== null && key > ctx.avatarKey;
      const t = fadeTarget(canOcclude ? spriteScreenRect(node, scratch) : null, key, ctx.avatarKey, ctx.avatarUpper, dist, ctx.hideSelf);
      const target = 1 - w * (1 - t);
      if (prev === undefined && target > 0.995) return 1;
      const a = easeAlpha(prev ?? 1, target, dt);
      if (a > 0.995) { cur.delete(node); return 1; }
      cur.set(node, a);
      return a;
    },
    drop() { cur.clear(); lastFrame = -1; lastNow = 0; },
  };
}

/** Fade for game-owned nodes, written through the alpha override and scaled by the game's alpha. `occlude` false:
 * the proximity fade only (every billboard, user decision 2026-10-03); building parts also get the occlusion fade. */
export function gameNodeFade(fader: Fader, occlude = true): PartFade {
  return (ctx, part, key, gx, gy) => {
    const f = fader.factor(ctx, part, key, gx, gy, occlude);
    if (f >= 1) ctx.ov.drop('alpha', part);
    else ctx.ov.put('alpha', part, f * ctx.ov.gameValue<number>('alpha', part));
  };
}
