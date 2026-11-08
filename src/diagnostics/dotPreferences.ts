// User preferences for the titlebar health dot: a master switch plus per-subsystem mutes.
// The Diagnostics window always shows true health; these only change what lights the dot.

import { storage } from '../utils/storage';
import { healthBus } from './healthBus';
import type { AggregateStatus, Subsystem } from './types';

const ENABLED_KEY = 'qpm.diagnostics.dot.enabled.v1';
const MUTED_KEY = 'qpm.diagnostics.dot.mutedSubsystems.v1';

type Listener = () => void;

let enabledCache: boolean | null = null;
let mutedCache: Set<Subsystem> | null = null;
const listeners = new Set<Listener>();

function emit(): void {
  for (const cb of listeners) {
    try { cb(); } catch { /* one bad listener must not block the rest */ }
  }
}

function loadMuted(): Set<Subsystem> {
  if (mutedCache) return mutedCache;
  const raw = storage.get<unknown>(MUTED_KEY, []);
  const list = Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
  mutedCache = new Set(list);
  return mutedCache;
}

export function isDotEnabled(): boolean {
  if (enabledCache === null) {
    const raw = storage.get<unknown>(ENABLED_KEY, true);
    enabledCache = raw !== false;
  }
  return enabledCache;
}

export function setDotEnabled(enabled: boolean): void {
  if (isDotEnabled() === enabled) return;
  enabledCache = enabled;
  storage.set(ENABLED_KEY, enabled);
  emit();
}

export function isSubsystemMuted(subsystem: Subsystem): boolean {
  return loadMuted().has(subsystem);
}

export function setSubsystemMuted(subsystem: Subsystem, muted: boolean): void {
  const set = loadMuted();
  if (set.has(subsystem) === muted) return;
  if (muted) set.add(subsystem);
  else set.delete(subsystem);
  storage.set(MUTED_KEY, Array.from(set).sort());
  emit();
}

export function getMutedSubsystems(): readonly Subsystem[] {
  return Array.from(loadMuted()).sort();
}

export function onDotPreferencesChange(cb: Listener): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** Aggregate over subsystems that are not muted; mirrors healthBus.aggregate(). */
export function dotAggregate(): AggregateStatus {
  const muted = loadMuted();
  let degraded = false;
  for (const h of healthBus.readAll()) {
    if (muted.has(h.subsystem)) continue;
    if (h.status === 'failed') return 'failed';
    if (h.status === 'degraded' || h.status === 'recovering') degraded = true;
  }
  return degraded ? 'degraded' : 'ok';
}
