import { TILE } from '../constants';
import type { FrameCtx } from '../frame/frame';
import type { Mat, Node3, XY } from '../types';
import type { Placement } from './entities';
import { flatInView, groundAffine, newAffine } from './flat';

// A mark's reach from its position: one tile sprite at any anchor (corner: 1.41 tiles), with slack for a scaled one.
const MARK_REACH = 2 * TILE;

type MatCtor = new (...args: unknown[]) => Mat;

/** The game's AreaTileIndicator (celestial plant auras, ward crystal coverage, held-item previews, ridden-pet ability
 * tiles; live 1381): ≥ 2 sprites on the tile grid around the container origin, each painted through the ground layer. */
export function isAreaGrid(c: Node3, layer: Node3): boolean {
  if (c.children.length < 2 || c.texture) return false;
  for (const s of c.children) {
    if (s.parentRenderLayer !== layer || !s.texture || !s.anchor || s.x % TILE !== 0 || s.y % TILE !== 0) return false;
  }
  return true;
}

/** `mid`: the owner's descendants above the container, top-down. */
interface Area { c: Node3; owner: Node3; mid: Node3[]; laid: number; hidden: boolean }

/** Tilted, takes a node's quad (w2: its parent's 2D world matrix) to draw it in perspective in band z (default: the area
 * marks' band) (areaMesh.ts); false: the node keeps the sprite path. */
export interface AreaTileSink { add(ctx: FrameCtx, s: Node3, w2: Mat, alpha: number, z?: number): boolean }

export interface AreaMarks {
  /** `n` is attached to the ground layer: true when it belongs to an area grid (it then stays on the layer). */
  claim(n: Node3, layer: Node3, world: Node3): boolean;
  /** The owner was drawn as a billboard: lay its area tiles flat on their own tiles. */
  lay(ctx: FrameCtx, owner: Node3, lp: Placement): void;
  /** After the World pass: hide the marks of owners that were not drawn, forget destroyed containers. */
  finish(ctx: FrameCtx): void;
  isMark(n: Node3): boolean;
  count(): number;
  drop(): void;
  stats(): Record<string, number>;
}

// The entity whose billboard carries the grid: the World child on its path, or the child of a World (0,0) group. Null
// for a World-level grid (the marker path lays those flat already).
function ownerOf(c: Node3, world: Node3): { owner: Node3; mid: Node3[] } | null {
  const path: Node3[] = [];
  for (let n = c.parent; n && n !== world; n = n.parent) path.push(n);
  let i = path.length - 1;
  const top = path[i];
  if (!top || top.parent !== world) return null;
  if (top.x === 0 && top.y === 0 && !top.texture) i--;
  if (i < 0) return null;
  return { owner: path[i]!, mid: path.slice(0, i).reverse() };
}

const under = (c: Node3, owner: Node3): boolean => {
  for (let n = c.parent, d = 0; n && d < 16; n = n.parent, d++) if (n === owner) return true;
  return false;
};

export function createAreaMarks(sink: AreaTileSink | null = null): AreaMarks {
  const areas = new Map<Node3, Area>();
  const byOwner = new Map<Node3, Area[]>();
  let marks = new WeakSet<Node3>();
  // Tiles the sink draws: their sprite is pinned hidden while they stay there (set once, never flipped per frame).
  let meshed = new WeakSet<Node3>();
  let shown = 0, shownFrame = -1;
  const pt: XY = { x: 0, y: 0 };
  const aff = newAffine();

  const forget = (ctx: FrameCtx | null, a: Area): void => {
    areas.delete(a.c);
    const list = byOwner.get(a.owner);
    if (list) { list.splice(list.indexOf(a), 1); if (list.length === 0) byOwner.delete(a.owner); }
    for (const s of a.c.children) {
      marks.delete(s);
      if ((a.hidden || meshed.has(s)) && ctx) ctx.ov.drop('visible', s);
      meshed.delete(s);
    }
  };

  let w2: Mat | null = null, inv: Mat | null = null, m: Mat | null = null;

  // Screen = A · W2 · L(s): W2 is the grid's 2D world matrix, A the ground affine at each tile's own centre. The grid
  // container is counter-transformed so the owner's billboard does not move it (World is the identity in 3D).
  // Matrices are reused: during Dawn every binder grid shows (live 2026-10-03: 264 tiles, +0.35–0.8 ms a frame).
  function layArea(ctx: FrameCtx, a: Area, lp: Placement): void {
    // The affine below is exact only straight down: tilted, a tile close to the camera spans a depth range no affine
    // can draw (first person, user report 2026-10-03), so the sink draws it in perspective.
    const toSink = sink !== null && !ctx.exactKeys;
    if (a.hidden) {
      // Back in view: tiles the sink takes stay pinned hidden instead of flipping visible and back this frame.
      for (const s of a.c.children) { if (toSink) meshed.add(s); else { ctx.ov.drop('visible', s); meshed.delete(s); } }
      a.hidden = false;
    }
    a.laid = ctx.frameNo;
    if (!a.c.children.some((s) => ctx.ov.gameValue<boolean>('visible', s))) return;
    const M = ctx.caps.classes.Matrix as unknown as MatCtor;
    const W2 = (w2 ??= new M()), I = (inv ??= new M()), S = (m ??= new M());
    const o = a.owner;
    W2.set(o.scale.x / lp.mm, 0, 0, o.scale.y / lp.mm, lp.x2d, lp.fy2d);
    I.set(o.scale.x, 0, 0, o.scale.y, o.x, o.y);
    for (const n of a.mid) { n.updateLocalTransform(); W2.append(n.localTransform); I.append(n.localTransform); }
    a.c.updateLocalTransform();
    W2.append(a.c.localTransform);
    // Sprites draw with their ancestors' alpha (a faded owner fades its marks): the sink gets the same product.
    let alpha = 1;
    if (toSink) for (let n: Node3 | null = a.c; n && n !== ctx.caps.scene.world; n = n.parent) alpha *= ctx.ov.raw<number>('alpha', n);
    let counter = false;
    for (const s of a.c.children) {
      if (!ctx.ov.gameValue<boolean>('visible', s)) continue;
      if (toSink && sink.add(ctx, s, W2, alpha * ctx.ov.raw<number>('alpha', s))) {
        if (!meshed.has(s) || !ctx.ov.has('visible', s)) { meshed.add(s); ctx.ov.put('visible', s, false, true); }
        continue;
      }
      if (meshed.has(s)) { meshed.delete(s); ctx.ov.drop('visible', s); }
      if (!counter) { counter = true; ctx.saves.save(a.c); a.c.setFromMatrix(I.invert()); }
      ctx.saves.save(s);
      const g = W2.apply(s.position, pt);
      const A = groundAffine(ctx, g.x, g.y, aff);
      // Off screen this frame (placeFlat's test), or outside the depth range: parked.
      if (!A || !flatInView(ctx, A, MARK_REACH)) { s.scale.set(0, 0); continue; }
      s.updateLocalTransform();
      s.setFromMatrix(S.set(A.a, A.b, A.c, A.d, A.tx, A.ty).append(W2).append(s.localTransform));
      if (shownFrame !== ctx.frameNo) { shownFrame = ctx.frameNo; shown = 0; }
      shown++;
    }
  }

  return {
    claim(n, layer, world) {
      if (marks.has(n)) return true;
      const c = n.parent;
      if (!c || areas.has(c) || !isAreaGrid(c, layer)) return false;
      const own = ownerOf(c, world);
      if (!own) return false;
      const a: Area = { c, owner: own.owner, mid: own.mid, laid: -1, hidden: false };
      areas.set(c, a);
      const list = byOwner.get(a.owner);
      if (list) list.push(a); else byOwner.set(a.owner, [a]);
      for (const s of c.children) marks.add(s);
      return true;
    },
    lay(ctx, owner, lp) {
      const list = byOwner.get(owner);
      if (!list || !(lp.mm > 0)) return;
      for (const a of list) if (!a.c.destroyed) layArea(ctx, a, lp);
    },
    finish(ctx) {
      if (shownFrame !== ctx.frameNo) shown = 0;
      for (const a of [...areas.values()]) {
        if (a.c.destroyed || !under(a.c, a.owner)) { forget(ctx, a); continue; }
        if (a.laid === ctx.frameNo || a.hidden) continue;
        // A layer paints its nodes whatever their ancestors' visibility, at their last transform: pinned, so a game
        // write (standing on the plant, the binder's weather) cannot show a tile that was not laid this frame.
        for (const s of a.c.children) ctx.ov.put('visible', s, false, true);
        a.hidden = true;
      }
    },
    isMark: (n) => marks.has(n),
    count: () => areas.size,
    drop() { areas.clear(); byOwner.clear(); marks = new WeakSet(); meshed = new WeakSet(); shown = 0; shownFrame = -1; },
    stats: () => ({ areas: areas.size, areaTiles: shown }),
  };
}
