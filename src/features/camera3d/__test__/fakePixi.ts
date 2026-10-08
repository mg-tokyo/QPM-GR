// The PIXI 8 Container internals frame/persist.ts relies on (live 2026-10-07, PIXI 8.19): observable points that notify
// their owner on a real change, the change tick as the local-transform cache key, and a render that walks changed
// nodes only. Pass `.node` wherever production code takes a Node3.
import type { Node3 } from '../types';
import { FakeMatrix } from './fakeMatrix';

export class ObsPoint {
  constructor(private readonly owner: { _onUpdate(p?: unknown): void }, public _x: number, public _y: number) {}
  get x(): number { return this._x; }
  set x(v: number) { if (this._x !== v) { this._x = v; this.owner._onUpdate(this); } }
  get y(): number { return this._y; }
  set y(v: number) { if (this._y !== v) { this._y = v; this.owner._onUpdate(this); } }
  set(x = 0, y = x): this {
    if (this._x !== x || this._y !== y) { this._x = x; this._y = y; this.owner._onUpdate(this); }
    return this;
  }
  copyFrom(p: { x: number; y: number }): this { return this.set(p.x, p.y); }
}

export class PixiNode {
  label: string | null = null;
  destroyed = false;
  parent: PixiNode | null = null;
  readonly children: PixiNode[] = [];
  texture: null = null;
  visible = true;
  alpha = 1;
  zIndex = 0;
  readonly _position: ObsPoint;
  readonly _scale: ObsPoint;
  readonly pivot = new ObsPoint(this, 0, 0);
  readonly skew = new ObsPoint(this, 0, 0);
  rotation = 0;
  _didContainerChangeTick = 0;
  didChange = false;
  /** Every _onUpdate call, and every render walk of this node. */
  updates = 0;
  walks = 0;
  readonly localTransform = new FakeMatrix();
  private localId = -1;
  /** PIXI's render cache (relativeGroupTransform): what the GPU draws. */
  readonly relativeGroupTransform = new FakeMatrix();

  constructor(x = 0, y = 0, scale = 1) {
    this._position = new ObsPoint(this, x, y);
    this._scale = new ObsPoint(this, scale, scale);
    this.render();
  }

  get position(): ObsPoint { return this._position; }
  get scale(): ObsPoint { return this._scale; }
  get x(): number { return this._position.x; }
  set x(v: number) { this._position.x = v; }
  get y(): number { return this._position.y; }
  set y(v: number) { this._position.y = v; }
  get node(): Node3 { return this as unknown as Node3; }

  _onUpdate(): void { this._didContainerChangeTick++; this.updates++; this.didChange = true; }
  updateLocalTransform(): void {
    if (this.localId === this._didContainerChangeTick) return;
    this.localId = this._didContainerChangeTick;
    this.localTransform.set(this._scale._x, 0, 0, this._scale._y, this._position._x, this._position._y);
  }
  /** PIXI's updateTransformAndChildren for a World root: only a changed node is walked. */
  render(): void {
    if (!this.didChange && this.walks > 0) return;
    this.updateLocalTransform();
    this.relativeGroupTransform.copyFrom(this.localTransform);
    this.didChange = false;
    this.walks++;
  }
  destroy(): void { this.destroyed = true; }

  /** [x, y, sx, sy] the fields hold (what game readers see). */
  fields(): number[] { return [this._position._x, this._position._y, this._scale._x, this._scale._y]; }
  /** [x, y, sx, sy] PIXI draws. */
  drawn(): number[] { const m = this.relativeGroupTransform; return [m.tx, m.ty, m.a, m.d]; }
}
