import type { Mat, Node3 } from '../types';

/** 2D World (x, y) draws at screen (px, py); a 2D offset d from it draws at d × mm. */
export interface ScreenMap { x: number; y: number; px: number; py: number; mm: number }
/** held: the persist table keeps its 2D between frames (persist.ts), so restore() leaves it alone. */
export interface DrawnEntry extends ScreenMap { node: Node3; sx: number; sy: number; held: boolean }
/** A lifted produce unit (lift.ts): drawn on its own ground point, not through its owner's card map. */
export interface LiftEntry extends ScreenMap { node: Node3; owner: Node3 }

// A pooled entry past `len` is never read; this only lets go of the node it pointed at.
const RELEASED = null as unknown as Node3;

/** Billboards drawn this frame: their 2D transform (restored in post) and the 3D map used by picking. */
export class DrawnTable {
  readonly entries: DrawnEntry[] = [];
  len = 0;
  // Lookup tables built on first use after a change (picking), kept and refilled rather than reallocated.
  private readonly index = new Map<Node3, DrawnEntry>();
  private indexed = false;
  private readonly lifts: LiftEntry[] = [];
  private liftLen = 0;
  private readonly liftIndex = new Map<Node3, LiftEntry>();
  private readonly owners = new Set<Node3>();
  private liftsIndexed = false;
  // Entries [0, held) may still point at a node; trim() releases the ones past this frame's end.
  private held = 0;
  private liftHeld = 0;

  push(node: Node3, x: number, y: number, sx: number, sy: number, px: number, py: number, mm: number, held = false): void {
    const e = this.entries[this.len];
    if (e) { e.node = node; e.x = x; e.y = y; e.sx = sx; e.sy = sy; e.px = px; e.py = py; e.mm = mm; e.held = held; }
    else this.entries.push({ node, x, y, sx, sy, px, py, mm, held });
    this.len++;
    this.indexed = false;
  }

  pushLift(owner: Node3, node: Node3, x: number, y: number, px: number, py: number, mm: number): void {
    const e = this.lifts[this.liftLen];
    if (e) { e.owner = owner; e.node = node; e.x = x; e.y = y; e.px = px; e.py = py; e.mm = mm; }
    else this.lifts.push({ owner, node, x, y, px, py, mm });
    this.liftLen++;
    this.liftsIndexed = false;
  }

  private indexLifts(): void {
    if (this.liftsIndexed) return;
    this.liftsIndexed = true;
    this.liftIndex.clear();
    this.owners.clear();
    for (let i = 0; i < this.liftLen; i++) { const l = this.lifts[i]!; this.liftIndex.set(l.node, l); this.owners.add(l.owner); }
  }

  liftFor(node: Node3): LiftEntry | null {
    if (this.liftLen === 0) return null;
    this.indexLifts();
    return this.liftIndex.get(node) ?? null;
  }

  hasLifts(owner: Node3): boolean {
    if (this.liftLen === 0) return false;
    this.indexLifts();
    return this.owners.has(owner);
  }

  restore(): void {
    for (let i = 0; i < this.len; i++) {
      const e = this.entries[i]!;
      if (e.held || e.node.destroyed) continue;
      e.node.scale.set(e.sx, e.sy);
      e.node.position.set(e.x, e.y);
    }
  }

  // The lookup tables keep last frame's nodes until rebuilt: cleared here so a despawned node is not held (A R4).
  reset(): void {
    this.len = 0; this.liftLen = 0; this.indexed = false; this.liftsIndexed = false;
    if (this.index.size) this.index.clear();
    if (this.liftIndex.size) { this.liftIndex.clear(); this.owners.clear(); }
  }

  /** After the frame is filled: pooled entries past its end let go of older frames' nodes (live 2026-10-05: they kept
   * destroyed sprites, and through them a stopped runtime, reachable). */
  trim(): void {
    for (let i = this.len; i < this.held; i++) this.entries[i]!.node = RELEASED;
    for (let i = this.liftLen; i < this.liftHeld; i++) { const l = this.lifts[i]!; l.node = RELEASED; l.owner = RELEASED; }
    this.held = this.len;
    this.liftHeld = this.liftLen;
  }

  /** Debug only: a copy of this frame's lifted units. */
  liftList(): LiftEntry[] { return this.lifts.slice(0, this.liftLen); }

  entryFor(node: Node3): DrawnEntry | null {
    if (!this.indexed) {
      this.indexed = true;
      this.index.clear();
      for (let i = 0; i < this.len; i++) this.index.set(this.entries[i]!.node, this.entries[i]!);
    }
    return this.index.get(node) ?? null;
  }
}

interface FullSave { node: Node3 | null; x: number; y: number; sx: number; sy: number; rot: number; kx: number; ky: number; pvx: number; pvy: number }

/** Full transform saves for nodes we lay flat, park or reset (decals, scrim, masks, the Camera). Records are reused
 * across frames (A PF4: one object per saved node per frame before). */
export class FullSaves {
  private readonly list: FullSave[] = [];
  private n = 0;

  save(nd: Node3): void {
    const s = this.list[this.n];
    if (s) {
      s.node = nd; s.x = nd.x; s.y = nd.y; s.sx = nd.scale.x; s.sy = nd.scale.y; s.rot = nd.rotation;
      s.kx = nd.skew.x; s.ky = nd.skew.y; s.pvx = nd.pivot.x; s.pvy = nd.pivot.y;
    } else {
      this.list.push({ node: nd, x: nd.x, y: nd.y, sx: nd.scale.x, sy: nd.scale.y, rot: nd.rotation, kx: nd.skew.x, ky: nd.skew.y, pvx: nd.pivot.x, pvy: nd.pivot.y });
    }
    this.n++;
  }

  restoreAll(): void {
    for (let i = this.n - 1; i >= 0; i--) {
      const s = this.list[i]!;
      const nd = s.node!;
      s.node = null;
      if (nd.destroyed) continue;
      nd.pivot.set(s.pvx, s.pvy);
      nd.skew.set(s.kx, s.ky);
      nd.rotation = s.rot;
      nd.scale.set(s.sx, s.sy);
      nd.position.set(s.x, s.y);
    }
    this.n = 0;
  }

  reset(): void {
    for (let i = 0; i < this.n; i++) this.list[i]!.node = null;
    this.n = 0;
  }
}

/** stage → … → node product of local transforms (node's 2D global transform), into `out` when given. */
export function chainMatrix(node: Node3, out?: Mat): Mat | null {
  node.updateLocalTransform();
  const m = out ? out.copyFrom(node.localTransform) : node.localTransform.clone();
  for (let p = node.parent; p; p = p.parent) { p.updateLocalTransform(); m.prepend(p.localTransform); }
  return m;
}

// The 3D render leaves World's render-group transform at the 3D-frame value (identity camera). PIXI's hit test
// inverts that cache between frames, so a 2D tap would miss World's hit area (spike fix 2). Write the 2D value back.
export function sync2d(world: Node3): void {
  const rg = world.renderGroup;
  if (rg) chainMatrix(world, rg.worldTransform);
}
