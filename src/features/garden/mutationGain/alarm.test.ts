import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MutationGain } from './diff';

const store = new Map<string, unknown>();
vi.mock('../../../utils/storage', () => ({
  storage: {
    get: (k: string, d: unknown) => (store.has(k) ? store.get(k) : d),
    set: (k: string, v: unknown) => { store.set(k, v); },
  },
}));
vi.mock('../../../sprite-v2/compat', () => ({
  isSpritesReady: () => true,
  getCropSpriteDataUrlWithMutations: (s: string, m: string[]) => `data:${s}+${m.join(',')}`,
  getAnySpriteDataUrl: (k: string | undefined) => (k ? `data:${k}` : ''),
}));
let catalogMutations = ['Gold', 'Rainbow', 'Frozen'];
vi.mock('../../../utils/game/catalogHelpers', () => ({
  getPlantSafe: (s: string) => ({ crop: { name: `${s} Crop` } }),
  getMutationsSafe: () => catalogMutations,
  getMutationName: (m: string) => `${m}!`,
}));
vi.mock('../../mutations/data/variantBadges', () => ({
  findVariantBadge: (m: string) => (m === 'Rainbow' ? { iconKey: `icon/${m}`, gradient: 'g' } : { iconKey: `icon/${m}`, color: `c-${m}` }),
}));
const overrides: Array<string[] | null> = [];
vi.mock('../filters', () => ({ setStatsHubTileOverride: (k: string[] | null) => { overrides.push(k); } }));
const pans: string[] = [];
let panReleases = 0;
vi.mock('./pan', () => ({
  panToTile: (k: string) => { pans.push(k); return true; },
  releasePan: () => { panReleases += 1; },
  getPanState: () => ({ active: false, point: null, lastSkip: null }),
}));

interface Action { label: string; onClick: () => void; keepOpen?: boolean }
interface Card {
  rowId: string; title: string; body?: string; accent?: string; chips?: unknown; figure?: unknown; iconUrl?: string;
  actions: Action[]; patches: Array<{ body?: string; figure?: unknown }>; close: () => void;
}
const cards: Card[] = [];
const open = new Map<string, Card>();
let rowOn = true;
let raises = 0;
vi.mock('../../alertHub', () => ({
  registerAlertRow: () => undefined,
  isAlertCardOpen: (key: string) => open.has(key),
  raiseAlert: (rowId: string, p: Omit<Card, 'rowId' | 'patches' | 'close'> & { cardKey: string }, opts: { onClose?: () => void } = {}) => {
    if (!rowOn) return null;
    raises += 1;
    const card: Card = {
      rowId, ...p, patches: [],
      close: () => { open.delete(p.cardKey); opts.onClose?.(); },
    };
    cards.push(card);
    open.set(p.cardKey, card);
    return { update: (patch: { body?: string; figure?: unknown }) => { card.patches.push(patch); }, close: card.close };
  },
}));

const { startMutationGainAlarm, stopMutationGainAlarm, onMutationGains, getWatchedMutations, setWatchedMutations, getMutationGainAlarmState, MUTATION_GAIN_ROW } = await import('./alarm');

const gain = (tile: number, mutation = 'Gold', species = 'Lily', slotId = 0): MutationGain => ({
  mutation, tileKey: `g:${tile}`, slotId, species, mutations: [mutation],
});
const lastPatch = (c: Card | undefined): { body?: string; figure?: unknown } | undefined => c?.patches[c.patches.length - 1];

describe('mutation gained alarm (ALR-6.2)', () => {
  beforeEach(() => {
    stopMutationGainAlarm();
    cards.length = 0;
    open.clear();
    store.clear();
    overrides.length = 0;
    pans.length = 0;
    panReleases = 0;
    rowOn = true;
    raises = 0;
    catalogMutations = ['Gold', 'Rainbow', 'Frozen'];
    startMutationGainAlarm();
  });

  it('defaults to Gold and Rainbow when the catalog lists them, none without a catalog; a stored pick wins', () => {
    expect(getWatchedMutations()).toEqual(['Gold', 'Rainbow']);
    catalogMutations = ['Gold'];
    expect(getWatchedMutations()).toEqual(['Gold']);
    catalogMutations = [];
    expect(getWatchedMutations()).toEqual([]);
    setWatchedMutations(['Frozen', 'Frozen']);
    expect(getWatchedMutations()).toEqual(['Frozen']);
  });

  it('an unwatched mutation raises nothing', () => {
    onMutationGains([gain(1, 'Frozen')]);
    expect(cards).toHaveLength(0);
  });

  it('one card per mutation; one crop names crop and tile; accent, chip and figure from the catalog', () => {
    onMutationGains([gain(109), gain(2, 'Rainbow')]);
    expect(cards.map((c) => c.title)).toEqual(['Gold! gained', 'Rainbow! gained']);
    const [gold, rainbow] = cards;
    expect(gold).toMatchObject({ rowId: MUTATION_GAIN_ROW, body: 'Lily Crop on tile 109', accent: 'c-Gold', iconUrl: 'data:Lily+Gold', figure: { value: '1', label: 'Crops' } });
    expect(gold?.chips).toEqual([{ text: 'Gold!', color: 'c-Gold', iconUrl: 'data:icon/Gold' }]);
    expect(rainbow?.accent).toBeUndefined();
    expect(gold?.actions.map((a) => [a.label, a.keepOpen])).toEqual([['Show', true], ['Next', true]]);
  });

  it('an open card keeps counting in place with no new raise (PD1, sound once per card)', () => {
    onMutationGains([gain(1)]);
    onMutationGains([gain(2, 'Gold', 'Tulip'), gain(3, 'Gold', 'Tulip'), gain(1)]);
    expect(raises).toBe(1);
    expect(lastPatch(cards[0])).toMatchObject({ body: 'Lily Crop · Tulip Crop ×2', figure: { value: '3', label: 'Crops' } });
  });

  it('a closed card starts the next gain fresh with a new raise', () => {
    onMutationGains([gain(1), gain(2)]);
    cards[0]?.close();
    onMutationGains([gain(3)]);
    expect(raises).toBe(2);
    expect(cards[1]?.figure).toEqual({ value: '1', label: 'Crops' });
  });

  it('row off: no card and no state kept', () => {
    rowOn = false;
    onMutationGains([gain(1)]);
    expect(getMutationGainAlarmState().cards).toEqual({});
  });

  it('Show spotlights the first crop, Next cycles; the body names the shown crop', () => {
    onMutationGains([gain(1), gain(2, 'Gold', 'Tulip')]);
    const [show, next] = cards[0]?.actions ?? [];
    show?.onClick();
    expect(overrides).toEqual([['g:1']]);
    expect(lastPatch(cards[0])?.body).toBe('1 of 2: Lily Crop on tile 1');
    next?.onClick();
    next?.onClick();
    expect(overrides).toEqual([['g:1'], ['g:2'], ['g:1']]);
    expect(getMutationGainAlarmState().spotlit).toBe('Gold');
  });

  it('closing the card releases its spotlight; another card closing leaves it', () => {
    onMutationGains([gain(1), gain(2, 'Rainbow')]);
    cards[0]?.actions[0]?.onClick();
    cards[1]?.close();
    expect(overrides).toEqual([['g:1']]);
    cards[0]?.close();
    expect(overrides).toEqual([['g:1'], null]);
    expect(getMutationGainAlarmState().spotlit).toBeNull();
  });

  it('Show and Next pan to the shown tile; closing the card releases the pan (ALR-6.3)', () => {
    onMutationGains([gain(1), gain(2, 'Gold', 'Tulip')]);
    const [show, next] = cards[0]?.actions ?? [];
    show?.onClick();
    next?.onClick();
    expect(pans).toEqual(['g:1', 'g:2']);
    expect(panReleases).toBe(0);
    cards[0]?.close();
    expect(panReleases).toBe(1);
  });

  it('stop releases the spotlight and ignores later gains', () => {
    onMutationGains([gain(1)]);
    cards[0]?.actions[1]?.onClick();
    stopMutationGainAlarm();
    expect(overrides).toEqual([['g:1'], null]);
    onMutationGains([gain(5)]);
    expect(cards).toHaveLength(1);
  });
});
