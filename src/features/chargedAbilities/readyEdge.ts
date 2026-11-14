// Recharge edges per pet + charged ability (ALR-10). Never fires on first sight (a pet already
// charged at load or swap-in); fires once per recharge, when the garden has a target for it.

import { subscribeAbilityTargets } from './selector';
import type { PetAbilityTargetSnapshot } from './types';

export interface ReadyEdgeInput {
  petSlotId: string;
  abilityId: string;
  ready: boolean;
  /** Qualifying crops in the best patch of the player's own garden (D1 addendum). */
  gardenTargetCount: number;
}

export interface ReadyEdgeEvent {
  kind: 'fire' | 'stop';
  key: string;
  petSlotId: string;
  abilityId: string;
  gardenTargetCount: number;
  /** stop only: the ability was used (went not-ready) or the pet left the active set. */
  reason?: 'used' | 'removed';
}

type EdgeState = 'idle' | 'cooling' | 'armed' | 'fired';

export function readyEdgeKey(petSlotId: string, abilityId: string): string {
  return `${petSlotId}:${abilityId}`;
}

export function createReadyEdgeTracker(): {
  step(inputs: readonly ReadyEdgeInput[]): ReadyEdgeEvent[];
  reset(): void;
} {
  const states = new Map<string, { state: EdgeState; input: ReadyEdgeInput }>();

  function step(inputs: readonly ReadyEdgeInput[]): ReadyEdgeEvent[] {
    const events: ReadyEdgeEvent[] = [];
    const seen = new Set<string>();
    for (const input of inputs) {
      const key = readyEdgeKey(input.petSlotId, input.abilityId);
      seen.add(key);
      const prev = states.get(key);
      const base = { key, petSlotId: input.petSlotId, abilityId: input.abilityId, gardenTargetCount: input.gardenTargetCount };
      if (!prev) {
        states.set(key, { state: input.ready ? 'idle' : 'cooling', input });
        continue;
      }
      let state = prev.state;
      if (!input.ready) {
        if (state === 'fired') events.push({ ...base, kind: 'stop', reason: 'used' });
        state = 'cooling';
      } else {
        if (state === 'cooling') state = 'armed';
        if (state === 'armed' && input.gardenTargetCount > 0) {
          events.push({ ...base, kind: 'fire' });
          state = 'fired';
        }
      }
      states.set(key, { state, input });
    }
    for (const [key, entry] of Array.from(states)) {
      if (seen.has(key)) continue;
      if (entry.state === 'fired') {
        const { petSlotId, abilityId, gardenTargetCount } = entry.input;
        events.push({ key, petSlotId, abilityId, gardenTargetCount, kind: 'stop', reason: 'removed' });
      }
      states.delete(key);
    }
    return events;
  }

  return { step, reset: () => { states.clear(); } };
}

export function toReadyEdgeInputs(snapshots: readonly PetAbilityTargetSnapshot[]): ReadyEdgeInput[] {
  return snapshots.map((s) => ({
    petSlotId: s.petSlotId,
    abilityId: s.abilityId,
    ready: s.ready,
    gardenTargetCount: s.optimality.bestPatch?.slots.length ?? 0,
  }));
}

const RECENT_LIMIT = 20;
const tracker = createReadyEdgeTracker();
const listeners = new Set<(event: ReadyEdgeEvent) => void>();
const recent: Array<ReadyEdgeEvent & { at: number }> = [];
let unsubscribe: (() => void) | null = null;

export function startReadyEdgeWatch(): void {
  if (unsubscribe) return;
  unsubscribe = subscribeAbilityTargets((snapshots) => {
    for (const event of tracker.step(toReadyEdgeInputs(snapshots))) {
      recent.push({ ...event, at: Date.now() });
      if (recent.length > RECENT_LIMIT) recent.shift();
      for (const cb of listeners) {
        try { cb(event); } catch { /* a listener failure must not stop the other listeners */ }
      }
    }
  });
}

export function stopReadyEdgeWatch(): void {
  unsubscribe?.();
  unsubscribe = null;
  tracker.reset();
  recent.length = 0;
}

export function onReadyEdge(cb: (event: ReadyEdgeEvent) => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function getRecentReadyEdges(): ReadonlyArray<ReadyEdgeEvent & { at: number }> {
  return recent.slice();
}
