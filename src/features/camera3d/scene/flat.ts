import { LEGACY_CULL } from '../constants';
import { project } from '../math/camera';
import { legacyShow, mayShow } from '../frame/cull';
import type { FrameCtx } from '../frame/frame';
import type { Mat, Node3 } from '../types';
import type { AreaTileSink } from './areaMarks';
import type { Placement } from './entities';

const STEP = 64;
type MatCtor = new (...args: unknown[]) => Mat;

/** sx, sy, cz: the fit point projected (screen px, camera depth). */
export interface Affine { a: number; b: number; c: number; d: number; tx: number; ty: number; sx: number; sy: number; cz: number }
export const newAffine = (): Affine => ({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0, sx: 0, sy: 0, cz: 0 });

/** Flat art of radius r (world px) around a ground point fitted by A may be on screen this frame (placed every frame,
 * so no re-check slack; frame/cull.ts). It lies on the ground, not facing the camera: its reach is a sphere's. Ring
 * lever off: the fixed margins of before perf Task 5. */
export function flatInView(ctx: FrameCtx, A: Affine, r: number): boolean {
  const c = ctx.cull;
  return c.ring <= 0 ? legacyShow(c, A.sx, A.sy, A.cz, c.legacy * ctx.H, LEGACY_CULL.below) : mayShow(c, A.sx, A.sy, A.cz, 0, 0, 0, r);
}

/** Affine fit of the ground-plane projection at (cx, cy): screen ≈ P(c) + J·(w − c), into `out`. Null outside the depth
 * range, or when a sample point is past the near plane: it projects through infinity and flips the fit (A V3). */
export function groundAffine(ctx: FrameCtx, cx: number, cy: number, out: Affine = newAffine()): Affine | null {
  const o = ctx.out, near = ctx.params.near;
  project(ctx.basis, cx, 0, cy, o);
  const X = o[0]!, Y = o[1]!, Z = o[2]!;
  if (Z < near || Z > ctx.params.far) return null;
  project(ctx.basis, cx + STEP, 0, cy, o);
  if (o[2]! < near) return null;
  const a = (o[0]! - X) / STEP, b = (o[1]! - Y) / STEP;
  project(ctx.basis, cx, 0, cy + STEP, o);
  if (o[2]! < near) return null;
  const c = (o[0]! - X) / STEP, d = (o[1]! - Y) / STEP;
  out.a = a; out.b = b; out.c = c; out.d = d; out.tx = X - (a * cx + c * cy); out.ty = Y - (b * cx + d * cy); out.sx = X; out.sy = Y; out.cz = Z;
  return out;
}

// Per-frame scratch for the flat placements (A PF4). setFromMatrix copies, so one matrix serves every node.
let flatM: Mat | null = null;
const flatA = newAffine();
const flatMatrix = (ctx: FrameCtx): Mat => {
  const M = ctx.caps.classes.Matrix as unknown as MatCtor;
  return flatM && flatM.constructor === M ? flatM : (flatM = new M());
};

/** Lays a node flat where 2D draws it. Its parent must be World or a building/group container at (0,0). r: its art's
 * reach from (cx, cy) in world px. */
export function placeFlat(ctx: FrameCtx, node: Node3, cx: number, cy: number, r: number): boolean {
  const A = groundAffine(ctx, cx, cy, flatA);
  if (!A || !flatInView(ctx, A, r)) {
    ctx.ov.put('visible', node, false);
    return false;
  }
  ctx.ov.drop('visible', node);
  if (!ctx.ov.raw<boolean>('visible', node)) return false;
  node.updateLocalTransform();
  const m = flatMatrix(ctx).set(A.a, A.b, A.c, A.d, A.tx, A.ty);
  m.append(node.localTransform);
  ctx.saves.save(node);
  node.setFromMatrix(m);
  return true;
}

/** Flat game art (ground markers, building decals). Tilted, a quad goes to the perspective sink in band z: an affine is
 * exact only straight down, and near the lens a rug spans a depth range no affine can draw (A V3). Straight down (s = 0)
 * and for anything the sink declines, the affine (placeFlat). */
export interface FlatPlacer {
  /** True: the node itself was laid flat (its own zIndex applies). False: hidden, or drawn by the sink. r: the art's
   * reach from (cx, cy) in world px. */
  place(ctx: FrameCtx, node: Node3, cx: number, cy: number, z: number, r: number): boolean;
  drop(): void;
}

/** Alpha the node draws with (its own times its ancestors' up to World); 0 when the game hides it or an ancestor. */
function drawnAlpha(ctx: FrameCtx, node: Node3): number {
  let a = 1;
  for (let n: Node3 | null = node; n && n !== ctx.caps.scene.world; n = n.parent) {
    if (!ctx.ov.gameValue<boolean>('visible', n)) return 0;
    a *= ctx.ov.raw<number>('alpha', n);
  }
  return a;
}

export function createFlatPlacer(sink: AreaTileSink | null): FlatPlacer {
  // Nodes the sink draws: pinned hidden while they stay there (set once, never flipped per frame), as areaMarks.ts.
  let meshed = new WeakSet<Node3>();
  let identity: Mat | null = null;

  return {
    place(ctx, node, cx, cy, z, r) {
      if (sink && !ctx.exactKeys) {
        const alpha = drawnAlpha(ctx, node);
        if (alpha <= 0 && meshed.has(node)) return false;
        const p = node.parent;
        let w2: Mat;
        if (!p || p === ctx.caps.scene.world) w2 = identity ??= new (ctx.caps.classes.Matrix as unknown as MatCtor)();
        else { p.updateLocalTransform(); w2 = p.localTransform; }
        if (alpha > 0 && sink.add(ctx, node, w2, alpha, z)) {
          // The override prune may have dropped the pin of a detached node (A R4): the set alone can't say it is still on.
          if (!meshed.has(node) || !ctx.ov.has('visible', node)) { meshed.add(node); ctx.ov.put('visible', node, false, true); }
          return false;
        }
      }
      if (meshed.has(node)) { meshed.delete(node); ctx.ov.drop('visible', node); }
      return placeFlat(ctx, node, cx, cy, r);
    },
    drop() { meshed = new WeakSet(); },
  };
}

/** A World-space mask (the tram tunnel rects) follows its owner's 2D→3D map so the 2D clip holds on the card. */
export function placeMask(ctx: FrameCtx, owner: Node3, lp: Placement): void {
  const m = owner.mask as Node3 | null | undefined;
  if (!m || typeof m !== 'object' || m.parent !== ctx.caps.scene.world) return;
  ctx.saves.save(m);
  m.setFromMatrix(flatMatrix(ctx).set(lp.mm, 0, 0, lp.mm, lp.px - lp.mm * lp.x2d, lp.sy - lp.mm * lp.fy2d));
}
