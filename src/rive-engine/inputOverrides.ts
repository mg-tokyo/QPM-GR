// src/rive-engine/inputOverrides.ts

import type {
  InputOverrideOpts, TriggerOpts, OverrideInfo, OverrideScope,
  RiveInstance, RiveSMIInput,
} from './types';
import { riveLog, EventBus } from './helpers';
import {
  getInstancesBySource, getInstancesByTag, getInstance,
} from './instanceTracker';
import { getRiveSingleton } from './runtimeCapture';

interface ActiveInputOverride {
  info: OverrideInfo;
  opts: InputOverrideOpts;
  // Per-instance snapshot of the input value at the moment the override was
  // first applied. cleanup() writes these back so the Rive state machine is
  // restored — without this, removing the entry from the map does nothing
  // visible since the input retains the overridden value.
  snapshots: Map<string, boolean | number>;
}

const activeOverrides = new Map<string, ActiveInputOverride>();
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

function findInput(sm: NonNullable<RiveInstance['stateMachine']>, name: string): RiveSMIInput | null {
  const count = sm.inputCount();
  for (let i = 0; i < count; i++) {
    const inp = sm.input(i);
    if (inp && inp.name === name) return inp;
  }
  return null;
}

function applyInputToInstance(
  instance: RiveInstance,
  inputName: string,
  value: boolean | number,
): boolean | number | null {
  if (!instance.stateMachine) return null;
  const rive = getRiveSingleton();
  if (!rive) return null;

  const inp = findInput(instance.stateMachine, inputName);
  if (!inp) {
    riveLog(`Input "${inputName}" not found on ${instance.id}`);
    return null;
  }

  let previous: boolean | number | null = null;
  if (inp.type === rive.SMIInput.boolean && typeof value === 'boolean') {
    previous = inp.asBool().value;
    inp.asBool().value = value;
  } else if (inp.type === rive.SMIInput.number && typeof value === 'number') {
    previous = inp.asNumber().value;
    inp.asNumber().value = value;
  } else {
    riveLog(`Input type mismatch for "${inputName}" on ${instance.id}`);
    return null;
  }

  riveLog(`Input override applied: "${inputName}" = ${value} on ${instance.id}`);
  return previous;
}

export function setInputOverride(
  opts: InputOverrideOpts,
  eventBus: EventBus,
): () => void {
  const id = `inp_${nextId++}`;

  const info: OverrideInfo = {
    id,
    kind: 'input',
    scope: opts.target,
    property: opts.input,
    cleanup: () => {},
  };

  const entry: ActiveInputOverride = { info, opts, snapshots: new Map() };
  activeOverrides.set(id, entry);

  const cleanup = () => {
    if (!activeOverrides.has(id)) return;
    activeOverrides.delete(id);
    // Restore each instance's pre-override value. Re-resolve via getInstance
    // so a stale id (instance destroyed since apply) is a quiet no-op.
    for (const [instanceId, previous] of entry.snapshots) {
      const inst = getInstance(instanceId);
      if (!inst) continue;
      applyInputToInstance(inst, opts.input, previous);
    }
    entry.snapshots.clear();
    eventBus.emit('overrideReverted', info);
  };

  info.cleanup = cleanup;

  const targets = resolveInstances(opts.target);
  for (const inst of targets) {
    const previous = applyInputToInstance(inst, opts.input, opts.value);
    if (previous !== null) entry.snapshots.set(inst.id, previous);
  }

  eventBus.emit('overrideApplied', info);
  return cleanup;
}

export function fireTrigger(opts: TriggerOpts): void {
  const rive = getRiveSingleton();
  if (!rive) return;

  const targets = resolveInstances(opts.target);
  for (const inst of targets) {
    if (!inst.stateMachine) continue;
    const inp = findInput(inst.stateMachine, opts.trigger);
    if (inp && inp.type === rive.SMIInput.trigger) {
      inp.asTrigger().fire();
      riveLog(`Trigger fired: "${opts.trigger}" on ${inst.id}`);
    }
  }
}

export function reapplyInputOverrides(instanceId: string): void {
  const instance = getInstance(instanceId);
  if (!instance) return;
  for (const entry of activeOverrides.values()) {
    if (!entry.opts.pin) continue;
    if (!scopeMatches(entry.opts.target, instance)) continue;
    const previous = applyInputToInstance(instance, entry.opts.input, entry.opts.value);
    if (previous !== null && !entry.snapshots.has(instance.id)) {
      entry.snapshots.set(instance.id, previous);
    }
  }
}

export function applyInputOverridesToNewInstance(instance: RiveInstance): void {
  for (const entry of activeOverrides.values()) {
    if (!scopeMatches(entry.opts.target, instance)) continue;
    const previous = applyInputToInstance(instance, entry.opts.input, entry.opts.value);
    if (previous !== null && !entry.snapshots.has(instance.id)) {
      entry.snapshots.set(instance.id, previous);
    }
  }
}

export function revertAllInputOverrides(): void {
  for (const entry of activeOverrides.values()) {
    entry.info.cleanup();
  }
  activeOverrides.clear();
}

export function getActiveInputOverrides(): OverrideInfo[] {
  return Array.from(activeOverrides.values()).map((e) => e.info);
}
