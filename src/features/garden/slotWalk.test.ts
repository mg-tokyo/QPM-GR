import { describe, expect, it } from 'vitest';
import { walkPlantSlots } from './slotWalk';

const slot = (slotId: number | undefined, extra: Record<string, unknown> = {}) => ({
  species: 'Carrot', startTime: 1000, endTime: 2000, size: 60, mutations: ['Gold'],
  ...(slotId === undefined ? {} : { slotId }), ...extra,
});

describe('walkPlantSlots', () => {
  it('returns nothing for a null garden', () => {
    expect(walkPlantSlots(null)).toEqual([]);
  });

  it('uses the game slotId, not the array position', () => {
    const out = walkPlantSlots({ tileObjects: { 7: { objectType: 'plant', slots: [slot(4), slot(0)] } } });
    expect(out.map((s) => [s.tileKey, s.slotId])).toEqual([['g:7', 4], ['g:7', 0]]);
  });

  it('falls back to the array position when slotId is missing', () => {
    const out = walkPlantSlots({ tileObjects: { 1: { objectType: 'plant', slots: [slot(undefined), slot(undefined)] } } });
    expect(out.map((s) => s.slotId)).toEqual([0, 1]);
  });

  it('walks boardwalk tiles with the b: prefix', () => {
    const out = walkPlantSlots({ boardwalkTileObjects: { 3: { objectType: 'plant', slots: [slot(0)] } } });
    expect(out[0]?.tileKey).toBe('b:3');
  });

  it('skips non-plants and malformed slots and keeps only string mutations', () => {
    const out = walkPlantSlots({
      tileObjects: {
        1: { objectType: 'decor' },
        2: { objectType: 'plant', slots: [null, { species: 'Carrot' }, slot(0, { mutations: ['Wet', 5], size: undefined })] },
      },
    });
    expect(out).toEqual([{ tileKey: 'g:2', slotId: 0, startTime: 1000, species: 'Carrot', mutations: ['Wet'], size: null }]);
  });
});
