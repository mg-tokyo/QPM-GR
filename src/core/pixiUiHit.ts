interface HitNode { parent?: unknown }
export interface PixiUiHitRenderer { events: { rootBoundary: { hitTest(x: number, y: number): unknown } } }

/** Whether the top PIXI hit at a global point is outside World (the HUD, name tags, game windows). World's children
 * are skipped: only "is it outside World" matters, and the full test walked every World child per pointer event
 * (camera3d live 2026-10-05: 0.19 → 0.016 ms, same answer at 400/400 points). */
export function isOverPixiUi(renderer: PixiUiHitRenderer, world: object, x: number, y: number): boolean {
  const wc = world as { interactiveChildren: boolean };
  const kids = wc.interactiveChildren;
  wc.interactiveChildren = false;
  let h: unknown;
  try { h = renderer.events.rootBoundary.hitTest(x, y); } finally { wc.interactiveChildren = kids; }
  for (let n = h; n; n = (n as HitNode).parent) if (n === world) return false;
  return !!h;
}
