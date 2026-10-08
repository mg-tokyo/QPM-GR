import { TILE } from '../constants';
import type { FrameCtx } from '../frame/frame';
import type { Node3, XY } from '../types';
import type { PartFade } from './buildings';

const TAU_MS = 150;
export const OCCLUDE_ALPHA = 0.35;

export interface ScreenRect { x0: number; y0: number; x1: number; y1: number }

// Proximity bands in tiles from the camera. First person stands at eye height inside its own tile: only what the
// camera is in fades (user 2026-10-03: a plant one tile away went half transparent).
const PROX_THIRD = { from: 0.5, to: 1.5 } as const;
const PROX_FIRST = { from: 0.15, to: 0.6 } as const;
// By view depth, in both modes: a card beside the lens is far on the ground but projects many screens tall.
const LENS = { from: 0.2, to: 0.4 } as const;

const ramp = (v: number, b: { from: number; to: number }): number => Math.min(1, Math.max(0, (v - b.from * TILE) / ((b.to - b.from) * TILE)));

/** D8: proximity fade (ground distance, and view depth for the lens) and occlusion fade, whichever is strongest. */
export function fadeTarget(rect: ScreenRect | null, key: number, avatarKey: number | null, avatarUpper: XY | null, distPx: number, firstPerson = false, depthPx = Infinity): number {
  const prox = Math.min(ramp(distPx, firstPerson ? PROX_FIRST : PROX_THIRD), ramp(depthPx, LENS));
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

export interface Fader {
  factor(ctx: FrameCtx, node: Node3, key: number, gx: number, gy: number, occlude?: boolean): number;
  /** Mid-fade, or pending one (factor would act on it). Ticks the frame clock as factor does, so a frame whose cards all skipped
   * factor (still camera, perf Task 4) does not leave the next fade a multi-frame dt. */
  isFading(ctx: FrameCtx, node: Node3): boolean;
  /** Forgets cards destroyed or detached mid-fade (A R4). */
  prune(): void;
  size(): number;
  drop(): void;
}

export function createFader(): Fader {
  // A mutable slot per card: a number stored in a Map is a fresh heap number on every write (A PF4).
  const cur = new Map<Node3, { a: number }>();
  // Target under 0.995 but a first step that rounds to 1 at this frame's dt: a slower frame starts the fade, so a
  // still-camera skip must keep asking (isFading).
  const pending = new Set<Node3>();
  const settle = (node: Node3): number => { if (pending.size > 0) pending.delete(node); return 1; };
  const scratch: ScreenRect = { x0: 0, y0: 0, x1: 0, y1: 0 };
  let lastFrame = -1, lastNow = 0, dt = 16;
  const clock = (ctx: FrameCtx): void => {
    if (ctx.frameNo !== lastFrame) { dt = lastNow ? Math.min(100, ctx.now - lastNow) : 16; lastNow = ctx.now; lastFrame = ctx.frameNo; }
  };
  return {
    factor(ctx, node, key, gx, gy, occlude = true) {
      clock(ctx);
      // Fades scale in with the tilt (s), so the s = 0 2D match draws every card at its own alpha.
      const w = ctx.tilt;
      const prev = cur.get(node);
      if (w === 0 && prev === undefined) return settle(node);
      const { C, F } = ctx.basis;
      const ddx = gx - C[0], ddz = gy - C[2];
      const dist = Math.sqrt(ddx * ddx + ddz * ddz);
      const depth = ddx * F[0] - C[1] * F[1] + ddz * F[2];
      // Per card per frame: the rect only matters for a card in front of the avatar, and is never allocated.
      const canOcclude = occlude && ctx.avatarUpper !== null && ctx.avatarKey !== null && key > ctx.avatarKey;
      const t = fadeTarget(canOcclude ? spriteScreenRect(node, scratch) : null, key, ctx.avatarKey, ctx.avatarUpper, dist, ctx.hideSelf, depth);
      const target = 1 - w * (1 - t);
      if (prev === undefined && target > 0.995) return settle(node);
      const a = easeAlpha(prev ? prev.a : 1, target, dt);
      if (a > 0.995) {
        if (prev) { cur.delete(node); return 1; }
        pending.add(node);
        return 1;
      }
      if (prev) prev.a = a; else { settle(node); cur.set(node, { a }); }
      return a;
    },
    isFading(ctx, node) { clock(ctx); return cur.has(node) || (pending.size > 0 && pending.has(node)); },
    prune() {
      for (const n of cur.keys()) if (n.destroyed === true || !n.parent) cur.delete(n);
      for (const n of pending) if (n.destroyed === true || !n.parent) pending.delete(n);
    },
    size: () => cur.size,
    drop() { cur.clear(); pending.clear(); lastFrame = -1; lastNow = 0; },
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
