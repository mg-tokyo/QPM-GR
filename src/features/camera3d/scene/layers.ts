import { AREA_MARK_Z, MARKER_Z } from '../math/depth';
import type { FrameCtx } from '../frame/frame';
import type { Node3 } from '../types';
import { createAreaMarks, type AreaTileSink } from './areaMarks';
import type { LayerHandler } from './entities';
import { createFlatPlacer } from './flat';

// RenderLayers draw their attached nodes at the layer's own slot even when hidden, so one depth key per billboard
// cannot interleave them. Ground layers (AboveGround, zIndex 0) are detached while 3D is live. Overlay layers
// (WorldOverlay, zIndex 1e12: the journal polaroid, pet thought bubbles) stay on top only straight down (s = 0 is 2D);
// tilted they are detached too, so a polaroid behind a building is hidden by it (user report 2026-10-03).
const OVERLAY_LAYER_Z = 1e9;
const LAYER_FIRST_Z = -1e9;

type Detach = (...n: Node3[]) => void;
interface Guard { orig: Detach; wrap: Detach; own: boolean }

export function createLayerHandler(areaSink: AreaTileSink | null = null): LayerHandler {
  const held = new Map<Node3, Set<Node3>>();
  const overlayHeld = new Map<Node3, Set<Node3>>();
  const guards = new Map<Node3, Guard>();
  let layerNodes = new WeakSet<Node3>();
  let overlayNodes = new WeakSet<Node3>();
  let layers: Node3[] | null = null;
  const areas = createAreaMarks(areaSink);
  const flat = createFlatPlacer(areaSink);
  const drawsSelf = (n: Node3): boolean => !!(n.texture || n.geometry || n.context);
  const isLayerOnly = (n: Node3): boolean => layerNodes.has(n) || (!drawsSelf(n) && n.children.every(isLayerOnly));

  // While 3D holds a layer's nodes, the game's own detach of one of them must stick: exit re-attaches only the rest.
  function guard(L: Node3): void {
    const orig = L.detach;
    if (guards.has(L) || !orig) return;
    const wrap: Detach = function (this: unknown, ...n: Node3[]): void {
      for (const x of n) { held.get(L)?.delete(x); overlayHeld.get(L)?.delete(x); }
      orig.apply(this, n);
    };
    guards.set(L, { orig, wrap, own: Object.prototype.hasOwnProperty.call(L, 'detach') });
    L.detach = wrap;
  }
  function unguard(L: Node3): void {
    const g = guards.get(L);
    if (!g) return;
    guards.delete(L);
    if (L.detach !== g.wrap) return;
    if (g.own) L.detach = g.orig;
    else delete (L as { detach?: Detach }).detach;
  }

  function reattach(from: Map<Node3, Set<Node3>>, L: Node3): void {
    const set = from.get(L);
    if (!set) return;
    from.delete(L);
    if (!held.has(L) && !overlayHeld.has(L)) unguard(L);
    const live = [...set].filter((nd) => !nd.destroyed && nd.parent && !nd.parentRenderLayer);
    if (live.length && !L.destroyed) L.attach?.(...live);
  }

  const detach = (into: Map<Node3, Set<Node3>>, L: Node3, kids: readonly Node3[]): Node3[] => {
    const copy = kids.slice();
    L.detach?.(...copy);
    let set = into.get(L);
    if (!set) { set = new Set(); into.set(L, set); }
    for (const nd of copy) set.add(nd);
    guard(L);
    return copy;
  };

  function adoptOverlay(ctx: FrameCtx, L: Node3): void {
    if (ctx.exactKeys) { reattach(overlayHeld, L); return; }
    const kids = L.renderLayerChildren;
    if (!kids || kids.length === 0) return;
    for (const nd of detach(overlayHeld, L, kids)) overlayNodes.add(nd);
  }

  return {
    adopt(ctx) {
      const world = ctx.caps.scene.world;
      // Finding the layers reads a property most World children lack (~3.7k children while live, 0.25 ms a frame):
      // only on full re-culls and rolling-pass starts, or when a known layer left World. New attachments to known layers
      // are caught each frame.
      if (!layers || ctx.reCull || ctx.roll === 0 || layers.some((L) => L.parent !== world)) layers = world.children.filter((c) => !!c.renderLayerChildren);
      for (const L of layers) {
        if (ctx.ov.gameValue<number>('zIndex', L) >= OVERLAY_LAYER_Z) { adoptOverlay(ctx, L); continue; }
        const kids = L.renderLayerChildren;
        let rest: Node3[] | null = null;
        let kept = 0;
        if (kids) for (const nd of kids) { if (areas.claim(nd, L, world)) kept++; else (rest ??= []).push(nd); }
        // Tile-radius area marks stay on the layer, laid flat on their tiles (areaMarks.ts): it paints them as ground
        // marks before every card, as in 2D.
        if (kept > 0) ctx.ov.put('zIndex', L, AREA_MARK_Z);
        else ctx.ov.drop('zIndex', L);
        if (!rest) continue;
        const copy = detach(held, L, rest);
        for (const nd of copy) layerNodes.add(nd);
        for (const nd of copy) {
          if (nd.parent === world) continue;
          const p = nd.parent;
          if (p && p.parent === world && p.x === 0 && p.y === 0) continue;
          // In 2D the layer draws before every World entity: keep its content under the rest of its own tile.
          let a = nd;
          while (a.parent && a.parent.parent && a.parent.parent !== world && a.parent.children.every(isLayerOnly)) a = a.parent;
          ctx.ov.put('zIndex', a, LAYER_FIRST_Z);
        }
      }
    },
    isLayerNode: (n) => layerNodes.has(n) || areas.isMark(n),
    isAreaMark: (n) => areas.isMark(n),
    layAreas: (ctx, owner, lp) => { areas.lay(ctx, owner, lp); },
    finishAreas: (ctx) => { areas.finish(ctx); },
    // A node we detached from its layer is not detached again by its own destroy, so the guard never sees it go.
    prune() {
      for (const m of [held, overlayHeld]) for (const set of m.values()) for (const nd of set) if (nd.destroyed === true) set.delete(nd);
    },
    stats: () => areas.stats(),
    isOverlayNode: (n) => overlayNodes.has(n) || (!!n.parent && overlayNodes.has(n.parent)),
    placeMarker(ctx, n) {
      const y = n.y; // placeFlat moves the node: key on its 2D ground y
      // No screen cull: a marker's art can reach far from its position (a tap route), and there are few (live
      // 2026-10-07: 3 on the ground layer).
      if (flat.place(ctx, n, n.x, y, MARKER_Z, Infinity)) ctx.ov.put('zIndex', n, MARKER_Z + y);
    },
    drop() {
      for (const L of [...held.keys()]) reattach(held, L);
      for (const L of [...overlayHeld.keys()]) reattach(overlayHeld, L);
      layerNodes = new WeakSet();
      overlayNodes = new WeakSet();
      layers = null;
      areas.drop();
      flat.drop();
    },
  };
}
