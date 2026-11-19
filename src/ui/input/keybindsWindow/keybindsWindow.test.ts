// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KeybindAction, KeybindRegistry } from '../../../features/input/keybinds/types';

const binds: Record<string, string> = {};
let shopKeysOn = true;
function fakeAction(id: string, section: KeybindAction['section'], extra: Partial<KeybindAction> = {}): KeybindAction {
  return {
    id, section, canUnbind: extra.canUnbind ?? true,
    read: () => binds[id] ?? '',
    holds: (c) => c !== '' && binds[id] === c,
    set: (c) => { binds[id] = c; },
    clear: () => { binds[id] = extra.canUnbind === false ? 'alt+q' : ''; },
    ...extra,
  };
}
const actions = (): KeybindAction[] => [
  fakeAction('panel', 'general', { canUnbind: false }),
  fakeAction('window:xpTracker', 'windows'),
  fakeAction('shop:seedShop', 'shops'),
  fakeAction('bag', 'gamePanels'),
  fakeAction('panel:seedSilo', 'gamePanels', { panelId: 'seedSilo' }),
  fakeAction('tool:Shovel', 'tools'),
  fakeAction('tool:CarvingKnife', 'tools'),
  ...myList.map(i => fakeAction(`item:${i.kind}:${i.id}`, 'myItems')),
  fakeAction('team:t1', 'pets', { teamId: 't1' }),
];
type FakeItem = { kind: 'seed' | 'egg' | 'decor'; id: string };
let myList: FakeItem[] = [];
const ownedItems = new Set<string>();
const chooseCalls: Array<[FakeItem, boolean]> = [];
const itemKey = (i: FakeItem): string => `${i.kind}:${i.id}`;
let registry: KeybindRegistry;
const gameKeys: Record<string, string[]> = {};
let fireGameKeys: () => void = () => {};
const ownedTools = new Set<string>(['Shovel']);
let fireBag: () => void = () => {};
let fetchOn = true;
const stored = new Map<string, string>();
let fireStorages: () => void = () => {};

vi.mock('../../../features/input/keybinds', async () => {
  const { createKeybindRegistry } = await vi.importActual<typeof import('../../../features/input/keybinds/registry')>('../../../features/input/keybinds/registry');
  registry = createKeybindRegistry({ actions, isGameHotkey: (c) => c === 'r' });
  return {
    listKeybindActions: () => registry.list(),
    assignKeybind: (id: string, c: string) => registry.assign(id, c),
    clearKeybindAction: (id: string) => registry.clear(id),
    onKeybindsChange: (cb: () => void) => registry.onChange(cb),
    gameKeysForAction: (info: { id: string }) => gameKeys[info.id] ?? [],
    onGameKeysChange: (cb: () => void) => { fireGameKeys = cb; return () => { fireGameKeys = () => {}; }; },
    areShopKeysEnabled: () => shopKeysOn,
    setShopKeysEnabled: (on: boolean) => registry.update(() => { shopKeysOn = on; }),
    isFetchFromStorageOn: () => fetchOn,
    setFetchFromStorageOn: (on: boolean) => registry.update(() => { fetchOn = on; }),
    storagePanelLook: (id: string) => (id === 'seedSilo' ? { name: 'Seed Silo', spriteKey: 'sprite/decor/SeedSilo' }
      : id === 'ToolShack' ? { name: 'Tool Shack', spriteKey: null } : null),
    toolIdOf: (id: string) => (id.startsWith('tool:') ? id.slice(5) : null),
    toolLook: (id: string) => ({ name: id === 'Shovel' ? 'Garden Shovel' : 'Carving Knife', spriteKey: id === 'Shovel' ? 'sprite/item/Shovel' : null }),
    toolsInBag: (ids: string[]) => new Set(ids.filter(id => ownedTools.has(id))),
    onToolBagChange: (cb: () => void) => { fireBag = cb; return () => { fireBag = () => {}; }; },
    myItemOf: (id: string) => {
      const m = /^item:(seed|egg|decor):(.+)$/.exec(id);
      return m ? { kind: m[1], id: m[2] } : null;
    },
    chooseMyItem: (item: FakeItem, on: boolean) => registry.update(() => {
      chooseCalls.push([item, on]);
      if (!on) myList = myList.filter(i => itemKey(i) !== itemKey(item));
    }),
  };
});
vi.mock('../../../features/input/selectItem', () => ({
  getMyItems: () => myList,
  myItemKey: itemKey,
  myItemLook: (i: FakeItem) => ({ name: i.id === 'Leek' ? 'Leek Seed' : 'Snow Egg', spriteKey: i.id === 'Leek' ? 'sprite/seed/Leek' : null }),
  myItemsInBag: (items: FakeItem[]) => new Set(items.map(itemKey).filter(k => ownedItems.has(k))),
  onMyItemsChange: () => () => {},
  storageHolding: (target: { kind: string; id: string }) => stored.get(`${target.kind}:${target.id}`) ?? null,
  onStoragesChange: (cb: () => void) => { fireStorages = cb; return () => { fireStorages = () => {}; }; },
}));
vi.mock('../../../i18n', () => ({ t: (key: string, p?: Record<string, unknown>) => (p ? `${key} ${JSON.stringify(p)}` : key) }));
vi.mock('../../../store/petTeams', () => ({
  getTeamsConfig: () => ({ teams: [{ id: 't1', name: 'Farm', slots: ['p1', null, null] }] }),
  getAllPooledPets: () => Promise.resolve([{ id: 'p1', species: 'Bee', mutations: [] }]),
}));
vi.mock('../../../store/pets', () => ({ getActivePetInfos: () => [] }));
vi.mock('../../../sprite-v2/compat', () => ({
  isSpritesReady: () => true,
  getAnySpriteDataUrl: (k: string) => (k === 'sprite/decor/SeedSilo' ? 'data:silo' : k === 'sprite/item/Shovel' ? 'data:shovel' : ''),
  getPetSpriteDataUrlWithMutations: (s: string) => `data:${s}`,
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
const openController = vi.fn();
vi.mock('../../hub', () => ({
  getHubGroups: () => [{ id: 'config', label: 'Config', icon: { kind: 'emoji', value: 'x' }, cards: [
    { key: 'xpTracker', label: 'XP Tracker', description: '', icon: { kind: 'emoji', value: 'x' }, tier: 'launcher', renderSummary: () => {}, onOpen: () => {} },
    { key: 'controller', label: 'Controller', description: '', icon: { kind: 'emoji', value: 'x' }, tier: 'expandable', renderSummary: () => {}, renderExpanded: () => {}, onDetach: openController },
  ] }],
}));
vi.mock('../../hub/cards/iconRenderer', () => ({ cardIconUrl: () => '' }));

const { renderKeybindsWindow } = await import('./index');
const { NOTE_MS } = await import('./rows');

const row = (root: HTMLElement, id: string): HTMLElement => root.querySelector<HTMLElement>(`[data-qpm-keybind-row="${id}"]`)!;
const keyBtn = (root: HTMLElement, id: string): HTMLButtonElement => row(root, id).querySelector<HTMLButtonElement>('.qpm-keybind-input')!;
const note = (root: HTMLElement, id: string): HTMLElement => row(root, id).querySelector<HTMLElement>('.qpm-keybinds-row__note')!;
const summary = (root: HTMLElement): string => root.querySelector('.qpm-alert-centre-card__summary')?.textContent ?? '';

function record(root: HTMLElement, id: string, init: KeyboardEventInit): void {
  keyBtn(root, id).click();
  window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
}

let root: HTMLElement;
let destroy: () => void;
beforeEach(() => {
  vi.useFakeTimers();
  for (const k of Object.keys(binds)) delete binds[k];
  for (const k of Object.keys(gameKeys)) delete gameKeys[k];
  Object.assign(binds, { panel: 'alt+q', 'shop:seedShop': 'alt+s' });
  shopKeysOn = true;
  ownedTools.clear();
  ownedTools.add('Shovel');
  myList = [];
  ownedItems.clear();
  chooseCalls.length = 0;
  fetchOn = true;
  stored.clear();
  root = document.createElement('div');
  document.body.append(root);
  destroy = renderKeybindsWindow(root);
});
afterEach(() => {
  destroy();
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe('Keybinds window', () => {
  it('lists every action under its section with names, counts and sprites', () => {
    expect(summary(root)).toBe('feature.keybinds.summary {"count":8,"bound":2}');
    expect(row(root, 'panel').closest('[data-qpm-keybind-section]')?.getAttribute('data-qpm-keybind-section')).toBe('general');
    expect(row(root, 'window:xpTracker').textContent).toContain('XP Tracker');
    expect(row(root, 'panel:seedSilo').textContent).toContain('Seed Silo');
    expect(row(root, 'panel:seedSilo').querySelector('img')?.getAttribute('src')).toBe('data:silo');
    expect(row(root, 'team:t1').textContent).toContain('Farm');
    expect(keyBtn(root, 'shop:seedShop').textContent).toBe('Alt+S');
    expect(keyBtn(root, 'bag').textContent).toBe('—');
  });

  it('team rows show the team pet sprites once the pet pool loads', async () => {
    await vi.runAllTimersAsync();
    expect(row(root, 'team:t1').querySelector('img')?.getAttribute('src')).toBe('data:Bee');
  });

  it('records a key and updates the header count', () => {
    record(root, 'bag', { key: 'b', code: 'KeyB', altKey: true });
    expect(binds.bag).toBe('alt+b');
    expect(keyBtn(root, 'bag').textContent).toBe('Alt+B');
    expect(summary(root)).toBe('feature.keybinds.summary {"count":8,"bound":3}');
  });

  it('moves a held key with a note that clears after 4 s', () => {
    record(root, 'bag', { key: 's', code: 'KeyS', altKey: true });
    expect(binds.bag).toBe('alt+s');
    expect(binds['shop:seedShop']).toBe('');
    expect(keyBtn(root, 'shop:seedShop').textContent).toBe('—');
    expect(note(root, 'bag').textContent).toBe('feature.keybinds.note.moved {"key":"Alt+S","from":"feature.keybinds.row.seedShop"}');
    vi.advanceTimersByTime(NOTE_MS);
    expect(note(root, 'bag').style.display).toBe('none');
  });

  it('refuses a game key and keeps recording', () => {
    record(root, 'bag', { key: 'r', code: 'KeyR' });
    expect(binds.bag).toBeUndefined();
    expect(note(root, 'bag').textContent).toBe('feature.keybinds.note.gameKey {"key":"R"}');
    expect(keyBtn(root, 'bag').textContent).toBe('feature.petsWindow.pressKey');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', code: 'KeyJ', altKey: true, cancelable: true }));
    expect(binds.bag).toBe('alt+j');
  });

  it('refuses the panel key on another row', () => {
    record(root, 'bag', { key: 'q', code: 'KeyQ', altKey: true });
    expect(binds.bag).toBeUndefined();
    expect(note(root, 'bag').textContent).toBe('feature.keybinds.note.panelKey {"key":"Alt+Q"}');
  });

  it('× clears a key, and resets the panel key instead of emptying it', () => {
    row(root, 'shop:seedShop').querySelector<HTMLButtonElement>('button[aria-label="feature.keybinds.clear"]')!.click();
    expect(binds['shop:seedShop']).toBe('');
    expect(keyBtn(root, 'shop:seedShop').textContent).toBe('—');
    binds.panel = 'alt+w';
    row(root, 'panel').querySelector<HTMLButtonElement>('button[aria-label="hub.config.resetToDefault"]')!.click();
    expect(binds.panel).toBe('alt+q');
  });

  it('search hides rows and empty sections, and shows the empty state on no match', () => {
    const input = root.querySelector<HTMLInputElement>('input')!;
    input.value = 'silo';
    input.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(300);
    expect(row(root, 'panel:seedSilo').style.display).toBe('');
    expect(row(root, 'bag').style.display).toBe('none');
    expect(row(root, 'panel').closest<HTMLElement>('.qpm-alert-settings__section')!.style.display).toBe('none');
    input.value = 'zzz';
    input.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(300);
    expect(root.textContent).toContain('feature.keybinds.noMatch');
  });

  it('shows the game key on its row once the game code is read, and hides it again', () => {
    const gameLine = (id: string): HTMLElement => row(root, id).querySelector<HTMLElement>('[data-qpm-game-key]')!;
    expect(gameLine('bag').style.display).toBe('none');
    gameKeys.bag = ['e'];
    fireGameKeys();
    expect(gameLine('bag').textContent).toBe('feature.keybinds.gameKey {"key":"E"}');
    expect(gameLine('bag').style.display).toBe('');
    expect(gameLine('panel:seedSilo').style.display).toBe('none');
    expect(keyBtn(root, 'bag').textContent).toBe('—');
    delete gameKeys.bag;
    fireGameKeys();
    expect(gameLine('bag').style.display).toBe('none');
  });

  it('shop keys off dims the shop rows; Elsewhere opens the controller card', () => {
    root.querySelector<HTMLButtonElement>('[data-qpm-keybind-section="shops"] [role="switch"], [data-qpm-keybind-section="shops"] button')!.click();
    expect(shopKeysOn).toBe(false);
    expect(row(root, 'shop:seedShop').classList.contains('qpm-keybinds-row--off')).toBe(true);
    expect(keyBtn(root, 'shop:seedShop').disabled).toBe(true);
    [...root.querySelectorAll('button')].find(b => b.textContent === 'feature.keybinds.controller')!.click();
    expect(openController).toHaveBeenCalled();
  });

  it('tool rows sit in the Tools section; a tool not in the bag is faded with a note but stays bindable', () => {
    const dimNote = (id: string): HTMLElement => row(root, id).querySelector<HTMLElement>('[data-qpm-dim-note]')!;
    expect(row(root, 'tool:Shovel').closest('[data-qpm-keybind-section]')?.getAttribute('data-qpm-keybind-section')).toBe('tools');
    expect(row(root, 'tool:Shovel').textContent).toContain('Garden Shovel');
    expect(row(root, 'tool:Shovel').querySelector('img')?.getAttribute('src')).toBe('data:shovel');
    expect(row(root, 'tool:Shovel').classList.contains('qpm-keybinds-row--dim')).toBe(false);
    expect(dimNote('tool:Shovel').style.display).toBe('none');
    expect(row(root, 'tool:CarvingKnife').classList.contains('qpm-keybinds-row--dim')).toBe(true);
    expect(dimNote('tool:CarvingKnife').textContent).toBe('feature.keybinds.row.notInBag');
    expect(keyBtn(root, 'tool:CarvingKnife').disabled).toBe(false);
    record(root, 'tool:CarvingKnife', { key: 'k', code: 'KeyK', altKey: true });
    expect(binds['tool:CarvingKnife']).toBe('alt+k');
  });

  it('the fade follows the bag', () => {
    ownedTools.add('CarvingKnife');
    ownedTools.delete('Shovel');
    fireBag();
    expect(row(root, 'tool:CarvingKnife').classList.contains('qpm-keybinds-row--dim')).toBe(false);
    expect(row(root, 'tool:Shovel').classList.contains('qpm-keybinds-row--dim')).toBe(true);
  });

  it('chosen items get rows under My items, faded when not in the bag; only they have Remove', () => {
    const section = root.querySelector<HTMLElement>('[data-qpm-keybind-section="myItems"]')!;
    expect(section.textContent).toContain('feature.keybinds.chooseItems');
    myList = [{ kind: 'seed', id: 'Leek' }, { kind: 'egg', id: 'SnowEgg' }];
    ownedItems.add('seed:Leek');
    registry.update(() => {});
    expect(row(root, 'item:seed:Leek').closest('[data-qpm-keybind-section]')).toBe(section);
    expect(row(root, 'item:seed:Leek').textContent).toContain('Leek Seed');
    expect(row(root, 'item:seed:Leek').classList.contains('qpm-keybinds-row--dim')).toBe(false);
    expect(row(root, 'item:egg:SnowEgg').classList.contains('qpm-keybinds-row--dim')).toBe(true);
    expect(row(root, 'item:egg:SnowEgg').querySelector('[data-qpm-dim-note]')?.textContent).toBe('feature.keybinds.row.notInBag');
    expect(row(root, 'item:seed:Leek').querySelector('[data-qpm-keybind-remove]')).not.toBeNull();
    expect(row(root, 'tool:Shovel').querySelector('[data-qpm-keybind-remove]')).toBeNull();
    record(root, 'item:seed:Leek', { key: '1', code: 'Digit1', altKey: true });
    expect(binds['item:seed:Leek']).toBe('alt+1');
  });

  it('an item only in a storage stays full colour with "In <storage>"; the tag follows the storages', () => {
    const dimNote = (id: string): HTMLElement => row(root, id).querySelector<HTMLElement>('[data-qpm-dim-note]')!;
    stored.set('tool:CarvingKnife', 'ToolShack');
    fireStorages();
    expect(row(root, 'tool:CarvingKnife').classList.contains('qpm-keybinds-row--dim')).toBe(false);
    expect(dimNote('tool:CarvingKnife').textContent).toBe('feature.keybinds.row.inStorage {"storage":"Tool Shack"}');
    expect(dimNote('tool:CarvingKnife').style.display).toBe('');
    stored.clear();
    fireStorages();
    expect(row(root, 'tool:CarvingKnife').classList.contains('qpm-keybinds-row--dim')).toBe(true);
    expect(dimNote('tool:CarvingKnife').textContent).toBe('feature.keybinds.row.notInBag');
    ownedTools.add('CarvingKnife');
    stored.set('tool:CarvingKnife', 'ToolShack');
    fireBag();
    expect(dimNote('tool:CarvingKnife').style.display).toBe('none');
  });

  it('My items rows use the same storage tag', () => {
    myList = [{ kind: 'seed', id: 'Leek' }];
    stored.set('seed:Leek', 'seedSilo');
    registry.update(() => {});
    expect(row(root, 'item:seed:Leek').classList.contains('qpm-keybinds-row--dim')).toBe(false);
    expect(row(root, 'item:seed:Leek').querySelector('[data-qpm-dim-note]')?.textContent).toBe('feature.keybinds.row.inStorage {"storage":"Seed Silo"}');
  });

  it('the Tools switch turns fetching off; storage-only rows fade to "Not in your bag"', () => {
    stored.set('tool:CarvingKnife', 'ToolShack');
    fireStorages();
    const toggle = root.querySelector<HTMLElement>('[data-qpm-keybind-section="tools"] [role="switch"], [data-qpm-keybind-section="tools"] button')!;
    expect(root.querySelector('[data-qpm-keybind-section="tools"]')!.firstElementChild!.textContent).toContain('feature.keybinds.fetchFromStorage');
    toggle.click();
    expect(fetchOn).toBe(false);
    expect(row(root, 'tool:CarvingKnife').classList.contains('qpm-keybinds-row--dim')).toBe(true);
    expect(row(root, 'tool:CarvingKnife').querySelector('[data-qpm-dim-note]')?.textContent).toBe('feature.keybinds.row.notInBag');
    toggle.click();
    expect(fetchOn).toBe(true);
    expect(row(root, 'tool:CarvingKnife').classList.contains('qpm-keybinds-row--dim')).toBe(false);
  });

  it('Remove drops the row through chooseMyItem; the My items card stays while searching', () => {
    myList = [{ kind: 'seed', id: 'Leek' }];
    registry.update(() => {});
    row(root, 'item:seed:Leek').querySelector<HTMLButtonElement>('[data-qpm-keybind-remove]')!.click();
    expect(chooseCalls).toEqual([[{ kind: 'seed', id: 'Leek' }, false]]);
    expect(root.querySelector('[data-qpm-keybind-row="item:seed:Leek"]')).toBeNull();
    const input = root.querySelector<HTMLInputElement>('input')!;
    input.value = 'zzz';
    input.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(300);
    const card = root.querySelector<HTMLElement>('[data-qpm-keybind-section="myItems"]')!.closest<HTMLElement>('.qpm-alert-settings__section')!;
    expect(card.style.display).toBe('');
  });
});
