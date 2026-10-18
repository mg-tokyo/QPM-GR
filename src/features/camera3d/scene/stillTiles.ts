import { cullSlot, type FrameCtx } from '../frame/frame';
import type { OvRef } from '../frame/overrides';
import type { PersistRef } from '../frame/persist';
import type { Node3 } from '../types';
import type { Placement } from './entities';

/** A tile view's last full placement on a still camera, with what it was placed from (perf Task 4). x..mm: its drawn
 * entry; stand: the stand-row token (lift.ts standToken); slot: its rolling re-check slot. Handles (perf Task 13, null
 * when not taken): prec its persist record, zr its zIndex override; vt its view tick (NaN: compare tex and ax). */
export interface TileRec {
  frame: number; slot: number; label: unknown; gz: number; tex: unknown; ax: number; stand: unknown;
  x: number; y: number; sx: number; sy: number; px: number; py: number; mm: number;
  key: number; standY: number; groundY: number; lp: Placement;
  prec: PersistRef | null; zr: OvRef | null; vt: number;
}

export class StillTiles {
  private recs = new WeakMap<Node3, TileRec>();

  get(n: Node3): TileRec | undefined { return this.recs.get(n); }

  /** After a full placement on a still camera; `drawnAt`: its entry in this frame's drawn table. Only a held tile view
   * (persist.ts) is recorded: the replay keeps it held instead of placing it. refs: take the handles. Returns the record. */
  note(ctx: FrameCtx, n: Node3, drawnAt: number, gz: number, stand: unknown, standY: number, groundY: number, key: number, lp: Placement, refs = false): TileRec | null {
    const d = drawnAt < ctx.drawn.len ? ctx.drawn.entries[drawnAt] : undefined;
    if (!d || d.node !== n || !d.held) return null;
    let r = this.recs.get(n);
    if (!r) {
      r = { frame: 0, slot: 0, label: null, gz: 0, tex: null, ax: 0, stand: null, x: 0, y: 0, sx: 0, sy: 0, px: 0, py: 0, mm: 0, key: 0, standY: 0, groundY: 0,
        lp: { sx: 0, sy: 0, px: 0, mm: 1, fx: 0, x2d: 0, fy2d: 0, key: 0, gdy: 0 }, prec: null, zr: null, vt: NaN };
      this.recs.set(n, r);
    }
    const tex = n.texture ?? null;
    r.frame = ctx.frameNo; r.slot = cullSlot(d.x, d.y); r.label = n.label; r.gz = gz; r.tex = tex; r.ax = tex && n.anchor ? n.anchor.x : 0; r.stand = stand;
    r.x = d.x; r.y = d.y; r.sx = d.sx; r.sy = d.sy; r.px = d.px; r.py = d.py; r.mm = d.mm;
    r.key = key; r.standY = standY; r.groundY = groundY;
    const o = r.lp;
    o.sx = lp.sx; o.sy = lp.sy; o.px = lp.px; o.mm = lp.mm; o.fx = lp.fx; o.x2d = lp.x2d; o.fy2d = lp.fy2d; o.key = lp.key; o.gdy = lp.gdy;
    if (refs) takeRefs(ctx, n, r);
    else { r.prec = null; r.zr = null; r.vt = NaN; }
    return r;
  }

  drop(): void { this.recs = new WeakMap(); }
}

/** The record's handles, taken on a frame that validated it without them (a full placement or a lookup replay). */
export function takeRefs(ctx: FrameCtx, n: Node3, r: TileRec): void {
  const vt = (n as { _didViewChangeTick?: unknown })._didViewChangeTick;
  r.prec = ctx.persist.ref(n); r.zr = ctx.ov.ref('zIndex', n); r.vt = typeof vt === 'number' ? vt : NaN;
}
