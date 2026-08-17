import { awaitRiveSingleton } from '../../rive-engine';
import { spriteLog } from '../diagnostics';
import { petRiveState, resetPetRiveState } from './state';
import {
  getCachedCanvas,
  getCachedDataUrl,
  getCachedMutatedCanvas,
  cacheMutatedCanvas,
  getCachedMutatedDataUrl,
  clearPetRiveCache,
  cachedSpeciesCount,
} from './cache';
import { fetchPetsRivBytes } from './bundleLoader';
import { setupRenderer, warmupAllSpecies, notifySpritesRefresh } from './renderer';

let initPromise: Promise<void> | null = null;

async function performInit(): Promise<void> {
  const runtime = await awaitRiveSingleton();
  petRiveState.runtime = runtime;

  const bytes = await fetchPetsRivBytes();
  if (!bytes) return; // bundleLoader already logged

  const setup = await setupRenderer(runtime, bytes, () => {
    // Fire-and-forget re-warm after context restore
    void reWarm();
  });
  if (!setup) return;

  petRiveState.file = setup.file;
  petRiveState.renderer = setup.renderer;
  petRiveState.workCanvas = setup.canvas;

  const { rendered, skipped } = warmupAllSpecies(runtime, setup.file, setup.renderer, setup.canvas);
  petRiveState.ready = true;

  spriteLog('info', 'pet-rive-warmup-complete', 'Pet species Rive warmup complete', {
    rendered: rendered.length,
    skipped: skipped.length,
    skippedNames: skipped,
  });

  const callbacks = petRiveState.readyCallbacks.slice();
  petRiveState.readyCallbacks.length = 0;
  for (const cb of callbacks) {
    try { cb(); } catch (error) {
      spriteLog('warn', 'pet-rive-ready-callback-failed', 'onPetRiveReady callback threw', {
        error: String((error as Error)?.message ?? error),
      });
    }
  }

  notifySpritesRefresh();
}

async function reWarm(): Promise<void> {
  if (!petRiveState.runtime || !petRiveState.file || !petRiveState.renderer || !petRiveState.workCanvas) return;
  clearPetRiveCache();
  const { rendered, skipped } = warmupAllSpecies(
    petRiveState.runtime,
    petRiveState.file,
    petRiveState.renderer,
    petRiveState.workCanvas,
  );
  petRiveState.ready = true;
  spriteLog('info', 'pet-rive-rewarm-complete', 'Pet species Rive re-warm complete', {
    rendered: rendered.length,
    skipped: skipped.length,
  });
  notifySpritesRefresh();
}

export function initPetRive(): Promise<void> {
  if (petRiveState.initialized) return initPromise ?? Promise.resolve();
  petRiveState.initialized = true;
  initPromise = performInit().catch((error) => {
    spriteLog('warn', 'pet-rive-init-failed', 'initPetRive failed', {
      error: String((error as Error)?.message ?? error),
    });
  });
  return initPromise;
}

export function stopPetRive(): void {
  for (const fn of petRiveState.cleanups) {
    try { fn(); } catch { /* best effort */ }
  }
  try { petRiveState.file?.unref?.(); } catch { /* best effort */ }
  try { petRiveState.workCanvas?.remove(); } catch { /* best effort */ }
  clearPetRiveCache();
  resetPetRiveState();
  initPromise = null;
}

export function isPetRiveReady(): boolean {
  return petRiveState.ready;
}

export function isPetRiveSpecies(species: string): boolean {
  return petRiveState.artboardNames.has(species);
}

export function getPetRiveCanvas(species: string): HTMLCanvasElement | null {
  if (!species) return null;
  return getCachedCanvas(species);
}

export function getPetRiveDataUrl(species: string): string {
  if (!species) return '';
  return getCachedDataUrl(species);
}

export function getPetRiveMutatedCanvas(species: string, mutations: string[]): HTMLCanvasElement | null {
  if (!species) return null;
  return getCachedMutatedCanvas(species, mutations);
}

export function cachePetRiveMutatedCanvas(species: string, mutations: string[], canvas: HTMLCanvasElement): void {
  if (!species) return;
  cacheMutatedCanvas(species, mutations, canvas);
}

export function getPetRiveMutatedDataUrl(species: string, mutations: string[]): string {
  if (!species) return '';
  return getCachedMutatedDataUrl(species, mutations);
}

export function onPetRiveReady(cb: () => void): () => void {
  if (petRiveState.ready) {
    try { cb(); } catch { /* best effort */ }
    return () => {};
  }
  petRiveState.readyCallbacks.push(cb);
  return () => {
    const idx = petRiveState.readyCallbacks.indexOf(cb);
    if (idx !== -1) petRiveState.readyCallbacks.splice(idx, 1);
  };
}

export function getPetRiveStats(): { ready: boolean; cached: number; artboards: number } {
  return {
    ready: petRiveState.ready,
    cached: cachedSpeciesCount(),
    artboards: petRiveState.artboardNames.size,
  };
}

// Runtime + file access for consumers that need to instantiate their OWN
// artboards for live per-frame animation (e.g. TD balloons). Returns null
// until warmup completes. Callers must NOT reuse petRive's shared workCanvas
// or renderer — create their own to avoid GL-state contention with warmups.
export function getPetRiveInternals(): {
  runtime: import('../../rive-engine/types').LowLevelRive;
  file: import('./state').RivePetsFile;
} | null {
  if (!petRiveState.ready || !petRiveState.runtime || !petRiveState.file) return null;
  return { runtime: petRiveState.runtime, file: petRiveState.file };
}
