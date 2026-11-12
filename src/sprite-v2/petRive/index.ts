import { awaitRiveSingleton } from '../../rive-engine';
import { onRivUrlSeen } from '../../rive-engine/fetchInterceptor';
import { spriteLog } from '../diagnostics';
import { reportPetRiveDiscovery } from '../service/healthIntegration';
import { petRiveState, resetPetRiveState } from './state';
import {
  getCachedCanvas,
  getCachedDataUrl,
  getCachedMutatedCanvas,
  cacheMutatedCanvas,
  getCachedMutatedDataUrl,
  cacheCanvas,
  clearPetRiveCache,
  cachedSpeciesCount,
} from './cache';
import { discoverPetRiveSources, fetchRivBytes, listSeenSpecies, speciesForSeenUrl } from './bundleLoader';
import {
  setupRenderer,
  loadRiveFile,
  renderFileArtboards,
  notifySpritesRefresh,
  scheduleSpritesRefresh,
  cancelScheduledRefresh,
} from './renderer';

let initPromise: Promise<void> | null = null;

function fireReadyCallbacks(): void {
  const callbacks = petRiveState.readyCallbacks.slice();
  petRiveState.readyCallbacks.length = 0;
  for (const cb of callbacks) {
    try { cb(); } catch (error) {
      spriteLog('warn', 'pet-rive-ready-callback-failed', 'onPetRiveReady callback threw', {
        error: String((error as Error)?.message ?? error),
      });
    }
  }
}

function markFailed(species: string, reason: string): void {
  petRiveState.failed.add(species);
  spriteLog('warn', 'pet-rive-species-failed', `Pet Rive species '${species}' failed: ${reason}`, { species, reason }, {
    onceKey: `pet-rive-species-failed:${species}`,
  });
}

async function loadSpecies(species: string, url: string): Promise<void> {
  const { runtime, renderer, workCanvas } = petRiveState;
  if (!runtime || !renderer || !workCanvas) return;

  const bytes = await fetchRivBytes(url);
  if (petRiveState.runtime !== runtime) return; // stopped while fetching
  if (!bytes) { markFailed(species, 'fetch'); return; }

  const file = await loadRiveFile(runtime, bytes, species);
  if (petRiveState.runtime !== runtime) { try { file?.unref?.(); } catch { /* ignore */ } return; }
  if (!file) { markFailed(species, 'load'); return; }

  const { rendered } = renderFileArtboards(runtime, file, renderer, workCanvas);
  try { file.unref?.(); } catch { /* ignore */ }

  const first = rendered[0];
  if (!first) { markFailed(species, 'render'); return; }
  // Cache under the species key too when the artboard carries a different name.
  if (!getCachedCanvas(species)) {
    const canvas = getCachedCanvas(first);
    if (canvas) cacheCanvas(species, canvas);
  }
  scheduleSpritesRefresh();
}

function requestSpecies(species: string): Promise<void> {
  const sources = petRiveState.sources;
  if (!sources || sources.kind !== 'split' || !petRiveState.ready) return Promise.resolve();
  const url = sources.bySpecies.get(species);
  if (!url || petRiveState.failed.has(species) || getCachedCanvas(species)) return Promise.resolve();
  const existing = petRiveState.inFlight.get(species);
  if (existing) return existing;
  const task = loadSpecies(species, url).finally(() => { petRiveState.inFlight.delete(species); });
  petRiveState.inFlight.set(species, task);
  return task;
}

/** Sequential so each species is its own task; the game already fetched these files. */
async function warmSeenSpecies(): Promise<void> {
  const sources = petRiveState.sources;
  if (!sources) return;
  const species = listSeenSpecies(sources);
  const started = performance.now();
  for (const s of species) {
    if (petRiveState.sources !== sources) return;
    await requestSpecies(s);
  }
  spriteLog('info', 'pet-rive-warm-complete', 'Pet Rive warm of game-fetched species complete', {
    warmed: species.length,
    cached: cachedSpeciesCount(),
    discovered: petRiveState.artboardNames.size,
    ms: Math.round(performance.now() - started),
  });
}

async function warmSingleFile(url: string): Promise<void> {
  const { runtime, renderer, workCanvas } = petRiveState;
  if (!runtime || !renderer || !workCanvas) return;
  const bytes = await fetchRivBytes(url);
  if (!bytes) return;
  const file = await loadRiveFile(runtime, bytes, 'pets.riv');
  if (!file) return;
  petRiveState.file = file;
  const { rendered, skipped } = renderFileArtboards(runtime, file, renderer, workCanvas);
  petRiveState.ready = true;
  spriteLog('info', 'pet-rive-warmup-complete', 'Pet species Rive warmup complete', {
    rendered: rendered.length,
    skipped: skipped.length,
    skippedNames: skipped,
  });
}

async function performInit(): Promise<void> {
  const runtime = await awaitRiveSingleton();
  petRiveState.runtime = runtime;

  const sources = await discoverPetRiveSources();
  petRiveState.sources = sources;
  const discovered = sources.kind === 'split' ? sources.bySpecies.size : sources.kind === 'single' ? 1 : 0;
  reportPetRiveDiscovery(discovered);
  if (sources.kind === 'none') {
    spriteLog('warn', 'pet-rive-url-missing', 'No pet .riv sources discoverable', undefined, {
      onceKey: 'pet-rive-url-missing',
    });
    return;
  }

  const setup = setupRenderer(runtime, () => { void reWarm(); });
  if (!setup) return;
  petRiveState.renderer = setup.renderer;
  petRiveState.workCanvas = setup.canvas;

  if (sources.kind === 'split') {
    for (const species of sources.bySpecies.keys()) petRiveState.artboardNames.add(species);
    petRiveState.ready = true;
    fireReadyCallbacks();
    notifySpritesRefresh();
    // The game fetches a species file only when it shows that pet, usually
    // after this init ran: warm each one as its fetch lands (HTTP cache hit).
    petRiveState.cleanups.push(onRivUrlSeen((url) => {
      const species = speciesForSeenUrl(sources, url);
      if (species) void requestSpecies(species);
    }));
    await warmSeenSpecies();
    return;
  }

  await warmSingleFile(sources.url);
  if (!petRiveState.ready) return;
  fireReadyCallbacks();
  notifySpritesRefresh();
}

async function reWarm(): Promise<void> {
  const { runtime, renderer, workCanvas, sources } = petRiveState;
  if (!runtime || !renderer || !workCanvas || !sources) return;
  clearPetRiveCache();
  petRiveState.failed.clear();
  if (sources.kind === 'split') {
    petRiveState.ready = true;
    await warmSeenSpecies();
  } else if (petRiveState.file) {
    const { rendered, skipped } = renderFileArtboards(runtime, petRiveState.file, renderer, workCanvas);
    petRiveState.ready = true;
    spriteLog('info', 'pet-rive-rewarm-complete', 'Pet species Rive re-warm complete', {
      rendered: rendered.length,
      skipped: skipped.length,
    });
  }
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
  cancelScheduledRefresh();
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
  const cached = getCachedCanvas(species);
  if (cached) return cached;
  void requestSpecies(species);
  return null;
}

export function getPetRiveDataUrl(species: string): string {
  if (!species) return '';
  const cached = getCachedDataUrl(species);
  if (cached) return cached;
  void requestSpecies(species);
  return '';
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

// Single-file mode only: split mode unref's each per-species file after
// rendering, so there is no shared file to hand out (returns null).
export function getPetRiveInternals(): {
  runtime: import('../../rive-engine/types').LowLevelRive;
  file: import('./state').RivePetsFile;
} | null {
  if (!petRiveState.ready || !petRiveState.runtime || !petRiveState.file) return null;
  return { runtime: petRiveState.runtime, file: petRiveState.file };
}
