// Merged key table. Policy assertion runs at module load so a mis-ordered
// ladder fails typecheck-time tests and dev boot.
import { assertLadderPolicy } from '../define';
import type { KeyDefinition } from '../types';
import { ECONOMY_KEYS } from './economy';
import { GARDEN_KEYS } from './garden';
import { INVENTORY_KEYS } from './inventory';
import { PET_KEYS } from './pets';
import { PLAYER_KEYS } from './player';
import { SHOP_KEYS } from './shops';
import { STORAGE_KEYS } from './storages';
import { UI_KEYS } from './ui';

export const GAME_STATE_KEYS = {
  ...PLAYER_KEYS, ...ECONOMY_KEYS, ...INVENTORY_KEYS, ...STORAGE_KEYS, ...PET_KEYS, ...GARDEN_KEYS, ...SHOP_KEYS, ...UI_KEYS,
};

export type GameStateKey = keyof typeof GAME_STATE_KEYS;
export type GameStateValue<K extends GameStateKey> =
  (typeof GAME_STATE_KEYS)[K] extends KeyDefinition<infer T> ? T : never;

export function validateKeyTable(): string[] {
  const out: string[] = [];
  for (const [name, def] of Object.entries(GAME_STATE_KEYS)) out.push(...assertLadderPolicy(name, def as KeyDefinition<unknown>));
  return out;
}
