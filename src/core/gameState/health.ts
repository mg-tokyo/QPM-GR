// Bus row + explain rendering for the registry.
import { healthBus } from '../../diagnostics/healthBus';
import type { Subsystem } from '../../diagnostics/types';
import type { KeyExplain, TopologyReason } from './types';

export const GAME_STATE_SUBSYSTEM: Subsystem = 'gameState';

export interface HealthSource {
  stats(): { keys: number; bound: number; preferred: number; unbound: string[]; fallback: string[]; lastReasons: readonly TopologyReason[] };
  explainAll(): KeyExplain[];
}

let started = false;

export function startGameStateDiagnostics(): void {
  if (started) return;
  started = true;
  healthBus.register(GAME_STATE_SUBSYSTEM, { category: 'core', status: 'starting', message: 'Awaiting first bind' });
}

export function buildGameStateHealth(
  source: HealthSource,
  divergent: readonly string[],
): { status: 'ok' | 'degraded'; message: string; metrics: Record<string, number> } {
  const stats = source.stats();
  const explains = source.explainAll();
  let viaStateTree = 0, viaAtom = 0, viaCustom = 0;
  let rebinds = 0;
  for (const e of explains) {
    rebinds += e.rebinds;
    if (e.boundVia === 'stateTree') viaStateTree++;
    else if (e.boundVia === 'atom') viaAtom++;
    else if (e.boundVia === 'custom') viaCustom++;
  }
  const metrics = {
    keys: stats.keys, viaStateTree, viaAtom, viaCustom,
    unbound: stats.unbound.length, fallbackBound: stats.fallback.length, divergent: divergent.length, rebinds,
  };
  const problems: string[] = [];
  for (const k of stats.fallback) {
    const e = explains.find((x) => x.key === k);
    problems.push(`${k} via ${e?.boundVia ?? '?'}`);
  }
  for (const k of stats.unbound) problems.push(`${k} unbound`);
  if (divergent.length > 0) problems.push(`divergent: ${divergent.join(', ')}`);
  if (problems.length === 0) {
    return { status: 'ok', message: `${stats.keys} keys bound (${viaStateTree} state / ${viaAtom} atom / ${viaCustom} custom)`, metrics };
  }
  return { status: 'degraded', message: `degraded: ${problems.join('; ')}`, metrics };
}

export function publishGameStateHealth(source: HealthSource, divergent: readonly string[]): void {
  if (!started) return;
  const h = buildGameStateHealth(source, divergent);
  healthBus.publish({ subsystem: GAME_STATE_SUBSYSTEM, category: 'core', status: h.status, message: h.message, metrics: h.metrics });
}

/** One line per key: key, bound rung, preferred/fallback/unbound, subs, rebinds, last delivery age. */
export function renderGameStateTable(explains: readonly KeyExplain[], now: number = Date.now()): string[] {
  const width = Math.min(24, Math.max(4, explains.reduce((m, e) => Math.max(m, e.key.length), 0)));
  return explains.map((e) => {
    const rung = e.boundDescription ?? '-';
    const state = e.boundVia === null ? 'unbound' : e.preferred ? 'preferred' : 'fallback';
    const age = e.lastDeliveryAt === null ? '-' : `${Math.round((now - e.lastDeliveryAt) / 1000)}s`;
    return `${e.key.padEnd(width)}  ${rung.padEnd(40)}  ${state.padEnd(9)}  subs=${e.subscribers}  rebinds=${e.rebinds}  last=${age}`;
  });
}
