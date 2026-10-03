import { describe, expect, it, vi } from 'vitest';

vi.mock('./compat', () => ({
  serviceReady: Promise.resolve({ state: { tex: new Map<string, unknown>([
    ['tile/PineTree', { frame: { x: 10, y: 20 } }],
    ['sprite/plant/Carrot', { frame: { x: 30, y: 40 } }],
  ]) } }),
}));

import { getGameTexture, getKeysByFrame, startGameTextures } from './gameTextures';

describe('gameTextures', () => {
  it('returns nothing before start, then the service map', async () => {
    expect(getGameTexture('tile/PineTree')).toBeNull();
    startGameTextures();
    await Promise.resolve();
    await Promise.resolve();
    expect(getGameTexture('tile/PineTree')).not.toBeNull();
    expect([...getKeysByFrame('tile/')]).toEqual([['10,20', 'tile/PineTree']]);
  });
});
