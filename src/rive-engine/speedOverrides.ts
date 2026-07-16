import type {
  SpeedOverrideOpts, OverrideInfo, OverrideScope, RiveInstance,
} from './types';
import { riveLog, EventBus } from './helpers';
import {
  getInstancesBySource, getInstancesByTag, getInstance,
} from './instanceTracker';

interface ActiveSpeedOverride {
  info: OverrideInfo;
  opts: SpeedOverrideOpts;
  // Per-instance snapshot of playbackSpeed at first apply. cleanup() writes
  // these back — needed because the game may have set a non-1 baseline
  // (hunger slow-mo, ability speed-up) that we must restore.
  snapshots: Map<string, number>;
}

const activeOverrides = new Map<string, ActiveSpeedOverride>();
let nextId = 1;

function resolveInstances(scope: OverrideScope): RiveInstance[] {
  switch (scope.type) {
    case 'global': return getInstancesBySource(scope.source);
    case 'tagged': return getInstancesByTag(scope.tag);
    case 'instance': {
      const inst = getInstance(scope.id);
      return inst ? [inst] : [];
    }
  }
}

function scopeMatches(scope: OverrideScope, instance: RiveInstance): boolean {
  switch (scope.type) {
    case 'global': return instance.source.toLowerCase().includes(scope.source.toLowerCase());
    case 'tagged': return instance.tags.includes(scope.tag);
    case 'instance': return instance.id === scope.id;
  }
}

// raw is the live RiveSprite — playbackSpeed is its public clock multiplier.
function applySpeed(instance: RiveInstance, speed: number): number | null {
  const raw = instance.raw as { playbackSpeed?: unknown };
  if (typeof raw.playbackSpeed !== 'number') return null;
  const previous = raw.playbackSpeed;
  raw.playbackSpeed = speed;
  riveLog(`Speed override applied: ${speed} on ${instance.id}`);
  return previous;
}

export function setSpeedOverride(
  opts: SpeedOverrideOpts,
  eventBus: EventBus,
): () => void {
  const id = `spd_${nextId++}`;

  const info: OverrideInfo = {
    id,
    kind: 'speed',
    scope: opts.target,
    property: 'playbackSpeed',
    cleanup: () => {},
  };

  const entry: ActiveSpeedOverride = { info, opts, snapshots: new Map() };
  activeOverrides.set(id, entry);

  const cleanup = (): void => {
    if (!activeOverrides.has(id)) return;
    activeOverrides.delete(id);
    for (const [instanceId, previous] of entry.snapshots) {
      const inst = getInstance(instanceId);
      if (inst) applySpeed(inst, previous);
    }
    entry.snapshots.clear();
    eventBus.emit('overrideReverted', info);
  };
  info.cleanup = cleanup;

  for (const inst of resolveInstances(opts.target)) {
    const previous = applySpeed(inst, opts.speed);
    if (previous !== null) entry.snapshots.set(inst.id, previous);
  }
  eventBus.emit('overrideApplied', info);
  return cleanup;
}

export function applySpeedOverridesToNewInstance(instance: RiveInstance): void {
  for (const entry of activeOverrides.values()) {
    if (!scopeMatches(entry.opts.target, instance)) continue;
    const previous = applySpeed(instance, entry.opts.speed);
    if (previous !== null && !entry.snapshots.has(instance.id)) {
      entry.snapshots.set(instance.id, previous);
    }
  }
}

export function revertAllSpeedOverrides(): void {
  for (const entry of activeOverrides.values()) entry.info.cleanup();
  activeOverrides.clear();
}

export function getActiveSpeedOverrides(): OverrideInfo[] {
  return Array.from(activeOverrides.values()).map((e) => e.info);
}
