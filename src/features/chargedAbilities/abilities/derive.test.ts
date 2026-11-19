import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChargedAbilityRules } from '../../../catalogs/logic/chargedAbilityRulesCatalog';
import type { PlantSlotMinimal } from './types';

let rules: ChargedAbilityRules | null = null;
let abilities: Record<string, { name?: string; baseParameters?: Record<string, unknown> }> | null = null;
const items: Record<string, unknown> = { AmberCapsule: {} };

vi.mock('../../../catalogs/logic/chargedAbilityRulesCatalog', () => ({ getChargedAbilityRules: () => rules }));
vi.mock('../../../catalogs/gameCatalogs', () => ({
  getPetAbilitiesCatalog: () => abilities,
  getPetCatalog: () => ({ Wolf: { innateAbilityWeights: { Thundercharger: 1 } } }),
  getMutation: () => null,
  getItemCatalog: () => items,
}));
const applied: Array<[string[], string]> = [];
vi.mock('../../../utils/mutationCompatibility', () => ({
  getMutationApplicationResult: (existing: string[], add: string) => {
    applied.push([existing, add]);
    return [...existing.filter((m) => m !== 'Thunderstruck'), add];
  },
}));
vi.mock('../projection', () => ({
  computeSlotSellValue: (slot: PlantSlotMinimal) => (slot.mutations.includes('Thundercharged') ? 500 : 100),
}));
vi.mock('../liveCooldown', () => ({ getAbilityCooldownRemainingMs: () => 0 }));

const { deriveAllChargedAbilityProjections } = await import('./derive');

const slot = (mutations: string[], preserved = false): PlantSlotMinimal =>
  ({ species: 'Carrot', mutations, targetScale: 1, endTime: 0, preserved });

const RULES: ChargedAbilityRules = {
  captures: [{ abilityId: 'AmberCapture', capsuleToolId: 'AmberCapsule', capsulesByMutation: { Ambershine: 1, Ambercharged: 2 } }],
  chargers: [{ abilityId: 'Thundercharger', target: 'Thunderstruck', replacement: 'Thundercharged' }],
  chargerDispatchFound: true,
  unparsedChargers: [],
};

const byId = (id: string) => deriveAllChargedAbilityProjections().find((p) => p.abilityId === id)!;

describe('charged ability projections from the game rules (REL-8.2)', () => {
  beforeEach(() => {
    rules = RULES;
    abilities = {
      AmberCapture: { name: 'Amber Capture', baseParameters: { cooldownSeconds: 600, tileRadius: 2 } },
      Thundercharger: { name: 'Thundercharger', baseParameters: { cooldownSeconds: 900 } },
    };
    applied.length = 0;
  });

  it('lists nothing while the rules are unread', () => {
    rules = null;
    expect(deriveAllChargedAbilityProjections()).toEqual([]);
  });

  it('skips a rule whose ability is not in the catalog', () => {
    abilities = { Thundercharger: { name: 'Thundercharger' } };
    expect(deriveAllChargedAbilityProjections().map((p) => p.abilityId)).toEqual(['Thundercharger']);
  });

  it('capture gain sums the table count of every removed mutation', () => {
    const p = byId('AmberCapture');
    expect(p.yieldKind).toBe('capsule');
    expect(p.targetMutations).toEqual(['Ambershine', 'Ambercharged']);
    expect(p.capsuleSpriteKey).toBe('sprite/item/AmberCapsule');
    expect(p.projectGain(slot(['Ambershine', 'Ambercharged', 'Wet']))).toEqual({ coin: 0, capsule: 3 });
    expect(p.applies(slot(['Ambercharged']))).toBe(true);
    expect(p.applies(slot(['Wet', 'Dawnlit']))).toBe(false);
    expect(p.projectGain(slot(['constructor']))).toEqual({ coin: 0, capsule: 0 });
  });

  it('capsule sprite is null when the item catalog lacks the tool', () => {
    rules = { ...RULES, captures: [{ ...RULES.captures[0]!, capsuleToolId: 'MissingCapsule' }] };
    expect(byId('AmberCapture').capsuleSpriteKey).toBeNull();
  });

  it('charger targets only crops carrying its target and gains through the mutation rules', () => {
    const p = byId('Thundercharger');
    expect(p.yieldKind).toBe('coin');
    expect(p.replacementMutation).toBe('Thundercharged');
    expect(p.requiredSpecies).toEqual(['Wolf']);
    expect(p.applies(slot(['Wet']))).toBe(false);
    expect(p.projectGain(slot(['Wet']))).toEqual({ coin: 0, capsule: 0 });
    expect(p.projectGain(slot(['Thunderstruck', 'Wet']))).toEqual({ coin: 400, capsule: 0 });
    expect(applied).toContainEqual([['Thunderstruck', 'Wet'], 'Thundercharged']);
  });

  it('preserved crops are never targets', () => {
    expect(byId('AmberCapture').applies(slot(['Ambershine'], true))).toBe(false);
    expect(byId('AmberCapture').projectGain(slot(['Ambershine'], true))).toEqual({ coin: 0, capsule: 0 });
    expect(byId('Thundercharger').applies(slot(['Thunderstruck'], true))).toBe(false);
  });

  it('radius comes from the dex tileRadius, else the game default', () => {
    expect(byId('AmberCapture').tileRadius).toBe(2);
    expect(byId('Thundercharger').tileRadius).toBe(1);
    expect(byId('AmberCapture').cooldownMs).toBe(600_000);
  });

  it('a charger dispatch miss still lists the captures', () => {
    rules = { ...RULES, chargers: [], chargerDispatchFound: false };
    expect(deriveAllChargedAbilityProjections().map((p) => p.abilityId)).toEqual(['AmberCapture']);
  });
});
