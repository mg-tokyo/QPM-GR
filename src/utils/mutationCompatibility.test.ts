import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMutationRules, type ParsedMutationRules } from '../catalogs/logic/mutationRulesParsing';

// Beta pr-4669 `inventoryAtoms-DkbetI5Q.js` excerpt (same as mutationRulesParsing.test.ts).
const BETA = 'function no(e,t,n){let r=W[t].group;return e.some(e=>W[e].group===r&&n?.includes(e)!==!0)}function ro(e,t){if(t.includes(e))return;let n=[...t];switch(e){case`Rainbow`:case`Gold`:if(no(t,e))return;n.push(e);break;case`Wet`:case`Chilled`:{let r=e===`Wet`?`Chilled`:`Wet`;if(no(t,e,[r]))return;t.includes(r)?(n=n.filter(e=>e!==r),n.push(`Frozen`)):n.push(e);break}case`Frozen`:if(no(t,e,[`Wet`,`Chilled`]))return;n=n.filter(e=>W[e].group!==`Hydro`),n.push(`Frozen`);break;case`Thunderstruck`:if(no(t,e))return;n.push(`Thunderstruck`);break;case`Thundercharged`:if(no(t,e,[`Thunderstruck`]))return;t.includes(`Thunderstruck`)&&(n=n.filter(e=>e!==`Thunderstruck`)),n.push(`Thundercharged`);break;case`Dawnlit`:case`Ambershine`:if(no(t,e))return;n.push(e);break;case`Dawncharged`:case`Ambercharged`:{let r=e===`Dawncharged`?`Dawnlit`:`Ambershine`;if(no(t,e,[r]))return;t.includes(r)&&(n=n.filter(e=>e!==r)),n.push(e);break}default:return e}return n}';

// Groups as in beta mutationsDex.ts:6-78 and the live catalog read 2026-11-13.
const GROUPS: Record<string, string> = {
  Gold: 'Growth', Rainbow: 'Growth',
  Wet: 'Hydro', Chilled: 'Hydro', Frozen: 'Hydro', Thunderstruck: 'Hydro', Thundercharged: 'Hydro',
  Dawnlit: 'Lunar', Ambershine: 'Lunar', Dawncharged: 'Lunar', Ambercharged: 'Lunar',
};
let rules: ParsedMutationRules | null = null;
let catalogLoaded = true;

vi.mock('../catalogs/gameCatalogs', () => ({
  getMutation: (id: string) => (catalogLoaded && GROUPS[id] ? { baseChance: 0, coinMultiplier: 1, group: GROUPS[id] } : null),
  getMutationCatalog: () => null,
}));
vi.mock('../catalogs/logic/mutationRulesCatalog', () => ({
  getMutationRule: (id: string) => rules?.rules[id] ?? null,
}));

const { canApplyMutation, filterCompatibleMutations, getMutationApplicationResult, simulateMutationsAfterApplying } = await import('./mutationCompatibility');

beforeEach(() => {
  rules = parseMutationRules(BETA);
  catalogLoaded = true;
});

describe('mutation rule engine (game updateMutationList)', () => {
  it.each<[string, string[], string[] | null]>([
    ['Wet', ['Thundercharged'], null],
    ['Wet', ['Chilled'], ['Frozen']],
    ['Chilled', ['Gold', 'Wet'], ['Gold', 'Frozen']],
    ['Frozen', ['Wet'], ['Frozen']],
    ['Frozen', ['Chilled', 'Dawnlit'], ['Dawnlit', 'Frozen']],
    ['Frozen', ['Thunderstruck'], null],
    ['Wet', ['Frozen'], null],
    ['Thundercharged', ['Thunderstruck'], ['Thundercharged']],
    ['Thundercharged', ['Wet'], null],
    ['Thunderstruck', ['Thundercharged'], null],
    ['Dawncharged', ['Dawnlit'], ['Dawncharged']],
    ['Dawncharged', ['Ambershine'], null],
    ['Ambercharged', ['Ambershine', 'Rainbow'], ['Rainbow', 'Ambercharged']],
    ['Dawnlit', ['Ambershine'], null],
    ['Gold', ['Rainbow'], null],
    ['Gold', ['Gold'], null],
    ['Rainbow', ['Wet', 'Dawnlit'], ['Wet', 'Dawnlit', 'Rainbow']],
  ])('%s on %j → %j', (add, existing, expected) => {
    expect(getMutationApplicationResult(existing, add)).toEqual(expected);
    expect(canApplyMutation(add, existing)).toBe(expected !== null);
  });

  it('resolves aliases and any letter case to catalog ids', () => {
    expect(getMutationApplicationResult(['dawnlit'], 'Dawnbound')).toEqual(['Dawncharged']);
    expect(canApplyMutation('amberlit', ['Dawnlit'])).toBe(false);
  });

  it('applies a list in order and keeps the input names that land', () => {
    expect(simulateMutationsAfterApplying(['Chilled'], ['Wet', 'Gold', 'Rainbow'])).toEqual(['Frozen', 'Gold']);
    expect(filterCompatibleMutations(['Chilled'], ['Wet', 'Gold', 'Rainbow', 'Thunderstruck'])).toEqual(['Wet', 'Gold']);
  });

  it('without parsed rules uses the group-only rule (PD1): no replace, no combine', () => {
    rules = null;
    expect(getMutationApplicationResult(['Chilled'], 'Wet')).toBeNull();
    expect(getMutationApplicationResult(['Dawnlit'], 'Dawncharged')).toBeNull();
    expect(getMutationApplicationResult(['Gold'], 'Wet')).toEqual(['Gold', 'Wet']);
  });

  it('a mutation with no catalog group is only refused as a duplicate', () => {
    catalogLoaded = false;
    expect(canApplyMutation('Eclipse', ['Wet'])).toBe(true);
    expect(canApplyMutation('Eclipse', ['Eclipse'])).toBe(false);
  });
});
