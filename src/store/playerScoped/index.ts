import { onIdentityChange } from '../../core/gameState';
import { getPlayerIdSync } from '../../core/playerContext';
import { createNamedLogger } from '../../diagnostics/logger';
import { readDurable, registerDynamicKey, storage } from '../../utils/storage';
import { createPlayerScopedWith } from './scope';
import type { PlayerScopedDeps, PlayerScopedHandle, PlayerScopedLayout, PlayerScopedSpec } from './types';

export { PLAYER_SCOPED_CLAIMS_KEY, PLAYER_SCOPED_UNCHANGED } from './scope';
export type { PlayerScopedHandle, PlayerScopedLayout, PlayerScopedSpec } from './types';

const log = createNamedLogger('playerScoped');

const realDeps: PlayerScopedDeps = {
  storageGet: (key, fallback) => storage.get(key, fallback),
  storageSet: (key, value) => storage.set(key, value),
  readDurable: (key, fallback) => readDurable(key, fallback),
  registerDynamicKey,
  currentPlayerId: getPlayerIdSync,
  onIdentityChange: (cb) => onIdentityChange((ctx) => cb(ctx.playerId)),
  siteId: () => globalThis.location?.origin ?? 'unknown',
  onError: (phase, baseKey, cause) => {
    log.warn(phase === 'persist' ? 'QPM-STORE-004' : 'QPM-STORE-001', { store: 'playerScoped', baseKey, phase }, cause);
  },
};

/** History keyed `<baseKey>.<playerId>`; see `PlayerScopedSpec` for the merge contract. Does nothing until `start()`. */
export function createPlayerScoped<T>(spec: PlayerScopedSpec<T>, layout?: PlayerScopedLayout<T>): PlayerScopedHandle<T> {
  return layout ? createPlayerScopedWith(spec, realDeps, layout) : createPlayerScopedWith(spec, realDeps);
}
