import { describe, expect, it, vi } from 'vitest';
import type { AbilityProjection, PlantSlotMinimal } from './abilities/types';

const plant = (mutations: string[], extra: Record<string, unknown> = {}) =>
  ({ objectType: 'plant', slots: [{ species: 'Carrot', mutations, targetScale: 1, endTime: 0, ...extra }] });

// 2×1 map: global tile 0 is dirt 0, global tile 1 is boardwalk 0; both hold a target crop.
vi.mock('../garden/bridge', () => ({
  getGardenSnapshot: () => ({
    tileObjects: { 0: plant(['Ambershine']), 1: plant(['Ambershine'], { preserved: true }) },
    boardwalkTileObjects: { 0: plant(['Ambershine']) },
  }),
  getMapSnapshot: () => ({
    cols: 2,
    rows: 1,
    globalTileIdxToDirtTile: { 0: { dirtTileIdx: 0, userSlotIdx: 0 } },
    globalTileIdxToBoardwalk: { 1: { boardwalkTileIdx: 0, userSlotIdx: 0 } },
  }),
}));
vi.mock('../../core/atomRegistry', () => ({ readAtomValueSync: () => 0 }));

const { scanGardenForAbility, getQualifyingCropsInFootprint } = await import('./footprintScan');

const ability = {
  yieldKind: 'capsule',
  applies: (s: PlantSlotMinimal) => !s.preserved && s.mutations.includes('Ambershine'),
  projectGain: () => ({ coin: 0, capsule: 1 }),
} as unknown as AbilityProjection;

describe('charged ability footprint scan (REL-8.2)', () => {
  it('garden scan counts dirt crops only and reads preserved', () => {
    const res = scanGardenForAbility(ability);
    expect(res.slots).toHaveLength(1);
    expect(res.slots[0]!.preserved).toBe(false);
    expect(res.totalGain.capsule).toBe(1);
  });

  it('footprint over a dirt and a boardwalk tile counts the dirt crop only', () => {
    const res = getQualifyingCropsInFootprint({ x: 1, y: 0 }, 1, ability);
    expect(res.slots).toHaveLength(1);
    expect(res.totalGain.capsule).toBe(1);
  });
});
