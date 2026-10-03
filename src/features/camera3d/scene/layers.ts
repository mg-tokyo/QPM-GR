import { AREA_MARK_Z, MARKER_Z } from '../math/depth';
import type { FrameCtx } from '../frame/frame';
import type { Node3 } from '../types';
import { createAreaMarks, type AreaTileSink } from './areaMarks';
import type { LayerHandler } from './entities';
import { placeFlat } from './flat';

// RenderLayers draw their attached nodes at the layer's own slot even when hidden, so one depth key per billboard
// cannot interleave them. Ground layers (AboveGround, zIndex 0) are detached while 3D is live. Overlay layers
// (WorldOverlay, zIndex 1e12: the journal polaroid, pet thought bubbles) stay on top only straight down (s = 0 is 2D);
// tilted they are detached too, so a polaroid behind a building is hidden by it (user report 2026-10-03).
const OVERLAY_LAYER_Z = 1e9;
const LAYER_FIRST_Z = -1e9;

function reattach(held: Map<Node3, Node3[]>, L: Node3): void {
  const list = held.get(L);
  if (!list) return;
  held.delete(L);
  const live = list.filter((nd) => !nd.destroyed && nd.parent && !nd.parentRenderLayer);
  if (live.length && !L.destroyed) L.attach?.(...live);
}

export function createLayerHandler(areaSink: AreaTileSink | null = null): LayerHandler {
  const held = new Map<Node3, Node3[]>();
  const overlayHeld = new Map<Node3, Node3[]>();
  let layerNodes = new WeakSet<Node3>();
  let overlayNodes = new WeakSet<Node3>();
  let layers: Node3[] | null = null;
  const areas = createAreaMarks(areaSink);
  const drawsSelf = (n: Node3): boolean => !!(n.texture || n.geometry || n.context);
  const isLayerOnly = (n: Node3): boolean => layerNodes.has(n) || (!drawsSelf(n) && n.children.every(isLayerOnly));

  const detach = (into: Map<Node3, Node3[]>, L: Node3, kids: readonly Node3[]): Node3[] => {
    const copy = kids.slice();
    L.detach?.(...copy);
    let list = into.get(L);
    if (!list) { list = []; into.set(L, list); }
    list.push(...copy);
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
    stats: () => areas.stats(),
    isOverlayNode: (n) => overlayNodes.has(n) || (!!n.parent && overlayNodes.has(n.parent)),
    placeMarker(ctx, n) {
      const y = n.y; // placeFlat moves the node: key on its 2D ground y
      if (placeFlat(ctx, n, n.x, y)) ctx.ov.put('zIndex', n, MARKER_Z + y);
    },
    drop() {
      for (const L of [...held.keys()]) reattach(held, L);
      for (const L of [...overlayHeld.keys()]) reattach(overlayHeld, L);
      layerNodes = new WeakSet();
      overlayNodes = new WeakSet();
      layers = null;
      areas.drop();
    },
  };
}
