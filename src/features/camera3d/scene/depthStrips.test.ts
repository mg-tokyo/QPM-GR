import { describe, expect, it } from 'vitest';
import { FakeNode } from '../__test__/fakeNode';
import type { FrameCtx } from '../frame/frame';
import type { DepthStripsLike, Node3 } from '../types';
import { createDepthStrips } from './depthStrips';

// PIXI's addChild takes the child from its old parent; FakeNode's does not.
class PixiNode extends FakeNode {
  override addChild(c: FakeNode): FakeNode { c.parent?.removeChild(c); return super.addChild(c); }
}

interface Depth { key: number; z: number }

// The game's manager (live 1634, deriveAvailableActions): zIndex, then the strip of the depth row, made on first use.
class Manager {
  strips = new Map<unknown, Node3>();
  constructor(public world: Node3) {}
  update(e: Node3, d: Depth): void {
    e.zIndex = d.z;
    let r = this.strips.get(d.key);
    if (e.parent !== r) {
      if (!r) { r = new PixiNode().node; r.zIndex = d.key; this.world.addChild(r); this.strips.set(d.key, r); }
      r.addChild(e);
    }
  }
}

const ctx = { reCull: false, roll: -1 } as unknown as FrameCtx;
const ROW = 37120001;

function scene() {
  const world = new PixiNode();
  const mgr = new Manager(world.node);
  const a = new PixiNode(22144, 3712), b = new PixiNode(21888, 3712);
  mgr.update(a.node, { key: ROW, z: ROW + 0.86e-5 });
  mgr.update(b.node, { key: ROW, z: ROW + 0.85e-5 });
  const strip = mgr.strips.get(ROW)!;
  return { world, mgr, a, b, strip, pass: createDepthStrips(mgr as unknown as DepthStripsLike, world.node) };
}

describe('depth strips while 3D is live (game 1634)', () => {
  it('moves strip members into World, and files them back on exit', () => {
    const { world, mgr, a, b, strip, pass } = scene();
    pass.pre(ctx);
    expect(a.parent).toBe(world);
    expect(b.parent).toBe(world);
    expect(strip.children).toHaveLength(0);
    expect(pass.stats!().flattened).toBe(2);
    pass.drop();
    expect(a.parent!.node).toBe(strip);
    expect(b.parent!.node).toBe(strip);
    expect(Object.prototype.hasOwnProperty.call(mgr, 'update')).toBe(false);
  });

  it('lets the game write the zIndex of a flattened node without re-filing it', () => {
    const { world, mgr, a, pass } = scene();
    pass.pre(ctx);
    mgr.update(a.node, { key: ROW + 2560e4, z: 42 });
    expect(a.zIndex).toBe(42);
    expect(a.parent).toBe(world);
    // The real map is back after the call.
    expect(mgr.strips.get(ROW)).toBeDefined();
    expect(mgr.strips.has(ROW + 2560e4)).toBe(false);
  });

  it('flattens a node the game files while 3D is live on the next frame', () => {
    const { world, mgr, pass } = scene();
    pass.pre(ctx);
    const c = new PixiNode(256, 3712);
    mgr.update(c.node, { key: ROW, z: ROW });
    expect(c.parent!.node).toBe(mgr.strips.get(ROW));
    pass.pre(ctx);
    expect(c.parent).toBe(world);
    pass.drop();
    expect(c.parent!.node).toBe(mgr.strips.get(ROW));
  });

  it('does not file back a node destroyed or removed while flat', () => {
    const { world, a, b, strip, pass } = scene();
    pass.pre(ctx);
    a.destroyed = true;
    world.removeChild(b);
    pass.drop();
    expect(strip.children).toHaveLength(0);
    expect(b.parent).toBeNull();
  });

  it('leaves a manager of another World alone and reports strips it cannot handle', () => {
    const { world, mgr, a, strip } = scene();
    const pass = createDepthStrips(mgr as unknown as DepthStripsLike, new PixiNode().node);
    pass.pre(ctx);
    expect(a.parent!.node).toBe(strip);
    expect(pass.unmanaged()).toBe(false);
    const none = createDepthStrips(null, world.node);
    expect(none.unmanaged()).toBe(true);
  });
});
