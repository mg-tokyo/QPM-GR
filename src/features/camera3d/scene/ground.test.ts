import { describe, expect, it } from 'vitest';
import { FakeNode } from '../__test__/fakeNode';
import { createGroundTracker } from './ground';

const avatar = (x: number, y: number): FakeNode => { const n = new FakeNode(x, y); n.label = 'AvatarContainer (p1)'; return n; };
const pet = (x: number, y: number): FakeNode => { const n = new FakeNode(x, y); n.label = 'Pet: Phoenix'; return n; };

/** An avatar learns the walker rest offset 192 at (6272, 5312) on tile row 5504. */
function walkerAtRest(): { g: ReturnType<typeof createGroundTracker>; a: FakeNode } {
  const g = createGroundTracker();
  const a = avatar(6272, 5312);
  for (let i = 0; i < 8; i++) g.groundY(a.node, 5504.0002, i);
  return { g, a };
}

describe('ground tracker', () => {
  it('keeps every non-avatar on its sort y', () => {
    const g = createGroundTracker();
    const tile = new FakeNode(100, 200);
    tile.label = 'Tile (0, 0)';
    expect(g.groundY(tile.node, 4000, 0)).toBe(4000);
    expect(g.isAvatar(tile.node)).toBe(false);
  });

  it('glides an avatar on y + its rest offset while the game sort y steps a whole tile (live 2026-10-03)', () => {
    const g = createGroundTracker();
    const a = avatar(6272, 5312);
    for (let i = 0; i < 8; i++) g.groundY(a.node, 5504, i);
    expect(g.groundY(a.node, 5504, 8)).toBe(5504);
    // Walking south: the sort y jumps to the next tile at the start of the step, the container glides.
    a.y = 5318.4;
    expect(g.groundY(a.node, 5760, 9)).toBeCloseTo(5510.4, 6);
    a.y = 5488;
    expect(g.groundY(a.node, 5760, 10)).toBeCloseTo(5680, 6);
    a.y = 5532.9;
    expect(g.groundY(a.node, 6016, 11)).toBeCloseTo(5724.9, 6);
  });

  it('does not learn the offset from a step start, when the sort y moved but the container has not yet', () => {
    const g = createGroundTracker();
    const a = avatar(6272, 5312);
    for (let i = 0; i < 8; i++) g.groundY(a.node, 5504, i);
    g.groundY(a.node, 5760, 8);
    g.groundY(a.node, 5760, 9);
    a.y = 5400;
    expect(g.groundY(a.node, 5760, 10)).toBeCloseTo(5592, 6);
  });

  it('falls back to the sort y until an avatar was seen at rest', () => {
    const g = createGroundTracker();
    expect(g.groundY(avatar(0, 5310).node, 5760, 0)).toBe(5760);
  });

  // Live 2026-10-04, Phoenix: the saddle lift puts the container 400 px above its tile row and bobs it ±17 px.
  it('stands a riding avatar on its tile row, whatever the saddle lift and bob', () => {
    const { g, a } = walkerAtRest();
    a.y = 5360;
    expect(g.groundY(a.node, 5504.0006, 100)).toBe(5504);
    a.y = 5377;
    expect(g.groundY(a.node, 5504.0006, 133)).toBe(5504);
  });

  it('eases a rider to the next tile row like the game step glide, and snaps a teleport', () => {
    const { g, a } = walkerAtRest();
    g.groundY(a.node, 5504.0006, 100);
    const mid = g.groundY(a.node, 5760.0006, 130);
    expect(mid).toBeGreaterThan(5504);
    expect(mid).toBeLessThan(5760);
    expect(g.groundY(a.node, 5760.0006, 600)).toBeCloseTo(5760, 1);
    expect(g.groundY(a.node, 8320.0006, 633)).toBe(8320);
  });

  it('stands the mount on its rider ground: same tile row, x locked to the rider', () => {
    const { g, a } = walkerAtRest();
    a.y = 5360;
    g.groundY(a.node, 5504.0006, 100);
    const mount = pet(6272, 5849);
    expect(g.groundY(mount.node, 5504.0007, 100)).toBe(5504);
    expect(g.riderOf(mount.node)).toBe(a.node);
    const other = pet(6272 + 256, 5849);
    expect(g.groundY(other.node, 5504.0007, 100)).toBe(5504.0007);
    expect(g.riderOf(other.node)).toBeNull();
  });

  it('after a dismount keeps the rider ground until the walker ground agrees, then hands over', () => {
    const { g, a } = walkerAtRest();
    a.y = 5104;
    g.groundY(a.node, 5504.0006, 100);
    // Dismounted: the lift slews back, the container is still 208 px high.
    expect(g.groundY(a.node, 5504.0002, 133)).toBeCloseTo(5504, 3);
    a.y = 5312;
    expect(g.groundY(a.node, 5504.0002, 166)).toBeCloseTo(5504, 3);
    a.y = 5300;
    expect(g.groundY(a.node, 5504.0002, 199)).toBeCloseTo(5492, 3);
    const mount = pet(6272, 5849);
    expect(g.groundY(mount.node, 5504.0007, 199)).toBe(5504.0007);
  });
});
