// sprite-v2/index.ts - Main sprite system initialization
// Optimized for non-blocking initialization with cooperative yielding

import type { SpriteState, SpriteConfig, SpriteService, GetSpriteParams, RenderOptions } from './types';
import { DEFAULT_CFG } from './settings';
import { detectGameVersionWithRetry, buildAssetsBaseUrl, getRuntimeWindow } from './detector';
import { createPixiHooks, waitForPixi, ensureDocumentReady } from './hooks';
import { getJSON, loadAtlasJsons, isAtlas, getBlob, blobToImage, joinPath, relPath } from './manifest';
import { getCtors, rememberBaseTex } from './utils';
import { buildAtlasTextures, buildItemsFromTextures } from './atlas';
import { processVariantJobs, computeVariantSignature, textureToCanvas } from './renderer';
import { clearVariantCache, getCacheStats } from './cache';
import { clearSpriteDataUrlCache } from './compat';
import * as api from './api';
import { sleep } from '../utils/dom/dom';
import { yieldToBrowser, YieldController, delay } from '../utils/scheduling/scheduling';
import { log } from '../utils/logger';
import { storage } from '../utils/storage';
import { createKtx2DecoderPool, type Ktx2DecoderPool, type Ktx2DecoderTelemetry } from './ktx2';
import { spriteLog } from './diagnostics';
import { pageWindow } from '../core/pageContext';
import { healthBus } from '../diagnostics/healthBus';
import { createNamedLogger } from '../diagnostics/logger';
import type { Subsystem, SubsystemHealth } from '../diagnostics/types';

// ── Diagnostics bus wiring (Phase 2 item 2.5) ──────────────────────────────
const SPRITE_SUBSYSTEM: Subsystem = 'spriteV2';
const diagLog = createNamedLogger('spriteV2');
const HYDRATION_EVENT = 'qpm:sprite-hydration-state-change';

let spriteDiagnosticsStarted = false;
let hydrationEventHandler: ((event: Event) => void) | null = null;
let lastPublishedSig = '';

// Global state
let ctx: {
  cfg: SpriteConfig;
  state: SpriteState;
} | null = null;

// CRITICAL: Create hooks at MODULE LOAD TIME, not inside async functions!
// The game calls __PIXI_APP_INIT__ early - we must have hooks ready before that.
const hooks = createPixiHooks();

function createInitialState(): SpriteState {
  return {
    started: false,
    open: false,
    loaded: false,
    version: null,
    base: null,
    ctors: null,
    app: null,
    renderer: null,
    cat: '__all__',
    q: '',
    f: '',
    mutOn: false,
    mutations: [],
    scroll: 0,
    items: [],
    filtered: [],
    cats: new Map(),
    tex: new Map(),
    lru: new Map(),
    cost: 0,
    jobs: [],
    jobMap: new Set(),
    srcCan: new Map(),
    atlasBases: new Set(),
    dbgCount: {},
    sig: '',
    changedAt: 0,
    needsLayout: false,
    overlay: null,
    bg: null,
    grid: null,
    dom: null,
    selCat: null,
    count: null,
    pool: [],
    active: new Map(),
    anim: new Set(),
    loadMode: 'legacy',
    fallbackBase: null,
    decoder: createDecoderTelemetry(),
    runtimeTextureHints: [],
    ktx2Canvases: new WeakMap(),
  };
}

// Warmup progress tracking for UI feedback
export type SpriteWarmupState = { total: number; done: number; completed: boolean; phase: string };
let warmupState: SpriteWarmupState = { total: 0, done: 0, completed: false, phase: 'idle' };
const warmupListeners = new Set<(state: SpriteWarmupState) => void>();

function notifyWarmup(update: Partial<SpriteWarmupState>): void {
  Object.assign(warmupState, update);
  for (const listener of warmupListeners) {
    try {
      listener(warmupState);
    } catch {
      /* ignore listener errors */
    }
  }
}

export function getSpriteWarmupState(): SpriteWarmupState {
  return { ...warmupState };
}

export function onSpriteWarmupProgress(listener: (state: SpriteWarmupState) => void): () => void {
  warmupListeners.add(listener);
  // Emit current state immediately
  try {
    listener(warmupState);
  } catch {
    /* ignore */
  }
  return () => {
    warmupListeners.delete(listener);
  };
}

// Prefetched atlas data for parallel loading
type PrefetchedAtlas = {
  base: string;
  atlasJsons: Record<string, any>;
  blobs: Map<string, Blob>;
};

let prefetchPromise: Promise<PrefetchedAtlas | null> | null = null;

const COMPRESSED_ATLAS_RE = /\.ktx2(?:[?#].*)?$/i;
const IMAGE_EXT_RE = /\.(png|webp|avif|jpg|jpeg|ktx2)$/i;
const TARGET_COMPRESSED_COVERAGE = 0.95;
const MAX_MISSING_SAMPLE = 8;
const ATLAS_DIMENSION_TOLERANCE = 3;
const RENDER_TARGET_HINT_RE = /backbuffer|render.?target|framebuffer|bigtriangle|gpu|view\.texture/i;
const KTX2_NATIVE_REQUIRED_VERSION = 114;
const ALLOW_KTX2_LEGACY_FALLBACK_KEY = 'qpm.debug.sprite.allowLegacyFallbackOnKtx2';

type AtlasLoaderMode = 'legacy' | 'compressed';
type SpriteLoadMode = 'legacy' | 'ktx2-native' | 'ktx2-native-failed' | 'legacy-fallback';
type AtlasSource = 'legacy-image' | 'ktx2-decoder' | 'legacy-fallback' | 'runtime-bridge';
type SpriteHydrationStatus = 'ok' | 'degraded' | 'failed';
type TextureSourceName = 'assets' | 'bridge' | 'runtime';

export type SpriteProbeInput =
  | string
  | {
      key?: string;
      category?: string;
      id?: string;
      mutations?: string[];
    };

export type SpriteProbeResult = {
  input: string;
  category: string;
  id: string;
  mutations: string[];
  ok: boolean;
  width: number;
  height: number;
  error?: string;
};

export type AtlasBootReport = {
  atlasPath: string;
  imagePath: string;
  mode: AtlasLoaderMode;
  source: AtlasSource;
  expectedFrames: number;
  hydratedFrames: number;
  coverage: number;
  status: SpriteHydrationStatus;
  sourceHits: Record<TextureSourceName, number>;
  missingSample: string[];
};

export type SpriteRendererReport = {
  rendererUid: string | number | null;
  rendererType: string | number | null;
  appRendererUid: string | number | null;
  sameAsAppRenderer: boolean;
  hasExtractCanvas: boolean;
  appHasExtractCanvas: boolean;
  lastRenderError: string | null;
  lastRenderErrorAt: number | null;
};

export type SpriteBootReport = {
  version: string | null;
  base: string | null;
  pixiVersion: string | null;
  finalMode: AtlasLoaderMode | 'mixed' | 'unknown';
  loadMode: SpriteLoadMode | 'unknown';
  status: SpriteHydrationStatus;
  expectedFrames: number;
  hydratedFrames: number;
  coverage: number;
  fallbackBase: string | null;
  atlasReports: AtlasBootReport[];
  bridgeSnapshot: any;
  renderer: SpriteRendererReport;
  decoder: Ktx2DecoderTelemetry;
  generatedAt: number;
};

let spriteBootReport: SpriteBootReport | null = null;
let lastSpriteRenderError: string | null = null;
let lastSpriteRenderErrorAt: number | null = null;
const spriteRenderFailureSignatures = new Set<string>();
let contextRestoreReloadPromise: Promise<void> | null = null;

type RuntimeTextureIndex = {
  exact: Map<string, any>;
  normalized: Map<string, any>;
};

type HydratePassResult = {
  hydrated: number;
  coverage: number;
  sourceHits: Record<TextureSourceName, number>;
  missingSample: string[];
  status: SpriteHydrationStatus;
};

function createDecoderTelemetry(): Ktx2DecoderTelemetry {
  return {
    workerReady: false,
    decodeAttempts: 0,
    decodeSuccesses: 0,
    decodeFailures: 0,
    totalDecodeMs: 0,
  };
}

function chooseKtx2DecoderConcurrency(): number {
  const cores = Number((navigator as any)?.hardwareConcurrency || 0);
  const memoryGb = Number((navigator as any)?.deviceMemory || 0);
  const lowEndByCores = Number.isFinite(cores) && cores > 0 && cores <= 4;
  const lowEndByMemory = Number.isFinite(memoryGb) && memoryGb > 0 && memoryGb <= 4;
  return lowEndByCores || lowEndByMemory ? 1 : 2;
}

function classifyKtx2Error(error: unknown): 'fetch-failed' | 'decode-timeout' | 'decode-failed' | 'canvas-build-failed' | 'wasm-blocked' {
  const msg = String((error as Error)?.message ?? error ?? '').toLowerCase();
  if (msg.includes('wasm') || msg.includes('webassembly') || msg.includes('csp') || msg.includes('script-src')) return 'wasm-blocked';
  if (msg.includes('timeout')) return 'decode-timeout';
  if (msg.includes('http') || msg.includes('network') || msg.includes('fetch')) return 'fetch-failed';
  if (msg.includes('canvas') || msg.includes('2d context')) return 'canvas-build-failed';
  return 'decode-failed';
}

/** Probe whether WebAssembly compilation is available (not blocked by CSP). */
function isWasmAvailable(): boolean {
  try {
    // Minimal valid WASM module header
    const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
    new WebAssembly.Module(bytes);
    return true;
  } catch {
    return false;
  }
}

function shouldAllowLegacyFallbackOnKtx2(): boolean {
  return storage.get<boolean>(ALLOW_KTX2_LEGACY_FALLBACK_KEY, false) === true;
}

type SpriteBridge = {
  loadAtlas?: (atlasPath: string, base: string, imagePath?: string, atlasData?: any) => Promise<any>;
  getAtlasTextures?: (atlasPath: string) => any;
  snapshot?: () => any;
  atlas?: Record<string, { textures?: Record<string, any> }>;
  runtimePool?: Record<string, any>;
};

function hasExtractCanvas(renderer: any): boolean {
  return typeof renderer?.extract?.canvas === 'function';
}

function getRendererUid(renderer: any): string | number | null {
  const uid = renderer?.uid ?? renderer?._uid ?? renderer?.CONTEXT_UID ?? renderer?.context?.uid ?? null;
  if (uid == null) return null;
  return typeof uid === 'number' || typeof uid === 'string' ? uid : String(uid);
}

function getRendererType(renderer: any): string | number | null {
  const type = renderer?.type ?? renderer?.context?.type ?? null;
  if (type == null) return null;
  return typeof type === 'number' || typeof type === 'string' ? type : String(type);
}

function buildRendererReport(state: SpriteState | null | undefined): SpriteRendererReport {
  const renderer = state?.renderer ?? null;
  const appRenderer = state?.app?.renderer ?? null;
  return {
    rendererUid: getRendererUid(renderer),
    rendererType: getRendererType(renderer),
    appRendererUid: getRendererUid(appRenderer),
    sameAsAppRenderer: Boolean(renderer && appRenderer && renderer === appRenderer),
    hasExtractCanvas: hasExtractCanvas(renderer),
    appHasExtractCanvas: hasExtractCanvas(appRenderer),
    lastRenderError: lastSpriteRenderError,
    lastRenderErrorAt: lastSpriteRenderErrorAt,
  };
}

function updateBootReportRenderer(state: SpriteState | null | undefined): void {
  if (!spriteBootReport) return;
  spriteBootReport = {
    ...spriteBootReport,
    renderer: buildRendererReport(state),
  };
}

function rememberRenderFailure(sig: string, detail: Record<string, unknown>): void {
  if (spriteRenderFailureSignatures.has(sig)) return;
  spriteRenderFailureSignatures.add(sig);
  if (spriteRenderFailureSignatures.size > 512) {
    spriteRenderFailureSignatures.clear();
  }
  spriteLog('warn', 'render-to-canvas-failed', 'Sprite render to canvas failed', detail);
  if (spriteDiagnosticsStarted) {
    diagLog.warn('QPM-SPRITE-004', detail);
  }
}

function cloneBootReport(report: SpriteBootReport | null): SpriteBootReport | null {
  if (!report) return null;
  try {
    return JSON.parse(JSON.stringify(report)) as SpriteBootReport;
  } catch {
    return report;
  }
}

export function getSpriteBootReport(): SpriteBootReport | null {
  return cloneBootReport(spriteBootReport);
}

function computeHydrationStatus(coverage: number): SpriteHydrationStatus {
  if (coverage >= TARGET_COMPRESSED_COVERAGE) return 'ok';
  if (coverage > 0) return 'degraded';
  return 'failed';
}

function dispatchHydrationEvent(reason: string, detail: Record<string, unknown>): void {
  const payload = {
    reason,
    at: Date.now(),
    ...detail,
  };
  const evt = new CustomEvent('qpm:sprite-hydration-state-change', { detail: payload });
  try {
    window.dispatchEvent(evt);
  } catch {
    // ignore event dispatch errors
  }
}

function normalizeTextureKey(raw: string): string {
  return String(raw ?? '')
    .replace(/\\/g, '/')
    .replace(/[?#].*$/, '')
    .replace(/^\/+/, '')
    .replace(IMAGE_EXT_RE, '')
    .trim()
    .toLowerCase();
}

function isTextureLike(value: any): boolean {
  if (!value || typeof value !== 'object') return false;
  if (value.frame && (value.source || value.orig || value._frame || value._source)) return true;
  if (value.source && (value.width != null || value.height != null || value.pixelWidth != null || value.pixelHeight != null)) return true;
  if (value.orig && (value.orig.width != null || value.orig.height != null)) return true;
  return false;
}

function isMapLike(value: any): value is { entries: () => Iterable<[unknown, unknown]>; forEach: (cb: (v: any, k: any) => void) => void } {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof value.entries === 'function' &&
    typeof value.forEach === 'function'
  );
}

function addTextureToIndex(index: RuntimeTextureIndex, key: string, texture: any): void {
  if (!key || !isTextureLike(texture)) return;
  const normalized = normalizeTextureKey(key);
  if (!normalized) return;

  const trimmedKey = String(key).replace(/^\/+/, '');
  index.exact.set(key, texture);
  if (trimmedKey && !index.exact.has(trimmedKey)) {
    index.exact.set(trimmedKey, texture);
  }
  index.normalized.set(normalized, texture);

  const spritePos = key.indexOf('sprite/');
  if (spritePos >= 0) {
    const spriteKey = key.slice(spritePos);
    if (spriteKey && !index.exact.has(spriteKey)) {
      index.exact.set(spriteKey, texture);
    }
    const spriteNorm = normalizeTextureKey(spriteKey);
    if (spriteNorm && !index.normalized.has(spriteNorm)) {
      index.normalized.set(spriteNorm, texture);
    }
  }

  if (trimmedKey.startsWith('sprite/')) {
    const withoutPrefix = trimmedKey.slice('sprite/'.length);
    if (withoutPrefix && !index.exact.has(withoutPrefix)) {
      index.exact.set(withoutPrefix, texture);
    }
    const withoutPrefixNorm = normalizeTextureKey(withoutPrefix);
    if (withoutPrefixNorm && !index.normalized.has(withoutPrefixNorm)) {
      index.normalized.set(withoutPrefixNorm, texture);
    }
  } else if (
    trimmedKey &&
    trimmedKey.includes('/') &&
    !trimmedKey.startsWith('atlases/') &&
    !/^https?:\/\//i.test(trimmedKey)
  ) {
    const spritePrefixed = `sprite/${trimmedKey}`;
    if (!index.exact.has(spritePrefixed)) {
      index.exact.set(spritePrefixed, texture);
    }
    const spritePrefixedNorm = normalizeTextureKey(spritePrefixed);
    if (spritePrefixedNorm && !index.normalized.has(spritePrefixedNorm)) {
      index.normalized.set(spritePrefixedNorm, texture);
    }
  }
}

function collectTexturesFromContainer(index: RuntimeTextureIndex, container: any): void {
  if (!container) return;

  // Cross-context Map objects from page window do not satisfy `instanceof Map`.
  if (isMapLike(container)) {
    try {
      for (const pair of container.entries()) {
        if (!Array.isArray(pair) || pair.length < 2) continue;
        const key = pair[0];
        const value: any = pair[1];
        addTextureToIndex(index, String(key), value);
        addTextureToIndex(index, String(key), value?.texture);
        addTextureToIndex(index, String(key), value?.tex);
        addTextureToIndex(index, String(key), value?.first);
        if (value?.textures) {
          collectTexturesFromContainer(index, value.textures);
        }
        if (value?.frames && typeof value.frames === 'object') {
          collectTexturesFromContainer(index, value.frames);
        }
      }
    } catch {
      try {
        container.forEach((value: any, key: any) => {
          addTextureToIndex(index, String(key), value);
          addTextureToIndex(index, String(key), value?.texture);
          addTextureToIndex(index, String(key), value?.tex);
          addTextureToIndex(index, String(key), value?.first);
          if (value?.textures) {
            collectTexturesFromContainer(index, value.textures);
          }
          if (value?.frames && typeof value.frames === 'object') {
            collectTexturesFromContainer(index, value.frames);
          }
        });
      } catch {
        // Ignore map scan errors from cross-context proxy wrappers.
      }
    }
    return;
  }

  if (Array.isArray(container)) {
    for (const value of container) {
      if (value?.textures) {
        collectTexturesFromContainer(index, value.textures);
      }
    }
    return;
  }

  if (typeof container === 'object') {
    for (const key of Object.keys(container)) {
      if (key === 'name' || key === 'baseTexture') continue;
      const value = (container as any)[key];
      addTextureToIndex(index, key, value);
      addTextureToIndex(index, key, (value as any)?.texture);
      addTextureToIndex(index, key, (value as any)?.tex);
      addTextureToIndex(index, key, (value as any)?.first);
      if ((value as any)?.textures) {
        collectTexturesFromContainer(index, (value as any).textures);
      }
      if ((value as any)?.frames && typeof (value as any).frames === 'object') {
        collectTexturesFromContainer(index, (value as any).frames);
      }
    }
  }
}

function shouldSkipDeepTraversal(value: any): boolean {
  if (!value || typeof value !== 'object') return true;
  if (typeof Window !== 'undefined' && value instanceof Window) return true;
  if (typeof Document !== 'undefined' && value instanceof Document) return true;
  if (typeof Element !== 'undefined' && value instanceof Element) return true;
  if (typeof HTMLCanvasElement !== 'undefined' && value instanceof HTMLCanvasElement) return true;
  if (typeof OffscreenCanvas !== 'undefined' && value instanceof OffscreenCanvas) return true;
  return false;
}

function collectTexturesDeep(
  index: RuntimeTextureIndex,
  rootValue: any,
  options: { maxDepth?: number; maxNodes?: number } = {}
): void {
  const maxDepth = Math.max(2, options.maxDepth ?? 7);
  const maxNodes = Math.max(2000, options.maxNodes ?? 25000);
  const seen = new WeakSet<object>();
  const stack: Array<{ value: any; depth: number; keyHint: string }> = [
    { value: rootValue, depth: 0, keyHint: '' },
  ];
  let nodes = 0;

  while (stack.length > 0 && nodes < maxNodes) {
    const current = stack.pop();
    if (!current) continue;
    const { value, depth, keyHint } = current;
    if (!value || typeof value !== 'object') continue;
    if (shouldSkipDeepTraversal(value)) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    nodes++;

    if (isTextureLike(value)) {
      if (keyHint) {
        addTextureToIndex(index, keyHint, value);
      }
      const label = String((value as any)?.label ?? '').trim();
      if (label) {
        addTextureToIndex(index, label, value);
      }
      continue;
    }

    if (isMapLike(value)) {
      try {
        for (const pair of value.entries()) {
          if (!Array.isArray(pair) || pair.length < 2) continue;
          const key = String(pair[0]);
          const itemValue = pair[1];
          addTextureToIndex(index, key, itemValue);
          if (depth < maxDepth && itemValue && typeof itemValue === 'object') {
            stack.push({ value: itemValue, depth: depth + 1, keyHint: key });
          }
        }
      } catch {
        try {
          value.forEach((itemValue: any, key: any) => {
            const keyStr = String(key);
            addTextureToIndex(index, keyStr, itemValue);
            if (depth < maxDepth && itemValue && typeof itemValue === 'object') {
              stack.push({ value: itemValue, depth: depth + 1, keyHint: keyStr });
            }
          });
        } catch {
          // ignore map traversal errors
        }
      }
      continue;
    }

    if (Array.isArray(value)) {
      if (depth < maxDepth) {
        for (let i = 0; i < value.length; i++) {
          const itemValue = value[i];
          if (itemValue && typeof itemValue === 'object') {
            stack.push({ value: itemValue, depth: depth + 1, keyHint });
          }
        }
      }
      continue;
    }

    if (depth >= maxDepth) continue;

    try {
      for (const key of Object.keys(value)) {
        if (key === 'name' || key === 'baseTexture') continue;
        const itemValue = (value as any)[key];
        addTextureToIndex(index, key, itemValue);
        if (itemValue && typeof itemValue === 'object') {
          stack.push({ value: itemValue, depth: depth + 1, keyHint: key });
        }
      }
    } catch {
      // ignore object traversal errors
    }
  }
}

function buildRuntimeTextureIndex(extraCandidates: any[] = [], useDeepScan = false): RuntimeTextureIndex {
  const index: RuntimeTextureIndex = {
    exact: new Map(),
    normalized: new Map(),
  };

  const root = getRuntimeWindow() as any;
  const pixiRoots = [root?.PIXI, root?.__PIXI__].filter(Boolean);
  const candidates = [
    root?.__PIXI_TEXTURE_CACHE__,
    root?.__PIXI_ASSET_CACHE__,
    root?.__QPM_PIXI_CAPTURED__?.app,
    root?.__QPM_PIXI_CAPTURED__?.renderer,
    ...extraCandidates,
  ];

  for (const P of pixiRoots) {
    candidates.push(
      P?.utils?.TextureCache,
      P?.TextureCache,
      P?.Cache?._cache,
      P?.Assets?.cache,
      P?.Assets?.cache?._cache
    );
  }

  for (const candidate of candidates) {
    collectTexturesFromContainer(index, candidate);
  }

  if (useDeepScan) {
    for (const candidate of candidates) {
      collectTexturesDeep(index, candidate);
    }
  }

  return index;
}

function buildTextureIndexFromContainers(containers: any[]): RuntimeTextureIndex {
  const index: RuntimeTextureIndex = {
    exact: new Map(),
    normalized: new Map(),
  };
  for (const container of containers) {
    collectTexturesFromContainer(index, container);
  }
  return index;
}

function readTextureFromIndex(index: RuntimeTextureIndex, key: string): any | null {
  const raw = String(key ?? '').replace(/^\/+/, '');
  if (!raw) return null;

  const exactCandidates = new Set<string>([raw, `/${raw}`]);
  if (raw.startsWith('sprite/')) {
    const withoutPrefix = raw.slice('sprite/'.length);
    if (withoutPrefix) {
      exactCandidates.add(withoutPrefix);
      exactCandidates.add(`/${withoutPrefix}`);
    }
  } else {
    exactCandidates.add(`sprite/${raw}`);
    exactCandidates.add(`/sprite/${raw}`);
  }

  for (const candidate of exactCandidates) {
    const hit = index.exact.get(candidate);
    if (hit) return hit;
  }

  for (const candidate of exactCandidates) {
    const normalized = normalizeTextureKey(candidate);
    if (!normalized) continue;
    const hit = index.normalized.get(normalized);
    if (hit) return hit;
  }

  return null;
}

function safeNumber(value: any): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function readObjectDimensions(value: any): { w: number; h: number } | null {
  if (!value || typeof value !== 'object') return null;
  const widthCandidates = [
    value.width,
    value.w,
    value.pixelWidth,
    value?.orig?.width,
    value?.frame?.width,
    value?._frame?.width,
    value?.source?.width,
    value?.source?.pixelWidth,
    value?.resource?.width,
    value?.resource?.pixelWidth,
  ];
  const heightCandidates = [
    value.height,
    value.h,
    value.pixelHeight,
    value?.orig?.height,
    value?.frame?.height,
    value?._frame?.height,
    value?.source?.height,
    value?.source?.pixelHeight,
    value?.resource?.height,
    value?.resource?.pixelHeight,
  ];
  const w = widthCandidates.map(safeNumber).find((n): n is number => n != null);
  const h = heightCandidates.map(safeNumber).find((n): n is number => n != null);
  if (!w || !h || w <= 0 || h <= 0) return null;
  return { w, h };
}

function readTextureDimensions(value: any): { w: number; h: number } | null {
  return readObjectDimensions(value) ?? readObjectDimensions(value?.source) ?? readObjectDimensions(value?._source);
}

function dimensionsMatch(
  actual: { w: number; h: number } | null,
  expected: { w: number; h: number } | null
): boolean {
  if (!actual || !expected) return false;
  return (
    Math.abs(actual.w - expected.w) <= ATLAS_DIMENSION_TOLERANCE &&
    Math.abs(actual.h - expected.h) <= ATLAS_DIMENSION_TOLERANCE
  );
}

function readAtlasExpectedSize(data: any): { w: number; h: number } | null {
  const w = safeNumber(data?.meta?.size?.w);
  const h = safeNumber(data?.meta?.size?.h);
  if (!w || !h || w <= 0 || h <= 0) return null;
  return { w, h };
}

function collectHintStrings(value: any): string[] {
  if (!value || typeof value !== 'object') return [];
  const out: string[] = [];
  const push = (raw: any) => {
    if (typeof raw !== 'string') return;
    const s = raw.trim();
    if (!s) return;
    out.push(s);
  };

  push(value.label);
  push(value.cacheId);
  push(value.cacheKey);
  push(value.src);
  push(value.url);
  push(value.href);
  push(value.path);
  push(value?.resource?.src);
  push(value?.resource?.url);
  push(value?.source?.label);
  push(value?.source?.src);
  push(value?.source?.url);
  push(value?.source?.resource?.src);
  push(value?.source?.resource?.url);

  const ids = value.textureCacheIds;
  if (Array.isArray(ids)) {
    for (const id of ids) push(id);
  }
  return out;
}

function buildAtlasAliasTokens(atlasPath: string, imagePath: string): string[] {
  const rawParts = [atlasPath, imagePath]
    .filter(Boolean)
    .map((part) => String(part).replace(/\\/g, '/').replace(/^\/+/, '').replace(/[?#].*$/, ''));
  const tokens = new Set<string>();

  for (const part of rawParts) {
    const normalized = normalizeTextureKey(part);
    if (normalized) tokens.add(normalized);

    const extless = part.replace(/\.[^/.]+$/i, '');
    const extlessNorm = normalizeTextureKey(extless);
    if (extlessNorm) tokens.add(extlessNorm);

    const seg = part.split('/').filter(Boolean).pop() || '';
    const segNorm = normalizeTextureKey(seg);
    if (segNorm) tokens.add(segNorm);

    const segExtlessNorm = normalizeTextureKey(seg.replace(/\.[^/.]+$/i, ''));
    if (segExtlessNorm) tokens.add(segExtlessNorm);
  }

  return [...tokens].filter((token) => token.length >= 3);
}

function scoreAtlasHint(hint: string, tokens: string[]): number {
  if (!hint || !tokens.length) return 0;
  const normalized = normalizeTextureKey(hint);
  if (!normalized) return 0;
  let score = 0;
  for (const token of tokens) {
    if (!token) continue;
    if (normalized === token) {
      score += 6;
    } else if (normalized.includes(token) || token.includes(normalized)) {
      score += 3;
    }
  }
  return score;
}

function coerceTextureForAtlas(raw: any, state: SpriteState, expectedSize: { w: number; h: number } | null): any | null {
  if (!raw || typeof raw !== 'object') return null;

  const Texture = state.ctors?.Texture;
  if (!Texture) return null;

  const candidates: any[] = [];
  const pushCandidate = (tex: any) => {
    if (!isTextureLike(tex)) return;
    candidates.push(tex);
  };

  // Prefer explicit source-derived textures first for atlas bases.
  const sourceCandidates = [raw?.source, raw?._source, raw];
  for (const source of sourceCandidates) {
    if (!source || typeof source !== 'object') continue;
    try {
      const t = new Texture({ source });
      pushCandidate(t);
    } catch {
      // try next constructor mode
    }
    try {
      const t = Texture.from(source);
      pushCandidate(t);
    } catch {
      // try next constructor mode
    }
    try {
      const t = new Texture(source);
      pushCandidate(t);
    } catch {
      // no-op
    }
  }

  pushCandidate(raw?.texture);
  pushCandidate(raw?.tex);
  pushCandidate(raw);

  if (candidates.length > 0) {
    if (!expectedSize) return candidates[0] ?? null;

    const perfect = candidates.find((candidate) => dimensionsMatch(readTextureDimensions(candidate), expectedSize));
    if (perfect) return perfect;

    const fallback = candidates[0] ?? null;
    if (fallback) return fallback;
  }

  const rawSource = raw?.source ?? raw?._source ?? raw;
  const rawDims = readObjectDimensions(rawSource);
  if (!rawDims) return null;
  if (expectedSize && !dimensionsMatch(rawDims, expectedSize)) return null;
  return rawSource;
}

type AtlasTextureCandidate = {
  texture: any;
  hint: string;
  score: number;
};

function collectAtlasTextureCandidates(
  state: SpriteState,
  runtimeCandidates: any[],
  tokens: string[],
  expectedSize: { w: number; h: number } | null
): AtlasTextureCandidate[] {
  const out: AtlasTextureCandidate[] = [];
  const seen = new Set<any>();
  const visited = new WeakSet<object>();

  const pushCandidate = (raw: any, hint: string) => {
    if (!raw || typeof raw !== 'object') return;
    const hintText = `${hint} ${collectHintStrings(raw).join(' ')}`.trim();
    const hintScore = scoreAtlasHint(hintText, tokens);
    const rawDims = readObjectDimensions(raw) ?? readObjectDimensions(raw?.source) ?? readObjectDimensions(raw?._source);
    const sizeScore = dimensionsMatch(rawDims, expectedSize) ? 4 : 0;
    const renderPenalty = RENDER_TARGET_HINT_RE.test(hintText.toLowerCase()) ? 4 : 0;

    if (hintScore <= 0 && sizeScore <= 0) return;
    if (renderPenalty > 0 && hintScore <= 0) return;

    const tex = coerceTextureForAtlas(raw, state, expectedSize);
    if (!tex) return;
    const identity = tex?.source ?? tex?._source ?? tex;
    if (identity && seen.has(identity)) return;

    const texDims = readTextureDimensions(tex);
    if (expectedSize && texDims && !dimensionsMatch(texDims, expectedSize) && hintScore < 3) {
      return;
    }

    if (identity) seen.add(identity);
    const score = hintScore + sizeScore - renderPenalty;
    if (score <= 0) return;
    out.push({ texture: tex, hint: hintText, score });
  };

  const scan = (container: any, label: string, depth: number) => {
    if (!container || typeof container !== 'object') return;
    if (visited.has(container)) return;
    visited.add(container);
    if (depth > 2) return;

    if (isMapLike(container)) {
      let n = 0;
      try {
        for (const pair of container.entries()) {
          if (!Array.isArray(pair) || pair.length < 2) continue;
          const keyObject = pair[0];
          const key = String(keyObject);
          const value = pair[1];
          const nextHint = `${label} ${key} ${collectHintStrings(keyObject).join(' ')}`.trim();
          pushCandidate(keyObject, `${nextHint} #map-key`);
          pushCandidate(value, nextHint);
          if (depth < 2) {
            scan(value, nextHint, depth + 1);
          }
          if (++n >= 2500) break;
        }
      } catch {
        // ignore map scan errors
      }
      return;
    }

    if (Array.isArray(container)) {
      for (let i = 0; i < container.length && i < 1200; i++) {
        const value = container[i];
        const nextHint = `${label}[${i}]`;
        pushCandidate(value, nextHint);
        if (depth < 2) {
          scan(value, nextHint, depth + 1);
        }
      }
      return;
    }

    let keys: string[] = [];
    try {
      keys = Object.keys(container);
    } catch {
      return;
    }
    const recurseKeyRe = /texture|source|cache|atlas|sprite|upload|managed|bound|resource|ktx|basis|asset/i;
    for (let i = 0; i < keys.length && i < 2200; i++) {
      const key = keys[i]!;
      if (key === 'name' || key === 'baseTexture') continue;
      const value = (container as any)[key];
      const nextHint = `${label}.${key}`;
      pushCandidate(value, nextHint);
      if (depth < 2 && recurseKeyRe.test(key)) {
        scan(value, nextHint, depth + 1);
      }
    }
  };

  const bridge = getSpriteBridge();
  const containers: Array<[string, any]> = [
    ['renderer.texture._managedTextures', state.renderer?.texture?._managedTextures],
    ['renderer.texture._boundTextures', state.renderer?.texture?._boundTextures],
    ['renderer.texture._uploads.compressed', state.renderer?.texture?._uploads?.compressed],
    ['renderer.texture._uploads.image', state.renderer?.texture?._uploads?.image],
    ['renderer.texture', state.renderer?.texture],
    ['state.renderer', state.renderer],
    ['state.app', state.app],
    ['bridge.runtimePool', bridge?.runtimePool],
    ['bridge.atlas', bridge?.atlas],
  ];
  for (let i = 0; i < runtimeCandidates.length; i++) {
    containers.push([`runtimeHint[${i}]`, runtimeCandidates[i]]);
  }

  for (const [label, container] of containers) {
    scan(container, label, 0);
  }

  out.sort((a, b) => b.score - a.score);
  return out.slice(0, 8);
}

function hydrateAtlasFromManagedTextureCandidates(
  atlasPath: string,
  imagePath: string,
  data: any,
  state: SpriteState,
  runtimeCandidates: any[]
): HydratePassResult | null {
  if (!state.ctors?.Texture || !state.ctors?.Rectangle) return null;
  const frameKeys = Object.keys(data?.frames || {});
  if (!frameKeys.length) return null;

  const baselineHydrated = countHydratedFrames(frameKeys, state);
  const expectedSize = readAtlasExpectedSize(data);
  const tokens = buildAtlasAliasTokens(atlasPath, imagePath);
  const candidates = collectAtlasTextureCandidates(state, runtimeCandidates, tokens, expectedSize);
  if (!candidates.length) return null;

  let bestHydrated = baselineHydrated;
  for (const candidate of candidates) {
    try {
      buildAtlasTextures(data, candidate.texture, state.tex, state.atlasBases, state.ctors);
    } catch {
      continue;
    }
    const hydrated = countHydratedFrames(frameKeys, state);
    if (hydrated > bestHydrated) {
      bestHydrated = hydrated;
    }
    if (expectedSize && bestHydrated >= frameKeys.length * TARGET_COMPRESSED_COVERAGE) {
      break;
    }
  }

  if (bestHydrated <= baselineHydrated) return null;
  const coverage = frameKeys.length > 0 ? bestHydrated / frameKeys.length : 1;
  const runtimeDelta = Math.max(0, bestHydrated - baselineHydrated);
  return {
    hydrated: bestHydrated,
    coverage,
    sourceHits: { assets: 0, bridge: 0, runtime: runtimeDelta },
    missingSample: frameKeys.filter((key) => !state.tex.has(key)).slice(0, MAX_MISSING_SAMPLE),
    status: computeHydrationStatus(coverage),
  };
}

function hydrateAtlasFromRuntimeIndex(data: any, state: SpriteState, index: RuntimeTextureIndex): number {
  let loaded = 0;
  for (const key of Object.keys(data?.frames || {})) {
    const tex = readTextureFromIndex(index, key);
    if (!tex) continue;
    state.tex.set(key, tex);
    rememberBaseTex(tex, state.atlasBases);
    loaded++;
  }
  return loaded;
}

function getSpriteBridge(): SpriteBridge | null {
  const root = getRuntimeWindow() as any;
  const bridge = root?.__QPM_SPRITE_BRIDGE__;
  if (!bridge || typeof bridge !== 'object') return null;
  return bridge as SpriteBridge;
}

function getBridgeTextureContainers(atlasPath: string): any[] {
  const bridge = getSpriteBridge();
  if (!bridge) return [];
  const out: any[] = [];

  try {
    if (typeof bridge.getAtlasTextures === 'function') {
      const fromGetter = bridge.getAtlasTextures(atlasPath);
      if (fromGetter) out.push(fromGetter);
    }
  } catch {
    // ignore bridge getter errors
  }

  const rec = bridge.atlas?.[atlasPath];
  if (rec?.textures) {
    out.push(rec.textures);
  }

  return out;
}

function getBridgeSnapshot(): any {
  const bridge = getSpriteBridge();
  if (!bridge) return null;
  try {
    if (typeof bridge.snapshot === 'function') {
      return bridge.snapshot();
    }
  } catch {
    // ignore bridge snapshot failures
  }
  return null;
}

async function tryLoadAtlasViaPixiAssets(base: string, atlasPath: string, imagePath?: string): Promise<any[]> {
  const root = getRuntimeWindow() as any;
  const pixiRoots = [root?.PIXI, root?.__PIXI__].filter(Boolean);

  const loadedAssets: any[] = [];
  const candidates = Array.from(
    new Set(
      [atlasPath, imagePath]
        .filter((value): value is string => Boolean(value))
        .flatMap((value) => [value, joinPath(base, value)])
    )
  );
  for (const P of pixiRoots) {
    const Assets = (P as any)?.Assets;
    if (!Assets?.load) continue;
    for (const candidate of candidates) {
      try {
        const loaded = await Assets.load(candidate);
        if (loaded != null) {
          loadedAssets.push(loaded);
        }
      } catch {
        // Try next candidate/root
      }
    }
  }
  return loadedAssets;
}

async function tryLoadAtlasViaBridge(base: string, atlasPath: string, imagePath?: string, atlasData?: any): Promise<any[]> {
  const bridge = getSpriteBridge();
  if (!bridge || typeof bridge.loadAtlas !== 'function') return [];

  try {
    await bridge.loadAtlas(atlasPath, base, imagePath, atlasData);
  } catch {
    // ignore bridge load failures, fallback sources are still checked
  }

  return getBridgeTextureContainers(atlasPath);
}

function hydrateAtlasFromSources(
  frameKeys: string[],
  state: SpriteState,
  sourceIndices: Array<{ source: TextureSourceName; index: RuntimeTextureIndex }>
): HydratePassResult {
  let hydrated = 0;
  const sourceHits: Record<TextureSourceName, number> = {
    assets: 0,
    bridge: 0,
    runtime: 0,
  };
  const missingSample: string[] = [];

  for (const frameKey of frameKeys) {
    if (state.tex.has(frameKey)) {
      hydrated++;
      continue;
    }

    let resolvedTexture: any = null;
    let resolvedSource: TextureSourceName | null = null;
    for (const source of sourceIndices) {
      const tex = readTextureFromIndex(source.index, frameKey);
      if (!tex) continue;
      resolvedTexture = tex;
      resolvedSource = source.source;
      break;
    }

    if (resolvedTexture) {
      state.tex.set(frameKey, resolvedTexture);
      rememberBaseTex(resolvedTexture, state.atlasBases);
      hydrated++;
      if (resolvedSource) {
        sourceHits[resolvedSource] += 1;
      }
    } else if (missingSample.length < MAX_MISSING_SAMPLE) {
      missingSample.push(frameKey);
    }
  }

  const expected = frameKeys.length || 1;
  const coverage = hydrated / expected;
  return {
    hydrated,
    coverage,
    sourceHits,
    missingSample,
    status: computeHydrationStatus(coverage),
  };
}

async function loadCompressedAtlasFromRuntime(
  base: string,
  atlasPath: string,
  data: any,
  state: SpriteState,
  options: { maxWaitMs?: number; loadAssets?: boolean; loadBridge?: boolean } = {}
): Promise<HydratePassResult> {
  const frameKeys = Object.keys(data?.frames || {});
  const expected = frameKeys.length;
  if (expected === 0) {
    return {
      hydrated: 0,
      coverage: 1,
      sourceHits: { assets: 0, bridge: 0, runtime: 0 },
      missingSample: [],
      status: 'ok',
    };
  }

  const root = getRuntimeWindow() as any;
  const pixiRoots = [root?.PIXI, root?.__PIXI__].filter(Boolean);
  const hasAssetsLoader = pixiRoots.some((P) => typeof (P as any)?.Assets?.load === 'function');
  const runtimeHints = Array.isArray(state.runtimeTextureHints)
    ? (state.runtimeTextureHints as any[]).filter(Boolean)
    : [];
  const hasRuntimeHints = runtimeHints.length > 0;

  const shouldLoadAssets = options.loadAssets !== false && hasAssetsLoader;
  const shouldLoadBridge = options.loadBridge !== false;
  const maxWaitMs = Math.max(250, options.maxWaitMs ?? 9000);
  const waitBudgetMs = !hasAssetsLoader && !hasRuntimeHints
    ? Math.min(maxWaitMs, 1500)
    : maxWaitMs;
  const imagePath = relPath(atlasPath, data?.meta?.image || '');

  const loadedAssets = shouldLoadAssets ? await tryLoadAtlasViaPixiAssets(base, atlasPath, imagePath) : [];
  const bridgeContainers = shouldLoadBridge
    ? await tryLoadAtlasViaBridge(base, atlasPath, imagePath, data)
    : getBridgeTextureContainers(atlasPath);
  const liveBridgeContainers = [...bridgeContainers];

  const start = performance.now();
  let best: HydratePassResult = {
    hydrated: 0,
    coverage: 0,
    sourceHits: { assets: 0, bridge: 0, runtime: 0 },
    missingSample: frameKeys.slice(0, MAX_MISSING_SAMPLE),
    status: 'failed',
  };
  const cumulativeSourceHits: Record<TextureSourceName, number> = { assets: 0, bridge: 0, runtime: 0 };
  const runtimeHintCandidates = Array.isArray(state.runtimeTextureHints)
    ? (state.runtimeTextureHints as any[])
    : [];
  const runtimeCandidates = [state.app, state.renderer, ...runtimeHintCandidates];
  let bridgeProbeAttempts = shouldLoadBridge ? 1 : 0;
  const initialManagedPass = hydrateAtlasFromManagedTextureCandidates(
    atlasPath,
    imagePath,
    data,
    state,
    runtimeCandidates
  );
  if (initialManagedPass?.hydrated) {
    cumulativeSourceHits.runtime += initialManagedPass.sourceHits.runtime;
    best = {
      ...initialManagedPass,
      sourceHits: { ...cumulativeSourceHits },
    };
    if (initialManagedPass.coverage >= TARGET_COMPRESSED_COVERAGE) {
      return {
        ...initialManagedPass,
        sourceHits: { ...cumulativeSourceHits },
        status: 'ok',
      };
    }
  }

  let zeroIndexPasses = 0;
  while (performance.now() - start < waitBudgetMs) {
    if (shouldLoadBridge && bridgeProbeAttempts < 10) {
      const bridgeReload = await tryLoadAtlasViaBridge(base, atlasPath, imagePath, data);
      if (bridgeReload.length > 0) {
        liveBridgeContainers.push(...bridgeReload);
      }
      bridgeProbeAttempts += 1;
    }

    const assetIndex = buildTextureIndexFromContainers(loadedAssets);
    const bridgeIndex = buildTextureIndexFromContainers([
      ...liveBridgeContainers,
      ...getBridgeTextureContainers(atlasPath),
    ]);
    const runtimeIndex = buildRuntimeTextureIndex(runtimeCandidates, false);
    const pass = hydrateAtlasFromSources(frameKeys, state, [
      { source: 'assets', index: assetIndex },
      { source: 'bridge', index: bridgeIndex },
      { source: 'runtime', index: runtimeIndex },
    ]);
    cumulativeSourceHits.assets += pass.sourceHits.assets;
    cumulativeSourceHits.bridge += pass.sourceHits.bridge;
    cumulativeSourceHits.runtime += pass.sourceHits.runtime;

    if (pass.hydrated > best.hydrated) {
      best = {
        ...pass,
        sourceHits: { ...cumulativeSourceHits },
      };
    }

    if (pass.coverage >= TARGET_COMPRESSED_COVERAGE) {
      return {
        ...pass,
        sourceHits: { ...cumulativeSourceHits },
        status: 'ok',
      };
    }

    if (assetIndex.exact.size === 0 && bridgeIndex.exact.size === 0 && runtimeIndex.exact.size === 0) {
      zeroIndexPasses += 1;
      if (zeroIndexPasses >= 6) {
        break;
      }
    } else {
      zeroIndexPasses = 0;
    }

    const loopManagedPass = hydrateAtlasFromManagedTextureCandidates(
      atlasPath,
      imagePath,
      data,
      state,
      runtimeCandidates
    );
    if (loopManagedPass?.hydrated && loopManagedPass.hydrated > best.hydrated) {
      cumulativeSourceHits.runtime += loopManagedPass.sourceHits.runtime;
      best = {
        ...loopManagedPass,
        sourceHits: { ...cumulativeSourceHits },
      };
      if (loopManagedPass.coverage >= TARGET_COMPRESSED_COVERAGE) {
        return {
          ...loopManagedPass,
          sourceHits: { ...cumulativeSourceHits },
          status: 'ok',
        };
      }
    }
    await delay(140);
  }

  if (best.coverage < TARGET_COMPRESSED_COVERAGE) {
    const lateManagedPass = hydrateAtlasFromManagedTextureCandidates(
      atlasPath,
      imagePath,
      data,
      state,
      runtimeCandidates
    );
    if (lateManagedPass?.hydrated && lateManagedPass.hydrated > best.hydrated) {
      cumulativeSourceHits.runtime += lateManagedPass.sourceHits.runtime;
      best = {
        ...lateManagedPass,
        sourceHits: { ...cumulativeSourceHits },
      };
    }
    if (lateManagedPass && lateManagedPass.coverage >= TARGET_COMPRESSED_COVERAGE) {
      return {
        ...lateManagedPass,
        sourceHits: { ...cumulativeSourceHits },
        status: 'ok',
      };
    }
  }

  const finalCoverage = best.hydrated / expected;
  return {
    hydrated: best.hydrated,
    coverage: finalCoverage,
    sourceHits: { ...cumulativeSourceHits },
    missingSample: best.missingSample,
    status: computeHydrationStatus(finalCoverage),
  };
}

function rgbaToCanvas(width: number, height: number, rgba: Uint8ClampedArray): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx2d = canvas.getContext('2d', { willReadFrequently: false });
  if (!ctx2d) {
    throw new Error('2D context unavailable for decoded KTX2 atlas');
  }
  // Ensure an ArrayBuffer-backed view for ImageData in strict TS DOM typings.
  const pixels = new Uint8ClampedArray(rgba.length);
  pixels.set(rgba);
  const imageData = new ImageData(pixels, width, height);
  ctx2d.putImageData(imageData, 0, 0);
  return canvas;
}

async function loadCompressedAtlasViaDecoder(
  base: string,
  atlasPath: string,
  data: any,
  state: SpriteState,
  decoder: Ktx2DecoderPool
): Promise<HydratePassResult> {
  const frameKeys = Object.keys(data?.frames || {});
  const expected = frameKeys.length;
  if (expected === 0) {
    return {
      hydrated: 0,
      coverage: 1,
      sourceHits: { assets: 0, bridge: 0, runtime: 0 },
      missingSample: [],
      status: 'ok',
    };
  }

  const imagePath = relPath(atlasPath, data?.meta?.image || '');
  const blob = await getBlob(joinPath(base, imagePath));
  const bytes = await blob.arrayBuffer();
  const decoded = await decoder.decode(bytes, imagePath);

  const canvas = rgbaToCanvas(decoded.width, decoded.height, decoded.rgba);
  const baseTex = state.ctors!.Texture.from(canvas);
  buildAtlasTextures(data, baseTex, state.tex, state.atlasBases, state.ctors!);

  // Store the KTX2 source canvas so textureToCanvas can bypass GPU extraction.
  // GPU textures may not be uploaded (never rendered to screen), causing blank extract.
  const texSource = baseTex?.source ?? baseTex?._source ?? baseTex;
  if (texSource && typeof texSource === 'object' && state.ktx2Canvases) {
    state.ktx2Canvases.set(texSource as object, canvas);
  }

  const hydrated = countHydratedFrames(frameKeys, state);
  const coverage = expected > 0 ? hydrated / expected : 1;
  return {
    hydrated,
    coverage,
    sourceHits: { assets: hydrated, bridge: 0, runtime: 0 },
    missingSample: frameKeys.filter((key) => !state.tex.has(key)).slice(0, MAX_MISSING_SAMPLE),
    status: computeHydrationStatus(coverage),
  };
}

/**
 * Prefetch atlas data in parallel with PIXI initialization.
 * This starts network requests early to reduce total load time.
 */
async function prefetchAtlasData(base: string): Promise<PrefetchedAtlas | null> {
  try {
    notifyWarmup({ phase: 'prefetch-manifest' });
    const manifest = await getJSON(joinPath(base, 'manifest.json'));
    
    notifyWarmup({ phase: 'prefetch-atlas-json' });
    const atlasJsons = await loadAtlasJsons(base, manifest);
    
    const blobs = new Map<string, Blob>();
    const entries = Object.entries(atlasJsons);
    const legacyAtlasEntries = entries.filter(([path, data]) => {
      if (!isAtlas(data)) return false;
      const imagePath = relPath(path, data.meta.image);
      return !COMPRESSED_ATLAS_RE.test(imagePath);
    });
    const atlasCount = legacyAtlasEntries.length;
    
    notifyWarmup({ phase: 'prefetch-images', total: atlasCount, done: 0 });
    
    // Fetch atlas images in parallel with yielding
    let fetched = 0;
    const yieldCtl = new YieldController(3, 16); // Yield every 3 fetches or 16ms
    
    for (const [path, data] of legacyAtlasEntries) {
      const imgPath = relPath(path, data.meta.image);
      try {
        const blob = await getBlob(joinPath(base, imgPath));
        blobs.set(imgPath, blob);
        fetched++;
        notifyWarmup({ done: fetched });
      } catch {
        /* ignore individual fetch errors - will be retried in loadTextures */
      }
      
      await yieldCtl.yieldIfNeeded();
    }
    
    return { base, atlasJsons, blobs };
  } catch (error) {
    spriteLog('warn', 'prefetch-failed', 'Prefetch failed, falling back to normal loading', {
      error: String((error as Error)?.message ?? error),
    });
    return null;
  }
}

type CompressedAtlasEntry = {
  atlasPath: string;
  imagePath: string;
  data: any;
};

type LoadTexturesResult = {
  atlasReports: AtlasBootReport[];
  compressedEntries: CompressedAtlasEntry[];
  expectedFrames: number;
  hydratedFrames: number;
  status: SpriteHydrationStatus;
  finalMode: AtlasLoaderMode | 'mixed' | 'unknown';
  loadMode: SpriteLoadMode;
  bridgeSnapshot: any;
  fallbackBase: string | null;
  decoder: Ktx2DecoderTelemetry;
};

function countHydratedFrames(frameKeys: string[], state: SpriteState): number {
  let n = 0;
  for (const key of frameKeys) {
    if (state.tex.has(key)) n++;
  }
  return n;
}

function recalcSpriteCatalog(state: SpriteState): void {
  const { items, cats } = buildItemsFromTextures(state.tex, { catLevels: 1 });
  state.items = items;
  state.filtered = items.slice();
  state.cats = cats;
}

function parseSpriteItemKey(key: string): { category: string; id: string } | null {
  const clean = String(key || '').replace(/^\/+/, '');
  const parts = clean.split('/').filter(Boolean);
  if (parts.length < 3) return null;
  if (parts[0] !== 'sprite' && parts[0] !== 'sprites') return null;
  const category = parts[1] || '';
  const id = parts.slice(2).join('/');
  if (!category || !id) return null;
  return { category, id };
}

async function runPostHydrationMutationPass(state: SpriteState, cfg: SpriteConfig): Promise<void> {
  const candidates = state.items
    .filter((item) => item.key.startsWith('sprite/plant/') || item.key.startsWith('sprite/tallplant/'))
    .slice(0, 8);
  if (!candidates.length) return;

  const mutationsToPrime: string[][] = [['Rainbow'], ['Gold']];
  const yieldCtl = new YieldController(2, 8);

  for (const item of candidates) {
    const parsed = parseSpriteItemKey(item.key);
    if (!parsed) continue;
    for (const mutations of mutationsToPrime) {
      try {
        api.getSpriteWithMutations(
          {
            category: parsed.category as any,
            id: parsed.id,
            mutations,
          },
          state,
          cfg
        );
      } catch {
        // Ignore warmup misses, this pass is best-effort only.
      }
      await yieldCtl.yieldIfNeeded();
    }
  }
}

function parseNumericVersion(version: string | null | undefined): number | null {
  const raw = String(version ?? '').trim();
  if (!/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function isKtx2NativeRequired(version: string | null | undefined): boolean {
  const parsed = parseNumericVersion(version);
  return parsed != null && parsed >= KTX2_NATIVE_REQUIRED_VERSION;
}

function swapBaseVersion(base: string, version: number): string | null {
  const normalized = String(base || '').trim();
  if (!normalized) return null;
  const withSlash = normalized.endsWith('/') ? normalized : `${normalized}/`;
  const swapped = withSlash.replace(/\/version\/[^/]+\/assets\/$/i, `/version/${version}/assets/`);
  if (swapped === withSlash) return null;
  return swapped;
}

async function tryLegacyVersionFallback(
  base: string,
  state: SpriteState,
  compressedEntries: CompressedAtlasEntry[],
  atlasReports: AtlasBootReport[],
  ctors: any
): Promise<string | null> {
  if (!compressedEntries.length) return null;
  const currentVersion = parseNumericVersion(state.version);
  if (!currentVersion) return null;

  const minVersion = Math.max(1, currentVersion - 8);
  const candidates: number[] = [];
  for (let v = currentVersion - 1; v >= minVersion; v--) {
    candidates.push(v);
  }

  for (const version of candidates) {
    const fallbackBase = swapBaseVersion(base, version);
    if (!fallbackBase) continue;

    try {
      const manifest = await getJSON(joinPath(fallbackBase, 'manifest.json'));
      const atlasJsons = await loadAtlasJsons(fallbackBase, manifest);
      const usableEntries = Object.entries(atlasJsons).filter(([path, data]) => {
        if (!isAtlas(data)) return false;
        const imagePath = relPath(path, data.meta.image);
        return !COMPRESSED_ATLAS_RE.test(imagePath);
      });
      if (!usableEntries.length) continue;

      for (const [path, data] of usableEntries) {
        const imagePath = relPath(path, data.meta.image);
        const blob = await getBlob(joinPath(fallbackBase, imagePath));
        const img = await blobToImage(blob);
        const baseTex = ctors.Texture.from(img);
        buildAtlasTextures(data, baseTex, state.tex, state.atlasBases, ctors);
      }

      let hydratedCompressed = 0;
      let expectedCompressed = 0;
      for (const entry of compressedEntries) {
        const keys = Object.keys(entry.data?.frames || {});
        expectedCompressed += keys.length;
        hydratedCompressed += countHydratedFrames(keys, state);
      }
      if (hydratedCompressed <= 0) {
        continue;
      }

      const reportByPath = new Map(atlasReports.map((report) => [report.atlasPath, report] as const));
      for (const entry of compressedEntries) {
        const report = reportByPath.get(entry.atlasPath);
        if (!report) continue;
        const keys = Object.keys(entry.data?.frames || {});
        const hydrated = countHydratedFrames(keys, state);
        if (hydrated > report.hydratedFrames) {
          report.sourceHits.assets += hydrated - report.hydratedFrames;
        }
        report.hydratedFrames = hydrated;
        report.coverage = keys.length > 0 ? hydrated / keys.length : 1;
        report.status = computeHydrationStatus(report.coverage);
        report.source = 'legacy-fallback';
        report.missingSample = keys.filter((key) => !state.tex.has(key)).slice(0, MAX_MISSING_SAMPLE);
      }

      return fallbackBase;
    } catch {
      // Continue to next candidate version.
    }
  }

  return null;
}

function finalizeReportStatus(reports: AtlasBootReport[]): {
  expectedFrames: number;
  hydratedFrames: number;
  coverage: number;
  status: SpriteHydrationStatus;
  finalMode: AtlasLoaderMode | 'mixed' | 'unknown';
} {
  let expectedFrames = 0;
  let hydratedFrames = 0;
  const seenModes = new Set<AtlasLoaderMode>();
  let status: SpriteHydrationStatus = 'ok';

  for (const report of reports) {
    expectedFrames += report.expectedFrames;
    hydratedFrames += report.hydratedFrames;
    seenModes.add(report.mode);
    if (report.status === 'failed') {
      status = 'failed';
    } else if (report.status === 'degraded' && status !== 'failed') {
      status = 'degraded';
    }
  }

  const coverage = expectedFrames > 0 ? hydratedFrames / expectedFrames : 1;
  let finalMode: AtlasLoaderMode | 'mixed' | 'unknown' = 'unknown';
  if (seenModes.size === 1) {
    finalMode = Array.from(seenModes)[0] ?? 'unknown';
  } else if (seenModes.size > 1) {
    finalMode = 'mixed';
  }

  return {
    expectedFrames,
    hydratedFrames,
    coverage,
    status: status === 'ok' ? computeHydrationStatus(coverage) : status,
    finalMode,
  };
}

async function runBackgroundCompressedRehydrate(
  base: string,
  compressedEntries: CompressedAtlasEntry[],
  atlasReports: AtlasBootReport[],
  state: SpriteState
): Promise<void> {
  if (!compressedEntries.length) return;
  const needsRehydrate = atlasReports.some(
    (r) => r.mode === 'compressed' && r.coverage < TARGET_COMPRESSED_COVERAGE
  );
  if (!needsRehydrate) return;

  const reportByPath = new Map(atlasReports.map((r) => [r.atlasPath, r] as const));
  let anyChanged = false;

  for (let attempt = 1; attempt <= 6; attempt++) {
    await delay(600);
    let changedThisAttempt = false;

    for (const entry of compressedEntries) {
      const report = reportByPath.get(entry.atlasPath);
      if (!report || report.coverage >= TARGET_COMPRESSED_COVERAGE) continue;

      const pass = await loadCompressedAtlasFromRuntime(
        base,
        entry.atlasPath,
        entry.data,
        state,
        { maxWaitMs: 1400, loadAssets: false, loadBridge: true }
      );
      if (pass.hydrated > report.hydratedFrames) {
        report.hydratedFrames = pass.hydrated;
        report.coverage = pass.coverage;
        report.status = pass.status;
        report.sourceHits.assets += pass.sourceHits.assets;
        report.sourceHits.bridge += pass.sourceHits.bridge;
        report.sourceHits.runtime += pass.sourceHits.runtime;
        report.missingSample = pass.missingSample;
        changedThisAttempt = true;
      }
    }

    if (changedThisAttempt) {
      anyChanged = true;
      clearVariantCache(state);
      clearSpriteDataUrlCache();
      recalcSpriteCatalog(state);
      const finalized = finalizeReportStatus(atlasReports);
      if (spriteBootReport) {
        spriteBootReport = {
          ...spriteBootReport,
          expectedFrames: finalized.expectedFrames,
          hydratedFrames: finalized.hydratedFrames,
          coverage: finalized.coverage,
          status: finalized.status,
          finalMode: finalized.finalMode,
          atlasReports: atlasReports.map((r) => ({ ...r })),
          bridgeSnapshot: getBridgeSnapshot(),
          renderer: buildRendererReport(state),
          generatedAt: Date.now(),
        };
      }
      dispatchHydrationEvent('rehydrated', {
        attempt,
        loadMode: state.loadMode ?? 'unknown',
        degraded: atlasReports.some((r) => r.status !== 'ok'),
        textures: state.tex.size,
        reports: atlasReports.map((r) => ({
          atlasPath: r.atlasPath,
          mode: r.mode,
          coverage: Number(r.coverage.toFixed(3)),
          status: r.status,
        })),
      });
    }

    const done = atlasReports
      .filter((r) => r.mode === 'compressed')
      .every((r) => r.coverage >= TARGET_COMPRESSED_COVERAGE);
    if (done) break;
  }

  if (anyChanged) {
    spriteLog('info', 'background-rehydrate-complete', 'Post-load compressed rehydrate completed', {
      textures: state.tex.size,
      reports: atlasReports.map((r) => ({
        atlasPath: r.atlasPath,
        coverage: Number(r.coverage.toFixed(3)),
        status: r.status,
      })),
    });
  }
}

async function loadTextures(
  base: string,
  state: SpriteState,
  prefetched?: PrefetchedAtlas | null
): Promise<LoadTexturesResult> {
  // Configuration for non-blocking loading
  const ATLAS_YIELD_DELAY_MS = 16; // ~1 frame at 60fps
  const FRAMES_PER_YIELD = 4; // Yield every N atlases
  const MAX_CHUNK_MS = 12; // Max time before yielding within atlas processing

  const ctors = state.ctors;
  if (!ctors?.Texture || !ctors?.Rectangle) {
    throw new Error('PIXI constructors missing');
  }

  // Use prefetched data if available and matches our base URL
  const usePrefetched = prefetched && prefetched.base === base ? prefetched : null;
  
  notifyWarmup({ phase: 'load-manifest' });
  const manifest = usePrefetched?.atlasJsons 
    ? null // Already have atlas JSONs
    : await getJSON(joinPath(base, 'manifest.json'));
  
  const atlasJsons = usePrefetched?.atlasJsons ?? await loadAtlasJsons(base, manifest!);
  
  const entries = Object.entries(atlasJsons);
  const atlasEntries = entries.filter(([, data]) => isAtlas(data));
  const totalAtlases = atlasEntries.length;
  const atlasReports: AtlasBootReport[] = [];
  const compressedEntries: CompressedAtlasEntry[] = [];
  const wasmOk = isWasmAvailable();
  const decoderConcurrency = chooseKtx2DecoderConcurrency();
  const decoder = wasmOk
    ? createKtx2DecoderPool({
        concurrency: decoderConcurrency,
        decodeTimeoutMs: decoderConcurrency === 1 ? 12000 : 9000,
      })
    : null;
  let decoderSnapshot = createDecoderTelemetry();

  if (!wasmOk) {
    spriteLog('warn', 'wasm-unavailable', 'WebAssembly blocked (CSP?), skipping KTX2 decoder — using legacy image path');
  }
  
  notifyWarmup({ phase: 'load-textures', total: totalAtlases, done: 0 });

  const yieldCtl = new YieldController(FRAMES_PER_YIELD, MAX_CHUNK_MS);
  let processed = 0;

  try {
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!entry) continue;
      const [path, data] = entry;
      if (!isAtlas(data)) continue;

      const imgPath = relPath(path, data.meta.image);
      const frameKeys = Object.keys(data.frames || {});
      const expected = frameKeys.length;

      // Capability-based branch: KTX2 uses native decoder path, all others keep legacy image decode.
      // When WASM is unavailable (CSP), skip decoder entirely → fall through to legacy image path.
      if (decoder && COMPRESSED_ATLAS_RE.test(imgPath)) {
        let pass: HydratePassResult;
        try {
          pass = await loadCompressedAtlasViaDecoder(base, path, data, state, decoder);
        } catch (error) {
          const failureKind = classifyKtx2Error(error);
          pass = {
            hydrated: 0,
            coverage: 0,
            status: 'failed',
            sourceHits: { assets: 0, bridge: 0, runtime: 0 },
            missingSample: frameKeys.slice(0, MAX_MISSING_SAMPLE),
          };
          spriteLog('warn', 'ktx2-atlas-decode-failed', 'KTX2 atlas decode failed', {
            atlasPath: path,
            imagePath: imgPath,
            failureKind,
            error: String((error as Error)?.message ?? error),
          });
        }

        atlasReports.push({
          atlasPath: path,
          imagePath: imgPath,
          mode: 'compressed',
          source: 'ktx2-decoder',
          expectedFrames: expected,
          hydratedFrames: pass.hydrated,
          coverage: pass.coverage,
          status: pass.status,
          sourceHits: {
            assets: pass.sourceHits.assets,
            bridge: pass.sourceHits.bridge,
            runtime: pass.sourceHits.runtime,
          },
          missingSample: pass.missingSample,
        });
        compressedEntries.push({ atlasPath: path, imagePath: imgPath, data });

        processed++;
        notifyWarmup({ done: processed });
        await yieldCtl.yieldIfNeeded();
        if (i < entries.length - 1) {
          await delay(ATLAS_YIELD_DELAY_MS);
        }
        continue;
      }

      // Try to use prefetched blob, otherwise fetch it.
      let blob = usePrefetched?.blobs.get(imgPath);
      if (!blob) {
        blob = await getBlob(joinPath(base, imgPath));
      }

      const img = await blobToImage(blob);
      const baseTex = ctors.Texture.from(img);

      buildAtlasTextures(data, baseTex, state.tex, state.atlasBases, ctors);
      const hydrated = countHydratedFrames(frameKeys, state);
      const coverage = expected > 0 ? hydrated / expected : 1;

      atlasReports.push({
        atlasPath: path,
        imagePath: imgPath,
        mode: 'legacy',
        source: 'legacy-image',
        expectedFrames: expected,
        hydratedFrames: hydrated,
        coverage,
        status: computeHydrationStatus(coverage),
        sourceHits: { assets: hydrated, bridge: 0, runtime: 0 },
        missingSample: [],
      });

      processed++;
      notifyWarmup({ done: processed });

      // Cooperative yielding - give browser time to render/respond
      await yieldCtl.yieldIfNeeded();

      // Small delay between atlases to prevent frame drops on low-end devices
      if (i < entries.length - 1) {
        await delay(ATLAS_YIELD_DELAY_MS);
      }
    }
  } finally {
    if (decoder) {
      decoderSnapshot = decoder.snapshot();
      decoder.destroy();
    }
  }

  notifyWarmup({ phase: 'build-catalog' });
  
  // Yield before building item catalog (can be CPU-intensive)
  await yieldToBrowser();

  const { items, cats } = buildItemsFromTextures(state.tex, { catLevels: 1 });
  
  // Yield after building to let GC run
  await yieldToBrowser();
  
  state.items = items;
  state.filtered = items.slice();
  state.cats = cats;

  let fallbackBase: string | null = null;
  let loadMode: SpriteLoadMode = compressedEntries.length > 0 ? 'ktx2-native' : 'legacy';
  const getCompressedStats = () => {
    const compressedExpected = atlasReports
      .filter((report) => report.mode === 'compressed')
      .reduce((sum, report) => sum + report.expectedFrames, 0);
    const compressedHydrated = atlasReports
      .filter((report) => report.mode === 'compressed')
      .reduce((sum, report) => sum + report.hydratedFrames, 0);
    return { compressedExpected, compressedHydrated };
  };

  let { compressedExpected, compressedHydrated } = getCompressedStats();
  const compressedDegraded =
    compressedEntries.length > 0 &&
    compressedExpected > 0 &&
    compressedHydrated < compressedExpected * TARGET_COMPRESSED_COVERAGE;
  if (compressedDegraded) {
    const nativeRequired = isKtx2NativeRequired(state.version);
    const allowFallback = shouldAllowLegacyFallbackOnKtx2();
    const canAttemptFallback = !nativeRequired || allowFallback;

    if (canAttemptFallback) {
      fallbackBase = await tryLegacyVersionFallback(base, state, compressedEntries, atlasReports, ctors);
      if (fallbackBase) {
        recalcSpriteCatalog(state);
        ({ compressedExpected, compressedHydrated } = getCompressedStats());
        loadMode = 'legacy-fallback';
        spriteLog(
          'warn',
          'legacy-fallback-applied',
          'Applied legacy atlas fallback for compressed runtime compatibility',
          {
            fallbackBase,
            textures: state.tex.size,
            items: state.items.length,
          },
          { alwaysConsole: true, onceKey: 'legacy-fallback-applied' }
        );
      } else {
        loadMode = 'ktx2-native-failed';
      }
    } else {
      loadMode = 'ktx2-native-failed';
    }
  }

  const degradedCompressedReports = atlasReports.filter((report) => report.mode === 'compressed' && report.status !== 'ok');
  if (degradedCompressedReports.length > 0) {
    const degradedExpected = degradedCompressedReports.reduce((sum, report) => sum + report.expectedFrames, 0);
    const degradedHydrated = degradedCompressedReports.reduce((sum, report) => sum + report.hydratedFrames, 0);
    const degradedCoverage = degradedExpected > 0 ? degradedHydrated / degradedExpected : 0;
    const summary =
      `Compressed atlas hydration degraded ` +
      `(${degradedHydrated}/${degradedExpected}, ${(degradedCoverage * 100).toFixed(1)}%) ` +
      `across ${degradedCompressedReports.length} atlas(es)`;

    spriteLog('warn', 'compressed-hydration-degraded', summary, undefined, {
      alwaysConsole: true,
      onceKey: 'compressed-hydration-degraded',
    });
    spriteLog('warn', 'compressed-hydration-degraded-details', 'Per-atlas degraded hydration details', {
      atlases: degradedCompressedReports.map((report) => ({
        atlasPath: report.atlasPath,
        imagePath: report.imagePath,
        expectedFrames: report.expectedFrames,
        hydratedFrames: report.hydratedFrames,
        coverage: Number(report.coverage.toFixed(3)),
        sourceHits: report.sourceHits,
        missingSample: report.missingSample,
      })),
    });
  }
  
  notifyWarmup({ phase: 'complete', completed: true });

  if (compressedEntries.length > 0) {
    clearVariantCache(state);
    clearSpriteDataUrlCache();
  }

  const finalized = finalizeReportStatus(atlasReports);
  if (compressedEntries.length > 0 && loadMode === 'ktx2-native' && finalized.status !== 'ok') {
    loadMode = 'ktx2-native-failed';
  }
  state.loaded = true;
  return {
    atlasReports,
    compressedEntries,
    expectedFrames: finalized.expectedFrames,
    hydratedFrames: finalized.hydratedFrames,
    status: finalized.status,
    finalMode: finalized.finalMode,
    loadMode,
    bridgeSnapshot: getBridgeSnapshot(),
    fallbackBase,
    decoder: decoderSnapshot,
  };
}

/**
 * Fast PIXI resolution - simplified to match Aries Mod's proven approach.
 * Uses unsafeWindow consistently for Chrome/Firefox compatibility.
 */
type PixiBundle = { app: any; renderer: any; version: string | null; runtimeHints?: any[] };

/**
 * Get the page window context — delegates to pageContext for Firefox wrappedJSObject support.
 */
function getRoot(): any {
  return pageWindow;
}

/**
 * Traverse React fiber tree to find QuinoaEngine and extract PIXI renderer.
 * This is a fallback when hooks and global polling fail.
 */
function findPixiViaFiber(): PixiBundle | null {
  try {
    const canvas = document.querySelector('canvas');
    if (!canvas) return null;
    
    // Find React fiber root on the canvas or its ancestors
    let element: Element | null = canvas;
    let fiber: any = null;
    
    while (element && !fiber) {
      const keys = Object.keys(element);
      for (const key of keys) {
        if (key.startsWith('__reactFiber$') || key.startsWith('__reactContainer$')) {
          fiber = (element as any)[key];
          break;
        }
      }
      element = element.parentElement;
    }
    
    if (!fiber) return null;
    
    // BFS to find QuinoaEngine in the fiber tree
    const queue: any[] = [fiber];
    const visited = new WeakSet();
    let iterations = 0;
    const maxIterations = 10000;
    
    while (queue.length > 0 && iterations++ < maxIterations) {
      const node = queue.shift();
      if (!node || visited.has(node)) continue;
      visited.add(node);
      
      // Check memoizedState chain for QuinoaEngine
      let state = node.memoizedState;
      let hookDepth = 0;
      while (state && hookDepth++ < 50) {
        const ms = state.memoizedState !== undefined ? state.memoizedState : state;
        
        if (ms && typeof ms === 'object') {
          // Check for QuinoaEngine structure (has canvasSpriteCache with renderer)
          if (ms.canvasSpriteCache?.renderer) {
            return {
              app: ms.app || null,
              renderer: ms.canvasSpriteCache.renderer,
              version: null,
              runtimeHints: [ms.canvasSpriteCache, ms.gameTextureCache, ms],
            } as any;
          }
          // Alternative: gameTextureCache
          if (ms.gameTextureCache?.renderer) {
            return {
              app: ms.app || null,
              renderer: ms.gameTextureCache.renderer,
              version: null,
              runtimeHints: [ms.gameTextureCache, ms.canvasSpriteCache, ms],
            } as any;
          }
          // Direct PIXI app check (has stage, renderer, ticker)
          if (ms.stage && ms.renderer && ms.ticker) {
            return { app: ms, renderer: ms.renderer, version: null };
          }
          // Direct renderer check
          if (ms.extract && ms.render && (ms.gl || ms.context)) {
            return { app: null, renderer: ms, version: null };
          }
        }
        
        state = state.next;
      }
      
      // Traverse fiber tree
      if (node.child) queue.push(node.child);
      if (node.sibling) queue.push(node.sibling);
      if (node.return && !visited.has(node.return)) queue.push(node.return);
    }
  } catch {
    // Silent failure - will try other detection methods
  }
  
  return null;
}

async function resolvePixiFast(): Promise<PixiBundle> {
  const root = getRoot();
  
  // Check 1: Injected script captured PIXI (critical for Chrome!)
  const checkInjectedCapture = (): PixiBundle | null => {
    const captured = root.__QPM_PIXI_CAPTURED__;
    if (captured?.app && captured?.renderer) {
      return {
        app: captured.app,
        renderer: captured.renderer,
        version: captured.version || null,
        runtimeHints: [captured.app?.canvasSpriteCache, captured.app?.gameTextureCache, captured.engine],
      } as any;
    }
    return null;
  };
  
  // Check 2: Global PIXI variables
  const checkGlobals = (): PixiBundle | null => {
    const app = root.__PIXI_APP__ || root.PIXI_APP || root.app || null;
    const renderer = root.__PIXI_RENDERER__ || root.PIXI_RENDERER__ || root.renderer || app?.renderer || null;
    
    if (app && renderer) {
      const version = root.__PIXI_VERSION__ || root.__PIXI__?.VERSION || root.PIXI?.VERSION || null;
      return {
        app,
        renderer,
        version,
        runtimeHints: [app?.canvasSpriteCache, app?.gameTextureCache, renderer?.canvasSpriteCache, renderer?.gameTextureCache],
      } as any;
    }
    return null;
  };
  
  // Check 3: Aries Mod's sprite service (piggyback if available)
  const checkAriesService = (): PixiBundle | null => {
    const ariesService = root.__MG_SPRITE_SERVICE__;
    if (ariesService?.state?.renderer) {
      return {
        app: ariesService.state.app || null,
        renderer: ariesService.state.renderer,
        version: ariesService.state.version || null,
        runtimeHints: [ariesService.state?.canvasSpriteCache, ariesService.state?.gameTextureCache, ariesService.state],
      } as any;
    }
    return null;
  };
  
  // Check 4: React fiber traversal (direct DOM inspection)
  const checkFiber = (): PixiBundle | null => findPixiViaFiber();
  
  // Combined check - injected capture is most reliable for Chrome
  const check = (): PixiBundle | null => checkInjectedCapture() || checkGlobals() || checkAriesService() || checkFiber();
  
  // Try immediately
  const hit = check();
  if (hit) return hit;

  // Poll for up to 15 seconds with all methods
  const maxMs = 15000;
  const pollStart = performance.now();
  
  while (performance.now() - pollStart < maxMs) {
    await new Promise(r => setTimeout(r, 100));
    const retry = check();
    if (retry) return retry;
  }

  // Final fallback: wait on hooks
  const waited = await waitForPixi(hooks, 5000).catch(() => ({ app: null, renderer: null, version: null }));
  
  if (waited.renderer || waited.app?.renderer) {
    return { app: waited.app, renderer: waited.renderer || waited.app?.renderer, version: waited.version };
  }
  
  throw new Error('PIXI app timeout');
}

function resolveActiveRenderer(state: SpriteState, preferred?: any): any {
  const candidates: any[] = [];
  const push = (value: any) => {
    if (!value) return;
    if (!candidates.includes(value)) candidates.push(value);
  };

  push(state.app?.renderer);
  push(preferred);
  push(state.renderer);
  push(state.app?.render);

  const withExtract = candidates.find((renderer) => hasExtractCanvas(renderer));
  const picked = withExtract ?? candidates[0] ?? null;
  if (picked && picked !== state.renderer) {
    state.renderer = picked;
    updateBootReportRenderer(state);
  }
  return picked;
}

// ─────────────────────────────────────────────────────────────────────────────
// Diagnostics bus integration (Phase 2 item 2.5)
//
// §4.4 ruling: single 'spriteV2' bus entry; sub-state (boot, renderer, hooks,
// detector, compat) lives in `metrics`, not split into multiple subsystems.
// ─────────────────────────────────────────────────────────────────────────────

function buildSpriteMetrics(detail?: Record<string, unknown>): Readonly<Record<string, number | string>> {
  const report = spriteBootReport;
  const coverage = Number(
    (detail?.['coverage'] as number | undefined) ?? report?.coverage ?? 0,
  );
  const expected = Number(
    (detail?.['expectedFrames'] as number | undefined) ?? report?.expectedFrames ?? 0,
  );
  const hydrated = Number(
    (detail?.['hydratedFrames'] as number | undefined) ?? report?.hydratedFrames ?? 0,
  );
  const finalMode = String(
    (detail?.['mode'] as string | undefined) ?? report?.finalMode ?? 'unknown',
  );
  const loadMode = String(
    (detail?.['loadMode'] as string | undefined) ?? report?.loadMode ?? ctx?.state.loadMode ?? 'unknown',
  );
  return {
    coverage: Number.isFinite(coverage) ? Number(coverage.toFixed(3)) : 0,
    expectedFrames: Number.isFinite(expected) ? expected : 0,
    hydratedFrames: Number.isFinite(hydrated) ? hydrated : 0,
    finalMode,
    loadMode,
    textures: ctx?.state.tex.size ?? 0,
    items: ctx?.state.items.length ?? 0,
  };
}

function publishSpriteHealth(
  status: SubsystemHealth['status'] | undefined,
  message: string,
  detail?: Record<string, unknown>,
): void {
  if (!spriteDiagnosticsStarted) return;
  const metrics = buildSpriteMetrics(detail);
  const sig = `${status ?? ''}|${message}|${metrics.coverage}|${metrics.hydratedFrames}|${metrics.expectedFrames}`;
  if (sig === lastPublishedSig) return;
  lastPublishedSig = sig;
  healthBus.publish({
    subsystem: SPRITE_SUBSYSTEM,
    category: 'core',
    ...(status === undefined ? {} : { status }),
    message,
    metrics,
  });
}

function describeHydration(detail: Record<string, unknown>): string {
  const hydrated = Number(detail['hydratedFrames'] ?? 0);
  const expected = Number(detail['expectedFrames'] ?? 0);
  const coverage = Number(detail['coverage'] ?? 0);
  return `Hydration ${(coverage * 100).toFixed(0)}% (${hydrated}/${expected})`;
}

function handleHydrationStateChange(detail: Record<string, unknown>): void {
  const reason = String(detail['reason'] ?? '');
  const status = String(detail['status'] ?? '');
  const degraded = Boolean(detail['degraded']);

  // 'boot' fires when start() begins — we already registered as 'starting'.
  if (reason === 'boot') return;

  if (status === 'failed') {
    diagLog.error('QPM-SPRITE-001', {
      reason,
      coverage: detail['coverage'] ?? 0,
      expectedFrames: detail['expectedFrames'] ?? 0,
      hydratedFrames: detail['hydratedFrames'] ?? 0,
      finalMode: detail['mode'],
      loadMode: detail['loadMode'],
    });
    return;
  }

  if (status === 'degraded' || degraded) {
    diagLog.warn('QPM-SPRITE-002', {
      reason,
      coverage: detail['coverage'] ?? 0,
      expectedFrames: detail['expectedFrames'] ?? 0,
      hydratedFrames: detail['hydratedFrames'] ?? 0,
      finalMode: detail['mode'],
      loadMode: detail['loadMode'],
    });
    return;
  }

  // status === 'ok' or no explicit degradation — publish healthy state.
  publishSpriteHealth('ok', describeHydration(detail), detail);
}

/**
 * Wire the sprite-v2 subsystem into the diagnostics health bus. Idempotent.
 * Must run after initDiagnostics() so the bus exists. Safe to call before
 * initSpriteSystem() — registers as 'starting' and listens for hydration
 * events from the existing dispatchHydrationEvent() flow.
 */
export function startSpriteV2Diagnostics(): void {
  if (spriteDiagnosticsStarted) return;
  spriteDiagnosticsStarted = true;

  healthBus.register(SPRITE_SUBSYSTEM, {
    category: 'core',
    status: 'starting',
    message: 'Waiting for PIXI + atlas hydration',
  });

  // If sprite boot already completed before diagnostics started, replay state.
  if (spriteBootReport) {
    const reason = spriteBootReport.status === 'ok' ? 'hydrated' : 'degraded/final';
    handleHydrationStateChange({
      reason,
      status: spriteBootReport.status,
      degraded: spriteBootReport.status !== 'ok',
      mode: spriteBootReport.finalMode,
      loadMode: spriteBootReport.loadMode,
      expectedFrames: spriteBootReport.expectedFrames,
      hydratedFrames: spriteBootReport.hydratedFrames,
      coverage: spriteBootReport.coverage,
    });
  }

  hydrationEventHandler = (event: Event) => {
    const detail = (event as CustomEvent).detail as Record<string, unknown> | null | undefined;
    if (!detail) return;
    handleHydrationStateChange(detail);
  };
  try {
    window.addEventListener(HYDRATION_EVENT, hydrationEventHandler);
  } catch {
    // window unavailable — bus stays in 'starting' until publish via report path.
  }
}

export function stopSpriteV2Diagnostics(): void {
  if (!spriteDiagnosticsStarted) return;
  if (hydrationEventHandler) {
    try { window.removeEventListener(HYDRATION_EVENT, hydrationEventHandler); } catch { /* ignore */ }
    hydrationEventHandler = null;
  }
  spriteDiagnosticsStarted = false;
  lastPublishedSig = '';
}

/**
 * Surface a sprite init failure on the health bus. Called from main.ts when
 * the initSpriteSystem() promise rejects — otherwise the bus would sit in
 * 'starting' forever.
 */
export function reportSpriteV2InitFailed(error: unknown): void {
  diagLog.error('QPM-SPRITE-001', { phase: 'initSpriteSystem' }, error);
}

async function start(): Promise<SpriteService> {
  const runtimeOrigin = getRuntimeWindow().location?.origin || DEFAULT_CFG.origin;

  // Initialize context
  ctx = {
    cfg: { ...DEFAULT_CFG, origin: runtimeOrigin },
    state: createInitialState(),
  };

  // Note: hooks are created at module load time (see top of file)
  // This ensures we catch PIXI init events even if they happen before start() is called

  if (ctx.state.started) {
    throw new Error('Sprite system already started');
  }

  ctx.state.started = true;
  notifyWarmup({ phase: 'init', total: 0, done: 0, completed: false });

  // Detect version and build base URL early so we can start prefetching
  const version = await detectGameVersionWithRetry();
  const base = buildAssetsBaseUrl(ctx.cfg.origin, version);
  ctx.state.version = version;
  ctx.state.base = base;
  dispatchHydrationEvent('boot', {
    loadMode: 'unknown',
    expectedFrames: 0,
    hydratedFrames: 0,
    coverage: 0,
    degraded: false,
  });

  // Start prefetching atlas data in parallel with PIXI initialization
  // This overlaps network I/O with waiting for the game to initialize PIXI
  if (!prefetchPromise) {
    prefetchPromise = prefetchAtlasData(base);
  }

  notifyWarmup({ phase: 'wait-pixi' });

  // Resolve PIXI using fast direct detection, falling back to hooks
  const resolved = await resolvePixiFast() as any;
  const { app, renderer: _renderer, version: pixiVersion } = resolved;
  await ensureDocumentReady();
  
  // Brief yield to let the browser catch up after PIXI init
  await yieldToBrowser();

  // Get renderer (prefer explicit renderer, fallback to app.renderer)
  ctx.state.app = app; // May be null if we got renderer through canvasSpriteCache
  ctx.state.renderer = _renderer || app?.renderer || app?.render || null;
  const renderer = resolveActiveRenderer(ctx.state, _renderer || app?.renderer || app?.render || null);
  if (!renderer) {
    throw new Error('No PIXI renderer found');
  }

  // Get PIXI constructors - try global PIXI first, then fall back to extraction
  ctx.state.ctors = getCtors(app, renderer);
  ctx.state.runtimeTextureHints = Array.isArray(resolved?.runtimeHints)
    ? resolved.runtimeHints.filter(Boolean)
    : [];
  ctx.state.sig = computeVariantSignature(ctx.state).sig;

  const publishLoadResult = (loadResult: LoadTexturesResult, eventReason?: string): void => {
    ctx!.state.loadMode = loadResult.loadMode;
    ctx!.state.fallbackBase = loadResult.fallbackBase ?? null;
    ctx!.state.decoder = { ...loadResult.decoder };

    const coverage = loadResult.expectedFrames > 0
      ? loadResult.hydratedFrames / loadResult.expectedFrames
      : 1;

    spriteBootReport = {
      version: ctx!.state.version,
      base: ctx!.state.base,
      pixiVersion,
      finalMode: loadResult.finalMode,
      loadMode: loadResult.loadMode,
      status: loadResult.status,
      expectedFrames: loadResult.expectedFrames,
      hydratedFrames: loadResult.hydratedFrames,
      coverage,
      fallbackBase: loadResult.fallbackBase ?? null,
      atlasReports: loadResult.atlasReports.map((r) => ({ ...r })),
      bridgeSnapshot: {
        bridge: loadResult.bridgeSnapshot,
        fallbackBase: loadResult.fallbackBase ?? null,
      },
      renderer: buildRendererReport(ctx!.state),
      decoder: { ...loadResult.decoder },
      generatedAt: Date.now(),
    };

    dispatchHydrationEvent(eventReason ?? (loadResult.status === 'ok' ? 'hydrated' : 'degraded/final'), {
      mode: loadResult.finalMode,
      loadMode: loadResult.loadMode,
      status: loadResult.status,
      degraded: loadResult.status !== 'ok',
      expectedFrames: loadResult.expectedFrames,
      hydratedFrames: loadResult.hydratedFrames,
      coverage: Number(coverage.toFixed(3)),
      renderer: spriteBootReport.renderer,
    });
  };

  const scheduleContextRestoreReload = (): void => {
    if (contextRestoreReloadPromise) return;
    contextRestoreReloadPromise = (async () => {
      try {
        await delay(80);
        if (!ctx?.state?.base) return;
        resolveActiveRenderer(ctx.state);
        const reloaded = await loadTextures(ctx.state.base, ctx.state);
        publishLoadResult(reloaded, reloaded.status === 'ok' ? 'rehydrated' : 'degraded/final');
        if (reloaded.compressedEntries.length > 0) {
          await runBackgroundCompressedRehydrate(ctx.state.base, reloaded.compressedEntries, reloaded.atlasReports, ctx.state);
        }
      } catch (error) {
        spriteLog('warn', 'context-restore-reload-failed', 'Sprite reload after context restore failed', {
          error: String((error as Error)?.message ?? error),
        });
      } finally {
        contextRestoreReloadPromise = null;
      }
    })();
  };

  // Listen for WebGL context restoration — clear stale texture caches so the
  // next sprite render triggers re-extraction from the new context.
  try {
    const canvas = app?.canvas || app?.view;
    if (canvas instanceof HTMLCanvasElement) {
      canvas.addEventListener('webglcontextrestored', () => {
        if (ctx) {
          ctx.state.tex.clear();
          ctx.state.srcCan.clear();
          ctx.state.atlasBases.clear();
          clearVariantCache(ctx.state);
          clearSpriteDataUrlCache();
          resolveActiveRenderer(ctx.state);
          spriteLog('warn', 'webgl-context-restored', 'WebGL context restored - sprite caches cleared, scheduling reload');
          scheduleContextRestoreReload();
        }
      });
    }
  } catch { /* ignore */ }

  // Wait for prefetch to complete (should already be done or nearly done)
  const prefetched = await (prefetchPromise ?? Promise.resolve(null));

  // Load all textures using prefetched data where available
  const loadResult = await loadTextures(ctx.state.base, ctx.state, prefetched);
  const hasCompressedAtlases = loadResult.atlasReports.some((report) => report.mode === 'compressed');
  publishLoadResult(loadResult);

  // Start job processor using ticker if available, otherwise use requestAnimationFrame
  ctx.state.open = true;
  if (app?.ticker?.add) {
    app.ticker.add(() => {
      processVariantJobs(ctx!.state, ctx!.cfg);
    });
  } else {
    // Fallback: use requestAnimationFrame for job processing
    const processLoop = () => {
      if (ctx?.state?.open) {
        processVariantJobs(ctx.state, ctx.cfg);
        requestAnimationFrame(processLoop);
      }
    };
    requestAnimationFrame(processLoop);
  }

  // Helper to render texture to canvas
  const renderTextureToCanvas = (tex: any): HTMLCanvasElement | null => {
    const state = ctx!.state;
    const tried: any[] = [];
    const pushTried = (renderer: any): boolean => {
      if (!renderer) return false;
      if (tried.includes(renderer)) return false;
      tried.push(renderer);
      return true;
    };
    const textureKey =
      tex?.label ||
      tex?.textureCacheIds?.[0] ||
      tex?.frame?.label ||
      `${tex?.frame?.x ?? 'x'}:${tex?.frame?.y ?? 'y'}:${tex?.frame?.width ?? 'w'}:${tex?.frame?.height ?? 'h'}`;

    const setRenderError = (message: string | null): void => {
      lastSpriteRenderError = message;
      lastSpriteRenderErrorAt = message ? Date.now() : null;
      updateBootReportRenderer(state);
    };

    const tryExtract = (renderer: any, stage: string): HTMLCanvasElement | null => {
      if (!pushTried(renderer)) return null;
      if (!hasExtractCanvas(renderer)) return null;

      let spr: any = null;
      try {
        spr = new state.ctors!.Sprite(tex);
        const canvas = renderer.extract.canvas(spr, { resolution: 1 });
        if (canvas) {
          if (state.renderer !== renderer) {
            state.renderer = renderer;
            updateBootReportRenderer(state);
          }
          setRenderError(null);
          return canvas;
        }
      } catch (error) {
        const msg = String((error as Error)?.message ?? error);
        const sig = `${stage}|${textureKey}|${getRendererUid(renderer) ?? 'no-uid'}|${msg}`;
        rememberRenderFailure(sig, {
          stage,
          texture: textureKey,
          rendererUid: getRendererUid(renderer),
          rendererType: getRendererType(renderer),
          hasExtractCanvas: hasExtractCanvas(renderer),
          error: msg,
        });
        setRenderError(`${stage}:${msg}`);
      } finally {
        try {
          spr?.destroy?.({ children: true, texture: false, baseTexture: false });
        } catch {
          // ignore sprite cleanup issues
        }
      }
      return null;
    };

    // Priority 1: textureToCanvas — uses stored KTX2 source canvas (no GPU needed)
    // then falls back to GPU extract with blank detection, then PIXI source chain.
    // This order avoids the common blank-canvas problem when GPU textures are
    // never rendered to screen (KTX2-decoded textures used only for offscreen extraction).
    try {
      const fallback = textureToCanvas(tex, state, ctx!.cfg);
      if (fallback) {
        setRenderError(null);
        return fallback;
      }
    } catch (error) {
      const msg = String((error as Error)?.message ?? error);
      const sig = `manual-fallback|${textureKey}|${getRendererUid(state.renderer) ?? 'no-uid'}|${msg}`;
      rememberRenderFailure(sig, {
        stage: 'manual-fallback',
        texture: textureKey,
        rendererUid: getRendererUid(state.renderer),
        rendererType: getRendererType(state.renderer),
        hasExtractCanvas: hasExtractCanvas(state.renderer),
        error: msg,
      });
      setRenderError(`manual-fallback:${msg}`);
    }

    // Priority 2: GPU extract — fallback when no KTX2 source canvas or manual path fails
    const currentRenderer = state.renderer;
    const appRenderer = state.app?.renderer ?? null;

    const direct = tryExtract(currentRenderer, 'state.renderer');
    if (direct) return direct;

    const appHit = tryExtract(appRenderer, 'app.renderer');
    if (appHit) return appHit;

    const resolved = resolveActiveRenderer(state);
    const resolvedHit = tryExtract(resolved, 'resolved.renderer');
    if (resolvedHit) return resolvedHit;

    return null;
  };

  // Build service
  const service: SpriteService = {
    ready: Promise.resolve(),
    state: ctx.state,
    cfg: ctx.cfg,

    list(category = 'any') {
      return api.listItemsByCategory(ctx!.state, category);
    },

    getBaseSprite(params) {
      return api.getBaseSprite(params, ctx!.state);
    },

    getSpriteWithMutations(params) {
      return api.getSpriteWithMutations(params, ctx!.state, ctx!.cfg);
    },

    buildVariant(mutations) {
      return api.buildVariant(mutations);
    },

    renderToCanvas(arg: GetSpriteParams | any): HTMLCanvasElement | null {
      const tex = arg?.isTexture || arg?.frame ? arg : service.getSpriteWithMutations(arg);
      if (!tex) return null;
      return renderTextureToCanvas(tex);
    },

    async renderToDataURL(arg: GetSpriteParams | any, type = 'image/png', quality?: number): Promise<string | null> {
      const c = service.renderToCanvas(arg);
      if (!c) return null;
      return c.toDataURL(type, quality);
    },

    renderOnCanvas(arg: GetSpriteParams | any, opts: RenderOptions = {}): { wrap: HTMLDivElement; canvas: HTMLCanvasElement } | null {
      const c = service.renderToCanvas(arg);
      if (!c) return null;

      c.style.background = 'transparent';
      c.style.display = 'block';

      let mutW = c.width || c.clientWidth;
      let mutH = c.height || c.clientHeight;
      let baseW = mutW;
      let baseH = mutH;

      if (arg && !arg.isTexture && !arg.frame) {
        const baseTex = service.getBaseSprite(arg);
        if (baseTex) {
          baseW = baseTex?.orig?.width ?? baseTex?._orig?.width ?? baseTex?.frame?.width ?? baseTex?._frame?.width ?? baseTex?.width ?? baseW;
          baseH = baseTex?.orig?.height ?? baseTex?._orig?.height ?? baseTex?.frame?.height ?? baseTex?._frame?.height ?? baseTex?.height ?? baseH;
        }
      }

      const scaleToBase = Math.min(baseW / mutW, baseH / mutH, 1);
      let logicalW = mutW * scaleToBase;
      let logicalH = mutH * scaleToBase;

      const { maxWidth, maxHeight, allowScaleUp } = opts;
      if (maxWidth || maxHeight) {
        const scaleW = maxWidth ? maxWidth / logicalW : 1;
        const scaleH = maxHeight ? maxHeight / logicalH : 1;
        let scale = Math.min(scaleW || 1, scaleH || 1);
        if (!allowScaleUp) scale = Math.min(scale, 1);
        logicalW = Math.floor(logicalW * scale);
        logicalH = Math.floor(logicalH * scale);
      }

      if (logicalW) c.style.width = `${logicalW}px`;
      if (logicalH) c.style.height = `${logicalH}px`;

      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:inline-flex;align-items:flex-start;justify-content:flex-start;padding:0;margin:0;background:transparent;border:none;flex:0 0 auto;';
      wrap.appendChild(c);

      return { wrap, canvas: c };
    },

    clearOverlay(): void {
      const host = document.getElementById('mg-sprite-overlay');
      if (host) host.remove();
    },

    renderAnimToCanvases(params: GetSpriteParams): HTMLCanvasElement[] {
      const item = ctx!.state.items.find((it) => it.key === `sprite/${params.category}/${params.id}` || it.key === params.id);
      if (!item) return [];

      if (item.isAnim && item.frames?.length) {
        const texes = params?.mutations?.length ? [service.getSpriteWithMutations(params)] : item.frames;
        return texes.map((t) => renderTextureToCanvas(t)).filter(Boolean) as HTMLCanvasElement[];
      }

      const t = service.getSpriteWithMutations(params);
      return t ? [renderTextureToCanvas(t)].filter(Boolean) as HTMLCanvasElement[] : [];
    },
  };

  // Expose to global (both runtime window and userscript window for console compatibility)
  const win = getRuntimeWindow();
  const targets = new Set<any>([win, window]);
  for (const target of targets) {
    if (!target) continue;
    (target as any).__MG_SPRITE_STATE__ = ctx.state;
    (target as any).__MG_SPRITE_CFG__ = ctx.cfg;
    (target as any).__MG_SPRITE_SERVICE__ = service;
    (target as any).MG_SPRITE_HELPERS = service;
  }

  // Expose individual functions
  for (const target of targets) {
    if (!target) continue;
    (target as any).getSpriteWithMutations = service.getSpriteWithMutations;
    (target as any).getBaseSprite = service.getBaseSprite;
    (target as any).buildSpriteVariant = service.buildVariant;
    (target as any).listSpritesByCategory = service.list;
    (target as any).renderSpriteToCanvas = service.renderToCanvas;
    (target as any).renderSpriteToDataURL = service.renderToDataURL;
  }

  // Expose catalog API
  const spriteCatalogApi = {
    open() {
      ctx!.state.open = true;
    },
    close() {
      ctx!.state.open = false;
    },
    toggle() {
      ctx!.state.open = !ctx!.state.open;
    },
    setCategory(cat: string) {
      ctx!.state.cat = cat || '__all__';
    },
    setFilterText(text: string) {
      ctx!.state.q = String(text || '').trim();
    },
    setSpriteFilter(name: string) {
      ctx!.state.f = name;
      ctx!.state.mutOn = false;
    },
    setMutation(on: boolean, ...muts: string[]) {
      ctx!.state.mutOn = !!on;
      ctx!.state.f = '';
      ctx!.state.mutations = ctx!.state.mutOn ? muts.filter(Boolean).map((name) => name) : [];
    },
    filters() {
      return [];
    },
    categories() {
      return [...ctx!.state.cats.keys()].sort((a, b) => a.localeCompare(b));
    },
    cacheStats() {
      return getCacheStats(ctx!.state);
    },
    clearCache() {
      clearVariantCache(ctx!.state);
    },
    curVariant: () => computeVariantSignature(ctx!.state),
  };
  for (const target of targets) {
    if (!target) continue;
    (target as any).MGSpriteCatalog = spriteCatalogApi;
  }

  log('[QPM Sprite-v2] Initialized', {
    version: ctx.state.version,
    pixi: pixiVersion,
    textures: ctx.state.tex.size,
    items: ctx.state.items.length,
    categories: ctx.state.cats.size,
    coverage: Number((spriteBootReport?.coverage ?? 0).toFixed(3)),
    mode: spriteBootReport?.finalMode ?? 'unknown',
    loadMode: ctx.state.loadMode ?? 'unknown',
  });

  if (hasCompressedAtlases) {
    void (async () => {
      await delay(0);
      if (ctx?.state?.base && loadResult.compressedEntries.length > 0) {
        await runBackgroundCompressedRehydrate(ctx.state.base, loadResult.compressedEntries, loadResult.atlasReports, ctx.state);
      }
      if (loadResult.status === 'ok') {
        await runPostHydrationMutationPass(ctx!.state, ctx!.cfg);
        dispatchHydrationEvent('hydrated', {
          mode: spriteBootReport?.finalMode ?? 'unknown',
          loadMode: ctx?.state?.loadMode ?? 'unknown',
          expectedFrames: spriteBootReport?.expectedFrames ?? 0,
          hydratedFrames: spriteBootReport?.hydratedFrames ?? 0,
          coverage: Number((spriteBootReport?.coverage ?? 0).toFixed(3)),
          degraded: (spriteBootReport?.status ?? 'ok') !== 'ok',
          renderer: spriteBootReport?.renderer ?? null,
        });
      }
    })();
  }

  return service;
}

function normalizeProbeInput(input: SpriteProbeInput): {
  input: string;
  category: string;
  id: string;
  mutations: string[];
} {
  if (typeof input === 'string') {
    const raw = input.trim();
    if (!raw) {
      return { input: String(input), category: 'any', id: '', mutations: [] };
    }
    return { input: raw, category: 'any', id: raw, mutations: [] };
  }

  const key = String(input.key ?? '').trim();
  if (key) {
    return {
      input: key,
      category: String(input.category ?? 'any'),
      id: key,
      mutations: Array.isArray(input.mutations) ? input.mutations.map((m) => String(m)).filter(Boolean) : [],
    };
  }

  const category = String(input.category ?? 'any').trim() || 'any';
  const id = String(input.id ?? '').trim();
  return {
    input: `${category}:${id}`,
    category,
    id,
    mutations: Array.isArray(input.mutations) ? input.mutations.map((m) => String(m)).filter(Boolean) : [],
  };
}

export function spriteProbe(inputs?: SpriteProbeInput[]): SpriteProbeResult[] {
  const probeInputs: SpriteProbeInput[] = inputs && inputs.length
    ? inputs
    : [
        'sprite/ui/Coin',
        'sprite/pet/Worm',
        'sprite/plant/Sunflower',
        'sprite/seed/Sunflower',
        'sprite/mutation/Rainbow',
        'sprite/mutation-overlay/FrozenTallPlant',
      ];

  if (!ctx?.state) {
    return probeInputs.map((value) => {
      const normalized = normalizeProbeInput(value);
      return {
        input: normalized.input,
        category: normalized.category,
        id: normalized.id,
        mutations: normalized.mutations,
        ok: false,
        width: 0,
        height: 0,
        error: 'sprite-context-not-initialized',
      };
    });
  }

  const service = (getRuntimeWindow() as any).__MG_SPRITE_SERVICE__ as SpriteService | undefined;
  if (!service) {
    return probeInputs.map((value) => {
      const normalized = normalizeProbeInput(value);
      return {
        input: normalized.input,
        category: normalized.category,
        id: normalized.id,
        mutations: normalized.mutations,
        ok: false,
        width: 0,
        height: 0,
        error: 'sprite-service-not-available',
      };
    });
  }

  return probeInputs.map((value) => {
    const normalized = normalizeProbeInput(value);
    try {
      const canvas = service.renderToCanvas({
        category: normalized.category as any,
        id: normalized.id,
        mutations: normalized.mutations,
      });
      return {
        input: normalized.input,
        category: normalized.category,
        id: normalized.id,
        mutations: normalized.mutations,
        ok: Boolean(canvas),
        width: canvas?.width ?? 0,
        height: canvas?.height ?? 0,
      };
    } catch (error) {
      return {
        input: normalized.input,
        category: normalized.category,
        id: normalized.id,
        mutations: normalized.mutations,
        ok: false,
        width: 0,
        height: 0,
        error: String((error as Error)?.message ?? error),
      };
    }
  });
}

// Export the service initializer
export { start as initSpriteSystem };

// Export types
export type { SpriteService, GetSpriteParams, RenderOptions };

