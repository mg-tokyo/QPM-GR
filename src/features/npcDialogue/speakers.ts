import { isRecord } from '../../utils/typeGuards';
import type { Speaker, Voice } from './types';

// literal-list-justified: game map location ids (mapAtom.locations keys) → QPM voice; a protocol table, not domain data. Unknown keys fall back to 'neutral'.
const VOICE_BY_LOCATION: Readonly<Record<string, Voice>> = {
  weatherStation: 'station',
  weatherShop: 'trader',
  preservationStation: 'preserve',
};

// NPC ids are `NPC_<spawnLayer>` — systems/npc/index.ts:29-35 in the game source.
const spawnName = (npcId: string): string => npcId.replace(/^NPC_/, '');

function spawnTile(map: unknown, npcId: string): number | null {
  if (!isRecord(map) || !isRecord(map.npcSpawns)) return null;
  const t = map.npcSpawns[spawnName(npcId)];
  return typeof t === 'number' ? t : null;
}

// v1361 NPC Visit bubbles are keyed `NPC_<name>#<forUserId>` and visitors like Iris have no spawn layer;
// their scripted lines are never Talks QPM may answer.
export const hasNpcSpawn = (map: unknown, npcId: string): boolean => spawnTile(map, npcId) !== null;

function locationOf(map: unknown, tile: number): string | null {
  if (!isRecord(map) || !isRecord(map.locations)) return null;
  for (const [key, loc] of Object.entries(map.locations)) {
    if (!isRecord(loc)) continue;
    const a = Array.isArray(loc.spawnTileIdx) ? loc.spawnTileIdx : [];
    const b = Array.isArray(loc.activationTilesIdxs) ? loc.activationTilesIdxs : [];
    if (a.includes(tile) || b.includes(tile)) return key;
  }
  return null;
}

// `quinoaData.npcs` only tracks NPCs the client has instantiated near the player (live 2026-09-18:
// {Reina, Juniper, Ember} present out of 7 spawns), so an absent spawn does not mean "borrowed" —
// only a live tile that differs from the spawn tile is a real displacement signal.
const isDisplaced = (map: unknown, npcTiles: unknown, npcId: string): boolean => {
  const spawn = spawnTile(map, npcId);
  if (spawn === null) return false;
  const live = isRecord(npcTiles) ? npcTiles[npcId] : undefined;
  return typeof live === 'number' && live !== spawn;
};

export function isCompanionActive(map: unknown, npcTiles: unknown, ariesInstalled: boolean): boolean {
  if (!ariesInstalled || !isRecord(map) || !isRecord(map.npcSpawns)) return false;
  for (const spawnKey of Object.keys(map.npcSpawns)) {
    if (isDisplaced(map, npcTiles, `NPC_${spawnKey}`)) return true;
  }
  return false;
}

export function resolveSpeaker(npcId: string, map: unknown, npcTiles: unknown, ariesInstalled: boolean): Speaker {
  if (ariesInstalled && isDisplaced(map, npcTiles, npcId)) return { npcId, role: 'companion', locationKey: null, voice: 'neutral' };
  const spawn = spawnTile(map, npcId);
  const locationKey = spawn === null ? null : locationOf(map, spawn);
  return { npcId, role: 'native', locationKey, voice: (locationKey && VOICE_BY_LOCATION[locationKey]) || 'neutral' };
}
