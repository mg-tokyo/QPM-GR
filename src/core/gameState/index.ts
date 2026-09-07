// Public facade. Feature code imports ONLY from here (or through the
// atomRegistry compatibility barrel once C1 lands).
import { visibleInterval } from '../../utils/scheduling/timerManager';
import { storage } from '../../utils/storage';
import { fetchGameAccountInfo } from '../../services/gameAccount';
import { createNamedLogger } from '../../diagnostics/logger';
import { setGameStatePayloadSource } from '../../diagnostics/copyPayload';
import { getCapturedInfo, onJotaiCapture } from '../jotaiBridge';
import { getPlayerIdFromUrl } from '../playerIdFromUrl';
import { onStateTreeReady, onStateTreeWelcome, selectSync as stateTreeSelectSync } from '../stateTree';
import { runDivergenceAudit, type DivergenceReport } from './divergence';
import {
  explainIdentity, getIdentity, hydrateIdentityFromAccount, initIdentity, refreshIdentity, stopIdentity,
} from './identity';
import { publishGameStateHealth, startGameStateDiagnostics } from './health';
import { GAME_STATE_KEYS, validateKeyTable, type GameStateKey, type GameStateValue } from './keys';
import { Registry } from './resolver';
import { createProductionRuntime, type SourceRuntime } from './runtime';
import { getTopologyStats, onTopologyChange, resetTopology, signalTopology } from './topology';
import type { KeyExplain, SourceKind } from './types';

export type { GameStateKey, GameStateValue } from './keys';
export type { KeyExplain, SourceKind } from './types';
export { renderGameStateTable } from './health';
export type { DivergenceReport } from './divergence';

const log = createNamedLogger('gameState');
const CACHE_GROWTH_POLL_MS = 30_000;
const DIVERGENCE_IDLE_MS = 2_000;

let registry: Registry<typeof GAME_STATE_KEYS> | null = null;
let runtime: SourceRuntime | null = null;
const disposers: Array<() => void> = [];
let lastDivergent: string[] = [];
let lastCacheSize = -1;
let divergenceTimer: ReturnType<typeof setTimeout> | null = null;

function requireRegistry(): Registry<typeof GAME_STATE_KEYS> {
  if (!registry) throw new Error('gameState: initGameState() has not run');
  return registry;
}

function readAtomByExactLabel(label: string): unknown {
  if (!runtime) return undefined;
  const atoms = runtime.atoms.findAtoms(new RegExp(`^${label}$`));
  if (atoms.length !== 1) return undefined;
  try { return runtime.atoms.readSync(atoms[0]); } catch { return undefined; }
}

function readPlayersInRoom(): readonly string[] | null {
  const players = stateTreeSelectSync<unknown>((s) => {
    const data = (s as { data?: { players?: unknown } }).data;
    return data && Array.isArray(data.players) ? data.players : null;
  });
  if (!Array.isArray(players)) return null;
  const out: string[] = [];
  for (const p of players) {
    if (p && typeof p === 'object') {
      const id = (p as { id?: unknown }).id;
      if (typeof id === 'string' && id.length > 0) out.push(id);
    }
  }
  return out;
}

function readUserSlots(): unknown {
  return stateTreeSelectSync<unknown>((s) => {
    const child = (s as { child?: { data?: { userSlots?: unknown } } }).child;
    return child?.data?.userSlots ?? null;
  });
}

function scheduleDivergenceAudit(): void {
  if (divergenceTimer !== null) clearTimeout(divergenceTimer);
  divergenceTimer = setTimeout(() => {
    divergenceTimer = null;
    const reg = registry;
    if (!reg) return;
    const pending = readAtomByExactLabel('pendingQuinoaPredictionsAtom');
    if (Array.isArray(pending) && pending.length > 0) { scheduleDivergenceAudit(); return; }
    lastDivergent = runDivergenceAudit(reg, { emit: true }).divergent.map((d) => d.key);
    publishGameStateHealth(reg, lastDivergent);
  }, DIVERGENCE_IDLE_MS);
}

export function initGameState(): void {
  if (registry) return;
  const violations = validateKeyTable();
  if (violations.length > 0) throw new Error(`gameState: invalid key table — ${violations.join('; ')}`);
  startGameStateDiagnostics();
  resetTopology();

  runtime = createProductionRuntime(getIdentity);
  initIdentity({
    readAtomByExactLabel,
    urlPlayerId: getPlayerIdFromUrl,
    userSlots: readUserSlots,
    playersInRoom: readPlayersInRoom,
    storage: { get: (k, fb) => storage.get(k, fb), set: (k, v) => storage.set(k, v) },
    fetchAccountPlayerId: async () => (await fetchGameAccountInfo())?.playerId ?? null,
  });

  const reg: Registry<typeof GAME_STATE_KEYS> = new Registry(GAME_STATE_KEYS, runtime, {
    onRebind: (key, from, to) => {
      const e = reg.explain(key as GameStateKey);
      if (to !== null && !e.preferred) log.info('QPM-ATOM-004 rebound to lower rung', { key, from, to });
      else if (to === null && from !== null) log.warn('QPM-ATOM-001', { key, from });
    },
  });
  registry = reg;

  disposers.push(onTopologyChange(() => { publishGameStateHealth(reg, lastDivergent); scheduleDivergenceAudit(); }));
  disposers.push(onStateTreeReady(() => { refreshIdentity(); signalTopology('stateTree:ready'); }));
  disposers.push(onStateTreeWelcome(() => { refreshIdentity(); signalTopology('stateTree:welcome'); }));
  disposers.push(onJotaiCapture(() => { refreshIdentity(); signalTopology('jotai:capture'); }));
  disposers.push(visibleInterval('gameState:cacheGrowth', () => {
    const size = runtime?.atoms.cacheSize() ?? 0;
    if (size !== lastCacheSize) { lastCacheSize = size; signalTopology('atoms:cacheGrowth'); }
  }, CACHE_GROWTH_POLL_MS));

  reg.start();
  setGameStatePayloadSource(() => reg.explainAll());
  if (getCapturedInfo().mode !== null) signalTopology('jotai:capture');
  if (getIdentity().playerId === null) {
    void hydrateIdentityFromAccount().then((ok) => { if (ok) log.info('identity resolved via account endpoint'); });
  }
  publishGameStateHealth(reg, lastDivergent);
}

export function stopGameState(): void {
  for (const d of disposers.splice(0)) { try { d(); } catch { /* ignore */ } }
  if (divergenceTimer !== null) { clearTimeout(divergenceTimer); divergenceTimer = null; }
  setGameStatePayloadSource(null);
  registry?.stop();
  registry = null;
  runtime = null;
  stopIdentity();
  resetTopology();
  lastDivergent = [];
  lastCacheSize = -1;
}

export const isGameStateReady = (): boolean => registry !== null;
export const read = <K extends GameStateKey>(key: K): Promise<GameStateValue<K> | null> => requireRegistry().read(key);
export const readSync = <K extends GameStateKey>(key: K): GameStateValue<K> | null => requireRegistry().readSync(key);
export const subscribe = <K extends GameStateKey>(key: K, cb: (v: GameStateValue<K> | null) => void): (() => void) => requireRegistry().subscribe(key, cb);
export const write = <K extends GameStateKey>(key: K, value: GameStateValue<K>): Promise<void> => requireRegistry().write(key, value);
export const explain = (key: GameStateKey): KeyExplain => requireRegistry().explain(key);
export const explainAll = (): KeyExplain[] => requireRegistry().explainAll();
export const divergence = (): DivergenceReport => runDivergenceAudit(requireRegistry(), { emit: false });
export const simulateSourceLoss = (key: GameStateKey, kind: SourceKind): void => requireRegistry().setSimulatedLoss(key, kind, true);
export const restoreSource = (key: GameStateKey, kind: SourceKind): void => requireRegistry().setSimulatedLoss(key, kind, false);
/** For read-patch instrumentation only (activity-log enhancer). Null when no atom rung resolves. */
export const atomObjectFor = (key: GameStateKey): unknown => requireRegistry().atomObjectFor(key);
export function gameStateStats() {
  return { ...requireRegistry().stats(), topology: getTopologyStats(), identity: explainIdentity(), divergent: lastDivergent };
}
