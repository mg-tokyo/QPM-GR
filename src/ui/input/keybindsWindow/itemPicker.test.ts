// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  bag: [] as unknown[],
  fireBag: (() => {}) as () => void,
}));

vi.mock('../../../utils/storage', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../utils/storage')>(),
  storage: {
    get: (k: string, fallback: unknown) => (state.store.has(k) ? state.store.get(k) : fallback),
    set: (k: string, v: unknown) => { state.store.set(k, JSON.parse(JSON.stringify(v))); },
  },
}));
vi.mock('../../../catalogs/gameCatalogs', () => {
  const plants: Record<string, { seed: { name: string; sprite: string } }> = {
    Leek: { seed: { name: 'Leek Seed', sprite: 'sprite/seed/Leek' } },
    Carrot: { seed: { name: 'Carrot Seed', sprite: 'sprite/seed/Carrot' } },
  };
  const eggs: Record<string, { name: string }> = { SnowEgg: { name: 'Snow Egg' } };
  const decor: Record<string, { name: string; art: string }> = { HayBale: { name: 'Hay Bale', art: 'sprite/decor/HayBale' } };
  return {
    getAllPlantSpecies: () => Object.keys(plants), getPlantSpecies: (id: string) => plants[id] ?? null,
    getAllEggTypes: () => Object.keys(eggs), getEggType: (id: string) => eggs[id] ?? null,
    getAllDecor: () => Object.keys(decor), getDecor: (id: string) => decor[id] ?? null,
  };
});
vi.mock('../../../store/inventory', () => ({
  getInventoryItems: () => state.bag.map(raw => ({ raw })),
  onInventoryChange: (cb: () => void) => { state.fireBag = cb; return () => { state.fireBag = () => {}; }; },
}));
vi.mock('../../../features/input/selectItem', async () =>
  vi.importActual<typeof import('../../../features/input/selectItem/myItems')>('../../../features/input/selectItem/myItems'));
vi.mock('../../../utils/game/catalogHelpers', () => ({ onCatalogsReady: (cb: () => void) => { cb(); return () => {}; } }));
vi.mock('../../../i18n', () => ({ t: (key: string, p?: Record<string, unknown>) => (p ? `${key} ${JSON.stringify(p)}` : key) }));
vi.mock('../../../sprite-v2/compat', () => ({
  isSpritesReady: () => true,
  getAnySpriteDataUrl: (k: string) => (k === 'sprite/seed/Leek' ? 'data:leek' : ''),
  onSpritesReady: () => () => {},
}));
vi.mock('../../../features/alertHub', () => ({
  resolveRowIcon: (d: { icon?: () => string | null } | null) => d?.icon?.() ?? null,
  resolveRowSummary: (d: { summary?: () => string } | null) => d?.summary?.() ?? null,
  resolveRowAccent: () => null,
}));
vi.mock('../../shop/restockAlerts/soundConfig', () => ({ BUILTIN_SOUNDS: [], getCustomSounds: () => ({}) }));
vi.mock('../../shop/restockAlerts/soundEngine', () => ({ previewSound: vi.fn() }));
vi.mock('../../../features/pets/optimizer', () => ({ calculatePetScore: () => 0 }));
vi.mock('../../../store/xpTracker', () => ({ calculateMaxStrength: () => null }));
vi.mock('../../../features/pets/data/petAbilities', () => ({ getAbilityDefinition: () => null }));
vi.mock('../../core/modalWindow', () => ({ openWindow: vi.fn(), closeWindow: vi.fn(), destroyWindow: vi.fn(), isWindowOpen: () => false }));

const { renderItemPicker } = await import('./itemPicker');

const row = (root: HTMLElement, key: string): HTMLElement => root.querySelector<HTMLElement>(`[data-qpm-item-picker-row="${key}"]`)!;
const visible = (root: HTMLElement): string[] =>
  [...root.querySelectorAll<HTMLElement>('[data-qpm-item-picker-row]')].filter(r => r.style.display !== 'none').map(r => r.dataset.qpmItemPickerRow ?? '');
const switchOf = (scope: HTMLElement): HTMLElement => scope.querySelector<HTMLElement>('[role="switch"]')!;
const sectionCard = (root: HTMLElement, kind: string): HTMLElement =>
  root.querySelector<HTMLElement>(`[data-qpm-item-picker-section="${kind}"]`)!.parentElement!;
const inBagTag = (r: HTMLElement): boolean => (r.lastElementChild as HTMLElement).style.display !== 'none';
const typeSearch = (root: HTMLElement, text: string): void => {
  const input = root.querySelector<HTMLInputElement>('input')!;
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  vi.advanceTimersByTime(300);
};

function mount(): { root: HTMLElement; destroy: () => void } {
  const root = document.createElement('div');
  document.body.append(root);
  return { root, destroy: renderItemPicker(root) };
}

beforeEach(() => {
  vi.useFakeTimers();
  state.store.clear();
  state.bag = [];
  document.body.replaceChildren();
});

describe('item picker (INP-4.4)', () => {
  it('lists seeds, eggs and decor from the catalogs, sorted by name, with sprites when known', () => {
    const { root } = mount();
    expect(visible(root)).toEqual(['seed:Carrot', 'seed:Leek', 'egg:SnowEgg', 'decor:HayBale']);
    expect(row(root, 'seed:Leek').querySelector('img')?.getAttribute('src')).toBe('data:leek');
  });

  it('search filters rows and hides empty sections', () => {
    const { root } = mount();
    typeSearch(root, 'hay');
    expect(visible(root)).toEqual(['decor:HayBale']);
    expect(sectionCard(root, 'seed').style.display).toBe('none');
    typeSearch(root, 'zzz');
    expect(visible(root)).toEqual([]);
    expect(root.textContent).toContain('feature.keybinds.picker.noMatch');
  });

  it('ticking saves the item, unticking removes it, and a reopened picker shows the saved choice', () => {
    const first = mount();
    switchOf(row(first.root, 'egg:SnowEgg')).click();
    switchOf(row(first.root, 'seed:Leek')).click();
    switchOf(row(first.root, 'seed:Leek')).click();
    expect(state.store.get('qpm.keybinds.myItems.v1')).toEqual({ items: [{ kind: 'egg', id: 'SnowEgg' }] });
    first.destroy();
    const second = mount();
    expect(switchOf(row(second.root, 'egg:SnowEgg')).getAttribute('aria-checked')).toBe('true');
    expect(switchOf(row(second.root, 'seed:Leek')).getAttribute('aria-checked')).toBe('false');
  });

  it('"Only items in my bag" shows bag items with the In bag tag and follows bag changes', () => {
    state.bag = [{ itemType: 'Seed', species: 'Leek', quantity: 2 }];
    const { root } = mount();
    expect(inBagTag(row(root, 'seed:Leek'))).toBe(true);
    expect(inBagTag(row(root, 'seed:Carrot'))).toBe(false);
    switchOf(root.querySelector<HTMLElement>('[data-qpm-item-picker-owned-only]')!).click();
    expect(visible(root)).toEqual(['seed:Leek']);
    state.bag = [...state.bag, { itemType: 'Decor', decorId: 'HayBale', quantity: 1 }];
    state.fireBag();
    expect(visible(root)).toEqual(['seed:Leek', 'decor:HayBale']);
  });
});
