// Minimal PIXI-like node for unit tests. Pass `.node` wherever production code takes a Node3.
import type { Node3 } from '../types';
import { FakeMatrix } from './fakeMatrix';

export class FakePoint {
  constructor(public x = 0, public y = 0) {}
  set(x: number, y?: number): void { this.x = x; this.y = y ?? x; }
  copyFrom(p: { x: number; y: number }): this { this.x = p.x; this.y = p.y; return this; }
}

export interface FakeTexture {
  orig: { width: number; height: number };
  frame: { x: number; y: number; width: number; height: number };
  source: { style: null };
  destroy(): void;
}

export class FakeNode {
  label: string | null = null;
  readonly position: FakePoint;
  readonly scale: FakePoint;
  readonly pivot = new FakePoint();
  readonly skew = new FakePoint();
  rotation = 0;
  zIndex = 0;
  visible = true;
  alpha = 1;
  destroyed = false;
  parent: FakeNode | null = null;
  readonly children: FakeNode[] = [];
  readonly localTransform = new FakeMatrix();
  /** The last matrix handed to setFromMatrix (a copy). */
  lastSet: FakeMatrix | null = null;
  readonly renderGroup = { worldTransform: new FakeMatrix() };
  texture: FakeTexture | null = null;
  anchor: FakePoint | null = null;

  constructor(x = 0, y = 0, scale = 1, kids: readonly FakeNode[] = []) {
    this.position = new FakePoint(x, y);
    this.scale = new FakePoint(scale, scale);
    for (const k of kids) this.addChild(k);
  }

  get x(): number { return this.position.x; }
  set x(v: number) { this.position.x = v; }
  get y(): number { return this.position.y; }
  set y(v: number) { this.position.y = v; }

  /** This node typed as the structural Node3 the production code takes. */
  get node(): Node3 { return this as unknown as Node3; }

  /** Gives the node a w×h texture with anchor (0.5, ay). */
  withTexture(w: number, h: number, ay: number): this {
    this.texture = { orig: { width: w, height: h }, frame: { x: 0, y: 0, width: w, height: h }, source: { style: null }, destroy: () => undefined };
    this.anchor = new FakePoint(0.5, ay);
    return this;
  }

  addChild(c: FakeNode): FakeNode { c.parent = this; this.children.push(c); return c; }
  addChildAt(c: FakeNode, i: number): FakeNode { c.parent = this; this.children.splice(i, 0, c); return c; }
  removeChild(c: FakeNode): FakeNode { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parent = null; return c; }
  destroy(): void { this.destroyed = true; }
  updateLocalTransform(): void { this.localTransform.set(this.scale.x, 0, 0, this.scale.y, this.position.x, this.position.y); }
  setFromMatrix(m: FakeMatrix): void { this.lastSet = m.clone(); }
}
