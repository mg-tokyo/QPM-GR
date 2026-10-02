import { describe, expect, it } from 'vitest';
import { hasNpcSpawn, isCompanionActive, resolveSpeaker } from './speakers';

const map = {
  npcSpawns: { Reina: 3177, Juniper: 2899, Wade: 3082 },
  locations: {
    weatherStation: { spawnTileIdx: [3177], activationTilesIdxs: [3176, 3177] },
    preservationStation: { spawnTileIdx: [], activationTilesIdxs: [2899] },
    weatherShop: { spawnTileIdx: [3082], activationTilesIdxs: [3082] },
    seedShop: { spawnTileIdx: [3069], activationTilesIdxs: [3069] },
  },
};

describe('resolveSpeaker', () => {
  it('themes a native NPC by the location containing its spawn tile', () => {
    expect(resolveSpeaker('NPC_Reina', map, { NPC_Reina: 3177 }, false)).toEqual({ npcId: 'NPC_Reina', role: 'native', locationKey: 'weatherStation', voice: 'station' });
    expect(resolveSpeaker('NPC_Juniper', map, { NPC_Juniper: 2899 }, false).voice).toBe('preserve');
    expect(resolveSpeaker('NPC_Wade', map, { NPC_Wade: 3082 }, false).voice).toBe('trader');
  });
  it('treats a displaced NPC as the companion only when Aries is installed', () => {
    expect(resolveSpeaker('NPC_Wade', map, { NPC_Wade: 1234 }, true)).toEqual({ npcId: 'NPC_Wade', role: 'companion', locationKey: null, voice: 'neutral' });
    expect(resolveSpeaker('NPC_Wade', map, { NPC_Wade: 1234 }, false).role).toBe('native');
  });
  it('treats an NPC absent from live npcs as a native speaker, not the companion', () => {
    // Regression: quinoaData.npcs only tracks NPCs near the player, so absence isn't a "borrowed" signal.
    expect(resolveSpeaker('NPC_Wade', map, { NPC_Reina: 3177 }, true).role).toBe('native');
  });
  it('degrades to an unthemed native speaker on missing data', () => {
    expect(resolveSpeaker('NPC_X', null, null, false)).toEqual({ npcId: 'NPC_X', role: 'native', locationKey: null, voice: 'neutral' });
  });
});

describe('hasNpcSpawn', () => {
  it('is true only for town NPCs with a map spawn tile', () => {
    expect(hasNpcSpawn(map, 'NPC_Reina')).toBe(true);
  });
  it('is false for NPC Visit bubbles, spawnless NPCs, and a missing map', () => {
    expect(hasNpcSpawn(map, 'NPC_Reina#user1')).toBe(false);
    expect(hasNpcSpawn(map, 'NPC_Iris#user1')).toBe(false);
    expect(hasNpcSpawn(map, 'NPC_Iris')).toBe(false);
    expect(hasNpcSpawn(null, 'NPC_Reina')).toBe(false);
  });
});

describe('isCompanionActive', () => {
  it('is true when Aries is installed and some NPC is displaced', () => {
    expect(isCompanionActive(map, { NPC_Reina: 3177, NPC_Juniper: 2899, NPC_Wade: 9 }, true)).toBe(true);
  });
  it('is false when Aries is installed but every present NPC is at its spawn tile', () => {
    expect(isCompanionActive(map, { NPC_Reina: 3177, NPC_Juniper: 2899, NPC_Wade: 3082 }, true)).toBe(false);
  });
  it('is false when an NPC is absent from live npcs (not a displacement signal — client may not have loaded it)', () => {
    expect(isCompanionActive(map, { NPC_Reina: 3177 }, true)).toBe(false);
  });
  it('is false when Aries is not installed even if an NPC is displaced', () => {
    expect(isCompanionActive(map, { NPC_Wade: 9 }, false)).toBe(false);
  });
});
