import { beforeEach, describe, expect, it, vi } from 'vitest';

const mem = new Map<string, unknown>();
vi.mock('../../utils/storage', () => ({
  storage: {
    get: (k: string, d: unknown = null) => (mem.has(k) ? mem.get(k) : d),
    set: (k: string, v: unknown) => { mem.set(k, v); },
  },
}));
vi.mock('../../i18n', () => ({
  t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key}:${JSON.stringify(vars)}` : key),
}));
vi.mock('../../sprite-v2/compat', () => ({
  isSpritesReady: () => true,
  getAnySpriteDataUrl: (key: string | null) => (key ? `data:${key}` : ''),
}));
// Rainbow carries a gradient only, as the catalog does.
vi.mock('../mutations/data/variantBadges', () => ({
  findVariantBadge: (m: string) => ({ iconKey: `sprite/ui/Mutation${m}`, ...(m === 'Rainbow' ? { gradient: 'linear-gradient(red, blue)' } : { color: `#c-${m}` }) }),
}));
vi.mock('../../utils/game/catalogHelpers', () => ({ getMutationName: (m: string) => m }));

let gardenCb: (() => void) | null = null;
let gardenSubs = 0;
vi.mock('./bridge', () => ({
  getGardenSnapshot: () => null,
  onGardenSnapshot: (cb: () => void) => { gardenCb = cb; gardenSubs += 1; return () => { gardenCb = null; gardenSubs -= 1; }; },
}));

// The garden as the test drives it: remaining per mutation and the total fruit.
let remaining: Record<string, number> = {};
let totalFruit = 10;
vi.mock('./gardenTiles', () => ({
  extractTiles: () => [{ slots: [{ fruitCount: totalFruit }] }],
  tileFruitCount: (tile: { slots: Array<{ fruitCount: number }> }) => tile.slots.reduce((s, x) => s + x.fruitCount, 0),
  countActionableFruits: (_tiles: unknown, sel: string[]) => remaining[sel[0] ?? ''] ?? 0,
}));

interface RaisedCard { row: string; title: string; body?: string; cardKey?: string; iconUrl?: string; accent?: string; chips?: Array<{ text: string; color?: string; iconUrl?: string }> }
interface RowDef { id: string; icon?: () => string | null; summary?: () => string; accent?: () => string | null }
const raised: RaisedCard[] = [];
const rows: string[] = [];
const defs: RowDef[] = [];
const enabledRows: string[] = [];
vi.mock('../alertHub', () => ({
  raiseAlert: (row: string, p: Omit<RaisedCard, 'row'>) => { raised.push({ row, ...p }); return null; },
  registerAlertRow: (def: RowDef) => { rows.push(def.id); defs.push(def); },
  setAlertRowEnabled: (id: string, on: boolean) => { if (on) enabledRows.push(id); },
}));

import {
  MUTATION_DONE_ROW,
  MUTATION_ETA_KEY,
  getBelledMutations,
  getMutationEtaBellState,
  setMutationBell,
  startMutationEtaBell,
  stepMutationBell,
  stopMutationEtaBell,
  type MutationBellState,
} from './mutationEtaBell';
import { QPM_STORAGE_KEYS } from '../../utils/storageKeys';

function tick(nextRemaining: Record<string, number>, nextTotal = totalFruit): void {
  remaining = nextRemaining;
  totalFruit = nextTotal;
  gardenCb?.();
}

beforeEach(() => {
  stopMutationEtaBell();
  mem.clear();
  raised.length = 0;
  rows.length = 0;
  defs.length = 0;
  enabledRows.length = 0;
  remaining = {};
  totalFruit = 10;
});

describe('stepMutationBell', () => {
  it('treats the first value as a baseline, even at 0', () => {
    const s: MutationBellState = { remaining: null, totalFruit: 0 };
    expect(stepMutationBell(s, 0, 10)).toBe(false);
    expect(s).toEqual({ remaining: 0, totalFruit: 10 });
  });

  it('fires once on the >0 → 0 edge and re-arms above 0', () => {
    const s: MutationBellState = { remaining: null, totalFruit: 0 };
    stepMutationBell(s, 2, 10);
    expect(stepMutationBell(s, 0, 10)).toBe(true);
    expect(stepMutationBell(s, 0, 10)).toBe(false);
    expect(stepMutationBell(s, 1, 11)).toBe(false);
    expect(stepMutationBell(s, 0, 11)).toBe(true);
  });

  it('PD2: a drop to 0 that takes fruit out of the garden (harvest) stays silent', () => {
    const s: MutationBellState = { remaining: null, totalFruit: 0 };
    stepMutationBell(s, 1, 10);
    expect(stepMutationBell(s, 0, 9)).toBe(false);
  });
});

describe('mutation done service', () => {
  it('rings a belled mutation through the hub row, with its icon', () => {
    setMutationBell('Rainbow', true);
    startMutationEtaBell();
    expect(rows).toContain(MUTATION_DONE_ROW);
    tick({ Rainbow: 1 });
    tick({ Rainbow: 0 });
    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({ row: MUTATION_DONE_ROW, cardKey: 'mutationDone:Rainbow', iconUrl: 'data:sprite/ui/MutationRainbow' });
    tick({ Rainbow: 0 });
    expect(raised).toHaveLength(1);
  });

  it('a solid-colour mutation sends its catalog colour as accent and a mutation chip; a gradient one sends neither colour', () => {
    setMutationBell('Frozen', true);
    setMutationBell('Rainbow', true);
    startMutationEtaBell();
    tick({ Frozen: 1, Rainbow: 1 });
    tick({ Frozen: 0, Rainbow: 0 });
    const frozen = raised.find((r) => r.cardKey === 'mutationDone:Frozen');
    const rainbow = raised.find((r) => r.cardKey === 'mutationDone:Rainbow');
    expect(frozen?.accent).toBe('#c-Frozen');
    expect(frozen?.chips).toEqual([{ text: 'Frozen', color: '#c-Frozen', iconUrl: 'data:sprite/ui/MutationFrozen' }]);
    expect(rainbow).not.toHaveProperty('accent');
    expect(rainbow?.chips).toEqual([{ text: 'Rainbow', iconUrl: 'data:sprite/ui/MutationRainbow' }]);
  });

  it('row follows the bells: first belled icon and colour, a list summary, none when empty', () => {
    startMutationEtaBell();
    const def = defs[0];
    expect([def?.icon?.(), def?.summary?.(), def?.accent?.()]).toEqual([null, 'feature.mutationEta.bellSummaryNone', null]);
    setMutationBell('Wet', true);
    setMutationBell('Gold', true);
    expect([def?.icon?.(), def?.summary?.(), def?.accent?.()]).toEqual([
      'data:sprite/ui/MutationWet',
      'feature.mutationEta.bellSummary:{"list":"Wet, Gold"}',
      '#c-Wet',
    ]);
  });

  it('first value 0 after start does not ring', () => {
    setMutationBell('Gold', true);
    remaining = { Gold: 0 };
    startMutationEtaBell();
    tick({ Gold: 0 });
    expect(raised).toHaveLength(0);
  });

  it('an unbelled mutation stays silent', () => {
    setMutationBell('Rainbow', true);
    startMutationEtaBell();
    tick({ Rainbow: 3, Gold: 2 });
    tick({ Rainbow: 3, Gold: 0 });
    expect(raised).toHaveLength(0);
  });

  it('a harvest to 0 stays silent (PD2)', () => {
    setMutationBell('Rainbow', true);
    startMutationEtaBell();
    tick({ Rainbow: 1 }, 10);
    tick({ Rainbow: 0 }, 9);
    expect(raised).toHaveLength(0);
  });

  it('bell on switches the centre row on; bell off keeps the other bells', () => {
    setMutationBell('Rainbow', true);
    setMutationBell('Gold', true);
    expect(enabledRows).toEqual([MUTATION_DONE_ROW, MUTATION_DONE_ROW]);
    setMutationBell('Rainbow', false);
    expect(getBelledMutations()).toEqual(['Gold']);
    expect(mem.get(MUTATION_ETA_KEY)).toEqual({ bells: { Gold: true } });
  });

  it('start and stop are idempotent', () => {
    startMutationEtaBell();
    startMutationEtaBell();
    expect(gardenSubs).toBe(1);
    stopMutationEtaBell();
    stopMutationEtaBell();
    expect(gardenSubs).toBe(0);
    expect(getMutationEtaBellState().started).toBe(false);
  });

  it('the key is registered', () => {
    expect(QPM_STORAGE_KEYS).toContain(MUTATION_ETA_KEY);
  });
});
