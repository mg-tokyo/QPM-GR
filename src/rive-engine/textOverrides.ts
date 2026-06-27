// src/rive-engine/textOverrides.ts

import type {
  TextOverrideOpts, OverrideInfo, OverrideScope, RiveInstance,
} from './types';
import { riveLog, EventBus } from './helpers';
import {
  getInstancesBySource, getInstancesByTag, getInstance,
} from './instanceTracker';

interface ActiveTextOverride {
  info: OverrideInfo;
  opts: TextOverrideOpts;
}

const activeOverrides = new Map<string, ActiveTextOverride>();
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

function applyTextToInstance(instance: RiveInstance, textRun: string, value: string): void {
  if (!instance.artboard) return;
  try {
    instance.artboard.setTextRunValue(textRun, value);
    riveLog(`Text override applied: "${textRun}" = "${value}" on ${instance.id}`);
  } catch {
    riveLog(`Text run "${textRun}" not found on ${instance.id}`);
  }
}

export function setTextOverride(
  opts: TextOverrideOpts,
  eventBus: EventBus,
): () => void {
  const id = `txt_${nextId++}`;

  const info: OverrideInfo = {
    id,
    kind: 'text',
    scope: opts.target,
    property: opts.textRun,
    cleanup: () => {},
  };

  const entry: ActiveTextOverride = { info, opts };
  activeOverrides.set(id, entry);

  const cleanup = () => {
    if (!activeOverrides.has(id)) return;
    activeOverrides.delete(id);
    eventBus.emit('overrideReverted', info);
  };

  info.cleanup = cleanup;

  const targets = resolveInstances(opts.target);
  for (const inst of targets) {
    applyTextToInstance(inst, opts.textRun, opts.value);
  }

  eventBus.emit('overrideApplied', info);
  return cleanup;
}

export function reapplyTextOverrides(instanceId: string): void {
  const instance = getInstance(instanceId);
  if (!instance) return;
  for (const entry of activeOverrides.values()) {
    if (!entry.opts.pin) continue;
    if (!scopeMatches(entry.opts.target, instance)) continue;
    applyTextToInstance(instance, entry.opts.textRun, entry.opts.value);
  }
}

export function applyTextOverridesToNewInstance(instance: RiveInstance): void {
  for (const entry of activeOverrides.values()) {
    if (!scopeMatches(entry.opts.target, instance)) continue;
    applyTextToInstance(instance, entry.opts.textRun, entry.opts.value);
  }
}

export function revertAllTextOverrides(): void {
  for (const entry of activeOverrides.values()) {
    entry.info.cleanup();
  }
  activeOverrides.clear();
}

export function getActiveTextOverrides(): OverrideInfo[] {
  return Array.from(activeOverrides.values()).map((e) => e.info);
}
