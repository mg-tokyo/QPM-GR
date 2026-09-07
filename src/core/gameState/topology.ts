// "Something that affects source availability changed" bus. Signals coalesce
// per microtask so a burst (welcome + identity + cache growth) re-walks every
// ladder once.
import type { TopologyReason } from './types';

type Listener = (reasons: ReadonlySet<TopologyReason>) => void;

const listeners = new Set<Listener>();
let pending = new Set<TopologyReason>();
let scheduled = false;
let signals = 0;
let flushes = 0;
let lastReasons: TopologyReason[] = [];

export function onTopologyChange(cb: Listener): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function signalTopology(reason: TopologyReason): void {
  signals++;
  pending.add(reason);
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(flushTopologyNow);
}

export function flushTopologyNow(): void {
  scheduled = false;
  if (pending.size === 0) return;
  const reasons = pending;
  pending = new Set<TopologyReason>();
  flushes++;
  lastReasons = [...reasons];
  for (const l of listeners) {
    try { l(reasons); } catch { /* listener isolated */ }
  }
}

export function getTopologyStats(): { signals: number; flushes: number; lastReasons: readonly TopologyReason[] } {
  return { signals, flushes, lastReasons };
}

export function resetTopology(): void {
  listeners.clear();
  pending = new Set<TopologyReason>();
  scheduled = false;
  signals = 0;
  flushes = 0;
  lastReasons = [];
}
