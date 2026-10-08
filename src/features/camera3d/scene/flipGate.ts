import type { FrameCtx } from '../frame/frame';
import type { Node3 } from '../types';

/** A parked card unused this many frames is hidden on the next frame that rebuilds World anyway, or on the sweep frame. */
export const IDLE_FRAMES = 120;
// Screen px a card's art may stop short of the edge and still count as on screen.
const EDGE_PAD = 2;

/** One frame in IDLE_FRAMES, the same for every pass: their forced hides share one rebuild. */
const sweepFrame = (ctx: FrameCtx): boolean => ctx.frameNo % IDLE_FRAMES === 0;

/** The screen rect (x0, y0)–(x1, y1) overlaps the screen. */
export const rectOnScreen = (ctx: FrameCtx, x0: number, y0: number, x1: number, y1: number): boolean =>
  x1 >= -EDGE_PAD && x0 <= ctx.W + EDGE_PAD && y1 >= -EDGE_PAD && y0 <= ctx.H + EDGE_PAD;

/** Visibility flips of QPM's own World cards (decor.ts, fences.ts). A flip rebuilds World's instructions (live
 * 2026-10-06: ≈3.8 ms at 1×, ≈16.6 ms at CPU 4×), so a culled card is parked at scale 0 and keeps `visible`, and a
 * hidden card wanted again waits while its art is off screen. Real flips ride frames that rebuild anyway. */
export class FlipGate {
  /** Frames this pass made World rebuild that would not have otherwise. */
  forced = 0;
  private flipped = false;
  private rebuilding = false;

  constructor(readonly world: Node3) {}

  begin(ctx: FrameCtx): void { this.flipped = false; this.rebuilding = this.structural(ctx); }
  end(): void { if (this.flipped && !this.rebuilding) this.forced++; }

  /** World rebuilds its instructions this frame whatever this pass does. */
  structural(ctx: FrameCtx): boolean { return this.flipped || ctx.reCull || this.world.renderGroup?.structureDidChange === true; }
  /** urgent: the card's art is on screen, so it cannot wait. */
  canShow(ctx: FrameCtx, urgent: boolean): boolean { return urgent || this.structural(ctx); }
  /** age: frames since the card last drew. */
  canHide(ctx: FrameCtx, age: number): boolean { return age >= IDLE_FRAMES && (this.structural(ctx) || sweepFrame(ctx)); }

  set(n: Node3, v: boolean): void { if (n.visible !== v) { n.visible = v; this.flipped = true; } }
  /** A child added to or removed from World this frame. */
  noteFlip(): void { this.flipped = true; }
}
