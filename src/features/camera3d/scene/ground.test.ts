import { describe, expect, it } from 'vitest';
import { FakeNode } from '../__test__/fakeNode';
import { createGroundTracker } from './ground';

const avatar = (x: number, y: number): FakeNode => { const n = new FakeNode(x, y); n.label = 'AvatarContainer (p1)'; return n; };

describe('ground tracker', () => {
  it('keeps every non-avatar on its sort y', () => {
    const g = createGroundTracker();
    const tile = new FakeNode(100, 200);
    tile.label = 'Tile (0, 0)';
    expect(g.groundY(tile.node, 4000)).toBe(4000);
    expect(g.isAvatar(tile.node)).toBe(false);
  });

  it('glides an avatar on y + its rest offset while the game sort y steps a whole tile (live 2026-10-03)', () => {
    const g = createGroundTracker();
    const a = avatar(6272, 5312);
    for (let i = 0; i < 8; i++) g.groundY(a.node, 5504);
    expect(g.groundY(a.node, 5504)).toBe(5504);
    // Walking south: the sort y jumps to the next tile at the start of the step, the container glides.
    a.y = 5318.4;
    expect(g.groundY(a.node, 5760)).toBeCloseTo(5510.4, 6);
    a.y = 5488;
    expect(g.groundY(a.node, 5760)).toBeCloseTo(5680, 6);
    a.y = 5532.9;
    expect(g.groundY(a.node, 6016)).toBeCloseTo(5724.9, 6);
  });

  it('does not learn the offset from a step start, when the sort y moved but the container has not yet', () => {
    const g = createGroundTracker();
    const a = avatar(6272, 5312);
    for (let i = 0; i < 8; i++) g.groundY(a.node, 5504);
    g.groundY(a.node, 5760);
    g.groundY(a.node, 5760);
    a.y = 5400;
    expect(g.groundY(a.node, 5760)).toBeCloseTo(5592, 6);
  });

  it('falls back to the sort y until an avatar was seen at rest', () => {
    const g = createGroundTracker();
    expect(g.groundY(avatar(0, 5310).node, 5760)).toBe(5760);
  });
});
