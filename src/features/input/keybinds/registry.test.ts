// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mem, sellAll, teams, panels } = vi.hoisted(() => ({
  panels: { ids: null as string[] | null, storages: null as string[] | null, listeners: new Set<() => void>() },
  mem: new Map<string, unknown>(),
  sellAll: { keybind: '' },
  teams: { ids: ['t1', 't2'], keybinds: {} as Record<string, string>, listeners: new Set<() => void>() },
}));
vi.mock('../../../utils/storage', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  storage: {
    get: (k: string, d: unknown = null) => (mem.has(k) ? structuredClone(mem.get(k)) : d),
    set: (k: string, v: unknown) => { mem.set(k, structuredClone(v)); },
  },
}));
vi.mock('../gameModal', () => ({ openGameModal: vi.fn(), toggleGameModal: vi.fn(), toggleBag: vi.fn() }));
vi.mock('../../../catalogs/logic/gamePanelsCatalog', () => ({
  getGamePanelIds: () => panels.ids,
  getStoragePanelIds: () => panels.storages,
  onGamePanelsChange: (cb: () => void) => { panels.listeners.add(cb); return () => panels.listeners.delete(cb); },
}));
vi.mock('../../../store/shopRegistry', () => ({ getWeatherShopIds: () => [], getShopWeatherKind: () => null }));
vi.mock('../../../store/weatherHub', () => ({ getWeatherSnapshot: () => ({ kind: 'sunny' }) }));
vi.mock('../../../ui/components', () => ({ showToast: vi.fn() }));
vi.mock('../../pets/instantFeed', () => ({ enqueueFeed: vi.fn() }));
vi.mock('../../../ui/hub', () => ({
  getHubGroups: () => [{ id: 'garden', cards: [{ key: 'stats', tier: 'launcher', onOpen: () => undefined }] }],
}));

vi.mock('../../pets/sellAll', () => ({
  getSellAllPetsKeybind: () => sellAll.keybind,
  setSellAllPetsKeybind: (c: string) => { sellAll.keybind = c.toLowerCase(); },
}));

vi.mock('../../../store/petTeams', () => ({
  getTeamsConfig: () => ({ teams: teams.ids.map(id => ({ id })) }),
  getKeybinds: () => ({ ...teams.keybinds }),
  setKeybind: (c: string, id: string) => { teams.keybinds[c.toLowerCase()] = id; },
  clearKeybind: (c: string) => { delete teams.keybinds[c.toLowerCase()]; },
  onTeamsChange: (cb: () => void) => { teams.listeners.add(cb); return () => teams.listeners.delete(cb); },
}));

import { buildKeybindActions, watchExternalKeybindChanges } from './adapters';
import { createKeybindRegistry, normalizeCombo } from './registry';
import { getPanelToggleKeybind } from '../panelHotkey';
import type { KeybindRegistry } from './types';

let gameAnswer: boolean | null = false;
let registry: KeybindRegistry;

const combos = (): Record<string, string> => Object.fromEntries(registry.list().map(a => [a.id, a.combo]));

beforeEach(() => {
  mem.clear();
  sellAll.keybind = '';
  teams.keybinds = { 'alt+7': 't1' };
  teams.listeners.clear();
  panels.ids = null;
  panels.storages = null;
  panels.listeners.clear();
  gameAnswer = false;
  registry = createKeybindRegistry({
    actions: buildKeybindActions,
    isGameHotkey: () => gameAnswer,
    watchExternal: watchExternalKeybindChanges,
  });
});

describe('normalizeCombo', () => {
  it('orders modifiers like normalizeKeybind and maps meta to ctrl', () => {
    expect(normalizeCombo('Shift+Alt+X')).toBe('alt+shift+x');
    expect(normalizeCombo('meta+k')).toBe('ctrl+k');
    expect(normalizeCombo(' alt+s ')).toBe('alt+s');
    expect(normalizeCombo('shift++')).toBe('shift++');
  });
  it('rejects a modifier alone or nothing', () => {
    expect(normalizeCombo('alt')).toBeNull();
    expect(normalizeCombo('ctrl+shift')).toBeNull();
    expect(normalizeCombo('')).toBeNull();
  });
});

describe('keybind registry', () => {
  it('lists every existing bind with today\'s defaults', () => {
    expect(combos()).toEqual({
      panel: 'alt+q',
      'shop:seedShop': 'alt+s', 'shop:eggShop': 'alt+e', 'shop:toolShop': 'alt+t', 'shop:decorShop': 'alt+d',
      'window:stats': '', bag: '', multiStorage: '', multiStorageReset: '', multiShop: '', multiShopReset: '', teamNext: '', teamPrev: '',
      'feed:0': 'alt+1', 'feed:1': 'alt+2', 'feed:2': 'alt+3',
      'team:t1': 'alt+7', 'team:t2': '',
      sellAll: '',
    });
    expect(registry.list().find(a => a.id === 'team:t1')?.teamId).toBe('t1');
    expect(registry.list().find(a => a.id === 'panel')?.canUnbind).toBe(false);
  });

  it('moves a shop key to the panel and leaves the shop with no key (not its default)', () => {
    expect(registry.assign('panel', 'alt+s')).toEqual({ ok: true, combo: 'alt+s', movedFrom: ['shop:seedShop'], gameKeysUnread: false });
    expect(getPanelToggleKeybind()).toBe('alt+s');
    expect(combos()['shop:seedShop']).toBe('');
    expect(combos()['shop:eggShop']).toBe('alt+e');
  });

  it('moves between shops and between feed slots without restoring defaults', () => {
    registry.assign('shop:eggShop', 'alt+s');
    expect(combos()['shop:seedShop']).toBe('');
    expect(combos()['shop:eggShop']).toBe('alt+s');
    registry.assign('feed:2', 'alt+1');
    expect(combos()['feed:0']).toBe('');
    expect(combos()['feed:2']).toBe('alt+1');
  });

  it('clears a team combo when another action takes it', () => {
    const r = registry.assign('sellAll', 'alt+7');
    expect(r).toMatchObject({ ok: true, movedFrom: ['team:t1'] });
    expect(teams.keybinds).toEqual({});
    expect(sellAll.keybind).toBe('alt+7');
    registry.assign('team:t2', 'alt+7');
    expect(teams.keybinds).toEqual({ 'alt+7': 't2' });
    expect(sellAll.keybind).toBe('');
  });

  it('gives a team one combo at a time', () => {
    registry.assign('team:t1', 'alt+8');
    expect(teams.keybinds).toEqual({ 'alt+8': 't1' });
  });

  it('refuses game keys, a modifier alone, unknown actions and the panel key; writes nothing', () => {
    gameAnswer = true;
    expect(registry.assign('shop:seedShop', 'r')).toEqual({ ok: false, reason: 'gameKey' });
    gameAnswer = false;
    expect(registry.assign('shop:seedShop', 'alt')).toEqual({ ok: false, reason: 'invalidCombo' });
    expect(registry.assign('nope', 'alt+x')).toEqual({ ok: false, reason: 'unknownAction' });
    expect(registry.assign('shop:seedShop', 'alt+q')).toEqual({ ok: false, reason: 'panelKey', heldBy: 'panel' });
    expect(mem.size).toBe(0);
    expect(combos()['shop:seedShop']).toBe('alt+s');
  });

  it('allows a key with a may-clash flag while the game keys are unread', () => {
    gameAnswer = null;
    expect(registry.assign('sellAll', 'x')).toEqual({ ok: true, combo: 'x', movedFrom: [], gameKeysUnread: true });
  });

  it('clear unbinds, except the panel which returns to Alt+Q', () => {
    registry.assign('panel', 'alt+p');
    registry.clear('panel');
    expect(getPanelToggleKeybind()).toBe('alt+q');
    registry.clear('feed:1');
    expect(combos()['feed:1']).toBe('');
    expect(registry.clear('nope')).toBe(false);
  });

  it('writes only the features\' own storage keys', () => {
    registry.assign('panel', 'alt+s');
    registry.assign('feed:0', 'alt+e');
    registry.clear('shop:toolShop');
    registry.update(() => undefined);
    expect([...mem.keys()].sort()).toEqual(['qpm.feed-keybinds.v1', 'qpm.panelHotkey.v1', 'qpm.shop-keybinds.v1']);
  });

  it('fires one change per write, forwards outside team changes, and stops watching when unsubscribed', () => {
    const cb = vi.fn();
    const off = registry.onChange(cb);
    expect(cb).not.toHaveBeenCalled();
    registry.assign('panel', 'alt+s');
    expect(cb).toHaveBeenCalledTimes(1);
    for (const l of teams.listeners) l();
    expect(cb).toHaveBeenCalledTimes(2);
    registry.assign('team:t2', 'alt+9');
    expect(cb).toHaveBeenCalledTimes(3);
    off();
    expect(teams.listeners.size).toBe(0);
  });

  it('lists game panel actions unbound once the game list is read, and forwards the list arriving', () => {
    const cb = vi.fn();
    const off = registry.onChange(cb);
    panels.ids = ['seedSilo', 'journal', 'rainShop'];
    panels.storages = ['seedSilo'];
    for (const l of panels.listeners) l();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(combos()).toMatchObject({ bag: '', 'panel:seedSilo': '', 'panel:journal': '', weatherShop: '' });
    expect(registry.list().find(a => a.id === 'panel:seedSilo')).toMatchObject({ section: 'gamePanels', panelId: 'seedSilo' });
    off();
    expect(panels.listeners.size).toBe(0);
  });

  it('moves keys between game panel actions and existing binds, saving new actions under one key', () => {
    panels.ids = ['seedSilo', 'journal'];
    panels.storages = ['seedSilo'];
    expect(registry.assign('panel:seedSilo', 'alt+s')).toMatchObject({ ok: true, movedFrom: ['shop:seedShop'] });
    expect(combos()['shop:seedShop']).toBe('');
    expect(registry.assign('panel:journal', 'alt+s')).toMatchObject({ ok: true, movedFrom: ['panel:seedSilo'] });
    expect(combos()).toMatchObject({ 'panel:seedSilo': '', 'panel:journal': 'alt+s' });
    expect(mem.get('qpm.keybinds.actions.v1')).toEqual({ binds: { 'panel:journal': 'alt+s' } });
    registry.assign('sellAll', 'alt+s');
    expect(combos()['panel:journal']).toBe('');
    expect(mem.get('qpm.keybinds.actions.v1')).toEqual({ binds: {} });
  });

  it('lists QPM window actions unbound and saves their keys with the other new actions', () => {
    expect(registry.list().find(a => a.id === 'window:stats')).toMatchObject({ section: 'windows', combo: '' });
    expect(registry.assign('window:stats', 'alt+e')).toMatchObject({ ok: true, movedFrom: ['shop:eggShop'] });
    expect(mem.get('qpm.keybinds.actions.v1')).toEqual({ binds: { 'window:stats': 'alt+e' } });
    expect(registry.clear('window:stats')).toBe(true);
    expect(combos()['window:stats']).toBe('');
  });
});
