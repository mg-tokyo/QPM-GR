// src/rive-engine/enumeration.ts

import type { InputDescriptor, RiveInstance } from './types';
import { getInstance, getAllInstances } from './instanceTracker';
import { getRiveSingleton } from './runtimeCapture';

export function enumerateInputs(instanceId: string): InputDescriptor[] {
  const instance = getInstance(instanceId);
  if (!instance?.stateMachine) return [];

  const rive = getRiveSingleton();
  if (!rive) return [];

  const results: InputDescriptor[] = [];
  const sm = instance.stateMachine;
  const count = sm.inputCount();

  for (let i = 0; i < count; i++) {
    const inp = sm.input(i);
    if (!inp) continue;

    let type: InputDescriptor['type'];
    let currentValue: boolean | number | null = null;

    if (inp.type === rive.SMIInput.boolean) {
      type = 'boolean';
      try { currentValue = inp.asBool().value; } catch {}
    } else if (inp.type === rive.SMIInput.number) {
      type = 'number';
      try { currentValue = inp.asNumber().value; } catch {}
    } else {
      type = 'trigger';
      currentValue = null;
    }

    results.push({ name: inp.name, type, currentValue });
  }

  return results;
}

// Best-effort image property probe.
//
// Rive's viewModel API exposes `.image(name)` as a lookup but not an enumeration
// surface, so we cannot reliably list every image property on a bundle. We
// probe a broad allowlist plus species ids pulled from the QPM pet catalog,
// and harvest extra names from the viewModel's internal structures when
// they're walkable. Anything that returns a non-null property is reported.
//
// The allowlist below mixes confirmed avatar property names with reasonable
// guesses for pet bundles. Add discovered names here once you've used
// `dumpInstance(id)` to find real ones.
const KNOWN_IMAGE_PROPS = [
  // Avatar slots (confirmed via texture swapper avatar rules)
  'bottom', 'mid', 'top', 'discordAvatar',
  // Generic guesses for pet bundles — none yet confirmed; harmless if absent
  'image', 'sprite', 'texture', 'portrait', 'pet', 'petImage',
  'body', 'face', 'head', 'eye', 'eyes', 'mouth', 'accessory',
  'main', 'primary', 'base', 'overlay', 'background',
];

function extractIntrospectableKeys(obj: object): string[] {
  // Production Rive runtimes minify private fields. We walk own property names
  // and pluck anything string-like that *might* be a name list. Best-effort —
  // this is for discovery only; the result feeds back into the same probe.
  const result = new Set<string>();
  let names: string[];
  try {
    names = Object.getOwnPropertyNames(obj);
  } catch {
    return [];
  }
  for (const key of names) {
    let value: unknown;
    try { value = (obj as Record<string, unknown>)[key]; } catch { continue; }
    if (typeof value === 'string' && value.length > 0 && value.length < 64) {
      result.add(value);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string' && item.length > 0 && item.length < 64) {
          result.add(item);
        }
      }
    } else if (value instanceof Map) {
      for (const k of value.keys()) {
        if (typeof k === 'string' && k.length > 0 && k.length < 64) result.add(k);
      }
    }
  }
  return Array.from(result);
}

function getCatalogSpeciesIds(): string[] {
  try {
    const dex = (window as unknown as { __QPM_CATALOGS?: { petCatalog?: Record<string, unknown> } })
      .__QPM_CATALOGS?.petCatalog;
    if (!dex || typeof dex !== 'object') return [];
    return Object.keys(dex);
  } catch {
    return [];
  }
}

export function enumerateImageProperties(instanceId: string): string[] {
  const instance = getInstance(instanceId);
  if (!instance?.viewModel) return [];

  const candidates = new Set<string>(KNOWN_IMAGE_PROPS);
  for (const id of getCatalogSpeciesIds()) candidates.add(id);
  for (const key of extractIntrospectableKeys(instance.viewModel as object)) {
    candidates.add(key);
  }

  const found: string[] = [];
  for (const name of candidates) {
    try {
      const prop = instance.viewModel.image(name);
      if (prop) found.push(name);
    } catch {}
  }
  return found;
}

export function enumerateTextRuns(instanceId: string): string[] {
  const instance = getInstance(instanceId);
  if (!instance?.artboard) return [];

  const KNOWN_TEXT_RUNS = [
    'streakNumber', 'title', 'digitHundreds', 'digitTens', 'digitOnes',
    'name', 'label', 'text',
  ];
  // Pull additional candidates from the artboard's own structure.
  const candidates = new Set<string>(KNOWN_TEXT_RUNS);
  for (const key of extractIntrospectableKeys(instance.artboard as object)) {
    candidates.add(key);
  }

  const found: string[] = [];
  for (const name of candidates) {
    try {
      const run = instance.artboard.textRun(name);
      if (run) found.push(name);
    } catch {}
  }
  return found;
}

// ---------------------------------------------------------------------------
// Discovery — surface what is actually swappable on a registered instance
// ---------------------------------------------------------------------------

export interface InstanceDump {
  id: string;
  artboard: string;
  tags: string[];
  source: string;
  hasViewModel: boolean;
  hasStateMachine: boolean;
  hasArtboard: boolean;
  inputs: InputDescriptor[];
  imageProperties: string[];
  textRuns: string[];
  // Raw key listing for follow-up — lets the operator see private-field
  // candidates when the structured probes come back empty.
  viewModelKeys: string[];
  artboardKeys: string[];
}

function safeKeys(obj: unknown): string[] {
  if (!obj || typeof obj !== 'object') return [];
  try { return Object.getOwnPropertyNames(obj); } catch { return []; }
}

/**
 * Produce a structured snapshot of everything swappable on one registered
 * instance. Use this to learn what a bundle exposes — call it via
 * `__QPM_RIVE_ENGINE__.dumpInstance(id)` with a pet card open and read the
 * `imageProperties` / `textRuns` arrays in the console.
 */
export function dumpInstance(instanceId: string): InstanceDump | null {
  const instance = getInstance(instanceId);
  if (!instance) return null;
  return {
    id: instance.id,
    artboard: instance.artboardName,
    tags: instance.tags.slice(),
    source: instance.source,
    hasViewModel: !!instance.viewModel,
    hasStateMachine: !!instance.stateMachine,
    hasArtboard: !!instance.artboard,
    inputs: enumerateInputs(instance.id),
    imageProperties: enumerateImageProperties(instance.id),
    textRuns: enumerateTextRuns(instance.id),
    viewModelKeys: safeKeys(instance.viewModel),
    artboardKeys: safeKeys(instance.artboard),
  };
}

/**
 * Dump every registered instance. Convenience for "I have a card open, tell
 * me everything." Filters with `tagFilter` (e.g. `'pet'`) when set; otherwise
 * returns the full registry snapshot.
 */
export function dumpAllInstances(tagFilter?: string): InstanceDump[] {
  const all: RiveInstance[] = getAllInstances();
  const result: InstanceDump[] = [];
  for (const inst of all) {
    if (tagFilter && !inst.tags.includes(tagFilter)) continue;
    const dump = dumpInstance(inst.id);
    if (dump) result.push(dump);
  }
  return result;
}
