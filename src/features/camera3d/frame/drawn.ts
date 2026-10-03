import type { Mat, Node3 } from '../types';

export interface DrawnEntry { node: Node3; x: number; y: number; sx: number; sy: number; px: number; py: number; mm: number }

/** Billboards drawn this frame: their 2D transform (restored in post) and the 3D map used by picking. */
export class DrawnTable {
  readonly entries: DrawnEntry[] = [];
  len = 0;
  private index: Map<Node3, DrawnEntry> | null = null;

  push(node: Node3, x: number, y: number, sx: number, sy: number, px: number, py: number, mm: number): void {
    const e = this.entries[this.len];
    if (e) { e.node = node; e.x = x; e.y = y; e.sx = sx; e.sy = sy; e.px = px; e.py = py; e.mm = mm; }
    else this.entries.push({ node, x, y, sx, sy, px, py, mm });
    this.len++;
    this.index = null;
  }

  restore(): void {
    for (let i = 0; i < this.len; i++) {
      const e = this.entries[i]!;
      if (e.node.destroyed) continue;
      e.node.scale.set(e.sx, e.sy);
      e.node.position.set(e.x, e.y);
    }
  }

  reset(): void { this.len = 0; this.index = null; }

  entryFor(node: Node3): DrawnEntry | null {
    if (!this.index) {
      this.index = new Map();
      for (let i = 0; i < this.len; i++) this.index.set(this.entries[i]!.node, this.entries[i]!);
    }
    return this.index.get(node) ?? null;
  }
}

interface FullSave { node: Node3; x: number; y: number; sx: number; sy: number; rot: number; kx: number; ky: number; pvx: number; pvy: number }

/** Full transform saves for nodes we lay flat, park or reset (decals, scrim, masks, the Camera). */
export class FullSaves {
  private list: FullSave[] = [];

  save(n: Node3): void {
    this.list.push({ node: n, x: n.x, y: n.y, sx: n.scale.x, sy: n.scale.y, rot: n.rotation, kx: n.skew.x, ky: n.skew.y, pvx: n.pivot.x, pvy: n.pivot.y });
  }

  restoreAll(): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const s = this.list[i]!;
      const n = s.node;
      if (n.destroyed) continue;
      n.pivot.set(s.pvx, s.pvy);
      n.skew.set(s.kx, s.ky);
      n.rotation = s.rot;
      n.scale.set(s.sx, s.sy);
      n.position.set(s.x, s.y);
    }
    this.list = [];
  }

  reset(): void { this.list = []; }
}

/** stage → … → node product of local transforms (node's 2D global transform). */
export function chainMatrix(node: Node3): Mat | null {
  const chain: Node3[] = [];
  for (let n: Node3 | null = node; n; n = n.parent) chain.push(n);
  let m: Mat | null = null;
  for (let i = chain.length - 1; i >= 0; i--) {
    const n = chain[i]!;
    n.updateLocalTransform();
    m = m ? m.append(n.localTransform) : n.localTransform.clone();
  }
  return m;
}

// The 3D render leaves World's render-group transform at the 3D-frame value (identity camera). PIXI's hit test
// inverts that cache between frames, so a 2D tap would miss World's hit area (spike fix 2). Write the 2D value back.
export function sync2d(world: Node3): void {
  const rg = world.renderGroup;
  if (!rg) return;
  const m = chainMatrix(world);
  if (m) rg.worldTransform.copyFrom(m);
}
