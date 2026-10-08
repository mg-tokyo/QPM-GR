import { cullSlot, type FrameCtx } from '../frame/frame';
import type { Node3 } from '../types';
import type { Placement } from './entities';

/** A tile view's last full placement on a still camera, with what it was placed from (perf Task 4). x..mm: its drawn
 * entry; stand: the stand-row scan (lift.ts scanOf); slot: its rolling re-check slot. */
export interface TileRec {
  frame: number; slot: number; label: unknown; gz: number; tex: unknown; ax: number; stand: unknown;
  x: number; y: number; sx: number; sy: number; px: number; py: number; mm: number;
  key: number; standY: number; groundY: number; lp: Placement;
}

export class StillTiles {
  private recs = new WeakMap<Node3, TileRec>();

  get(n: Node3): TileRec | undefined { return this.recs.get(n); }

  /** After a full placement on a still camera; `drawnAt`: its entry in this frame's drawn table. Only a held tile view
   * (persist.ts) is recorded: the replay keeps it held instead of placing it. */
  note(ctx: FrameCtx, n: Node3, drawnAt: number, gz: number, stand: unknown, standY: number, groundY: number, key: number, lp: Placement): void {
    const d = drawnAt < ctx.drawn.len ? ctx.drawn.entries[drawnAt] : undefined;
    if (!d || d.node !== n || !d.held) return;
    let r = this.recs.get(n);
    if (!r) {
      r = { frame: 0, slot: 0, label: null, gz: 0, tex: null, ax: 0, stand: null, x: 0, y: 0, sx: 0, sy: 0, px: 0, py: 0, mm: 0, key: 0, standY: 0, groundY: 0,
        lp: { sx: 0, sy: 0, px: 0, mm: 1, fx: 0, x2d: 0, fy2d: 0, key: 0, gdy: 0 } };
      this.recs.set(n, r);
    }
    const tex = n.texture ?? null;
    r.frame = ctx.frameNo; r.slot = cullSlot(d.x, d.y); r.label = n.label; r.gz = gz; r.tex = tex; r.ax = tex && n.anchor ? n.anchor.x : 0; r.stand = stand;
    r.x = d.x; r.y = d.y; r.sx = d.sx; r.sy = d.sy; r.px = d.px; r.py = d.py; r.mm = d.mm;
    r.key = key; r.standY = standY; r.groundY = groundY;
    const o = r.lp;
    o.sx = lp.sx; o.sy = lp.sy; o.px = lp.px; o.mm = lp.mm; o.fx = lp.fx; o.x2d = lp.x2d; o.fy2d = lp.fy2d; o.key = lp.key; o.gdy = lp.gdy;
  }

  drop(): void { this.recs = new WeakMap(); }
}
