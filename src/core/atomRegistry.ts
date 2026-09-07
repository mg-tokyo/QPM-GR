// src/core/atomRegistry.ts — compatibility barrel over src/core/gameState.
// Kept so the existing importers keep compiling; new code imports the
// facade directly. Resolution, ladders and diagnostics live in gameState/.
import * as gameState from './gameState';
import type { GameStateKey, GameStateValue } from './gameState';
import { startGameStateDiagnostics } from './gameState/health';
import { getAllAtomEntries, getCachedStore } from './jotaiBridge';
import type { SubscriberTier } from './reactive/types';

export type AtomRegistryKey = GameStateKey;
export type RegistryValue<K extends AtomRegistryKey> = GameStateValue<K> | null;

export function readAtomValue<K extends AtomRegistryKey>(key: K): Promise<RegistryValue<K>> {
  return gameState.read(key);
}

export function readAtomValueSync<K extends AtomRegistryKey>(key: K): RegistryValue<K> {
  return gameState.readSync(key);
}

// `hint` is accepted for signature compatibility only — the reactive tier now
// lives on the key definition. Always resolves to an unsubscribe (never null):
// a key with no available source stays pending inside the registry.
export async function subscribeAtomValue<K extends AtomRegistryKey>(
  key: K,
  cb: (value: RegistryValue<K>) => void,
  _hint?: SubscriberTier,
): Promise<(() => void) | null> {
  return gameState.subscribe(key, cb);
}

export async function writeRegistryAtom<K extends AtomRegistryKey>(key: K, value: RegistryValue<K>): Promise<void> {
  // Null is a valid game value for nullable keys (e.g. selectedItemId deselection).
  // Callers that must forbid null narrow their own types.
  await gameState.write(key, value as GameStateValue<K>);
}

export interface AtomHealthCheckResult {
  registered: Array<{ key: string; label: string; resolvedVia: 'label' | 'structure' | 'fallback' | 'stateTree' }>;
  missing: string[];
  unregistered: Array<{ label: string; populated: boolean }>;
}

export function runAtomHealthCheck(): AtomHealthCheckResult {
  const explains = gameState.explainAll();
  const registered: AtomHealthCheckResult['registered'] = [];
  const missing: string[] = [];
  const boundLabels = new Set<string>();
  for (const e of explains) {
    if (e.boundVia === null) { missing.push(e.key); continue; }
    const label = e.boundDescription ?? e.boundVia;
    registered.push({ key: e.key, label, resolvedVia: e.boundVia === 'stateTree' ? 'stateTree' : 'label' });
    if (e.boundVia === 'atom') boundLabels.add(label.replace(/^atom:/, ''));
  }
  const store = getCachedStore();
  const unregistered: AtomHealthCheckResult['unregistered'] = [];
  for (const entry of getAllAtomEntries()) {
    if (!entry.label || boundLabels.has(entry.label)) continue;
    let populated = false;
    if (store) { try { populated = store.get(entry.atom) != null; } catch { /* unreadable */ } }
    unregistered.push({ label: entry.label, populated });
  }
  return { registered, missing, unregistered };
}

export function getRegisteredKeys(): Array<{ key: string; resolved: boolean; label: string | null; via: string | null }> {
  return gameState.explainAll().map((e) => ({ key: e.key, resolved: e.boundVia !== null, label: e.boundDescription, via: e.boundVia }));
}

export function getRegistryStatus(): string {
  const s = gameState.gameStateStats();
  return `gameState: ${s.bound}/${s.keys} keys bound (${s.preferred} preferred, ${s.fallback.length} fallback, ${s.unbound.length} unbound)`;
}

export const startAtomRegistryDiagnostics = startGameStateDiagnostics;
