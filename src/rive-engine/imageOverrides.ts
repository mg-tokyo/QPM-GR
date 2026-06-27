// src/rive-engine/imageOverrides.ts

import type {
  ImageOverrideOpts, OverrideInfo, OverrideScope,
  RiveInstance, LowLevelRive,
} from './types';
import { riveLog, decodeImageBytes, fetchImageBytes, EventBus } from './helpers';
import {
  getInstancesBySource, getInstancesByTag, getInstance,
} from './instanceTracker';
import { getRiveSingleton } from './runtimeCapture';

interface ActiveImageOverride {
  info: OverrideInfo;
  opts: ImageOverrideOpts;
  imageBytes: Uint8Array | null;
  // Flipped to true by the disposer. The async fetch/decode chain must check
  // this before every await boundary and before writing the override, so a
  // dispose mid-fetch does not apply the image after restore.
  aborted: boolean;
  // Instance ids the override was actually written to. Cleanup uses this to
  // write the restoreOnCleanup image back to the same instances even if scope
  // resolution would return nothing now (e.g. instance re-registered).
  appliedInstanceIds: Set<string>;
}

const activeOverrides = new Map<string, ActiveImageOverride>();
let nextOverrideId = 1;

// ---------------------------------------------------------------------------
// Scope resolution
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Apply to a single instance
// ---------------------------------------------------------------------------

async function applyImageToInstance(
  instance: RiveInstance,
  property: string,
  imageBytes: Uint8Array,
  rive: LowLevelRive,
  isAborted?: () => boolean,
): Promise<void> {
  if (isAborted?.()) return;
  if (!instance.viewModel) {
    riveLog(`Cannot set image "${property}" on ${instance.id}: no viewModel`);
    return;
  }

  const imageProp = instance.viewModel.image(property);
  if (!imageProp) {
    riveLog(`Image property "${property}" not found on ${instance.id}`);
    console.warn(`[QPM:RiveEngine] Image property "${property}" not found on instance ${instance.id}`);
    return;
  }

  const decoded = await decodeImageBytes(rive, imageBytes);
  if (isAborted?.()) {
    // Drop the decoded image — we never wrote it, so unref to release
    // the underlying renderer resource Rive allocated.
    try { decoded.unref(); } catch { /* best effort */ }
    return;
  }
  imageProp.value(decoded);
  riveLog(`Image override applied: "${property}" on ${instance.id}`);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function setImageOverride(
  opts: ImageOverrideOpts,
  eventBus: EventBus,
): () => void {
  const rive = getRiveSingleton();
  if (!rive) {
    riveLog('Cannot set image override: Rive runtime not captured');
    return () => {};
  }

  const id = `img_${nextOverrideId++}`;

  const info: OverrideInfo = {
    id,
    kind: 'image',
    scope: opts.target,
    property: opts.property,
    cleanup: () => {},
  };

  const entry: ActiveImageOverride = {
    info,
    opts,
    imageBytes: opts.image instanceof Uint8Array ? opts.image : null,
    aborted: false,
    appliedInstanceIds: new Set(),
  };

  activeOverrides.set(id, entry);

  const cleanup = () => {
    if (!activeOverrides.has(id)) return;
    // Mark aborted FIRST so any in-flight async loop sees it before deletion
    // (Map.delete + has-check is the only sync state; the flag is what the
    // fetch/decode coroutine actually consults).
    entry.aborted = true;
    activeOverrides.delete(id);
    eventBus.emit('overrideReverted', info);
    riveLog(`Image override reverted: ${id}`);

    // One-shot restore: write the caller-provided original image back to every
    // instance we actually applied to. No new override entry is created, so
    // future imageReloaded events fall through to the game's natural value.
    const restoreSource = opts.restoreOnCleanup?.();
    if (restoreSource && entry.appliedInstanceIds.size > 0) {
      const targetIds = Array.from(entry.appliedInstanceIds);
      void (async () => {
        try {
          const bytes = restoreSource instanceof Uint8Array
            ? restoreSource
            : await fetchImageBytes(restoreSource);
          for (const instId of targetIds) {
            const inst = getInstance(instId);
            if (!inst) continue;
            // Pass an always-false abort signal — this is the cleanup path, the
            // override is already gone; we want the restore write to complete.
            await applyImageToInstance(inst, opts.property, bytes, rive, () => false);
          }
        } catch (e) {
          riveLog('Image restore on cleanup failed:', e);
        }
      })();
    }
  };

  info.cleanup = cleanup;

  const isAborted = () => entry.aborted;

  void (async () => {
    try {
      if (!entry.imageBytes) {
        entry.imageBytes = await fetchImageBytes(opts.image as string);
      }
      if (isAborted()) return;

      const targets = resolveInstances(opts.target);
      if (targets.length === 0) {
        riveLog(`Image override: no instances found for scope`, opts.target);
      }
      for (const inst of targets) {
        if (isAborted()) return;
        await applyImageToInstance(inst, opts.property, entry.imageBytes, rive, isAborted);
        entry.appliedInstanceIds.add(inst.id);
      }

      if (isAborted()) return;
      eventBus.emit('overrideApplied', info);
    } catch (e) {
      riveLog('Image override apply failed:', e);
      console.warn('[QPM:RiveEngine] Image override failed:', e);
    }
  })();

  return cleanup;
}

export function reapplyImageOverrides(instanceId: string): void {
  const rive = getRiveSingleton();
  if (!rive) return;

  const instance = getInstance(instanceId);
  if (!instance) return;

  for (const entry of activeOverrides.values()) {
    if (!entry.imageBytes) continue;
    if (entry.aborted) continue;
    if (!scopeMatches(entry.opts.target, instance)) continue;

    const isAborted = () => entry.aborted;
    void applyImageToInstance(instance, entry.opts.property, entry.imageBytes, rive, isAborted)
      .then(() => { if (!entry.aborted) entry.appliedInstanceIds.add(instance.id); });
  }
}

export function applyImageOverridesToNewInstance(instance: RiveInstance): void {
  const rive = getRiveSingleton();
  if (!rive) return;

  for (const entry of activeOverrides.values()) {
    if (!entry.imageBytes) continue;
    if (entry.aborted) continue;
    if (!scopeMatches(entry.opts.target, instance)) continue;

    const isAborted = () => entry.aborted;
    void applyImageToInstance(instance, entry.opts.property, entry.imageBytes, rive, isAborted)
      .then(() => { if (!entry.aborted) entry.appliedInstanceIds.add(instance.id); });
  }
}

export function revertAllImageOverrides(): void {
  // Mark every entry aborted before iterating cleanups — cleanup() also flips
  // entry.aborted, but doing it up front guarantees any concurrent async loop
  // walking activeOverrides sees the abort before its next isAborted() check.
  for (const entry of activeOverrides.values()) {
    entry.aborted = true;
  }
  for (const entry of activeOverrides.values()) {
    entry.info.cleanup();
  }
  activeOverrides.clear();
}

export function getActiveImageOverrides(): OverrideInfo[] {
  return Array.from(activeOverrides.values()).map((e) => e.info);
}
