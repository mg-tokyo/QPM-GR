import { createPlayerScoped, PLAYER_SCOPED_UNCHANGED, type PlayerScopedHandle, type PlayerScopedLayout } from '../playerScoped';
import { buildLogEnvelope, parseRebuild } from './log';
import { mergePityCopies, type PityCopy } from './merge';
import { LOG_STORAGE_KEY, STORAGE_KEY, applyCopy, ctx, defaultState, diag, normalizeSaved, persist } from './state';

/** State and pull log as one player-scoped value: the PD1 merge needs both copies' checkpoint and log together. */
export function pityLayout(isLogDirty: () => boolean): PlayerScopedLayout<PityCopy> {
  return {
    parts: [STORAGE_KEY, LOG_STORAGE_KEY],
    join: ([rawState, rawLog]) => {
      if (rawState === undefined) return undefined;
      try {
        const saved = normalizeSaved(rawState, rawLog ?? null);
        return { state: saved.state, log: saved.log, rebuild: saved.logReset ? null : parseRebuild(rawLog) };
      } catch (error) {
        diag.warn('QPM-STORE-001', { phase: 'load', key: STORAGE_KEY }, error);
        return undefined;
      }
    },
    split: (copy, reason) => [
      copy.state,
      reason === 'bind' || isLogDirty() ? buildLogEnvelope(copy.log, copy.rebuild) : PLAYER_SCOPED_UNCHANGED,
    ],
  };
}

let handle: PlayerScopedHandle<PityCopy> | null = null;

/** `onBound(first)` runs once the player's merged copy is applied: first bind, then after each player change. */
export function startPityScope(onBound: (first: boolean) => void): void {
  if (handle) return;
  let bound = false;
  const fallback: PityCopy = { state: defaultState(), log: [], rebuild: null };
  const scoped = createPlayerScoped<PityCopy>({
    baseKey: STORAGE_KEY,
    fallback,
    merge: mergePityCopies,
    onReady: (copy) => {
      // The fallback is shared across binds; the store mutates its state in place.
      applyCopy(copy === fallback ? { state: defaultState(), log: [], rebuild: null } : copy);
      ctx.write = () => scoped.write({ state: ctx.state, log: ctx.log, rebuild: ctx.pendingRebuild });
      const first = !bound;
      bound = true;
      onBound(first);
    },
    flush: persist,
  }, pityLayout(() => ctx.logDirty));
  handle = scoped;
  scoped.start();
}

export function stopPityScope(): void {
  handle?.stop();
  handle = null;
  ctx.write = null;
}
