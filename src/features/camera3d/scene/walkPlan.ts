import type { Node3 } from '../types';

export const PLAN_OTHER = 0;
/** A QPM node (EntityDeps.skip, which only grows): never visited. */
export const PLAN_CARD = 1;
/** Replayed or recorded as a still tile last frame (scene/stillTiles.ts), with its record. */
export const PLAN_TILE = 2;

/** World's children as the entity pass last walked them, by index (perf Task 13). A child is classified again only when
 * another node sat at its index, so a card costs an array compare instead of a lookup, and a still tile skips the
 * per-node reads of visit (property loads on game nodes are megamorphic: live v1459, 0.4 µs per `x` read at CPU 4×). */
export class WalkPlan<R> {
  private nodes: Array<Node3 | null> = [];
  private kinds = new Uint8Array(1024);
  private recs: Array<R | null> = [];
  private len = 0;

  /** The kind of child i when node n sat there last walk, else -1. */
  kindAt(i: number, n: Node3): number { return i < this.len && this.nodes[i] === n ? this.kinds[i]! : -1; }

  rec(i: number): R | null { return i < this.len ? this.recs[i] ?? null : null; }

  set(i: number, n: Node3, kind: number, rec: R | null): void {
    if (i >= this.kinds.length) {
      const k = new Uint8Array(Math.max(i + 1, this.kinds.length * 2));
      k.set(this.kinds);
      this.kinds = k;
    }
    while (this.nodes.length <= i) { this.nodes.push(null); this.recs.push(null); }
    this.nodes[i] = n; this.kinds[i] = kind; this.recs[i] = rec;
    if (i >= this.len) this.len = i + 1;
  }

  /** After a walk of n children: entries past them let go of their nodes. */
  end(n: number): void {
    for (let i = n; i < this.len; i++) { this.nodes[i] = null; this.recs[i] = null; }
    if (n < this.len) this.len = n;
  }

  reset(): void { this.end(0); }

  size(): number { return this.len; }
}
