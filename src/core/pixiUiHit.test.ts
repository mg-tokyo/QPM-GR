import { describe, expect, it } from 'vitest';
import { isOverPixiUi } from './pixiUiHit';

interface N { label: string; parent: N | null; interactiveChildren?: boolean }
const node = (label: string, parent: N | null = null): N => ({ label, parent });

describe('isOverPixiUi (the root-boundary test camera3d and the spectator share)', () => {
  const stage = node('stage');
  const camera = node('Camera', stage);
  const world = { ...node('World', camera), interactiveChildren: true };
  const plant = node('plant', world);
  const hotbar = node('Hotbar', stage);

  const renderer = (hit: (x: number, y: number, kids: boolean) => N | null) =>
    ({ events: { rootBoundary: { hitTest: (x: number, y: number) => hit(x, y, world.interactiveChildren) } } });

  it('a top hit outside World is UI; World, its children or nothing is not', () => {
    expect(isOverPixiUi(renderer(() => hotbar), world, 1, 1)).toBe(true);
    expect(isOverPixiUi(renderer(() => world), world, 1, 1)).toBe(false);
    expect(isOverPixiUi(renderer(() => plant), world, 1, 1)).toBe(false);
    expect(isOverPixiUi(renderer(() => null), world, 1, 1)).toBe(false);
  });

  it("skips World's children during the test and restores the flag, even when the test throws", () => {
    let seen: boolean | null = null;
    isOverPixiUi(renderer((_x, _y, kids) => { seen = kids; return world; }), world, 1, 1);
    expect(seen).toBe(false);
    expect(world.interactiveChildren).toBe(true);
    expect(() => isOverPixiUi(renderer(() => { throw new Error('boom'); }), world, 1, 1)).toThrow('boom');
    expect(world.interactiveChildren).toBe(true);
  });
});
