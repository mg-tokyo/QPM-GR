import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMutationRules, type ParsedMutationRules } from '../../../catalogs/logic/mutationRulesParsing';
import type { MutationLetter, PlantData, WeatherType } from './types';

// Beta pr-4669 `inventoryAtoms-DkbetI5Q.js` excerpt (same as utils/mutationCompatibility.test.ts).
const BETA = 'function no(e,t,n){let r=W[t].group;return e.some(e=>W[e].group===r&&n?.includes(e)!==!0)}function ro(e,t){if(t.includes(e))return;let n=[...t];switch(e){case`Rainbow`:case`Gold`:if(no(t,e))return;n.push(e);break;case`Wet`:case`Chilled`:{let r=e===`Wet`?`Chilled`:`Wet`;if(no(t,e,[r]))return;t.includes(r)?(n=n.filter(e=>e!==r),n.push(`Frozen`)):n.push(e);break}case`Frozen`:if(no(t,e,[`Wet`,`Chilled`]))return;n=n.filter(e=>W[e].group!==`Hydro`),n.push(`Frozen`);break;case`Thunderstruck`:if(no(t,e))return;n.push(`Thunderstruck`);break;case`Thundercharged`:if(no(t,e,[`Thunderstruck`]))return;t.includes(`Thunderstruck`)&&(n=n.filter(e=>e!==`Thunderstruck`)),n.push(`Thundercharged`);break;case`Dawnlit`:case`Ambershine`:if(no(t,e))return;n.push(e);break;case`Dawncharged`:case`Ambercharged`:{let r=e===`Dawncharged`?`Dawnlit`:`Ambershine`;if(no(t,e,[r]))return;t.includes(r)&&(n=n.filter(e=>e!==r)),n.push(e);break}default:return e}return n}';

// literal-list-justified: test fixture mirroring the live mutation catalog groups (build 2022, 2026-11-13)
const GROUPS: Record<string, string> = {
  Gold: 'Growth', Rainbow: 'Growth',
  Wet: 'Hydro', Chilled: 'Hydro', Frozen: 'Hydro', Thunderstruck: 'Hydro', Thundercharged: 'Hydro',
  Dawnlit: 'Lunar', Ambershine: 'Lunar', Dawncharged: 'Lunar', Ambercharged: 'Lunar',
};
// Granted mutation per weather as the live weather catalog gives it (Rain, Frost "Snow", Dawn, AmberMoon).
const GRANTED: Record<string, string> = { rain: 'Wet', snow: 'Chilled', dawn: 'Dawnlit', amber: 'Ambershine' };

let rules: ParsedMutationRules | null = null;
let catalogLoaded = true;

vi.mock('../../../catalogs/gameCatalogs', () => ({
  getMutation: (id: string) => (catalogLoaded && GROUPS[id] ? { baseChance: 0, coinMultiplier: 1, group: GROUPS[id] } : null),
  getMutationCatalog: () => null,
}));
vi.mock('../../../catalogs/logic/mutationRulesCatalog', () => ({
  getMutationRule: (id: string) => rules?.rules[id] ?? null,
}));
vi.mock('../../garden/cropMutationAnalytics', () => ({
  resolveWeatherMutationEntry: (weather: string) => ({
    mutation: catalogLoaded ? GRANTED[weather] ?? null : null,
    displayName: null,
    chancePerMinutePerCrop: null,
    groupId: null,
  }),
}));

const { evaluatePlantForWeather } = await import('./evaluator');
const { computeSlotStateFromMutationNames } = await import('./parsing');
const { MUTATION_LETTERS } = await import('./constants');

function gardenPlant(slots: string[][]): PlantData {
  const slotStates = slots.map(computeSlotStateFromMutationNames);
  const domMutationCounts = Object.fromEntries(MUTATION_LETTERS.map((l) => [l, 0])) as Record<MutationLetter, number>;
  for (const s of slotStates) for (const l of s.letters) domMutationCounts[l] += 1;
  return {
    name: 'test',
    mutations: '',
    element: {} as Element,
    fruitCount: slotStates.length,
    slotStates,
    slotSource: 'garden',
    domMutationCounts,
    domBoldCounts: { D: 0, A: 0 },
  };
}

function pending(weather: WeatherType, slots: string[][]): number {
  return evaluatePlantForWeather(gardenPlant(slots), weather, false).pendingFruits;
}

beforeEach(() => {
  rules = parseMutationRules(BETA);
  catalogLoaded = true;
});

describe('mutation reminder pending fruit on the shared rule engine', () => {
  it.each<[WeatherType, string[][], number]>([
    ['rain', [['Thunderstruck']], 0],
    ['rain', [['Thundercharged']], 0],
    ['rain', [['Frozen']], 0],
    ['rain', [['Chilled']], 1],
    ['rain', [['Chilled'], []], 2],
    ['rain', [[]], 1],
    ['rain', [['Rainbow']], 1],
    ['rain', [['Thunderstruck'], [], ['Wet']], 1],
    ['snow', [['Thunderstruck']], 0],
    ['snow', [['Wet']], 1],
    ['snow', [['Frozen']], 0],
    ['snow', [[]], 1],
    ['dawn', [['Ambershine']], 0],
    ['dawn', [['Ambercharged']], 0],
    ['dawn', [['Dawnlit']], 0],
    ['dawn', [['Rainbow', 'Thunderstruck']], 1],
    ['amber', [['Dawnlit']], 0],
    ['amber', [['Dawncharged'], []], 1],
  ])('%s on %j → %i pending', (weather, slots, expected) => {
    expect(pending(weather, slots)).toBe(expected);
  });

  it('counts a Wet fruit as needing snow and the refusals in the detail', () => {
    const evaluation = evaluatePlantForWeather(gardenPlant([['Wet'], ['Thunderstruck']]), 'snow', false);
    expect(evaluation.needsSnow).toBe(1);
    expect(evaluation.detail).toMatchObject({ strategy: 'inventory', rulesRefused: 1 });
  });

  it('without parsed rules the group-only rule still blocks Thunder fruit', () => {
    rules = null;
    expect(pending('rain', [['Thunderstruck']])).toBe(0);
    expect(pending('rain', [[]])).toBe(1);
  });

  it('with no catalog it keeps the old flag behaviour', () => {
    catalogLoaded = false;
    expect(pending('rain', [['Thunderstruck']])).toBe(1);
    expect(pending('rain', [['Wet']])).toBe(0);
    expect(pending('dawn', [['Ambershine']])).toBe(1);
  });
});
