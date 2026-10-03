import type { Runtime } from '../runtime';
import type { XY } from '../types';
import type { Picker } from './picking';

type MapFn = (this: unknown, point: XY, x: number, y: number) => void;
type Wrapped = MapFn & { __qpmRetired?: boolean };

// PIXI maps every DOM pointer event through mapPositionToPoint before hit testing; the game's tap router reads the
// result. While 3D is live: cursor → topmost drawn billboard (or the ground under it) → the same point in the 2D
// scene → 2D global point. Points over the HUD are left alone.
export function installPointerRemap(rt: Runtime, picker: Picker): () => void {
  const events = rt.caps.scene.renderer.events;
  const host = events as unknown as { mapPositionToPoint: MapFn };
  const world = rt.caps.scene.world;
  let hadOwn = Object.prototype.hasOwnProperty.call(host, 'mapPositionToPoint');
  let original: MapFn = host.mapPositionToPoint;
  let evType = '';
  let cursor: XY | null = null;
  const live = (): boolean => rt.isLive() && rt.frame.ctx() !== null;

  const overUi = (x: number, y: number): boolean => {
    const h = events.rootBoundary.hitTest(x, y);
    for (let n = h; n; n = n.parent) if (n === world) return false;
    return !!h;
  };

  const make = (inner: MapFn): Wrapped => {
    const w: Wrapped = function (this: unknown, point: XY, x: number, y: number): void {
      inner.call(this, point, x, y);
      if (w.__qpmRetired || !live()) return;
      if (overUi(point.x, point.y)) { cursor = null; return; }
      cursor = { x: point.x, y: point.y };
      // Hover settles at most once per frame (spec §14 pick gate); taps pick fresh and synchronously.
      const res = evType === 'pointermove' ? picker.hover(point.x, point.y) : picker.pick(point.x, point.y, true);
      point.x = res.global.x;
      point.y = res.global.y;
    };
    return w;
  };
  let wrapper = make(original);
  host.mapPositionToPoint = wrapper;

  const ensure = (): void => {
    if (host.mapPositionToPoint === wrapper) return;
    wrapper.__qpmRetired = true;
    hadOwn = Object.prototype.hasOwnProperty.call(host, 'mapPositionToPoint');
    original = host.mapPositionToPoint;
    wrapper = make(original);
    host.mapPositionToPoint = wrapper;
  };
  const offStage = rt.onStageRender(ensure);

  // Tap-to-move drops taps whose global point is off the 2D screen; a remapped point can be far outside the 2D view.
  const mf = rt.caps.systems.movementFallback as unknown as { isTapInBounds: (x: number, y: number) => boolean };
  const mfOwn = Object.prototype.hasOwnProperty.call(mf, 'isTapInBounds');
  const origInBounds = mf.isTapInBounds;
  mf.isTapInBounds = function (this: unknown, x: number, y: number): boolean {
    return live() && cursor ? origInBounds.call(this, cursor.x, cursor.y) : origInBounds.call(this, x, y);
  };

  const onType = (e: Event): void => { evType = e.type; };
  const types = ['pointerdown', 'pointerup', 'pointermove'] as const;
  for (const ty of types) window.addEventListener(ty, onType, true);

  return () => {
    offStage();
    for (const ty of types) window.removeEventListener(ty, onType, true);
    if (mfOwn) mf.isTapInBounds = origInBounds;
    else delete (mf as unknown as Record<string, unknown>).isTapInBounds;
    if (host.mapPositionToPoint === wrapper) {
      if (hadOwn) host.mapPositionToPoint = original;
      else delete (host as unknown as Record<string, unknown>).mapPositionToPoint;
    } else {
      wrapper.__qpmRetired = true;
    }
    picker.destroy();
  };
}
