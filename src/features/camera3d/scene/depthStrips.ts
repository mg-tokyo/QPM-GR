import { SORT_Z_SCALE } from '../math/depth';
import type { Pass } from '../frame/frame';
import type { DepthStripsLike, Node3 } from '../types';

type Update = DepthStripsLike['update'];

// Game 1634 files tiles, garden edges, desks and the tram into one render group per depth row ("World depth strip"),
// and a group sorts as one unit: tilted, rows could not interleave with each other or with avatars and pets. While 3D
// is live they are World children again, the layout every pass here was built for. The manager re-files a node on each
// of its draws (Tile.draw → updateZIndex, every frame), so that re-filing is bypassed for them until exit files them back.
export interface DepthStripPass extends Pass {
  /** A World child shaped like a depth strip exists, but no manager was found (QPM-CAM3D-012). */
  unmanaged(): boolean;
}

/** A World group whose own zIndex is a depth key and that holds entities: a depth strip, managed or not. */
const isStripShaped = (n: Node3): boolean => n.x === 0 && n.y === 0 && !n.texture && n.zIndex >= SORT_Z_SCALE && n.children.length > 0;

export function createDepthStrips(mgr: DepthStripsLike | null, world: Node3): DepthStripPass {
  const usable = mgr !== null && mgr.world === world;
  const home = new Map<Node3, Node3>();
  let orig: Update | null = null, wrap: Update | null = null, own = false;
  let live = false;
  let homed = 0;
  // Stand-in for the manager's key → strip map during a bypassed update: every depth row is World.
  const toWorld = { get: (): Node3 => world } as unknown as Map<unknown, Node3>;

  function hook(m: DepthStripsLike): void {
    if (wrap) return;
    const o = m.update;
    own = Object.prototype.hasOwnProperty.call(m, 'update');
    const w: Update = function (this: DepthStripsLike, node, depth) {
      if (!live || node.parent !== world) { o.call(this, node, depth); return; }
      const saved = this.strips;
      this.strips = toWorld;
      try { o.call(this, node, depth); } finally { this.strips = saved; }
    };
    orig = o; wrap = w;
    m.update = w;
  }

  function unhook(m: DepthStripsLike): void {
    if (!wrap) return;
    if (m.update === wrap) {
      if (own) m.update = orig!;
      else delete (m as { update?: Update }).update;
    }
    wrap = null; orig = null;
  }

  function rehome(): void {
    for (const [n, strip] of home) {
      if (n.destroyed || strip.destroyed || n.parent !== world) continue;
      strip.addChild(n);
      homed++;
    }
    home.clear();
  }

  function leave(): void {
    live = false;
    rehome();
    if (mgr) unhook(mgr);
  }

  return {
    name: 'depthStrips',
    pre(ctx) {
      if (!usable || !mgr) return;
      hook(mgr);
      live = true;
      if (ctx.reCull || ctx.roll === 0) for (const n of home.keys()) if (n.destroyed) home.delete(n);
      // Once at entry, then only nodes the game created since (a new tile, a garden edge).
      for (const strip of mgr.strips.values()) {
        if (strip.children.length === 0) continue;
        for (const c of strip.children.slice()) { home.set(c, strip); world.addChild(c); }
      }
    },
    drop: leave,
    destroy: leave,
    unmanaged: () => !usable && world.children.some(isStripShaped),
    stats: () => ({ usable, flattened: home.size, homed }),
  };
}
