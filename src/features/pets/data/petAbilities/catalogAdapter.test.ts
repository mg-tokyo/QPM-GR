import { describe, expect, it, vi } from 'vitest';

type Entry = { name: string; trigger: string; baseProbability: number | null; baseParameters: Record<string, unknown> };

// literal-list-justified: test fixture copied from the live v1361 petAbilities catalog (2026-10-02)
const CATALOG: Record<string, Entry> = {
  CoinFinderI: { name: 'Coin Finder I', trigger: 'continuous', baseProbability: 35, baseParameters: { baseMaxCoinsFindable: 120000 } },
  ThunderCoinFinder: { name: 'Thunder Coin Finder', trigger: 'continuous', baseProbability: 35, baseParameters: { baseMaxCoinsFindable: 5500000, requiredWeather: 'Thunderstorm' } },
  PetXpBoost: { name: 'XP Boost I', trigger: 'continuous', baseProbability: 30, baseParameters: { bonusXp: 300 } },
  PlantGrowthBoost: { name: 'Plant Growth Boost I', trigger: 'continuous', baseProbability: 24, baseParameters: { plantGrowthReductionMinutes: 3 } },
  EggGrowthBoostII_NEW: { name: 'Egg Growth Boost II', trigger: 'continuous', baseProbability: 24, baseParameters: { eggGrowthTimeReductionMinutes: 9 } },
  EggGrowthBoostII: { name: 'Egg Growth Boost III', trigger: 'continuous', baseProbability: 27, baseParameters: { eggGrowthTimeReductionMinutes: 11 } },
  PetAgeBoost: { name: 'Hatch XP Boost I', trigger: 'hatchEgg', baseProbability: 50, baseParameters: { bonusXp: 8000 } },
  ProduceMutationBoost: { name: 'Weather Mutation Boost I', trigger: 'continuous', baseProbability: null, baseParameters: { mutationChanceIncreasePercentage: 15 } },
  HungerBoost: { name: 'Hunger Boost I', trigger: 'continuous', baseProbability: null, baseParameters: { hungerRefundPercentage: 12 } },
  RainDance: { name: 'Rain Granter', trigger: 'continuous', baseProbability: 10, baseParameters: { grantedMutations: ['Wet'] } },
  ProduceEater: { name: 'Crop Eater', trigger: 'continuous', baseProbability: 60, baseParameters: { cropSellPriceIncreasePercentage: 150 } },
};

const state = { captured: true };

vi.mock('../../../../catalogs/gameCatalogs', () => ({
  areCatalogsReady: (): boolean => true,
  arePetAbilitiesCaptured: (): boolean => state.captured,
  getAllAbilities: (): string[] => (state.captured ? Object.keys(CATALOG) : []),
  getAbilityDef: (id: string): unknown => (state.captured ? CATALOG[id] ?? null : null),
  onPetAbilitiesCaptured: (): (() => void) => () => undefined,
}));

const { getAbilityDefinition, getAllAbilityDefinitions, resolveCatalogParameterMetadata } = await import('./catalogAdapter');
const { ABILITY_METADATA } = await import('./definitions');

describe('effectValuePerProc from catalog rules', () => {
  it('coin finder per proc is the mean of the 1..max roll', () => {
    expect(getAbilityDefinition('CoinFinderI')?.effectValuePerProc).toBe(60000);
  });

  it('catalog-only weather coin finder gets a per-proc value and its weather gate', () => {
    const def = getAbilityDefinition('ThunderCoinFinder');
    expect(def?.effectValuePerProc).toBe(2750000);
    expect(def?.requiredWeather).toBe('thunderstorm');
  });

  it('xp and growth-minute params are the per-proc value', () => {
    expect(getAbilityDefinition('PetXpBoost')?.effectValuePerProc).toBe(300);
    expect(getAbilityDefinition('PlantGrowthBoost')?.effectValuePerProc).toBe(3);
    expect(getAbilityDefinition('EggGrowthBoostII_NEW')?.effectValuePerProc).toBe(9);
    expect(getAbilityDefinition('PetAgeBoost')?.effectValuePerProc).toBe(8000);
  });

  it('percentage params carry no per-proc value', () => {
    expect(resolveCatalogParameterMetadata('sellAllCrops', { cropSellPriceIncreasePercentage: 20 }).effectValuePerProc).toBeUndefined();
    expect(resolveCatalogParameterMetadata('continuous', { mutationChanceIncreasePercentage: 5 }).effectValuePerProc).toBeUndefined();
  });
});

describe('catalog is the only source of game values', () => {
  it('grantedMutations-only abilities are valued as coin granters (RainDance)', () => {
    expect(resolveCatalogParameterMetadata('continuous', { grantedMutations: ['Wet'] })).toEqual({ category: 'misc', effectUnit: 'coins' });
    const def = getAbilityDefinition('RainDance');
    expect(def?.effectUnit).toBe('coins');
    expect(def?.effectBaseValue).toBeUndefined();
    expect(def?.name).toBe('Rain Granter');
  });

  it('a QPM alias resolves to the catalog entry of its metadata id', () => {
    expect(getAbilityDefinition('Rain Dance')?.id).toBe('RainDance');
    const mutation = getAbilityDefinition('Crop Mutation Boost I');
    expect(mutation?.id).toBe('ProduceMutationBoost');
    expect(mutation?.effectBaseValue).toBe(15);
  });

  it('an exact id beats another ability whose name compacts to it', () => {
    expect(getAbilityDefinition('EggGrowthBoostII')?.id).toBe('EggGrowthBoostII');
    expect(getAbilityDefinition('EggGrowthBoostII')?.effectValuePerProc).toBe(11);
    expect(getAbilityDefinition('Egg Growth Boost II')?.id).toBe('EggGrowthBoostII_NEW');
  });

  it('a null catalog chance stays unset (no hardcoded 0)', () => {
    expect(getAbilityDefinition('HungerBoost')?.baseProbability).toBeUndefined();
  });

  it('getAllAbilityDefinitions is the catalog list with QPM aliases and notes attached', () => {
    const all = getAllAbilityDefinitions();
    expect(all.map((d) => d.id)).toEqual(Object.keys(CATALOG));
    expect(all.find((d) => d.id === 'RainDance')?.aliases).toEqual(['Rain Dance']);
    expect(all.find((d) => d.id === 'ProduceEater')?.notes).toBeTruthy();
    expect(all.find((d) => d.id === 'ThunderCoinFinder')?.aliases).toBeUndefined();
  });

  it('catalog absent ⇒ no definitions at all', () => {
    state.captured = false;
    try {
      expect(getAbilityDefinition('CoinFinderI')).toBeNull();
      expect(getAbilityDefinition('Rain Dance')).toBeNull();
      expect(getAllAbilityDefinitions()).toEqual([]);
    } finally {
      state.captured = true;
    }
  });

  it('alias metadata lists each id once', () => {
    const ids = ABILITY_METADATA.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
