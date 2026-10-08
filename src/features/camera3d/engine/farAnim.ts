import { TILE } from '../constants';
import type { FrameCtx, Pass } from '../frame/frame';
import { sortYOf } from '../math/depth';
import type { Node3 } from '../types';

/** "Far pets animate" (PC3 b, 2026-10-07): off freezes pets and players past FAR_PX from the look target. */
export type FarAnim = 'off' | 'full';

export const FAR_PX = 10 * TILE;
export const NEAR_PX = FAR_PX - TILE;
const FAR2 = FAR_PX * FAR_PX;
const NEAR2 = NEAR_PX * NEAR_PX;
// Every 8th frame plus re-cull frames: the registry list is a fresh array per read.
const SCAN_MASK = 7;
const ROOT_DEPTH = 32;

/** d2: squared ground distance from the camera; wasFar: paused now (1-tile hysteresis). */
export const isFar = (d2: number, wasFar: boolean): boolean => d2 > (wasFar ? NEAR2 : FAR2);

// The game's RiveSprite (live v1431; beta 3668 RiveSprite.ts:688-726). pause() snapshots the frame into its own texture
// and leaves the atlas; resume() empties the texture until the next draw() and flush put it back.
interface RiveSpriteLike { readonly isPaused: boolean; pause(): void; resume(): void; readonly destroyed?: boolean }
interface Walkable { readonly parent?: Node3 | null }

export interface FarAnimDeps {
  world: Node3;
  /** Visits each Rive sprite in the game's atlas working set: the ones it draws this frame. */
  each(fn: (raw: unknown) => void): void;
  /** False until the Rive tracker has hooked that working set: `each` would visit nothing. */
  tracking(): boolean;
  isSelf(ctx: FrameCtx, root: Node3): boolean;
  /** Once per install: kind 'refused' (a pause the game cancelled), 'shape' (no pause/resume/isPaused) or 'tracker'. */
  report(info: Record<string, unknown>): void;
}

export interface FarAnimPass extends Pass {
  setMode(m: FarAnim): void;
  mode(): FarAnim;
  stats(): { mode: FarAnim; far: number; paused: number; refused: number };
}

const asSprite = (raw: unknown): RiveSpriteLike | null => {
  const s = raw as Partial<RiveSpriteLike> | null;
  return s && typeof s.pause === 'function' && typeof s.resume === 'function' && typeof s.isPaused === 'boolean' ? (s as RiveSpriteLike) : null;
};

// Only pet and avatar views hold World-rooted Rive sprites: decor draws through shared backings outside World (beta 3668
// SharedRiveBacking.ts, RiveWorldVisual.ts). Decisions are made in pre, before the entity pass writes 3D positions, and
// carried out in post: a pause there freezes the frame just drawn, a resume there redraws at the next flush (live
// 2026-10-07). A resume between that flush and the render would draw an empty texture, so releases wait a microtask.
export function createFarAnim(deps: FarAnimDeps): FarAnimPass {
  const { world } = deps;
  let mode: FarAnim = 'full';
  let due = false;
  let far = 0;
  let refusedN = 0;
  let reported = false;
  let scanCtx: FrameCtx | null = null;
  const roots = new WeakMap<object, Node3>();
  const paused = new Set<RiveSpriteLike>();
  const refused = new WeakSet<object>();
  const toPause: RiveSpriteLike[] = [];
  const toResume: RiveSpriteLike[] = [];

  const once = (info: Record<string, unknown>): void => {
    if (reported) return;
    reported = true;
    deps.report(info);
  };

  const refuse = (s: RiveSpriteLike): void => {
    refused.add(s);
    refusedN++;
    once({ kind: 'refused' });
  };

  function rootOf(s: Walkable): Node3 | null {
    const c = roots.get(s);
    if (c && c.parent === world && !c.destroyed) return c;
    let n = s as Walkable | null;
    for (let d = 0; n && d < ROOT_DEPTH; d++) {
      const up: Node3 | null = n.parent ?? null;
      if (up === world) { roots.set(s, n as Node3); return n as Node3; }
      n = up;
    }
    return null;
  }

  // From the look target, not the camera (PC13): the camera's distance from the avatar grows with the 2D zoom (35 tiles
  // at intent 60, s 0.18, live 2026-10-07), so a camera rule froze everything around the player.
  const dist2 = (ctx: FrameCtx, root: Node3): number => {
    const t = ctx.target;
    const dx = root.x - t.x, dy = sortYOf(ctx.ov.gameValue<number>('zIndex', root), root.y) - t.y;
    return dx * dx + dy * dy;
  };

  const visit = (raw: unknown): void => {
    const ctx = scanCtx;
    if (!ctx) return;
    const root = rootOf(raw as Walkable);
    if (!root) return;
    const s = asSprite(raw);
    if (!s) { once({ kind: 'shape' }); return; }
    if (s.isPaused || paused.has(s) || refused.has(s) || deps.isSelf(ctx, root)) return;
    if (isFar(dist2(ctx, root), false)) { far++; toPause.push(s); }
  };

  function release(): void {
    toPause.length = 0;
    toResume.length = 0;
    due = true;
    far = 0;
    if (paused.size === 0) return;
    const list = [...paused];
    paused.clear();
    queueMicrotask(() => {
      for (const s of list) {
        try { s.resume(); } catch { /* destroyed with its view: nothing to give back */ }
      }
    });
  }

  return {
    name: 'farAnim',
    pre(ctx) {
      if (mode === 'full' || (!due && !ctx.reCull && (ctx.frameNo & SCAN_MASK) !== 0)) return;
      due = false;
      far = 0;
      if (deps.tracking()) {
        scanCtx = ctx;
        try { deps.each(visit); } finally { scanCtx = null; }
      } else once({ kind: 'tracker' });
      for (const s of paused) {
        if (s.destroyed) { paused.delete(s); continue; }
        if (!s.isPaused) { paused.delete(s); refuse(s); continue; }
        const root = rootOf(s as Walkable);
        // A root the game hid is one it stopped drawing: resuming frees the snapshot texture.
        const keep = root !== null && !deps.isSelf(ctx, root) && ctx.ov.gameValue<boolean>('visible', root) && isFar(dist2(ctx, root), true);
        if (keep) far++; else toResume.push(s);
      }
    },
    post() {
      for (let i = 0; i < toPause.length; i++) {
        const s = toPause[i]!;
        if (s.destroyed || s.isPaused) continue;
        try { s.pause(); paused.add(s); } catch { refuse(s); }
      }
      for (let i = 0; i < toResume.length; i++) {
        const s = toResume[i]!;
        paused.delete(s);
        try { s.resume(); } catch { /* destroyed with its view */ }
      }
      toPause.length = 0;
      toResume.length = 0;
    },
    drop: release,
    destroy: release,
    setMode(m) {
      if (m === mode) return;
      mode = m;
      if (m === 'full') release(); else due = true;
    },
    mode: () => mode,
    stats: () => ({ mode, far, paused: paused.size, refused: refusedN }),
  };
}
