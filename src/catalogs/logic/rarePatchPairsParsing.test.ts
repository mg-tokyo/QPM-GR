import { describe, expect, it } from 'vitest';
import { RARE_PATCH_PAIRS_MARKER, parseRarePatchPairs } from './rarePatchPairsParsing';

// Exact excerpt of live build 2036 `inventoryAtoms-DNE6rlLK.js` (2026-11-14).
const LIVE = 'a.push(e)}return i}var $o=[{patchSpeciesId:`Daisy`,rareCropSpeciesId:`PurpleDaisy`},{patchSpeciesId:`Clover`,rareCropSpeciesId:`FourLeafClover`},{patchSpeciesId:`Snowdrop`,rareCropSpeciesId:`SnowdropDouble`},{patchSpeciesId:`Cattail`,rareCropSpeciesId:`VariegatedCattail`},{patchSpeciesId:`Emberbloom`,rareCropSpeciesId:`Embercrown`},{patchSpeciesId:`Foxfire`,rareCropSpeciesId:`Witchfire`}],es=Object.fromEntries($o.map(({patchSpeciesId:e,rareCropSpeciesId:t})=>[e,t]));';

const LIVE_PAIRS = [
  { patch: 'Daisy', rare: 'PurpleDaisy' },
  { patch: 'Clover', rare: 'FourLeafClover' },
  { patch: 'Snowdrop', rare: 'SnowdropDouble' },
  { patch: 'Cattail', rare: 'VariegatedCattail' },
  { patch: 'Emberbloom', rare: 'Embercrown' },
  { patch: 'Foxfire', rare: 'Witchfire' },
];

describe('parseRarePatchPairs (ALR-16.2)', () => {
  it('reads the live table in order', () => {
    expect(parseRarePatchPairs(LIVE)).toEqual(LIVE_PAIRS);
  });

  it('reads either field order, other quotes and spaced output', () => {
    const swapped = 'x=[{rareCropSpeciesId:"PurpleDaisy",patchSpeciesId:"Daisy"},{rareCropSpeciesId:\'Witchfire\',patchSpeciesId:\'Foxfire\'}];';
    expect(parseRarePatchPairs(swapped)).toEqual([{ patch: 'Daisy', rare: 'PurpleDaisy' }, { patch: 'Foxfire', rare: 'Witchfire' }]);
    const spaced = 'const t = [\n  { patchSpeciesId: `Daisy`, rareCropSpeciesId: `PurpleDaisy` },\n  {\n    patchSpeciesId: `Foxfire`,\n    rareCropSpeciesId: `Witchfire`,\n  },\n];';
    expect(parseRarePatchPairs(spaced)).toEqual([{ patch: 'Daisy', rare: 'PurpleDaisy' }, { patch: 'Foxfire', rare: 'Witchfire' }]);
  });

  it('absent anchor → null; destructuring alone is not the table', () => {
    expect(parseRarePatchPairs('var a=1;')).toBeNull();
    expect(parseRarePatchPairs('$o.map(({patchSpeciesId:e,rareCropSpeciesId:t})=>[e,t])')).toBeNull();
  });

  it('an entry of another shape, a repeated field or no closing bracket → null', () => {
    expect(parseRarePatchPairs('[{patchSpeciesId:`Daisy`,rareCropSpeciesId:`PurpleDaisy`,weight:2}]')).toBeNull();
    expect(parseRarePatchPairs('[{patchSpeciesId:`Daisy`,patchSpeciesId:`Clover`}]')).toBeNull();
    expect(parseRarePatchPairs('[{patchSpeciesId:`Daisy`,rareCropSpeciesId:`PurpleDaisy`},')).toBeNull();
  });

  it('marker scan stays fast on a large chunk without the table', () => {
    const big = '{patchSpeciesId:'.repeat(20000) + '[{'.repeat(20000);
    const t0 = performance.now();
    expect(RARE_PATCH_PAIRS_MARKER.test(big)).toBe(false);
    expect(parseRarePatchPairs(big)).toBeNull();
    expect(performance.now() - t0).toBeLessThan(200);
  });
});
