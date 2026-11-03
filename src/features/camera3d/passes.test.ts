import { describe, expect, it } from 'vitest';
import { missingLayers } from './passes';
import type { Caps } from './types';

const caps = (systems: Record<string, unknown>): Caps => ({
  scene: { stage: { children: [] }, world: { children: [] } },
  systems: { cameraMirrors: null, moon: null, gardenTiles: null, ...systems },
} as unknown as Caps);
const strips = (unmanaged: boolean) => ({ unmanaged: () => unmanaged });

describe('missingLayers (QPM-CAM3D-012)', () => {
  it('names the garden tiles when the side-view decor source is absent', () => {
    expect(missingLayers(caps({}), strips(false))).toEqual(['gardenTiles']);
    expect(missingLayers(caps({ gardenTiles: { tileViews: new Map() } }), strips(false))).toEqual([]);
    expect(missingLayers(caps({}), strips(true))).toEqual(['depthStrips', 'gardenTiles']);
  });
});
