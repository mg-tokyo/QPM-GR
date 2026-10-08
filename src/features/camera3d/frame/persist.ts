import type { Node3 } from '../types';

// Dual state for tile views (perf Task 3, PC1): between frames a held node's position/scale fields hold its 2D base,
// written past the observable points with the change tick bumped, so every local walk (toGlobal, getBounds, the crop
// pick, the occlusion mask) reads 2D. PIXI re-walks a node only after _onUpdate, so its render cache keeps the 3D
// transform, and a still camera dirties nothing. PIXI 8.19 internals, live 2026-10-07 (v1419).
interface ObsPoint { _x: number; _y: number }
interface DualNode { _position: ObsPoint; _scale: ObsPoint; _didContainerChangeTick: number; didChange: boolean; _onUpdate(point?: unknown): void }
type Held = Node3 & DualNode;

/** tick ≥ 0: settled at that change tick (fields hold the base). */
const IN_FRAME = -1;
const FREE = -2;
interface Rec { node: Held; bx: number; by: number; bsx: number; bsy: number; ax: number; ay: number; asx: number; asy: number; tick: number; frame: number }

// Read through calls: the self-test checks values that PIXI methods change behind the compiler's narrowing.
const localTx = (n: Held): number => { n.updateLocalTransform(); return n.localTransform.tx; };
const changed = (n: Held): boolean => n.didChange;

/** The install self-test on a scratch node: false keeps today's set-and-restore (same picture, slower). */
export function dualStateWorks(Container: unknown): boolean {
  if (typeof Container !== 'function') return false;
  let c: Held | null = null;
  try {
    c = new (Container as new () => Held)();
    c.position.set(2, 3);
    c.scale.set(4, 5);
    const p = c._position, s = c._scale;
    if (typeof c._onUpdate !== 'function' || typeof c._didContainerChangeTick !== 'number' || !p || !s) return false;
    if (p._x !== 2 || p._y !== 3 || s._x !== 4 || s._y !== 5) return false;
    if (localTx(c) !== 2 || c.localTransform.a !== 4) return false;
    const tick = c._didContainerChangeTick;
    c.position.set(2, 3);
    if (c._didContainerChangeTick !== tick) return false;
    c.didChange = false;
    p._x = 7;
    c._didContainerChangeTick++;
    if (c.position.x !== 7 || changed(c)) return false;
    if (localTx(c) !== 7) return false;
    c._onUpdate();
    return changed(c);
  } catch {
    return false;
  } finally {
    try { c?.destroy(); } catch { /* scratch node */ }
  }
}

export interface PersistStats { enabled: boolean; held: number; silent: number; gameWrites: number; restores: number }

export class PersistTable {
  private readonly recs = new WeakMap<Node3, Rec>();
  // Applied or kept this frame / settled after the last one; swapped in finish(). Records carry their node, so the
  // per-frame loops never look a node up.
  private cur: Rec[] = [];
  private held: Rec[] = [];
  private frame = 0;
  private on: boolean;
  private silent = 0;
  private gameWrites = 0;
  private restores = 0;

  constructor(private readonly supported: boolean) { this.on = supported; }

  begin(frameNo: number): void { this.frame = frameNo; }

  /** Writes the 3D transform and holds the node: true. False: disabled, nothing written (set and restore it). */
  apply(node: Node3, x: number, y: number, sx: number, sy: number): boolean {
    if (!this.on) return false;
    const nd = node as Held;
    const p = nd._position, s = nd._scale;
    let r = this.recs.get(node);
    if (!r) {
      r = { node: nd, bx: 0, by: 0, bsx: 1, bsy: 1, ax: 0, ay: 0, asx: 1, asy: 1, tick: FREE, frame: -1 };
      this.recs.set(node, r);
    }
    // IN_FRAME (applied again this frame, or a frame that never finished): the fields hold 3D, the record the base.
    if (r.tick !== IN_FRAME) {
      r.bx = p._x; r.by = p._y; r.bsx = s._x; r.bsy = s._y;
      if (r.tick >= 0) {
        // Nothing wrote the node since finish(): its render cache still holds last frame's 3D, so the fields go back
        // to that silently and an unchanged placement below writes nothing.
        if (nd._didContainerChangeTick === r.tick) {
          p._x = r.ax; p._y = r.ay; s._x = r.asx; s._y = r.asy;
          nd._didContainerChangeTick++;
          this.silent++;
        } else this.gameWrites++;
      }
      r.tick = IN_FRAME;
    }
    if (r.frame !== this.frame) { r.frame = this.frame; this.cur.push(r); }
    nd.position.set(x, y);
    nd.scale.set(sx, sy);
    r.ax = x; r.ay = y; r.asx = sx; r.asy = sy;
    return true;
  }

  /** A still frame's apply of the same placement (perf Task 4): held last frame and written by nothing since (the tick
   * covers position, scale, alpha and visible), so its 3D goes back into the fields silently. False: place it. */
  keep(node: Node3): boolean {
    if (!this.on) return false;
    const r = this.recs.get(node);
    if (r === undefined || r.tick < 0) return false;
    const nd = r.node;
    if (nd.destroyed || nd._didContainerChangeTick !== r.tick) return false;
    const p = nd._position, s = nd._scale;
    p._x = r.ax; p._y = r.ay; s._x = r.asx; s._y = r.asy;
    nd._didContainerChangeTick++;
    r.tick = IN_FRAME;
    r.frame = this.frame;
    this.cur.push(r);
    this.silent++;
    return true;
  }

  /** Post, after the render: the base goes back into each applied node's fields; nodes that left are released. */
  finish(): void {
    const cur = this.cur;
    let n = 0;
    for (let i = 0; i < cur.length; i++) {
      const r = cur[i]!;
      if (r.tick !== IN_FRAME) continue;
      const nd = r.node;
      if (nd.destroyed) { r.tick = FREE; continue; }
      const p = nd._position, s = nd._scale;
      p._x = r.bx; p._y = r.by; s._x = r.bsx; s._y = r.bsy;
      r.tick = ++nd._didContainerChangeTick;
      cur[n++] = r;
    }
    cur.length = n;
    for (const r of this.held) if (r.frame !== this.frame) this.releaseRec(r);
    this.held.length = 0;
    this.cur = this.held;
    this.held = cur;
  }

  /** Back to 2D: the base into the fields if the node is mid-frame, and a wake so the next render re-walks it. */
  release(node: Node3): void {
    const r = this.recs.get(node);
    if (r) this.releaseRec(r);
  }

  /** 3D left by any path (frame drop): nothing stays held. Safe mid-frame and when called twice. */
  releaseAll(): void {
    for (const r of this.cur) this.releaseRec(r);
    for (const r of this.held) this.releaseRec(r);
    this.cur.length = 0;
    this.held.length = 0;
  }

  /** The 2D base: during a frame from the record, between frames the fields themselves. Null: not held. */
  base(node: Node3): { x: number; y: number; sx: number; sy: number } | null {
    const r = this.recs.get(node);
    if (!r || r.tick === FREE) return null;
    if (r.tick === IN_FRAME) return { x: r.bx, y: r.by, sx: r.bsx, sy: r.bsy };
    const nd = node as Held;
    return { x: nd._position._x, y: nd._position._y, sx: nd._scale._x, sy: nd._scale._y };
  }

  enabled(): boolean { return this.on; }

  private releaseRec(r: Rec): void {
    if (r.tick === FREE) return;
    const nd = r.node;
    if (!nd.destroyed) {
      if (r.tick === IN_FRAME) { nd.scale.set(r.bsx, r.bsy); nd.position.set(r.bx, r.by); }
      nd._onUpdate();
    }
    r.tick = FREE;
    this.restores++;
  }

  /** Debug lever (same-page A/B): off releases everything first. Stays off when the self-test failed. */
  setEnabled(on: boolean): boolean {
    if (!on) this.releaseAll();
    this.on = on && this.supported;
    return this.on;
  }

  /** silent / gameWrites / restores count since the last read. */
  stats(): PersistStats {
    const st = { enabled: this.on, held: this.held.length, silent: this.silent, gameWrites: this.gameWrites, restores: this.restores };
    this.silent = 0; this.gameWrites = 0; this.restores = 0;
    return st;
  }
}
