import { describe, expect, it } from 'vitest';
import { checkCatalogAgreement } from './agreement';

const ARIES = 'https://mg-api.ariedam.fr/assets/sprites';

// Bundle-text shapes after sprite-enum resolution (game 1686).
const BUNDLE_MUTATIONS = {
  Gold: { name: 'Gold', baseChance: 0.01, coinMultiplier: 25, group: 'Growth' },
  Wet: { name: 'Wet', baseChance: 0, coinMultiplier: 2, group: 'Hydro', sprite: 'sprite/mutation/Wet' },
};
const BUNDLE_PLANTS = {
  Carrot: {
    name: 'Carrot',
    seed: { sprite: 'sprite/seed/Carrot', name: 'Carrot Seed', coinPrice: 10 },
    plant: { sprite: 'sprite/plant/BabyCarrot', name: 'Carrot Plant' },
    crop: { sprite: 'sprite/plant/Carrot', name: 'Carrot' },
  },
};
const BUNDLE_PETS = { Worm: { name: 'Worm', coinsToFullyReplenishHunger: 500, diet: ['Carrot'] } };
const BUNDLE_ABILITIES = {
  CoinFinderI: { name: 'Coin Finder I', trigger: 'continuous', baseProbability: 35, baseParameters: { baseMaxCoinsFindable: 120000 } },
};

describe('checkCatalogAgreement — game copies agree', () => {
  it('accepts the game mutation copy with a QPM-written color', () => {
    const captured = {
      Gold: { ...BUNDLE_MUTATIONS.Gold, color: '#ffd700' },
      Wet: { ...BUNDLE_MUTATIONS.Wet, color: '#5fa8ff' },
    };
    expect(checkCatalogAgreement(captured, BUNDLE_MUTATIONS, { ignoreKeys: ['color'] })).toEqual({ agrees: true, mismatches: [] });
  });

  it('ignores keys present on only one side and numeric differences', () => {
    const captured = { Wet: { ...BUNDLE_MUTATIONS.Wet, coinMultiplier: 3 }, NewMutation: { name: 'New' } };
    expect(checkCatalogAgreement(captured, BUNDLE_MUTATIONS).agrees).toBe(true);
  });

  it('skips function values and captured sprite paths the bundle could not resolve', () => {
    const captured = { Worm: { ...BUNDLE_PETS.Worm, getThing: () => 1, sprite: 'sprite/pet/Worm' } };
    expect(checkCatalogAgreement(captured, BUNDLE_PETS).agrees).toBe(true);
  });
});

describe("checkCatalogAgreement — Arie's copies disagree", () => {
  it('flags URL sprite paths at entry level', () => {
    const captured = { ...BUNDLE_MUTATIONS, Wet: { ...BUNDLE_MUTATIONS.Wet, sprite: `${ARIES}/mutations/Wet.png?v=1686` } };
    const result = checkCatalogAgreement(captured, BUNDLE_MUTATIONS, { ignoreKeys: ['color'] });
    expect(result.agrees).toBe(false);
    expect(result.mismatches).toEqual([`Wet.sprite: "${ARIES}/mutations/Wet.png?v=1686" != "sprite/mutation/Wet"`]);
  });

  it('flags URL sprite paths one stage down', () => {
    const carrot = BUNDLE_PLANTS.Carrot;
    const captured = { Carrot: { ...carrot, crop: { ...carrot.crop, sprite: `${ARIES}/plants/Carrot.png` } } };
    expect(checkCatalogAgreement(captured, BUNDLE_PLANTS).mismatches).toEqual([
      `Carrot.crop.sprite: "${ARIES}/plants/Carrot.png" != "sprite/plant/Carrot"`,
    ]);
  });

  it('flags foreign top-level fields on pets and abilities', () => {
    const pets = { Worm: { ...BUNDLE_PETS.Worm, sprite: `${ARIES}/pets/Worm.png`, animations: {}, rive: null } };
    expect(checkCatalogAgreement(pets, BUNDLE_PETS).mismatches).toEqual(['Worm.sprite: foreign field', 'Worm.animations: foreign field', 'Worm.rive: foreign field']);
    const abilities = { CoinFinderI: { ...BUNDLE_ABILITIES.CoinFinderI, description: 'Finds coins', descriptionTokens: [], color: 'gold' } };
    expect(checkCatalogAgreement(abilities, BUNDLE_ABILITIES, { ignoreKeys: ['color'] }).mismatches).toEqual([
      'CoinFinderI.description: foreign field',
      'CoinFinderI.descriptionTokens: foreign field',
    ]);
  });
});
