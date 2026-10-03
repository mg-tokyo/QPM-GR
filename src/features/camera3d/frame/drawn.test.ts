import { describe, expect, it } from 'vitest';
import { FakeNode } from '../__test__/fakeNode';
import { DrawnTable, FullSaves, chainMatrix, sync2d } from './drawn';

describe('drawn table + saves', () => {
  it('restores billboard transforms and skips destroyed nodes', () => {
    const t = new DrawnTable();
    const a = new FakeNode(10, 20, 2), b = new FakeNode(5, 5);
    t.push(a.node, 10, 20, 2, 2, 300, 400, 0.5);
    t.push(b.node, 5, 5, 1, 1, 0, 0, 1);
    a.position.set(300, 400); a.scale.set(1, 1);
    b.destroyed = true;
    b.position.set(-1, -1);
    t.restore();
    expect([a.x, a.y, a.scale.x]).toEqual([10, 20, 2]);
    expect(b.x).toBe(-1);
    expect(t.entryFor(a.node)?.mm).toBe(0.5);
  });

  it('FullSaves restores in reverse so the first save wins', () => {
    const s = new FullSaves();
    const a = new FakeNode(1, 2);
    s.save(a.node); a.position.set(9, 9);
    s.save(a.node); a.position.set(7, 7);
    s.restoreAll();
    expect([a.x, a.y]).toEqual([1, 2]);
  });

  it('sync2d writes the 2D chain into the render-group transform', () => {
    const root = new FakeNode(100, 50, 2);
    const world = root.addChild(new FakeNode(10, 0));
    sync2d(world.node);
    const wt = world.renderGroup.worldTransform;
    expect([wt.a, wt.tx, wt.ty]).toEqual([2, 120, 50]);
    expect(chainMatrix(world.node)!.tx).toBe(120);
  });
});
