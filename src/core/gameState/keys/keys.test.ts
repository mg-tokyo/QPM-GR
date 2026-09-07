import { describe, expect, it } from 'vitest';
import { FIXTURE_IDENTITY, FIXTURE_SNAPSHOT } from './__fixtures__/snapshot';
import { GAME_STATE_KEYS, validateKeyTable, type GameStateKey } from './index';
import type { SourceSpec, StateTreeSourceSpec } from '../types';

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
    expect(sel('weather')).toBeNull();
    expect(sel('shops')).toBeTruthy();
    expect(sel('eggShop')).toBeNull();
    expect(sel('petSlotInfos')).toEqual({ pet1: { motion: { kind: 'idle' } } });
    expect((sel('players') as unknown[]).length).toBe(1);
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
