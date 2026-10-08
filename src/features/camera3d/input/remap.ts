import { camera3dDiag } from '../diagnostics';
import { RewrapBudget } from '../frame/rewrap';
import type { Runtime } from '../runtime';
import type { XY } from '../types';
import type { PickResult, Picker } from './picking';

type MapFn = (this: unknown, point: XY, x: number, y: number) => void;
type Wrapped = MapFn & { __qpmRetired?: boolean };
const OFF_SCREEN = -1e6;

/** A click is one decision: the pointerup at its pointerdown's cursor pixel reuses that pick (A PF5: each tap was two
 * synchronous GPU reads, one per event). */
export class TapMemo<R> {
  private x = NaN;
  private y = NaN;
  private res: R | null = null;

  down(x: number, y: number, res: R): void { this.x = x; this.y = y; this.res = res; }
  /** The pointerdown's result for an up at the same pixel, once. */
  up(x: number, y: number): R | null {
    const r = this.res !== null && x === this.x && y === this.y ? this.res : null;
    this.res = null;
    return r;
  }
  clear(): void { this.res = null; }
}

export type PickMode = 'down' | 'up' | 'hover';
/** Only a press and its release need a synchronous pick; PIXI also maps over/out and wheel events. */
export const pickMode = (type: string): PickMode => (type === 'pointerdown' ? 'down' : type === 'pointerup' ? 'up' : 'hover');

// PIXI maps every DOM pointer event through mapPositionToPoint before hit testing; the game's tap router reads the
// result. While 3D is live: cursor → topmost drawn billboard (or the ground under it) → the same point in the 2D
// scene → 2D global point. Points over the HUD are left alone.
export function installPointerRemap(rt: Runtime, picker: Picker): () => void {
  const { renderer, world } = rt.caps.scene;
  const events = renderer.events;
  const host = events as unknown as { mapPositionToPoint: MapFn };
  let hadOwn = Object.prototype.hasOwnProperty.call(host, 'mapPositionToPoint');
  let original: MapFn = host.mapPositionToPoint;
  let evType = '';
  // The real cursor in 2D screen space while it is over the 3D view (not the HUD, not the sky).
  const cursor: XY = { x: 0, y: 0 };
  let hasCursor = false;
  const taps = new TapMemo<PickResult>();
  const budget = new RewrapBudget();
  const live = (): boolean => rt.isLive() && rt.frame.ctx() !== null;

  // Only "is the top hit outside World" matters here, so World's children are skipped: the full test walked every World
  // child on each pointer event (live 2026-10-05: 0.19 → 0.016 ms, same answer at 400/400 points).
  const overUi = (x: number, y: number): boolean => {
    const wc = world as unknown as { interactiveChildren: boolean };
    const kids = wc.interactiveChildren;
    wc.interactiveChildren = false;
    let h;
    try { h = events.rootBoundary.hitTest(x, y); } finally { wc.interactiveChildren = kids; }
    for (let n = h; n; n = n.parent) if (n === world) return false;
    return !!h;
  };

  const pickFor = (mode: PickMode, x: number, y: number): PickResult => {
    // Hover settles at most once per frame (spec §14 pick gate); taps pick fresh and synchronously.
    if (mode === 'hover') return picker.hover(x, y);
    if (mode === 'up') {
      const down = taps.up(x, y);
      return down ? picker.repick(down) : picker.pick(x, y);
    }
    const res = picker.pick(x, y);
    taps.down(x, y, res);
    return res;
  };

  const make = (inner: MapFn): Wrapped => {
    const w: Wrapped = function (this: unknown, point: XY, x: number, y: number): void {
      inner.call(this, point, x, y);
      if (w.__qpmRetired || !live()) return;
      // PIXI's pointerup listener is a window capture listener added before ours, so evType still read 'pointerdown'
      // there and every click picked twice (live 2026-10-05). The event being dispatched names the type.
      const mode = pickMode(window.event?.type ?? evType);
      try {
        if (mode === 'down') taps.clear();
        // Pointer lock freezes the client point where the lock began: aim at the crosshair instead (P6 a, A I1).
        if (document.pointerLockElement === renderer.canvas) { point.x = renderer.screen.width / 2; point.y = renderer.screen.height / 2; }
        hasCursor = false;
        if (overUi(point.x, point.y)) return;
        cursor.x = point.x;
        cursor.y = point.y;
        const res = pickFor(mode, point.x, point.y);
        point.x = res.global.x;
        point.y = res.global.y;
        // A sky tap keeps its off-screen point, which isTapInBounds then refuses (A I4).
        hasCursor = res.kind !== 'sky';
      } catch (e) {
        // Never act at the 2D point under a 3D cursor: the event lands nowhere, like a sky tap.
        hasCursor = false;
        point.x = OFF_SCREEN;
        point.y = OFF_SCREEN;
        rt.fail(mode === 'hover' ? 'hover' : 'pick', e);
      }
    };
    return w;
  };
  let wrapper = make(original);
  host.mapPositionToPoint = wrapper;

  const ensure = (): void => {
    if (host.mapPositionToPoint === wrapper) return;
    const b = budget.take(performance.now());
    if (b === 'capped') rt.hookFight('mapPositionToPoint');
    if (b !== 'ok') return;
    wrapper.__qpmRetired = true;
    hadOwn = Object.prototype.hasOwnProperty.call(host, 'mapPositionToPoint');
    original = host.mapPositionToPoint;
    wrapper = make(original);
    host.mapPositionToPoint = wrapper;
    camera3dDiag.diag.info('QPM-CAM3D-002', { hook: 'mapPositionToPoint' });
  };
  const offStage = rt.onStageRender(ensure);
  const offExit = rt.onExit(() => { taps.clear(); });

  // Tap-to-move drops taps whose global point is off the 2D screen; a remapped point can be far outside the 2D view.
  const mf = rt.caps.systems.movementFallback as unknown as { isTapInBounds: (x: number, y: number) => boolean };
  const mfOwn = Object.prototype.hasOwnProperty.call(mf, 'isTapInBounds');
  const origInBounds = mf.isTapInBounds;
  mf.isTapInBounds = function (this: unknown, x: number, y: number): boolean {
    return live() && hasCursor ? origInBounds.call(this, cursor.x, cursor.y) : origInBounds.call(this, x, y);
  };

  // The router drops a world tap whose global point is under its HUD or in a tap dead zone. The plant you stand on sits
  // under the 2D action card, so test where the cursor really is (live 2026-10-04: crop taps on your own tile lost).
  const router = rt.caps.systems.tapRouter;
  const origSuppress = router?.isWorldPointerSuppressed;
  const supOwn = !!router && Object.prototype.hasOwnProperty.call(router, 'isWorldPointerSuppressed');
  if (router && origSuppress) {
    router.isWorldPointerSuppressed = function (this: unknown, p: XY, pointerType?: string): boolean {
      return origSuppress.call(this, live() && hasCursor ? cursor : p, pointerType);
    };
  }

  const onType = (e: Event): void => { evType = e.type; };
  const types = ['pointerdown', 'pointerup', 'pointermove'] as const;
  for (const ty of types) window.addEventListener(ty, onType, true);

  return () => {
    offStage();
    offExit();
    for (const ty of types) window.removeEventListener(ty, onType, true);
    if (mfOwn) mf.isTapInBounds = origInBounds;
    else delete (mf as unknown as Record<string, unknown>).isTapInBounds;
    if (router && origSuppress) {
      if (supOwn) router.isWorldPointerSuppressed = origSuppress;
      else delete (router as unknown as Record<string, unknown>).isWorldPointerSuppressed;
    }
    if (host.mapPositionToPoint === wrapper) {
      if (hadOwn) host.mapPositionToPoint = original;
      else delete (host as unknown as Record<string, unknown>).mapPositionToPoint;
    } else {
      wrapper.__qpmRetired = true;
    }
  };
}
