import { describe, expect, it } from 'vitest';
import { FakeMatrix } from '../__test__/fakeMatrix';
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

  it('restore leaves an entry the persist table holds alone (perf Task 3)', () => {
    const t = new DrawnTable();
    const a = new FakeNode(10, 20, 2), b = new FakeNode(5, 5);
    t.push(a.node, 10, 20, 2, 2, 300, 400, 0.5, true);
    t.push(b.node, 5, 5, 1, 1, 0, 0, 1);
    a.position.set(300, 400); b.position.set(9, 9);
    t.restore();
    expect([a.x, a.y, b.x, b.y]).toEqual([300, 400, 5, 5]);
    expect([t.entryFor(a.node)?.held, t.entryFor(b.node)?.held]).toEqual([true, false]);
  });

  it('keeps each lifted unit\'s own screen map, indexed by unit and by owner, until reset', () => {
    const t = new DrawnTable();
    const tile = new FakeNode(), slot = new FakeNode(), other = new FakeNode();
    t.push(tile.node, 0, 0, 1, 1, 0, 0, 1);
    t.pushLift(tile.node, slot.node, 5000, 4162, 640, 410, 0.4);
    expect(t.liftFor(slot.node)).toMatchObject({ owner: tile.node, x: 5000, y: 4162, px: 640, py: 410, mm: 0.4 });
    expect(t.hasLifts(tile.node)).toBe(true);
    expect(t.hasLifts(other.node)).toBe(false);
    expect(t.liftFor(other.node)).toBeNull();
    t.reset();
    expect(t.liftFor(slot.node)).toBeNull();
    expect(t.hasLifts(tile.node)).toBe(false);
    // Pooled: a later frame reuses the entry object.
    t.pushLift(other.node, tile.node, 1, 2, 3, 4, 5);
    expect(t.liftFor(tile.node)).toMatchObject({ owner: other.node, mm: 5 });
  });

  it('trim lets go of the nodes in pooled entries past the frame\'s end (a destroyed pet stayed reachable, A R4)', () => {
    const t = new DrawnTable();
    const [a, b, c] = [new FakeNode(), new FakeNode(), new FakeNode()];
    t.push(a.node, 0, 0, 1, 1, 0, 0, 1); t.push(b.node, 0, 0, 1, 1, 0, 0, 1); t.push(c.node, 0, 0, 1, 1, 0, 0, 1);
    t.pushLift(a.node, b.node, 0, 0, 0, 0, 1); t.pushLift(a.node, c.node, 0, 0, 0, 0, 1);
    t.trim();
    t.reset();
    t.push(a.node, 0, 0, 1, 1, 0, 0, 1);
    t.trim();
    const lifts = (t as unknown as { lifts: Array<{ node: unknown; owner: unknown }> }).lifts;
    const held = (o: object): boolean => t.entries.some((e) => e.node === o) || lifts.some((l) => l.node === o || l.owner === o);
    expect(held(b.node) || held(c.node)).toBe(false);
    expect(t.entries.length).toBe(3);
    expect(t.entryFor(a.node)).not.toBeNull();
    t.reset();
    t.trim();
    expect(t.entries.some((e) => e.node === a.node)).toBe(false);
  });

  it('FullSaves restores in reverse so the first save wins', () => {
    const s = new FullSaves();
    const a = new FakeNode(1, 2);
    s.save(a.node); a.position.set(9, 9);
    s.save(a.node); a.position.set(7, 7);
    s.restoreAll();
    expect([a.x, a.y]).toEqual([1, 2]);
  });

  it('FullSaves reuses its records across frames without restoring a stale save (A PF4)', () => {
    const s = new FullSaves();
    const a = new FakeNode(1, 2), b = new FakeNode(3, 4);
    s.save(a.node); s.save(b.node);
    a.position.set(9, 9); b.position.set(9, 9);
    s.restoreAll();
    // Next frame: only `b` saved, from a new position; `a` must not be touched by last frame's record.
    b.position.set(5, 6);
    s.save(b.node);
    b.position.set(0, 0);
    a.position.set(7, 7);
    s.restoreAll();
    expect([b.x, b.y]).toEqual([5, 6]);
    expect([a.x, a.y]).toEqual([7, 7]);
    s.save(a.node);
    s.reset();
    a.position.set(8, 8);
    s.restoreAll();
    expect([a.x, a.y]).toEqual([8, 8]);
  });

  it('chainMatrix writes into `out` when given one (no allocation per frame)', () => {
    const root = new FakeNode(100, 50, 2);
    const mid = root.addChild(new FakeNode(10, 0, 3));
    const leaf = mid.addChild(new FakeNode(1, 1));
    const fresh = chainMatrix(leaf.node)!;
    const out = new FakeMatrix(9, 9, 9, 9, 9, 9);
    expect(chainMatrix(leaf.node, out as never)).toBe(out);
    expect([out.a, out.b, out.c, out.d, out.tx, out.ty]).toEqual([fresh.a, fresh.b, fresh.c, fresh.d, fresh.tx, fresh.ty]);
    expect([out.a, out.tx, out.ty]).toEqual([6, 126, 56]);
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
