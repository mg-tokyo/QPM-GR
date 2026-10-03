import { project } from '../math/camera';
import type { FrameCtx } from '../frame/frame';
import type { Node3 } from '../types';
import type { Placement } from './entities';

const STEP = 64;

export interface Affine { a: number; b: number; c: number; d: number; tx: number; ty: number; sx: number; sy: number }

/** Affine fit of the ground-plane projection at (cx, cy): screen ≈ P(c) + J·(w − c). Null outside the depth range. */
export function groundAffine(ctx: FrameCtx, cx: number, cy: number): Affine | null {
  const o = ctx.out;
  project(ctx.basis, cx, 0, cy, o);
  const X = o[0]!, Y = o[1]!, Z = o[2]!;
  if (Z < ctx.params.near || Z > ctx.params.far) return null;
  project(ctx.basis, cx + STEP, 0, cy, o);
  const a = (o[0]! - X) / STEP, b = (o[1]! - Y) / STEP;
  project(ctx.basis, cx, 0, cy + STEP, o);
  const c = (o[0]! - X) / STEP, d = (o[1]! - Y) / STEP;
  return { a, b, c, d, tx: X - (a * cx + c * cy), ty: Y - (b * cx + d * cy), sx: X, sy: Y };
}

/** Lays a node flat where 2D draws it. Its parent must be World or a building/group container at (0,0). */
export function placeFlat(ctx: FrameCtx, node: Node3, cx: number, cy: number): boolean {
  const A = groundAffine(ctx, cx, cy);
  if (!A || A.sx < -ctx.marginX || A.sx > ctx.W + ctx.marginX || A.sy < -ctx.marginTop || A.sy > ctx.H + 1200) {
    ctx.ov.put('visible', node, false);
    return false;
  }
  ctx.ov.drop('visible', node);
  if (!ctx.ov.raw<boolean>('visible', node)) return false;
  node.updateLocalTransform();
  const m = new ctx.caps.classes.Matrix(A.a, A.b, A.c, A.d, A.tx, A.ty);
  m.append(node.localTransform);
  ctx.saves.save(node);
  node.setFromMatrix(m);
  return true;
}

/** A World-space mask (the tram tunnel rects) follows its owner's 2D→3D map so the 2D clip holds on the card. */
export function placeMask(ctx: FrameCtx, owner: Node3, lp: Placement): void {
  const m = owner.mask as Node3 | null | undefined;
  if (!m || typeof m !== 'object' || m.parent !== ctx.caps.scene.world) return;
  ctx.saves.save(m);
  m.setFromMatrix(new ctx.caps.classes.Matrix(lp.mm, 0, 0, lp.mm, lp.px - lp.mm * lp.x2d, lp.sy - lp.mm * lp.fy2d));
}
