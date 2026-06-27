// src/rive-engine/loadWrapper.ts
//
// Monkey-patch LowLevelRive.load to inject a CustomFileAssetLoader that
// consults the assetInterceptor registry for each asset in a .riv bundle.
//
// Why this exists: the game calls `rive.load(bytes)` from multiple paths
// (low-level RiveSprite, high-level RiveFile via @rive-app/canvas) without
// passing an asset loader. The Rive runtime falls back to the bytes embedded
// inside the .riv. To swap a pet's texture (which is baked into the bundle),
// we MUST intercept asset decoding — there is no view-model property to
// override after the fact.
//
// Multiple-runtime support: production uses TWO distinct rive WASM instances:
//   1. @rive-app/webgl2-advanced — captured via lowLevelRiveAtom (Jotai).
//   2. @rive-app/canvas-advanced — captured via the Object.prototype.runtime
//      trap in canvasRuntimeTrap.ts (it lives in a closure inside
//      @rive-app/canvas and is unreachable from window any other way).
// Both runtimes go through wrapRiveLoad() and share state below.
//
// How asset → URL matching works: the fetch interceptor fingerprints every
// .riv response by URL. When `rive.load(bytes)` runs, we reverse-lookup the
// URL via findUrlForBytes(bytes) and feed it to getAssetHandler(url, name).
// If the bytes were never fetched through our interceptor (engine started
// late, bytes synthesized locally), URL is null and we don't apply any
// interceptors — the load proceeds with embedded assets as if we weren't
// here.
//
// Caller assetLoader chaining: if the game passes its own assetLoader to
// rive.load() (the high-level RiveFile path does for avatars), we call
// through to it first and only consult our registry when the caller returns
// false. That preserves the game's own dynamic-asset behaviour.

import type { LowLevelRive } from './types';
import { riveLog } from './helpers';
import { getAssetHandler } from './assetInterceptor';
import { findUrlForBytes } from './fetchInterceptor';

interface RiveAssetLike {
  name: string;
  isImage?: boolean;
  isFont?: boolean;
  setRenderImage?: (image: unknown) => void;
  decode?: (bytes: Uint8Array) => unknown;
}

interface TrackedAsset {
  asset: RiveAssetLike;
  rive: LowLevelRive;
  riveLabel: string;
  capturedAt: number;
}

type AssetSniffer = (url: string | null, asset: RiveAssetLike) => void;

interface WrappedEntry {
  rive: LowLevelRive;
  originalLoad: LowLevelRive['load'];
  label: string;
}

// Indexed by the rive object itself — supports multiple runtimes (low-level
// via Jotai, canvas via prototype trap) at once. Each entry holds the
// original .load so we can restore on teardown.
const wrappedRuntimes = new Map<LowLevelRive, WrappedEntry>();
let assetSniffer: AssetSniffer | null = null;
let loadCallCount = 0;

// Always-on asset-name collector. Populated by every rive.load() callback
// the wrapper runs, indexed by .riv URL. Lives at module scope so it
// captures from the very first load, not just after the user enables a
// sniffer manually. The user-facing dumpAssets() reads this directly.
const sniffedAssetsByUrl = new Map<string, Set<string>>();

// Records every rive.load() invocation independently of whether the bundle
// produced any external assets. A bundle that bakes all textures into the
// file calls our wrap (loadCallCount++) but never invokes the assetLoader,
// so sniffedAssetsByUrl gets no entry. This map shows the URL anyway,
// which is what disambiguates "bundle wasn't loaded" from "bundle was
// loaded with zero external assets."
interface LoadRecord {
  url: string | null;
  label: string;
  byteLength: number;
  callIndex: number;
}
const loadHistory: LoadRecord[] = [];

export function getLoadHistory(): LoadRecord[] {
  return loadHistory.slice();
}

export function clearLoadHistory(): void {
  loadHistory.length = 0;
}

// File-level image asset references captured during rive.load() so we can
// later call asset.setRenderImage(decodedImage) for live texture swaps —
// no refresh required. Keyed by URL → asset name. Each entry carries the
// runtime that owns the asset so decodeImage runs on the correct WASM.
//
// Lifetime: assets are kept alive by Rive as long as the parent File is
// alive (which lives for the session for cached bundles like petz.riv).
// If a File is destroyed, setRenderImage on a stale asset will throw.
// Callers should swallow that and re-track via the next load.
//
// Counter is incremented on every track for monotonic age so callers can
// tell which capture is more recent if duplicates appear.
const trackedAssetsByUrl = new Map<string, Map<string, TrackedAsset>>();
let trackedSeq = 0;

function trackAsset(
  url: string,
  asset: RiveAssetLike,
  rive: LowLevelRive,
  riveLabel: string,
): void {
  let perFile = trackedAssetsByUrl.get(url);
  if (!perFile) {
    perFile = new Map();
    trackedAssetsByUrl.set(url, perFile);
  }
  perFile.set(asset.name, { asset, rive, riveLabel, capturedAt: ++trackedSeq });
}

/**
 * List every (url, assetName) pair currently tracked, with which runtime
 * label owns it. Used by debug tooling to confirm a swap target is alive
 * before calling liveSwapAssetImage.
 */
export function listTrackedAssets(): Array<{
  url: string;
  name: string;
  runtimeLabel: string;
  capturedAt: number;
}> {
  const out: Array<{ url: string; name: string; runtimeLabel: string; capturedAt: number }> = [];
  for (const [url, perFile] of trackedAssetsByUrl) {
    for (const [name, t] of perFile) {
      out.push({ url, name, runtimeLabel: t.riveLabel, capturedAt: t.capturedAt });
    }
  }
  return out;
}

export function clearTrackedAssets(): void {
  trackedAssetsByUrl.clear();
}

/**
 * Live-swap a single image asset inside an already-loaded .riv bundle.
 * `rivFile` is matched as a case-insensitive substring against tracked URLs
 * (same convention as setAssetInterceptor); `assetName` is an exact match
 * against the asset's name. `bytes` is the PNG (or JPEG/WebP — anything
 * rive.decodeImage handles) replacement.
 *
 * Returns `{ ok: true }` on synchronous accept (decode is async; the
 * texture change becomes visible when the next render tick runs after the
 * decode callback fires). Returns `{ ok: false, reason }` if no tracked
 * asset matches, the runtime can't decode, or the asset has no
 * setRenderImage method.
 *
 * Note: this mutates the FILE-level asset, which means EVERY sprite using
 * this artboard sees the swap (e.g. all Butterfly pets at once). For per-
 * instance swap you'd need a view-model binding, which the new pet
 * RiveSprites don't have (viewModelInstance: null).
 */
export function liveSwapAssetImage(
  rivFile: string,
  assetName: string,
  bytes: Uint8Array,
): { ok: boolean; reason?: string } {
  const fileNeedle = rivFile.toLowerCase();
  for (const [url, perFile] of trackedAssetsByUrl) {
    if (!url.toLowerCase().includes(fileNeedle)) continue;
    const t = perFile.get(assetName);
    if (!t) continue;

    const decoder = t.rive.decodeImage;
    if (typeof decoder !== 'function') {
      return { ok: false, reason: 'runtime has no decodeImage' };
    }
    const setter = t.asset.setRenderImage;
    if (typeof setter !== 'function') {
      return { ok: false, reason: 'asset has no setRenderImage (likely a font or non-image asset)' };
    }

    try {
      decoder.call(t.rive, bytes, (image: { unref?: () => void } | null) => {
        if (!image) {
          riveLog(`liveSwapAssetImage: decode returned null for ${url} / ${assetName}`);
          return;
        }
        try {
          (t.asset.setRenderImage as (i: unknown) => void).call(t.asset, image);
        } catch (e) {
          riveLog(`liveSwapAssetImage: setRenderImage threw for ${assetName}`, e);
        }
        try { image.unref?.(); } catch { /* ignore */ }
      });
      return { ok: true };
    } catch (e) {
      riveLog(`liveSwapAssetImage: decodeImage threw for ${assetName}`, e);
      return { ok: false, reason: 'decodeImage threw' };
    }
  }
  return { ok: false, reason: 'no tracked asset matches' };
}

function recordSniffedAsset(url: string | null, asset: RiveAssetLike): void {
  const key = url ?? '<unknown>';
  let set = sniffedAssetsByUrl.get(key);
  if (!set) {
    set = new Set();
    sniffedAssetsByUrl.set(key, set);
  }
  const name = String(asset.name ?? '');
  if (name) set.add(name);
}

/** Snapshot of every asset name seen so far, indexed by .riv URL. */
export function getSniffedAssets(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [url, set] of sniffedAssetsByUrl) {
    out[url] = Array.from(set).sort();
  }
  return out;
}

/** Wipe the collected asset map. */
export function clearSniffedAssets(): void {
  sniffedAssetsByUrl.clear();
}

export function getLoadCallCount(): number {
  return loadCallCount;
}

/**
 * How many rive runtimes currently have their .load wrapped. Expect 2 in
 * production: webgl2-advanced + canvas-advanced.
 */
export function getWrappedRuntimeCount(): number {
  return wrappedRuntimes.size;
}

/**
 * Diagnostic: per-runtime wrap state. Returns `[{ label, wrapped, sample }]`
 * — one entry per wrapped runtime. `wrapped:false` for an entry means
 * something replaced our patch on that runtime after we installed it.
 */
export function verifyRiveWrap(): Array<{ label: string; wrapped: boolean; sample: string }> {
  if (wrappedRuntimes.size === 0) return [{ label: '<none>', wrapped: false, sample: '<no-runtime>' }];
  const out: Array<{ label: string; wrapped: boolean; sample: string }> = [];
  for (const entry of wrappedRuntimes.values()) {
    const fn = (entry.rive as unknown as Record<string, unknown>).load as unknown;
    let sample = '';
    let wrapped = false;
    if (typeof fn === 'function') {
      wrapped = (fn as unknown as Record<string, unknown>).__qpmWrapped === true;
      try { sample = String(fn).slice(0, 80); } catch { sample = '<unstringifiable>'; }
    } else {
      sample = typeof fn;
    }
    out.push({ label: entry.label, wrapped, sample });
  }
  return out;
}

export function setAssetSniffer(cb: AssetSniffer | null): void {
  assetSniffer = cb;
}

function isAssetLike(value: unknown): value is RiveAssetLike {
  return value != null && typeof value === 'object' && 'name' in (value as object);
}

// CustomFileAssetLoader's NATIVE loadContents (runtime source index-qJ6k2ajy.js
// line 30 ~pos 39138) is `function(e, t) { return e = r.ptrToAsset(e), this.Eb(e, t); }`
// — the wrapper does `r.ptrToAsset` BEFORE handing control to the JS callback
// we install via `new CustomFileAssetLoader({loadContents: fn})`. So our
// callback receives (resolvedAsset, bytes), not (rawPtr, bytes). Calling
// `r.ptrToAsset` a second time here throws (`null.isImage`) because
// `r.ptrToFileAsset(jsObject)` returns null — and that throw kills the whole
// chain since FallbackFileAssetLoader iterates without try/catch (broke
// avatarelements / blobling preview). Don't generalise from CDNFileAssetLoader
// which IS a native subclass and DOES receive a raw pointer.
type RiveLoadContents = (asset: unknown, bytes: Uint8Array) => boolean;

function makeOverrideLoader(
  rive: LowLevelRive,
  url: string | null,
  riveLabel: string,
): RiveLoadContents {
  return (assetArg, bytes) => {
    const asset = assetArg as RiveAssetLike | null;
    if (!isAssetLike(asset)) return false;

    // Always record the asset for dumpAssets(). Cheap (one Map.get + Set.add
    // per asset). Independent of the optional assetSniffer hook below.
    recordSniffedAsset(url, asset);

    // Track image asset references for live runtime swap (liveSwapAssetImage).
    // We hold the asset reference + the runtime that owns it so future decode
    // calls route through the right WASM. URL is required — without it we
    // wouldn't know which entry to match in liveSwapAssetImage's substring
    // lookup. Non-image assets are not tracked because setRenderImage is the
    // mechanism we use for swap.
    if (url && asset.isImage && asset.name) {
      trackAsset(url, asset, rive, riveLabel);
    }

    if (assetSniffer) {
      try { assetSniffer(url, asset); } catch (e) { riveLog('asset sniffer error', e); }
    }

    if (!url) return false;

    const name = String(asset.name ?? '');
    const handler = getAssetHandler(url, name);
    if (!handler) return false;

    const override = handler(name);
    if (!override) return false;

    if (asset.isImage && typeof rive.decodeImage === 'function') {
      try {
        rive.decodeImage(override, (image) => {
          if (image && typeof asset.setRenderImage === 'function') {
            asset.setRenderImage(image);
            (image as { unref?: () => void }).unref?.();
          }
        });
        return true;
      } catch (e) {
        riveLog('asset decode/setRenderImage failed', e);
        return false;
      }
    }

    if (typeof asset.decode === 'function') {
      try {
        asset.decode(override);
        return true;
      } catch (e) {
        riveLog('asset.decode failed', e);
        return false;
      }
    }

    return false;
  };
}

/**
 * Replace `rive.load` with a wrapper that injects an assetLoader. Idempotent
 * per-runtime: calling for a runtime already wrapped is a no-op. Multiple
 * distinct runtimes can be wrapped simultaneously (webgl2-advanced + canvas).
 *
 * Composition: we build a FallbackFileAssetLoader containing [our override
 * loader, caller's loader] and pass that to the original `rive.load`. Rive's
 * own `r.load` then wraps OUR chain alongside `CDNFileAssetLoader` in its
 * outer FallbackFileAssetLoader. Effective dispatch order:
 *   ours → caller → CDN
 * which means: overrides win when they match; otherwise the game's caller
 * loader runs with the WASM-pointer contract it was built for (no more
 * `Cannot read properties of null` from us trying to invoke it manually);
 * otherwise CDN fallback handles embedded assets.
 */
export function wrapRiveLoad(rive: LowLevelRive, label = 'unknown'): void {
  if (wrappedRuntimes.has(rive)) return;

  const originalLoad = rive.load;
  wrappedRuntimes.set(rive, { rive, originalLoad, label });

  // Resolve runtime chain primitives once per wrap install. Both are
  // emscripten `n.extend(...)` bindings exposed on the runtime object.
  // FallbackFileAssetLoader iterates loaders and returns on the first true;
  // CustomFileAssetLoader wraps a JS `{loadContents}` callback, calling
  // `r.ptrToAsset` itself before invoking it (see RiveLoadContents above).
  const riveObj = rive as unknown as Record<string, unknown>;
  const CustomLoader = typeof riveObj.CustomFileAssetLoader === 'function'
    ? riveObj.CustomFileAssetLoader as new (opts: { loadContents: RiveLoadContents }) => unknown
    : null;
  const Fallback = typeof riveObj.FallbackFileAssetLoader === 'function'
    ? riveObj.FallbackFileAssetLoader as new () => { addLoader(loader: unknown): void }
    : null;

  if (!CustomLoader || !Fallback) {
    riveLog(
      `wrapRiveLoad(${label}): runtime missing chain primitives ` +
      `(CustomFileAssetLoader=${!!CustomLoader}, FallbackFileAssetLoader=${!!Fallback}). ` +
      `Pass-through mode: load history will record but asset overrides + sniffing ` +
      `will not run for this runtime.`,
    );
  }

  const wrapped = function (this: unknown, bytes: Uint8Array, callerLoader?: unknown) {
    loadCallCount++;
    const url = findUrlForBytes(bytes);
    loadHistory.push({ url, label, byteLength: bytes.byteLength, callIndex: loadCallCount });
    riveLog(`rive.load(${label}) called #${loadCallCount} — url=${url ?? '<unknown>'} bytes=${bytes.byteLength}`);

    if (!CustomLoader || !Fallback) {
      // Defensive: runtime lacks the chain classes we need. Don't drop the
      // caller — pass it through so the game's loader still runs.
      return originalLoad.call(rive, bytes, callerLoader);
    }

    const overrideFn = makeOverrideLoader(rive, url, label);
    const overrideLoader = new CustomLoader({ loadContents: overrideFn });

    const chain = new Fallback();
    // Our override loader FIRST: when a user has registered an override for
    // an asset, that explicit intent wins. The caller's loader (e.g.
    // AvatarRiveFileCache's `r[name]=asset` bookkeeping) is skipped for that
    // single asset; non-overridden assets fall through normally.
    chain.addLoader(overrideLoader);
    if (callerLoader !== undefined) chain.addLoader(callerLoader);

    return originalLoad.call(rive, bytes, chain);
  };
  (wrapped as unknown as Record<string, unknown>).__qpmWrapped = true;
  (wrapped as unknown as Record<string, unknown>).__qpmLabel = label;
  (rive as unknown as Record<string, unknown>).load = wrapped as unknown as Function;

  // Also wrap the runtime's File constructor — some loading paths in the
  // bundled @rive-app/canvas code use `new rive.File(bytes, callback)`
  // directly, bypassing .load(). Wrapping File ensures we see those too.
  // The File constructor signature varies across rive versions: callback-
  // last for older WASM, options-object for newer. We forward args
  // unchanged and pass the assetLoader through opts when available.
  const OrigFile = riveObj.File;
  if (typeof OrigFile === 'function') {
    const WrappedFile = function (this: unknown, ...args: unknown[]) {
      const bytes = args[0];
      if (bytes instanceof Uint8Array || bytes instanceof ArrayBuffer) {
        const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        loadCallCount++;
        const url = findUrlForBytes(u8);
        loadHistory.push({
          url,
          label: `${label}:File`,
          byteLength: u8.byteLength,
          callIndex: loadCallCount,
        });
        riveLog(`new rive.File(${label}) called #${loadCallCount} — url=${url ?? '<unknown>'} bytes=${u8.byteLength}`);
        // Note: we don't inject an assetLoader for the File constructor path
        // because its signature is not standardized across rive versions —
        // a wrong-shape arg would crash decoding. For now we just observe.
      }
      // Construct via Reflect.construct so `new` semantics survive.
      return Reflect.construct(OrigFile as Function, args, WrappedFile);
    } as unknown as Function;
    // Preserve constructor identity for `instanceof` checks via prototype.
    (WrappedFile as unknown as { prototype: unknown }).prototype = (OrigFile as { prototype: unknown }).prototype;
    (WrappedFile as unknown as Record<string, unknown>).__qpmWrapped = true;
    (WrappedFile as unknown as Record<string, unknown>).__qpmLabel = `${label}:File`;
    riveObj.File = WrappedFile;
  }

  riveLog(`rive.load wrapper installed (${label}); total wrapped runtimes: ${wrappedRuntimes.size}`);
}

/** Restore every wrapped runtime's original `.load`. Safe to call repeatedly. */
export function unwrapRiveLoad(): void {
  for (const entry of wrappedRuntimes.values()) {
    try {
      (entry.rive as unknown as Record<string, unknown>).load = entry.originalLoad as unknown as Function;
    } catch (e) {
      riveLog(`failed to unwrap ${entry.label}`, e);
    }
  }
  if (wrappedRuntimes.size > 0) {
    riveLog(`rive.load wrapper removed from ${wrappedRuntimes.size} runtime(s)`);
  }
  wrappedRuntimes.clear();
}
