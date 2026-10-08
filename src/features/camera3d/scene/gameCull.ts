import { TILE } from '../constants';
import type { FrameCtx } from '../frame/frame';
import type { Node3 } from '../types';
import { FlipGate, IDLE_FRAMES, rectOnScreen } from './flipGate';

/** How far a game node's art may reach from its projected foot (world px at the foot's depth). Live 2026-10-06 (v1419):
 * every tile ≤ 317 px sideways, 1,234 up, 213 down from its origin; pets ≤ 307 and 869; lifted produce, on its own
 * ground point at up to 1.58× the tile's depth factor, ≤ 517 sideways (its art taken as half a tile wide), 149 down.
 * Up adds the art-row offset (the foot sits under the origin). Tighter is fewer forced shows (walk: 768 px → 31 of
 * 32, 512 → 19, 384 → 13); looser only shows sooner. */
export const ART_REACH = { side: 576, up: 6 * TILE, down: 2 * TILE } as const;

const sweepFrame = (ctx: FrameCtx): boolean => ctx.frameNo % IDLE_FRAMES === 0;

/** Visibility of game nodes the entity pass culls. A flip rebuilds World's instructions (live 2026-10-06: the entity
 * pass's cull flips dirtied 109 of 119 walk frames), so a culled node is parked by a pinned alpha-0 override (no
 * structure change), hidden on a frame that rebuilds anyway, and a hidden node back in view waits while its art is off
 * screen. Without a frame begun (a direct placeBillboard call) every flip happens at once. */
export class GameCull {
  private gate: FlipGate | null = null;
  /** Parked node → the frame it was parked. */
  private readonly parkedAt = new Map<Node3, number>();
  /** Hidden nodes in view at their last check, re-tried every frame until shown. */
  private readonly waiting = new Set<Node3>();
  /** Shows that flipped on a frame not rebuilding yet (art on screen, or the sweep), and those of them that had waited:
   * the rest were found in view late, by their rolling re-check. */
  private urgent = 0;
  private urgentWaited = 0;

  get forced(): number { return this.gate?.forced ?? 0; }

  begin(ctx: FrameCtx): void {
    const world = ctx.caps.scene.world;
    if (!this.gate || this.gate.world !== world) this.gate = new FlipGate(world);
    this.gate.begin(ctx);
  }

  /** After the World walk: parked nodes are hidden on a frame that rebuilds anyway, or on the sweep frame once idle.
   * A destroyed or detached one is forgotten; so is one whose alpha another writer now owns (a building piece drawn by
   * its anchor and faded), keeping that writer's value. */
  end(ctx: FrameCtx): void {
    const g = this.gate;
    if (!g) return;
    if (this.parkedAt.size && (g.structural(ctx) || sweepFrame(ctx))) {
      for (const [n, at] of this.parkedAt) {
        if (n.destroyed === true || !n.parent) { this.forget(ctx, n); continue; }
        if (ctx.ov.raw<number>('alpha', n) !== 0) { this.parkedAt.delete(n); continue; }
        if (g.structural(ctx) || g.canHide(ctx, ctx.frameNo - at)) this.hide(ctx, n);
      }
    }
    g.end();
  }

  /** Read on every skipped entity: the raw alpha first, the map only when it is 0. */
  isParked(ctx: FrameCtx, n: Node3): boolean { return ctx.ov.raw<number>('alpha', n) === 0 && this.parkedAt.has(n); }
  isWaiting(n: Node3): boolean { return this.waiting.has(n); }

  /** A hidden node in view may show this frame: its art is on screen, World rebuilds anyway, or it is the sweep frame
   * (so a still camera keeps nothing waiting for long). (sx, sy, cz): the projected foot; pad widens the art by
   * world px. */
  canShow(ctx: FrameCtx, sx: number, sy: number, cz: number, pad = 0): boolean {
    return !this.gate || this.gate.canShow(ctx, this.artOnScreen(ctx, sx, sy, cz, pad)) || sweepFrame(ctx);
  }

  /** Out of view. */
  cull(ctx: FrameCtx, n: Node3): void {
    this.waiting.delete(n);
    if (this.parkedAt.has(n) || !ctx.ov.raw<boolean>('visible', n)) return;
    if (!this.gate || this.gate.structural(ctx)) { this.hide(ctx, n); return; }
    // Pinned: a game alpha write while parked goes to the shadow, not on screen.
    ctx.ov.put('alpha', n, 0, true);
    this.parkedAt.set(n, ctx.frameNo);
  }

  /** In view: a tile is pinned shown (`pin`), anything else takes the game's value. Returns whether it is drawn. */
  show(ctx: FrameCtx, n: Node3, pin: boolean, sx: number, sy: number, cz: number): boolean {
    const { ov } = ctx;
    const waited = this.waiting.delete(n);
    if (this.parkedAt.delete(n)) ov.drop('alpha', n);
    const was = ov.raw<boolean>('visible', n);
    if (!was && (pin || ov.gameValue<boolean>('visible', n)) && !this.canShow(ctx, sx, sy, cz)) {
      this.waiting.add(n);
      return false;
    }
    // Read before the write: a flip sets World's structureDidChange itself.
    const rebuilding = !this.gate || this.gate.structural(ctx);
    if (pin) ov.put('visible', n, true, true);
    else ov.drop('visible', n);
    const now = ov.raw<boolean>('visible', n);
    if (now !== was && this.gate) {
      if (!rebuilding) { this.urgent++; if (waited) this.urgentWaited++; }
      this.gate.noteFlip();
    }
    return now;
  }

  /** Forgets destroyed and detached nodes; a detached one gets its own alpha back now, not when 3D is left. */
  prune(ctx: FrameCtx): void {
    for (const n of this.parkedAt.keys()) if (n.destroyed === true || !n.parent) this.forget(ctx, n);
    for (const n of this.waiting) if (n.destroyed === true || !n.parent) this.waiting.delete(n);
  }

  /** 3D left: the overrides go back with ov.dropAll() (frame.ts drop, right after the passes'). */
  drop(): void { this.parkedAt.clear(); this.waiting.clear(); }

  stats(): { parked: number; waiting: number; forced: number; urgent: number; urgentWaited: number } {
    return { parked: this.parkedAt.size, waiting: this.waiting.size, forced: this.forced, urgent: this.urgent, urgentWaited: this.urgentWaited };
  }

  private forget(ctx: FrameCtx, n: Node3): void { this.parkedAt.delete(n); ctx.ov.drop('alpha', n); }

  private hide(ctx: FrameCtx, n: Node3): void {
    const was = ctx.ov.raw<boolean>('visible', n);
    ctx.ov.put('visible', n, false);
    if (was) this.gate?.noteFlip();
    if (this.parkedAt.delete(n)) ctx.ov.drop('alpha', n);
  }

  // The art's possible rect around its foot, mm = fpx / cz (nothing to draw in front of the near plane).
  private artOnScreen(ctx: FrameCtx, sx: number, sy: number, cz: number, pad: number): boolean {
    if (cz < ctx.params.near) return false;
    const mm = ctx.basis.fpx / cz;
    const side = (ART_REACH.side + pad) * mm;
    return rectOnScreen(ctx, sx - side, sy - (ART_REACH.up + pad) * mm, sx + side, sy + (ART_REACH.down + pad) * mm);
  }
}
