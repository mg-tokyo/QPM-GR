import type { LiftEntry, ScreenMap } from '../frame/drawn';
import type { Mat, Node3, XY } from '../types';

/** A drawn leaf under the cursor: the map it was drawn through and the cursor's 2D World point on it. */
export interface LeafHit { leaf: Node3; map: ScreenMap; wx: number; wy: number }
type InvMat = Mat & { applyInverse(p: XY, out?: XY): XY };

/** node-local → World, from the restored 2D local transforms (into `out` when given). */
export function relMatrix(node: Node3, world: Node3, out?: Mat): Mat {
  node.updateLocalTransform();
  const m = out ? out.copyFrom(node.localTransform) : node.localTransform.clone();
  for (let p = node.parent; p && p !== world; p = p.parent) { p.updateLocalTransform(); m.prepend(p.localTransform); }
  return m;
}

/**
 * Leaves of `root` under screen (cx, cy) on the last drawn frame, topmost first. Top-down through each node's local
 * transform (toLocal per leaf walks up to the stage; live: 2.2 ms per pick over ~500 drawn entries). Entering a lifted
 * unit switches to its own map, so the entity's child order holds.
 */
export function collectLeafHits(
  root: Node3, map: ScreenMap, cx: number, cy: number, world: Node3,
  liftOf: (n: Node3) => LiftEntry | null, skipLeaf: (n: Node3) => boolean, acc: LeafHit[], pool: XY[],
): void {
  const walk = (n: Node3, p: XY, m: ScreenMap, wx: number, wy: number, depth: number): void => {
    if (!n.visible || n.alpha <= 0 || n.renderable === false || skipLeaf(n)) return;
    const lift = liftOf(n);
    if (lift && !(lift.mm > 0)) return;
    if (lift && lift !== m) {
      m = lift;
      wx = lift.x + (cx - lift.px) / lift.mm;
      wy = lift.y + (cy - lift.py) / lift.mm;
      p = n.parent ? relMatrix(n.parent, world).invert().apply({ x: wx, y: wy }) : { x: wx, y: wy };
    }
    n.updateLocalTransform();
    const lp = (n.localTransform as InvMat).applyInverse(p, pool[depth] ??= { x: 0, y: 0 });
    if (n.children.length === 0) {
      if (n.containsPoint && (n.texture || n.geometry || n.context) && n.containsPoint(lp)) acc.push({ leaf: n, map: m, wx, wy });
      return;
    }
    for (let i = n.children.length - 1; i >= 0; i--) walk(n.children[i]!, lp, m, wx, wy, depth + 1);
  };
  const wx = map.x + (cx - map.px) / map.mm, wy = map.y + (cy - map.py) / map.mm;
  walk(root, { x: wx, y: wy }, map, wx, wy, 0);
}
