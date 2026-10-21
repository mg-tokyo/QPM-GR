import { describe, expect, it } from 'vitest';
import { hasWebAddressSprite } from './detection';

const ARIES = 'https://mg-api.ariedam.fr/assets/sprites';
const check = (record: Record<string, unknown>): boolean => hasWebAddressSprite(record, Object.keys(record));

describe('hasWebAddressSprite', () => {
  it('fires on an entry-level URL sprite', () => {
    expect(check({ Wet: { name: 'Wet', sprite: `${ARIES}/mutations/Wet.png?v=1686` } })).toBe(true);
  });

  it('fires on a stage-level URL sprite', () => {
    expect(check({
      Carrot: { name: 'Carrot', seed: { sprite: 'sprite/seed/Carrot' }, crop: { sprite: `${ARIES}/plants/Carrot.png` } },
    })).toBe(true);
  });

  it('stays quiet on game sprite paths and plain strings', () => {
    expect(check({
      Carrot: { name: 'Carrot', seed: { sprite: 'sprite/seed/Carrot' }, crop: { sprite: 'sprite/plant/Carrot' } },
      Wet: { name: 'Wet', group: 'Hydro', sprite: 'sprite/mutation/Wet' },
      Worm: { name: 'Worm', diet: ['Carrot'], tileTransformOrigin: 'bottom' },
    })).toBe(false);
  });

  it('samples only the first 3 entries', () => {
    expect(check({ A: { n: 'a' }, B: { n: 'b' }, C: { n: 'c' }, D: { sprite: `${ARIES}/x.png` } })).toBe(false);
  });

  it('survives throwing getters', () => {
    const record: Record<string, unknown> = {};
    Object.defineProperty(record, 'Bad', { enumerable: true, get: () => { throw new Error('nope'); } });
    expect(check(record)).toBe(false);
  });
});
