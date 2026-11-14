import { describe, expect, it } from 'vitest';
import { FIXTURE_IDENTITY, FIXTURE_SNAPSHOT } from './__fixtures__/snapshot';
import { GAME_STATE_KEYS, validateKeyTable, type GameStateKey } from './index';
import { selectMyData } from './selectors';
import type { AtomSourceSpec, SourceSpec, StateTreeSourceSpec } from '../types';

const stateRung = (key: GameStateKey): StateTreeSourceSpec<unknown> | undefined => {
  const sources = GAME_STATE_KEYS[key].sources as readonly SourceSpec<unknown>[];
  return sources.find((s): s is StateTreeSourceSpec<unknown> => s.kind === 'stateTree');
};
const sel = (key: GameStateKey): unknown => stateRung(key)!.select(FIXTURE_SNAPSHOT, FIXTURE_IDENTITY);

describe('key table', () => {
  it('has a valid ladder for every key', () => { expect(validateKeyTable()).toEqual([]); });
  it('every server-owned key resolves against the fixture', () => {
    expect(sel('coinsBalance')).toBe(10);
    expect(sel('magicDustBalance')).toBe(5);
    expect(sel('riddenPetId')).toBe('pet1');
    expect(sel('myUserSlotIdx')).toBe(1);
    expect((sel('cropInventory') as unknown[]).length).toBe(1);
    expect((sel('hutchPets') as unknown[]).length).toBe(2);
    expect(sel('hutchCapacity')).toBe(100);
    expect((sel('decorShedItems') as unknown[]).length).toBe(2);
    expect(sel('toolShackCapacity')).toBe(25);
    expect(sel('feedingTroughItems')).toEqual([{ id: 'f1', itemType: 'Produce' }]);
    expect(sel('feedingTroughCapacity')).toBe(9);
    expect(sel('weather')).toBeNull();
    expect(sel('weatherWindow')).toBeNull();
    expect((sel('weatherForecast') as { weatherId: string | null }[]).map((e) => e.weatherId)).toEqual([null, 'Rain']);
    expect(sel('shops')).toBeTruthy();
    expect(sel('eggShop')).toBeNull();
    expect(sel('petSlotInfos')).toEqual({ pet1: { motion: { kind: 'idle' } } });
    expect((sel('players') as unknown[]).length).toBe(1);
    expect(sel('seatPetSlots')).toEqual([null, [{ id: 'pet1' }]]);
    expect(sel('serverTime')).toBe(1794116408575);
  });
  it('shopPurchases atom rung projects the same value as the state rung', () => {
    const atom = (GAME_STATE_KEYS.shopPurchases.sources as readonly SourceSpec<unknown>[])
      .find((s): s is AtomSourceSpec<unknown> => s.kind === 'atom')!;
    expect(atom.label.test('myDataAtom')).toBe(true);
    expect(atom.requiresSeat).toBe(true);
    expect(sel('shopPurchases')).toEqual({ seed: {} });
    expect(atom.project!(selectMyData(FIXTURE_SNAPSHOT, FIXTURE_IDENTITY))).toEqual(sel('shopPurchases'));
    expect(atom.project!({ coinsCount: 1 })).toBeNull();
    expect(atom.project!(null)).toBeUndefined();
  });
  it('troughFedPetIds reads the game Set as an id list, seat required', () => {
    const atom = (GAME_STATE_KEYS.troughFedPetIds.sources as readonly SourceSpec<unknown>[])
      .find((s): s is AtomSourceSpec<unknown> => s.kind === 'atom')!;
    expect(atom.label.test('myAuthoritativeTroughFedPetIdsAtom')).toBe(true);
    expect(atom.requiresSeat).toBe(true);
    expect(atom.project!(new Set(['a', 'b']))).toEqual(['a', 'b']);
    expect(atom.project!(new Set())).toEqual([]);
    expect(atom.project!(null)).toBeUndefined();
    expect(atom.project!('a')).toBeUndefined();
  });
  it('quinoaToasts: room-scope toasts first, label second, arrays only', () => {
    const atoms = (GAME_STATE_KEYS.quinoaToasts.sources as readonly SourceSpec<unknown>[])
      .filter((s): s is AtomSourceSpec<unknown> => s.kind === 'atom');
    expect(atoms.map((a) => [a.label.source, a.via ?? null, a.writable === true])).toEqual([
      ['^currentRoomAtom$', 'toasts', true],
      ['^quinoaToastsAtom$', null, true],
    ]);
    expect(atoms[0]!.structure!([])).toBe(true);
    expect(atoms[0]!.structure!({})).toBe(false);
  });
  it('roomScopeId projects the scope uuid, unavailable without one', () => {
    const atom = (GAME_STATE_KEYS.roomScopeId.sources as readonly SourceSpec<unknown>[])
      .find((s): s is AtomSourceSpec<unknown> => s.kind === 'atom')!;
    expect(atom.label.test('currentRoomAtom')).toBe(true);
    expect(atom.project!({ id: 'r1', toasts: {} })).toBe('r1');
    expect(atom.project!({ toasts: {} })).toBeUndefined();
    expect(atom.project!(null)).toBeUndefined();
  });
  it('trough keys: no trough storage => [] and null', () => {
    const noTrough = structuredClone(FIXTURE_SNAPSHOT) as typeof FIXTURE_SNAPSHOT;
    const inv = selectMyData(noTrough, FIXTURE_IDENTITY)!.inventory!;
    inv.storages = (inv.storages ?? []).filter((s) => s.decorId !== 'FeedingTrough');
    expect(stateRung('feedingTroughItems')!.select(noTrough, FIXTURE_IDENTITY)).toEqual([]);
    expect(stateRung('feedingTroughCapacity')!.select(noTrough, FIXTURE_IDENTITY)).toBeNull();
  });
  it('serverTime is unavailable without a room clock', () => {
    const noClock = { ...FIXTURE_SNAPSHOT, child: { scope: 'Quinoa', data: { shops: {} } } };
    expect(stateRung('serverTime')!.select(noClock, FIXTURE_IDENTITY)).toBeUndefined();
    expect(stateRung('serverTime')!.select({ ...FIXTURE_SNAPSHOT, child: null }, FIXTURE_IDENTITY)).toBeUndefined();
  });
  it('returns undefined (unavailable), not null, when identity is unresolved', () => {
    for (const key of ['coinsBalance', 'inventory', 'hutchPets', 'myData', 'riddenPetId'] as const) {
      expect(stateRung(key)!.select(FIXTURE_SNAPSHOT, { playerId: null, myIdx: null })).toBeUndefined();
    }
  });
  it('keeps the legacy key names the barrel re-exports', () => {
    const legacy: GameStateKey[] = ['weather', 'shops', 'seedShop', 'eggShop', 'toolShop', 'decorShop', 'coinsBalance', 'creditsBalance',
      'magicDustBalance', 'player', 'state', 'position', 'localPosition', 'userSlots', 'myUserSlotIdx', 'myUserSlot', 'quinoaData',
      'activePetSlots', 'petInventory', 'hutchPets', 'hutchCapacity', 'petHutch', 'seedSiloItems', 'seedSiloCapacity', 'decorShedItems',
      'decorShedCapacity', 'inventory', 'cropInventory', 'toolInventory', 'selectedItemId', 'myData', 'map', 'dirtTileIndex', 'gardenObject',
      'ownGardenObject', 'gardenTile', 'activeModal', 'selectedSlotId', 'riddenPetId', 'action'];
    for (const k of legacy) expect(GAME_STATE_KEYS[k]).toBeDefined();
  });
});
