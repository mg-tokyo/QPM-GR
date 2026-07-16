// src/rive-engine/index.ts

import { storage } from '../utils/storage';
import { shareGlobal } from '../core/pageContext';
import type {
  RiveInstance, OverrideScope, OverrideInfo, InputDescriptor,
  ImageOverrideOpts, InputOverrideOpts, TriggerOpts,
  TextOverrideOpts, AssetInterceptOpts, SpeedOverrideOpts,
  LowLevelRive, RiveImage,
  RiveEngineEventMap, RiveEngineListener,
} from './types';
import { riveLog, decodeImageBytes, EventBus } from './helpers';
import {
  startRiveEngineDiagnostics,
  publishOk as publishRiveOk,
  warnRiveEngine,
} from './_diagnostics';
import { writeShimConsole } from '../diagnostics/logger';
import {
  captureRiveRuntime, getRiveSingleton, awaitRiveSingleton, releaseRiveCapture,
  findAllRiveRuntimes,
} from './runtimeCapture';
import {
  initInstanceTracker,
  getAllInstances, getInstance, getInstancesBySource, getInstancesByTag,
  addTag, findAvatarInstanceByPlayerId, findAllAvatarInstances,
  debugAvatarParentChains,
  findInstancesUnderPixiContainer,
} from './instanceTracker';
import {
  setImageOverride as setImageOverrideImpl,
  revertAllImageOverrides, getActiveImageOverrides,
  applyImageOverridesToNewInstance,
  reapplyImageOverrides,
} from './imageOverrides';
import {
  setInputOverride as setInputOverrideImpl,
  fireTrigger as fireTriggerImpl,
  revertAllInputOverrides, getActiveInputOverrides,
  applyInputOverridesToNewInstance,
} from './inputOverrides';
import {
  setTextOverride as setTextOverrideImpl,
  revertAllTextOverrides, getActiveTextOverrides,
  applyTextOverridesToNewInstance,
} from './textOverrides';
import {
  setSpeedOverride as setSpeedOverrideImpl,
  revertAllSpeedOverrides, getActiveSpeedOverrides,
  applySpeedOverridesToNewInstance,
} from './speedOverrides';
// File + asset interceptors are wired through the fetch interceptor (.riv
// URL → override bytes) and the load wrapper (assetLoader injection). See
// fetchInterceptor.ts and loadWrapper.ts for the consumer side.
import {
  setFileOverride as setFileOverrideImpl,
  revertAllFileOverrides, getActiveFileOverrides,
  restoreFileOverridesFromStorage,
  awaitOverridePersist,
} from './fileOverrides';
import {
  setAssetInterceptor as setAssetInterceptorImpl,
  revertAllAssetInterceptors, getActiveAssetInterceptors,
} from './assetInterceptor';
import {
  initRivFetchInterceptor, findUrlForBytes, listSeenRivUrls,
  setCaptureFetchStacks, getFetchStacks,
} from './fetchInterceptor';
import {
  getLoadCallCount, verifyRiveWrap, getWrappedRuntimeCount,
  getSniffedAssets, clearSniffedAssets,
  getLoadHistory, clearLoadHistory,
  liveSwapAssetImage, listTrackedAssets, clearTrackedAssets,
} from './loadWrapper';

// Live runtime mutation: replace a single image asset inside an already-
// loaded .riv bundle. The asset reference was tracked when rive.load() ran;
// liveSwapAssetImage decodes the supplied bytes via the runtime that owns
// the asset and calls setRenderImage on it. Mutates the file-level asset,
// so every sprite sharing this artboard sees the change.
export { liveSwapAssetImage, listTrackedAssets, clearTrackedAssets };
import { initCanvasRuntimeTrap, getTrapAssignmentCounts } from './canvasRuntimeTrap';

// Re-exported: the Object.prototype.runtime setter trap that catches the
// @rive-app/canvas-advanced runtime as it's assigned to RiveFile instances.
// Must be called at the very top of the userscript bootstrap, before any
// game code can construct a RiveFile.
export { initCanvasRuntimeTrap };

// Install the .riv fetch interceptor — must be called at the top of the
// userscript bootstrap so .riv bundles fetched early in game startup get
// fingerprinted before the engine runtime is captured. Idempotent; safe to
// call multiple times.
export { initRivFetchInterceptor };
import {
  enumerateInputs, enumerateImageProperties, enumerateTextRuns,
  dumpInstance, dumpAllInstances,
} from './enumeration';

// Re-export types for consumers
export type {
  RiveInstance, OverrideScope, OverrideInfo, InputDescriptor,
  ImageOverrideOpts, InputOverrideOpts, TriggerOpts,
  TextOverrideOpts, SpeedOverrideOpts,
  LowLevelRive, RiveImage,
};

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

const DEBUG_STORAGE_KEY = 'qpm.riveEngine.debug.v1';

let eventBus: EventBus | null = null;
let initialized = false;
let cleanups: Array<() => void> = [];

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export function initRiveEngine(): () => void {
  if (initialized) return () => {};
  initialized = true;

  startRiveEngineDiagnostics();

  const debugEnabled = storage.get<boolean>(DEBUG_STORAGE_KEY, false) ?? false;
  riveLog.enabled = debugEnabled;

  // Always capture the first fetch stack per .riv URL — one-shot per URL,
  // so the cost is negligible, and we lose nothing if the user never asks
  // for it. Disable later via captureFetchStacks(false) if desired.
  setCaptureFetchStacks(true);

  eventBus = new EventBus();

  // Replay overrides persisted in IndexedDB so registrations from prior
  // sessions survive reload. Fire-and-forget — the read is async (~50 ms
  // typical IDB latency) and the game's first .riv request is ~5 s into
  // page load (measured), so the replay completes with ample margin.
  // If init timing ever tightens to where the game can fetch a .riv
  // sub-second, this should be awaited (or the fetch interceptor gated
  // on a "restore complete" signal). See src/rive-engine/fileOverrideStore.ts.
  void restoreFileOverridesFromStorage(eventBus).catch((e) => {
    riveLog('File override restore failed', e);
  });

  const unsubRegistered = eventBus.on('registered', (instance: RiveInstance) => {
    applyImageOverridesToNewInstance(instance);
    applyInputOverridesToNewInstance(instance);
    applyTextOverridesToNewInstance(instance);
    applySpeedOverridesToNewInstance(instance);
  });
  cleanups.push(unsubRegistered);

  // Re-apply image overrides when game reloads cosmetics (audit fix #4)
  const unsubImageReloaded = eventBus.on('imageReloaded', ({ instanceId }) => {
    reapplyImageOverrides(instanceId);
  });
  cleanups.push(unsubImageReloaded);

  const stopTracker = initInstanceTracker(eventBus);
  cleanups.push(stopTracker);

  // Fetch interceptor for .riv URLs is installed independently — call
  // initRivFetchInterceptor() at the top of the userscript bootstrap, not
  // here. This engine init is Phase 8, by which point the game has already
  // fetched its critical .riv bundles (avatar, currency, etc.) into the
  // shared binary cache. Installing the hook here is too late for those.
  // initRivFetchInterceptor() is idempotent, so calling it twice is harmless.

  void captureRiveRuntime().then(() => {
    publishRiveOk('Ready');
    exposeDebugGlobals();
  }).catch((e) => {
    warnRiveEngine('QPM-RIVE-001', { what: 'runtimeCapture' }, e);
  });

  return () => {
    revertAll();
    for (const fn of cleanups) fn();
    cleanups = [];
    eventBus?.clear();
    eventBus = null;
    releaseRiveCapture();
    initialized = false;
    riveLog('RiveEngine stopped');
  };
}

export function isRiveEngineReady(): boolean {
  return initialized && getRiveSingleton() !== null;
}

// ---------------------------------------------------------------------------
// Runtime access
// ---------------------------------------------------------------------------

export { getRiveSingleton, awaitRiveSingleton };

export async function decodeImage(bytes: Uint8Array): Promise<RiveImage> {
  const rive = await awaitRiveSingleton();
  return decodeImageBytes(rive, bytes);
}

// ---------------------------------------------------------------------------
// Instance discovery
// ---------------------------------------------------------------------------

export {
  getAllInstances, getInstance, getInstancesBySource, getInstancesByTag,
  addTag, findAvatarInstanceByPlayerId, findAllAvatarInstances,
  findInstancesUnderPixiContainer,
};

/**
 * Resolve when an instance matching `predicate` is registered. Checks the
 * current registry synchronously first; if no match, subscribes to the
 * `registered` event and resolves on the first match. Resolves with `null`
 * after `timeoutMs` if nothing matches.
 *
 * Use this to wait for a Rive instance that the game mounts asynchronously
 * (e.g. the pet sprite inside an opening card). Returns null instead of
 * rejecting so callers can degrade gracefully without try/catch noise.
 */
export function waitForInstance(
  predicate: (instance: RiveInstance) => boolean,
  timeoutMs: number,
): Promise<RiveInstance | null> {
  // Sync check first — covers the case where the instance is already
  // registered by the time the caller asks. Avoids the listener round-trip.
  for (const inst of getAllInstances()) {
    if (predicate(inst)) return Promise.resolve(inst);
  }
  if (!eventBus) return Promise.resolve(null);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: RiveInstance | null) => {
      if (settled) return;
      settled = true;
      unsub();
      if (timer !== null) clearTimeout(timer);
      resolve(value);
    };
    const unsub = eventBus!.on('registered', (instance: RiveInstance) => {
      if (predicate(instance)) finish(instance);
    });
    const timer = setTimeout(() => finish(null), timeoutMs);
  });
}

// ---------------------------------------------------------------------------
// Overrides
// ---------------------------------------------------------------------------

export function setImageOverride(opts: ImageOverrideOpts): () => void {
  if (!eventBus) return () => {};
  return setImageOverrideImpl(opts, eventBus);
}

export function setInputOverride(opts: InputOverrideOpts): () => void {
  if (!eventBus) return () => {};
  return setInputOverrideImpl(opts, eventBus);
}

export function fireTrigger(opts: TriggerOpts): void {
  fireTriggerImpl(opts);
}

export function setTextOverride(opts: TextOverrideOpts): () => void {
  if (!eventBus) return () => {};
  return setTextOverrideImpl(opts, eventBus);
}

export function setSpeedOverride(opts: SpeedOverrideOpts): () => void {
  if (!eventBus) return () => {};
  return setSpeedOverrideImpl(opts, eventBus);
}

/**
 * Replace the bytes the Rive runtime loads for a given .riv URL. Matches
 * `rivFile` as a case-insensitive substring of the request URL. The
 * substitution happens in the fetch interceptor — registering after the
 * game has already cached the .riv won't retroactively swap it; the next
 * load that misses the game's shared cache will pick up the override.
 *
 * Use for whole-bundle replacement (e.g. ship a modded Turtle.riv). For
 * single-asset swaps inside an unmodified bundle, use setAssetInterceptor.
 */
export function setFileOverride(rivFile: string, bytes: Uint8Array): () => void {
  if (!eventBus) return () => {};
  return setFileOverrideImpl(rivFile, bytes, eventBus);
}

/**
 * Intercept a single asset inside a .riv bundle. `rivFile` is a substring
 * matched against the URL the bundle was fetched from; `assetName` is the
 * exact name (string) or pattern (RegExp) of the asset inside the bundle.
 * The handler is invoked per-asset and returns override bytes (or null to
 * let Rive use the embedded asset).
 *
 * Asset names are not statically known — call `__QPM_RIVE_ENGINE__.dumpAssets()`
 * after the game UI is up to see what asset names each bundle exposes.
 *
 * KNOWN SCOPE: the only bundle with external image assets is
 * avatarelements.riv (bottom/mid/top/discordAvatar + Rickroll easter-egg
 * slots). Other .riv bundles (giftbox, loader, currency, thoughtbubble,
 * decor) bake textures inline with no referenced asset names — the
 * assetLoader is never called for those.
 *
 * Pets: since ~v641, pet sprites ARE Rive (per-species artboards in
 * petz.riv — Horse, Capybara, Turtle, …). petz.riv doesn't expose external
 * image assets (setAssetInterceptor won't fire), but pets DO appear in the
 * instance registry as tag `pet` and support setInputOverride /
 * setSpeedOverride / fireTrigger. Historical v573 note: pets were not Rive
 * then; textureSwapper's static-atlas path was the only route.
 */
export function setAssetInterceptor(opts: AssetInterceptOpts): () => void {
  if (!eventBus) return () => {};
  return setAssetInterceptorImpl(opts, eventBus);
}

// ---------------------------------------------------------------------------
// Enumeration
// ---------------------------------------------------------------------------

export {
  enumerateInputs, enumerateImageProperties, enumerateTextRuns,
  dumpInstance, dumpAllInstances,
};

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export function onInstanceRegistered(cb: RiveEngineListener<'registered'>): () => void {
  return eventBus?.on('registered', cb) ?? (() => {});
}

export function onInstanceDestroyed(cb: RiveEngineListener<'destroyed'>): () => void {
  return eventBus?.on('destroyed', cb) ?? (() => {});
}

export function onOverrideApplied(cb: RiveEngineListener<'overrideApplied'>): () => void {
  return eventBus?.on('overrideApplied', cb) ?? (() => {});
}

export function onOverrideReverted(cb: RiveEngineListener<'overrideReverted'>): () => void {
  return eventBus?.on('overrideReverted', cb) ?? (() => {});
}

// ---------------------------------------------------------------------------
// Bulk
// ---------------------------------------------------------------------------

export function revertAll(): void {
  revertAllImageOverrides();
  revertAllInputOverrides();
  revertAllTextOverrides();
  revertAllSpeedOverrides();
  revertAllFileOverrides();
  revertAllAssetInterceptors();
  riveLog('All overrides reverted');
}

export function getActiveOverrides(): OverrideInfo[] {
  return [
    ...getActiveImageOverrides(),
    ...getActiveInputOverrides(),
    ...getActiveTextOverrides(),
    ...getActiveSpeedOverrides(),
    ...getActiveFileOverrides(),
    ...getActiveAssetInterceptors(),
  ];
}

// ---------------------------------------------------------------------------
// Debug
// ---------------------------------------------------------------------------

export function setRiveEngineDebug(enabled: boolean): void {
  riveLog.enabled = enabled;
  try { storage.set(DEBUG_STORAGE_KEY, enabled); } catch {}
}

export function isRiveEngineDebugEnabled(): boolean {
  return riveLog.enabled;
}

function exposeDebugGlobals(): void {
  // The asset map is populated ALWAYS by the load wrapper itself (every
  // rive.load() since engine init has been writing into it). dumpAssets()
  // is therefore a snapshot of everything seen so far, no opt-in required.
  const startAssetSniffer = (): boolean => {
    // Backwards-compat: was an opt-in gate before. Now just clears state so
    // the next dump only shows what arrives from this point forward.
    clearSniffedAssets();
    return true;
  };

  const stopAssetSniffer = (): boolean => true;

  const dumpAssets = (): Record<string, string[]> => {
    const out = getSniffedAssets();
    try { writeShimConsole('QPM:RiveEngine', ['dumpAssets — by URL:', out]); } catch { /* console unavailable in sandbox */ }
    return out;
  };

  shareGlobal('__QPM_RIVE_ENGINE__', {
    runtime: getRiveSingleton(),
    instances: () => getAllInstances(),
    enumerate: (id: string) => ({
      inputs: enumerateInputs(id),
      images: enumerateImageProperties(id),
      textRuns: enumerateTextRuns(id),
    }),
    setImage: (id: string, property: string, url: string) =>
      setImageOverride({ target: { type: 'instance', id }, property, image: url }),
    setInput: (id: string, input: string, value: boolean | number) =>
      setInputOverride({ target: { type: 'instance', id }, input, value }),
    setSpeed: (id: string, speed: number) =>
      setSpeedOverride({ target: { type: 'instance', id }, speed }),
    fire: (id: string, trigger: string) =>
      fireTrigger({ target: { type: 'instance', id }, trigger }),
    // Async so callers can `await __QPM_RIVE_ENGINE__.setFile(...)` before
    // reloading and be sure the IDB write committed. The returned cleanup
    // is still synchronous to invoke.
    setFile: async (rivFile: string, bytes: Uint8Array) => {
      const cleanup = setFileOverride(rivFile, bytes);
      await awaitOverridePersist();
      return cleanup;
    },
    awaitPersist: () => awaitOverridePersist(),
    setAsset: (rivFile: string, assetName: string | RegExp, handler: (name: string) => Uint8Array | null) =>
      setAssetInterceptor({ rivFile, assetName, handler }),
    overrides: () => getActiveOverrides(),
    revertAll,
    findAvatar: (playerId: string) => findAvatarInstanceByPlayerId(playerId),
    avatars: () => findAllAvatarInstances(),
    debugParentChains: () => debugAvatarParentChains(),
    // Discovery for asset interceptors: open the target window (e.g. a pet
    // card), call startAssetSniffer() before the load, then dumpAssets()
    // after the load runs. URLs map to the asset names you'd hand to setAsset.
    startAssetSniffer,
    stopAssetSniffer,
    dumpAssets,
    findUrlForBytes,
    listSeenRivUrls,
    // Definitive "did the wrapper fire" signal — increments on every
    // rive.load() call. If 0 after opening a pet card, the load wrapper
    // isn't on the runtime singleton the card actually uses.
    loadCallCount: () => getLoadCallCount(),
    // Every rive.load() invocation recorded — including bundles that
    // produced zero external assets (which don't appear in dumpAssets).
    // Disambiguates "bundle never loaded" from "bundle loaded but baked".
    loadHistory: () => {
      const h = getLoadHistory();
      try { console.table(h); } catch {}
      return h;
    },
    clearLoadHistory: () => { clearLoadHistory(); return true; },
    // Every (url, assetName) we have a live reference to. Source of truth
    // for which targets liveSwap can hit.
    tracked: () => {
      const t = listTrackedAssets();
      try { console.table(t); } catch {}
      return t;
    },
    // Live-swap by file substring + asset name. Pass the replacement bytes
    // (PNG, JPEG, WebP — anything rive.decodeImage accepts). Returns
    // { ok: true } on accept; { ok: false, reason } otherwise.
    liveSwap: (rivFile: string, assetName: string, bytes: Uint8Array) =>
      liveSwapAssetImage(rivFile, assetName, bytes),
    clearTracked: () => { clearTrackedAssets(); return true; },
    wrappedRuntimeCount: () => getWrappedRuntimeCount(),
    // Trap diagnostics: total .runtime assignments observed, how many were
    // rive-shaped, and how many distinct runtimes we ended up wrapping.
    // Mismatch (matched > wrappedRuntimes) means we saw the same runtime
    // assigned multiple times to different RiveFile instances (expected).
    trapCounts: () => getTrapAssignmentCounts(),
    // Per-runtime wrap state: returns one entry per wrapped runtime with
    // its label ('lowLevelRiveAtom', 'canvas-trap', etc), wrapped flag, and
    // a sample of the current .load. wrapped:false on any entry means
    // something replaced our patch after we installed it.
    verifyWrap: () => verifyRiveWrap(),
    // List every low-level rive runtime visible in any atom. If this returns
    // more than one, we may have hooked the wrong one.
    // Enable/disable stack capture for .riv fetches. Turn ON, refresh page,
    // wait for the game to load, then call getFetchStacks() to see the
    // caller stack for each .riv URL. The stack tells us which module is
    // loading the bundle (RiveSprite vs RiveFile vs something else).
    captureFetchStacks: (enabled: boolean) => { setCaptureFetchStacks(enabled); return enabled; },
    getFetchStacks: () => getFetchStacks(),
    findAllRuntimes: () => {
      const all = findAllRiveRuntimes();
      try {
        console.table(all.map((r, i) => ({
          idx: i,
          atomLabel: r.atomLabel,
          isCaptured: r.matches === getRiveSingleton(),
          hasLoad: typeof (r.matches as { load?: unknown }).load === 'function',
          loadWrapped: ((r.matches as { load?: { __qpmWrapped?: boolean } }).load?.__qpmWrapped) === true,
        })));
      } catch {}
      return all;
    },
    // Discovery — open a card, call dumpInstance(id) for one instance or
    // dumpPet() for everything under tag 'pet'. The imageProperties /
    // textRuns arrays are the swappable surface; viewModelKeys lists raw
    // private fields to chase when the structured probe comes back empty.
    dumpInstance: (id: string) => dumpInstance(id),
    dumpAllInstances: (tagFilter?: string) => dumpAllInstances(tagFilter),
    dumpPet: () => {
      const result = dumpAllInstances('pet');
      try {
        console.table(result.map((r) => ({
          id: r.id,
          artboard: r.artboard,
          tags: r.tags.join(','),
          inputs: r.inputs.length,
          images: r.imageProperties.length,
          textRuns: r.textRuns.length,
        })));
        writeShimConsole('QPM:RiveEngine', ['dumpPet — full result:', result]);
      } catch { /* console may be unavailable in some sandboxes */ }
      return result;
    },
  });
}
