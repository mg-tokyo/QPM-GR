// src/features/textureSwapper.ts
// Texture Manipulator — cosmetic texture overrides for QPM UI (Layer A) and live PIXI garden (Layer B)
// No game state changes — visual only.

import { storage } from '../../utils/storage';
import { createLogger } from '../../utils/logger';
import { notify } from '../../core/notifications';
import { pageWindow } from '../../core/pageContext';
import { dispatchCustomEventAll } from '../../core/pageContext';
import { serviceReady, onSpritesReady, invalidateSpriteKeyCache } from '../../sprite-v2/compat';
import type { SpriteService, SpriteCategory } from '../../sprite-v2/types';

const log = createLogger('QPM:TextureSwapper', false);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'qpm.textureSwaps.v1';
const DEBUG_STORAGE_KEY = 'qpm.textureSwaps.debugLogs';
export const TEXTURE_MANIPULATOR_ENABLED = false;
export const UPLOADS_ENABLED = true;
const MAX_UPLOAD_BYTES = 512 * 1024; // 512 KB
const COMPRESS_SIZE = 256;
const LAYER_B_REFRESH_DELAYS_MS = [0, 300, 1200, 3000, 7000] as const;
const MAX_WALK_DEPTH = 25;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TextureOverrideRule {
  id: string;
  enabled: boolean;
  targetSpriteKey: string;        // atlas key e.g. 'sprite/plant/RoseRed'
  targetCategory: SpriteCategory; // for UI grouping
  displayLabel: string;           // human-readable (display only)
  mutationBehavior?: 'preserve' | 'replace';
  source: {
    type: 'library' | 'upload';
    librarySpriteKey?: string;    // replacement game atlas key
    uploadAssetId?: string;       // key into uploadedAssets
  };
  params: {
    tintColor?: string;           // CSS color e.g. '#ff0000'
    tintAlpha?: number;           // 0–1
    tintBlend?: string;           // GlobalCompositeOperation
    scaleX?: number;              // Layer B display scale
    scaleY?: number;
    alpha?: number;               // Layer B display alpha
  };
}

export interface TextureManipulatorState {
  version: 1;
  rules: TextureOverrideRule[];
  uploadedAssets: Record<string, string>; // assetId → base64 data URL
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let swapperState: TextureManipulatorState = { version: 1, rules: [], uploadedAssets: {} };
let activeRules: TextureOverrideRule[] = [];
let currentSvc: SpriteService | null = null;

// Layer A: override svc.state.tex + item.first
const origTextures = new Map<string, any | null>(); // ruleId -> original PIXI.Texture | null
const ruleTextures = new Map<string, any>(); // ruleId -> custom PIXI.Texture
const ruleVariantTextures = new Map<string, any>(); // cacheKey -> mutation-aware stage texture
const origItemFirsts = new Map<string, any>(); // ruleId -> original item.first (QPM UI revert)
const retiredTextures = new Set<any>();

// Layer B: override live PIXI stage sprites
type LayerBOriginalSnapshot = {
  texture: any;
  scaleX: number;
  scaleY: number;
  alpha: number;
  frameSig: string | null;
  keyHints: string[];
};
let layerBOriginals = new WeakMap<object, LayerBOriginalSnapshot>();
let layerBModified: any[] = [];
let ruleRevision = 0;
let lastLayerBApplyToken: string | null = null;

const objectIdentity = new WeakMap<object, number>();
let nextObjectIdentity = 1;

let textureSwapperDebugEnabled = false;
let layerBRefreshRunId = 0;
const layerBRefreshTimers = new Set<number>();

let started = false;
const cleanups: Array<() => void> = [];

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function loadState(): TextureManipulatorState {
  try {
    const saved = storage.get<TextureManipulatorState | null>(STORAGE_KEY, null);
    if (saved && saved.version === 1) {
      const normalizedRules = Array.isArray(saved.rules)
        ? saved.rules.map((rule) => ({
          ...rule,
          mutationBehavior: rule.mutationBehavior ?? 'preserve',
        }))
        : [];
      return { ...saved, rules: normalizedRules };
    }
  } catch (e) {
    log('Failed to load state', e);
  }
  return { version: 1, rules: [], uploadedAssets: {} };
}

function saveState(): void {
  try {
    storage.set(STORAGE_KEY, swapperState);
  } catch (e) {
    log('Failed to save state', e);
    notify({ feature: 'textureSwapper', level: 'error', message: 'Texture rules failed to save' });
  }
}

// ---------------------------------------------------------------------------
// Canvas utilities
// ---------------------------------------------------------------------------

export function parseAtlasKey(key: string): { category: SpriteCategory; id: string } {
  const parts = key.split('/').filter(Boolean);
  const start = parts[0] === 'sprite' ? 1 : 0;
  const category = (parts[start] ?? 'any') as SpriteCategory;
  const id = parts.slice(start + 1).join('/');
  return { category, id };
}

async function loadImageToCanvas(dataUrl: string): Promise<HTMLCanvasElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(null); return; }
      ctx.drawImage(img, 0, 0);
      resolve(canvas);
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

function offscreenToCanvas(src: any): HTMLCanvasElement | null {
  try {
    const out = document.createElement('canvas');
    out.width = src.width as number;
    out.height = src.height as number;
    const ctx = out.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(src, 0, 0);
    return out;
  } catch {
    return null;
  }
}

function texToAtlasCanvas(tex: any): HTMLCanvasElement | null {
  try {
    const src: any = tex?.source?.resource?.source
      ?? tex?._source?.resource?.source
      ?? tex?._baseTexture?.resource?.source
      ?? null;
    const frame: any = tex?.frame ?? tex?._frame ?? null;
    if (!src || !frame || !(frame.width > 0)) return null;
    const c = document.createElement('canvas');
    c.width = Math.round(frame.width as number);
    c.height = Math.round(frame.height as number);
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(src, Math.round(-(frame.x as number)), Math.round(-(frame.y as number)));
    return c;
  } catch {
    return null;
  }
}

function renderSpriteToCanvas(
  svc: SpriteService,
  category: SpriteCategory,
  id: string,
  mutations: string[] = [],
): HTMLCanvasElement | null {
  // Path 1: standard render — handle HTMLCanvasElement and PIXI v8 OffscreenCanvas
  try {
    const c: any = svc.renderToCanvas({ category, id, mutations });
    log(`renderSpriteToCanvas path1 ${category}/${id}: got`, c ? `${Object.prototype.toString.call(c)} ${c.width}x${c.height}` : 'null');
    if (c instanceof HTMLCanvasElement && c.width > 0) return c;
    if (c && (c as any).width > 0) {
      const converted = offscreenToCanvas(c);
      log(`renderSpriteToCanvas offscreen→canvas: ${converted ? `${converted.width}x${converted.height}` : 'null'}`);
      if (converted) return converted;
    }
  } catch (e) {
    log('renderSpriteToCanvas path1 threw:', e);
  }
  // Path 2: extract directly from atlas image source (no WebGL required)
  try {
    const tex: any = (svc as any).getBaseSprite?.({ category, id });
    log(`renderSpriteToCanvas path2 ${category}/${id}: baseTex=`, tex ? `frame ${JSON.stringify(tex?.frame ?? tex?._frame)}` : 'null');
    if (tex) {
      const c = texToAtlasCanvas(tex);
      log(`renderSpriteToCanvas path2 atlas canvas: ${c ? `${c.width}x${c.height}` : 'null'}`);
      if (c) return c;
    }
  } catch (e) {
    log('renderSpriteToCanvas path2 threw:', e);
  }
  log(`renderSpriteToCanvas FAILED for ${category}/${id}`);
  return null;
}

function applyTintToCanvas(
  source: HTMLCanvasElement,
  color: string,
  alpha: number,
  blend: string,
): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = source.width;
  out.height = source.height;
  const ctx = out.getContext('2d');
  if (!ctx) return source;
  ctx.drawImage(source, 0, 0);
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.globalCompositeOperation = blend as GlobalCompositeOperation;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  return out;
}

function getRuleTargetTexture(rule: TextureOverrideRule, svc: SpriteService): any | null {
  const item = svc.state.items.find(it => it.key === rule.targetSpriteKey);
  return svc.state.tex.get(rule.targetSpriteKey) ?? item?.first ?? null;
}

type TextureCanvasLayout = {
  canvasWidth: number;
  canvasHeight: number;
  contentX: number;
  contentY: number;
  contentWidth: number;
  contentHeight: number;
};

function getTextureCanvasLayout(tex: any): TextureCanvasLayout | null {
  if (!tex) return null;
  const canvasWidth = Math.round(
    Number(
      tex?.orig?.width
      ?? tex?._orig?.width
      ?? tex?.frame?.width
      ?? tex?._frame?.width
      ?? tex?.width
      ?? 0
    )
  );
  const canvasHeight = Math.round(
    Number(
      tex?.orig?.height
      ?? tex?._orig?.height
      ?? tex?.frame?.height
      ?? tex?._frame?.height
      ?? tex?.height
      ?? 0
    )
  );
  if (!Number.isFinite(canvasWidth) || !Number.isFinite(canvasHeight) || canvasWidth <= 0 || canvasHeight <= 0) {
    return null;
  }

  const trim = tex?.trim ?? tex?._trim ?? null;
  const trimWidth = Math.round(Number(trim?.width ?? 0));
  const trimHeight = Math.round(Number(trim?.height ?? 0));
  const hasTrim = Number.isFinite(trimWidth) && Number.isFinite(trimHeight) && trimWidth > 0 && trimHeight > 0;

  let contentX = hasTrim ? Math.round(Number(trim?.x ?? 0)) : 0;
  let contentY = hasTrim ? Math.round(Number(trim?.y ?? 0)) : 0;
  let contentWidth = hasTrim ? trimWidth : canvasWidth;
  let contentHeight = hasTrim ? trimHeight : canvasHeight;

  contentX = Math.max(0, Math.min(canvasWidth - 1, contentX));
  contentY = Math.max(0, Math.min(canvasHeight - 1, contentY));
  contentWidth = Math.max(1, Math.min(canvasWidth - contentX, contentWidth));
  contentHeight = Math.max(1, Math.min(canvasHeight - contentY, contentHeight));

  return {
    canvasWidth,
    canvasHeight,
    contentX,
    contentY,
    contentWidth,
    contentHeight,
  };
}

function resizeCanvasToLayout(source: HTMLCanvasElement, layout: TextureCanvasLayout): HTMLCanvasElement {
  const { canvasWidth, canvasHeight, contentX, contentY, contentWidth, contentHeight } = layout;
  const isIdentity = source.width === canvasWidth
    && source.height === canvasHeight
    && contentX === 0
    && contentY === 0
    && contentWidth === canvasWidth
    && contentHeight === canvasHeight;
  if (isIdentity) return source;
  const out = document.createElement('canvas');
  out.width = canvasWidth;
  out.height = canvasHeight;
  const ctx = out.getContext('2d');
  if (!ctx) return source;
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  ctx.imageSmoothingEnabled = false;
  // Preserve aspect ratio and align to the target texture layout.
  // Vertical bottom alignment keeps plant/pet baseline placement stable.
  const scale = Math.min(contentWidth / Math.max(1, source.width), contentHeight / Math.max(1, source.height));
  const drawWidth = Math.min(contentWidth, Math.max(1, Math.round(source.width * scale)));
  const drawHeight = Math.min(contentHeight, Math.max(1, Math.round(source.height * scale)));
  const offsetX = contentX + Math.floor((contentWidth - drawWidth) / 2);
  const offsetY = contentY + (contentHeight - drawHeight);
  ctx.drawImage(source, offsetX, offsetY, drawWidth, drawHeight);
  return out;
}

async function buildSourceCanvas(rule: TextureOverrideRule, svc: SpriteService): Promise<HTMLCanvasElement | null> {
  if (rule.source.type === 'library' && rule.source.librarySpriteKey) {
    const { category, id } = parseAtlasKey(rule.source.librarySpriteKey);
    const canvas = renderSpriteToCanvas(svc, category, id);
    if (canvas) return canvas;
  }

  if (rule.source.type === 'upload' && rule.source.uploadAssetId) {
    const dataUrl = swapperState.uploadedAssets[rule.source.uploadAssetId];
    if (dataUrl) {
      const canvas = await loadImageToCanvas(dataUrl);
      if (canvas) return canvas;
    }
  }

  // Fallback: render the target sprite itself (used for tint-only rules)
  const { category, id } = parseAtlasKey(rule.targetSpriteKey);
  return renderSpriteToCanvas(svc, category, id);
}

async function buildCustomCanvas(rule: TextureOverrideRule, svc: SpriteService): Promise<HTMLCanvasElement | null> {
  const src = await buildSourceCanvas(rule, svc);
  if (!src || src.width === 0) return null;

  let out = src;
  if (rule.params.tintColor) {
    out = applyTintToCanvas(
      src,
      rule.params.tintColor,
      rule.params.tintAlpha ?? 0.5,
      rule.params.tintBlend ?? 'multiply',
    );
  }

  // Keep replacement dimensions aligned with target sprite to avoid scale/size jumps.
  const targetTex = getRuleTargetTexture(rule, svc);
  const targetLayout = getTextureCanvasLayout(targetTex);
  if (targetLayout) {
    out = resizeCanvasToLayout(out, targetLayout);
  }
  return out;
}

async function buildCustomTexture(rule: TextureOverrideRule, svc: SpriteService): Promise<any | null> {
  const ctors = svc.state.ctors;
  if (!ctors) {
    log('buildCustomTexture: no ctors available');
    return null;
  }

  const canvas = await buildCustomCanvas(rule, svc);
  if (!canvas) {
    log('buildCustomTexture: buildCustomCanvas returned null for rule', rule.id, rule.targetSpriteKey);
    return null;
  }
  log(`buildCustomTexture: canvas ${canvas.width}x${canvas.height}, calling Texture.from`);

  try {
    const tex = ctors.Texture.from(canvas);
    log('buildCustomTexture: Texture.from result', tex ? 'ok' : 'null/falsy', tex);
    return tex;
  } catch (e) {
    log('buildCustomTexture: Texture.from threw:', e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Layer A — QPM UI texture override
// ---------------------------------------------------------------------------

async function applyLayerA(rule: TextureOverrideRule, svc: SpriteService): Promise<void> {
  log(`applyLayerA: starting rule ${rule.id} target=${rule.targetSpriteKey}`);
  const customTex = await buildCustomTexture(rule, svc);
  if (!customTex) {
    log(`applyLayerA: buildCustomTexture returned null — rule ${rule.id} not applied`);
    return;
  }

  // getSpriteWithMutations (QPM UI render path) uses item.first, not state.tex.
  // For animated sprites, item.key is a synthesized base key absent from state.tex — fall back to item.first.
  const origItem = svc.state.items.find(it => it.key === rule.targetSpriteKey);
  log(`applyLayerA: origItem found=${origItem !== undefined}, state.tex has key=${svc.state.tex.has(rule.targetSpriteKey)}, items total=${svc.state.items.length}`);
  const origTex = svc.state.tex.get(rule.targetSpriteKey) ?? origItem?.first ?? null;
  log(`applyLayerA: origTex=${origTex ? 'ok' : 'null'}, origTex.baseTexture=${origTex?.baseTexture ? 'ok' : 'null/undefined'}, origTex.frame=${JSON.stringify(origTex?.frame ?? origTex?._frame ?? null)}`);
  origTextures.set(rule.id, origTex);
  if (origItem !== undefined) origItemFirsts.set(rule.id, origItem.first);
  clearRuleVariantTexturesForRule(rule.id);
  const prevCustom = ruleTextures.get(rule.id);
  if (prevCustom && prevCustom !== customTex) {
    queueTextureForRetirement(prevCustom);
  }
  ruleTextures.set(rule.id, customTex);

  svc.state.tex.set(rule.targetSpriteKey, customTex);
  if (origItem !== undefined) origItem.first = customTex;
  invalidateSpriteKeyCache(rule.targetSpriteKey);
  log(`applyLayerA: done — origTex stored for Layer B matching`);
}

function revertLayerA(rule: TextureOverrideRule, svc: SpriteService): void {
  clearRuleVariantTexturesForRule(rule.id);
  if (origTextures.has(rule.id)) {
    const origTex = origTextures.get(rule.id);
    if (origTex !== null && origTex !== undefined) {
      svc.state.tex.set(rule.targetSpriteKey, origTex);
    } else {
      svc.state.tex.delete(rule.targetSpriteKey);
    }
    invalidateSpriteKeyCache(rule.targetSpriteKey);
    origTextures.delete(rule.id);
  }

  // Restore item.first so QPM UI rendering reverts
  const origItem = svc.state.items.find(it => it.key === rule.targetSpriteKey);
  if (origItem !== undefined && origItemFirsts.has(rule.id)) {
    origItem.first = origItemFirsts.get(rule.id);
    origItemFirsts.delete(rule.id);
  }

  const customTex = ruleTextures.get(rule.id);
  if (customTex) {
    queueTextureForRetirement(customTex);
    ruleTextures.delete(rule.id);
  }
}

function flushPendingTextureDestroy(): void {
  if (retiredTextures.size === 0) return;
  const queued = [...retiredTextures];
  retiredTextures.clear();
  for (const tex of queued) {
    try { tex.destroy(true); } catch {}
  }
}

function clearLayerBRefreshTimers(): void {
  for (const id of layerBRefreshTimers) {
    clearTimeout(id);
  }
  layerBRefreshTimers.clear();
}

function scheduleLayerBRefreshBurst(forceFirst = false): void {
  const runId = ++layerBRefreshRunId;
  clearLayerBRefreshTimers();

  for (const delay of LAYER_B_REFRESH_DELAYS_MS) {
    const run = () => {
      if (runId !== layerBRefreshRunId) return;
      try {
        maybeApplyLayerB(activeRules, forceFirst && delay === 0);
      } catch (e) {
        log('scheduleLayerBRefreshBurst tick failed', e);
      }
    };

    if (delay === 0) {
      run();
      continue;
    }

    const timerId = setTimeout(() => {
      layerBRefreshTimers.delete(timerId as unknown as number);
      run();
    }, delay) as unknown as number;
    layerBRefreshTimers.add(timerId);
  }
}

function refreshLayerBNow(): void {
  try {
    scheduleLayerBRefreshBurst(true);
  } catch (e) {
    log('refreshLayerBNow failed', e);
  }
}

async function applyAllLayerA(rules: TextureOverrideRule[]): Promise<void> {
  const svc = currentSvc;
  if (!svc) return;
  for (const rule of rules) {
    if (!ruleTextures.has(rule.id)) {
      await applyLayerA(rule, svc);
    }
  }
}

// ---------------------------------------------------------------------------
// Layer B — live PIXI stage texture override
// ---------------------------------------------------------------------------

function getPixiApp(): any {
  try {
    const captured = (pageWindow as Record<string, unknown>).__QPM_PIXI_CAPTURED__ as
      { app?: unknown } | undefined;
    return (captured?.app) ?? null;
  } catch {
    return null;
  }
}

function isPixiSprite(node: any): boolean {
  if (!node || typeof node !== 'object') return false;
  const tex = node.texture;
  if (!tex || typeof tex !== 'object') return false;
  // PIXI v7: .baseTexture; PIXI v8: .source
  return (typeof tex.baseTexture === 'object' && tex.baseTexture !== null)
      || (typeof tex.source === 'object' && tex.source !== null);
}

const SPRITE_KEY_EXT_RE = /\.(png|webp|avif|jpg|jpeg|ktx2)$/i;
const KNOWN_SPRITE_PREFIXES = new Set([
  'plant',
  'tallplant',
  'crop',
  'decor',
  'item',
  'pet',
  'seed',
  'mutation',
  'mutation-overlay',
  'ui',
  'object',
  'animation',
  'winter',
]);

function safeNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function normalizeSpriteKeyCandidate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let key = String(raw).trim();
  if (!key) return null;
  key = key.replace(/\\/g, '/').replace(/[?#].*$/, '').replace(/^\/+/, '');
  if (!key) return null;

  const variantPos = key.indexOf('|');
  if (variantPos > 0) {
    key = key.slice(0, variantPos);
  }

  const spritePos = key.toLowerCase().lastIndexOf('sprite/');
  if (spritePos >= 0) {
    key = key.slice(spritePos);
  }
  key = key.replace(SPRITE_KEY_EXT_RE, '');
  if (!key) return null;

  if (key.startsWith('sprite/')) return key;
  const first = key.split('/')[0]?.toLowerCase() ?? '';
  if (!KNOWN_SPRITE_PREFIXES.has(first)) return null;
  return `sprite/${key}`;
}

function isMutationSpriteKey(key: string): boolean {
  const normalized = normalizeSpriteKeyCandidate(key);
  if (!normalized) return false;
  const lower = normalized.toLowerCase();
  return lower.startsWith('sprite/mutation/') || lower.startsWith('sprite/mutation-overlay/');
}

function isPlantBaseSpriteKey(key: string): boolean {
  const normalized = normalizeSpriteKeyCandidate(key);
  if (!normalized) return false;
  const lower = normalized.toLowerCase();
  return lower.startsWith('sprite/plant/') || lower.startsWith('sprite/crop/') || lower.startsWith('sprite/tallplant/');
}

type SpriteVariantInfo = {
  baseKey: string;
  sig: string;
  mutations: string[];
};

type PlantSpriteContext = {
  speciesKey: string;
  mutations: string[];
};

const KNOWN_MUTATION_CANONICAL = [
  'Rainbow',
  'Gold',
  'Wet',
  'Chilled',
  'Frozen',
  'Dawnlit',
  'Ambershine',
  'Dawncharged',
  'Ambercharged',
  'Thunderstruck',
];

const KNOWN_MUTATION_ALIASES: Record<string, string> = {
  rainbow: 'Rainbow',
  gold: 'Gold',
  wet: 'Wet',
  chilled: 'Chilled',
  frozen: 'Frozen',
  dawnlit: 'Dawnlit',
  ambershine: 'Ambershine',
  dawncharged: 'Dawncharged',
  ambercharged: 'Ambercharged',
  thunderstruck: 'Thunderstruck',
  amberlit: 'Ambershine',
  dawnbound: 'Dawncharged',
  amberbound: 'Ambercharged',
};

function parseMutationsFromVariantSig(sig: string): string[] {
  const trimmed = sig.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('M:')) {
    const selected = trimmed.slice(2).split('|')[0] ?? '';
    return selected.split(',').map((value) => value.trim()).filter(Boolean);
  }
  if (trimmed.startsWith('F:')) {
    const filter = trimmed.slice(2).trim();
    return filter ? [filter] : [];
  }
  return [];
}

function parseVariantInfoFromLabel(raw: unknown): SpriteVariantInfo | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  const split = value.indexOf('|');
  if (split <= 0) return null;
  const baseKey = normalizeSpriteKeyCandidate(value.slice(0, split));
  if (!baseKey) return null;
  const sig = value.slice(split + 1).trim();
  return {
    baseKey,
    sig,
    mutations: parseMutationsFromVariantSig(sig),
  };
}

function getTextureFrame(tex: any): any {
  return tex?.frame ?? tex?._frame ?? null;
}

function getTextureOrig(tex: any): any {
  return tex?.orig ?? tex?._orig ?? null;
}

function getTextureSourceToken(tex: any): string {
  const source = tex?.source ?? tex?.baseTexture ?? tex?._source ?? tex?._baseTexture ?? null;
  const raw = source?.label
    ?? source?.resource?.url
    ?? source?.resource?.src
    ?? source?.resource?.source?.currentSrc
    ?? source?.resource?.source?.src
    ?? '';
  if (typeof raw !== 'string' || raw.trim() === '') return '?';
  const cleaned = raw
    .replace(/\\/g, '/')
    .replace(/[?#].*$/, '')
    .split('/')
    .pop() ?? raw;
  const token = cleaned.replace(SPRITE_KEY_EXT_RE, '').toLowerCase();
  return token || '?';
}

function makeFrameSignature(tex: any): string | null {
  if (!tex) return null;
  const frame = getTextureFrame(tex);
  if (!frame) return null;
  const orig = getTextureOrig(tex) ?? {};
  const source = tex?.source ?? tex?.baseTexture ?? tex?._source ?? tex?._baseTexture ?? null;
  const sourceW = safeNum(source?.pixelWidth ?? source?.width ?? source?.resource?.source?.width);
  const sourceH = safeNum(source?.pixelHeight ?? source?.height ?? source?.resource?.source?.height);
  return [
    getTextureSourceToken(tex),
    `${safeNum(frame.x)}:${safeNum(frame.y)}:${safeNum(frame.width)}:${safeNum(frame.height)}`,
    `${safeNum(orig.width ?? frame.width)}:${safeNum(orig.height ?? frame.height)}`,
    `${sourceW}:${sourceH}`,
  ].join('|');
}

function extractTextureSpriteKeys(tex: any): string[] {
  if (!tex) return [];
  const out = new Set<string>();

  const add = (candidate: unknown) => {
    const normalized = normalizeSpriteKeyCandidate(candidate);
    if (normalized) out.add(normalized.toLowerCase());
  };

  add(tex?.label);
  add(tex?._label);
  add(tex?.textureCacheIds?.[0]);
  add(tex?.source?.label);
  add(tex?.source?.resource?.url);
  add(tex?.source?.resource?.src);

  return [...out];
}

function extractTextureHintStrings(tex: any): string[] {
  if (!tex) return [];
  const out = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (!trimmed) return;
    out.add(trimmed);
  };
  add(tex?.label);
  add(tex?._label);
  add(tex?.textureCacheIds?.[0]);
  add(tex?.source?.label);
  add(tex?.source?.resource?.url);
  add(tex?.source?.resource?.src);
  add(tex?.baseTexture?.resource?.url);
  add(tex?.baseTexture?.resource?.src);
  return [...out];
}

function extractSpriteNodeSpriteKeys(sprite: any): string[] {
  const out = new Set<string>();
  const add = (candidate: unknown) => {
    const normalized = normalizeSpriteKeyCandidate(candidate);
    if (normalized) out.add(normalized.toLowerCase());
  };
  add(sprite?.label);
  add(sprite?._label);
  add(sprite?.name);
  add(sprite?.parent?.label);
  add(sprite?.parent?._label);
  add(sprite?.parent?.name);
  return [...out];
}

function extractSpriteHintStrings(sprite: any, maxDepth = 8): string[] {
  const out = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (!trimmed) return;
    out.add(trimmed);
  };

  let cur: any = sprite;
  let depth = 0;
  while (cur && depth <= maxDepth) {
    add(cur?.label);
    add(cur?._label);
    add(cur?.name);
    add(cur?.type);
    cur = cur.parent;
    depth++;
  }
  return [...out];
}

function extractVariantInfoFromSpriteNode(sprite: any): SpriteVariantInfo | null {
  const candidates = [
    sprite?.label,
    sprite?._label,
    sprite?.name,
    sprite?.parent?.label,
    sprite?.parent?._label,
    sprite?.parent?.name,
  ];
  for (const raw of candidates) {
    const parsed = parseVariantInfoFromLabel(raw);
    if (parsed) return parsed;
  }
  return null;
}

function normalizeHintForSearch(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\\/g, '/')
    .replace(/[?#].*$/, '')
    .replace(SPRITE_KEY_EXT_RE, '');
}

function hintContainsTargetId(hint: string, targetId: string): boolean {
  if (!targetId) return false;
  const normHint = normalizeHintForSearch(hint);
  const needle = targetId.toLowerCase();
  if (!normHint.includes(needle)) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, 'i');
  return re.test(normHint);
}

function hintLooksLikeMutationAsset(raw: string): boolean {
  const hint = normalizeHintForSearch(raw);
  if (!hint) return false;
  return hint.includes('/mutation/')
    || hint.includes('mutation-overlay')
    || hint.includes('mutation-icon')
    || hint.includes('sprite/mutation');
}

function spriteLooksLikeMutationAsset(spriteKeys: Set<string>, hints: string[]): boolean {
  for (const key of spriteKeys) {
    if (key.startsWith('sprite/mutation/') || key.startsWith('sprite/mutation-overlay/')) {
      return true;
    }
  }
  for (const hint of hints) {
    if (hintLooksLikeMutationAsset(hint)) return true;
  }
  return false;
}

function spriteHasCropVisualContext(hints: string[]): boolean {
  for (const raw of hints) {
    const hint = normalizeHintForSearch(raw);
    if (!hint) continue;
    if (hint.includes('cropvisual')) return true;
    if (/\bslot-\d+\b/.test(hint)) return true;
  }
  return false;
}

function allowPlantRuleFallback(entry: { rule: TextureOverrideRule }, hints: string[]): boolean {
  if (!isPlantBaseSpriteKey(entry.rule.targetSpriteKey)) return true;
  return spriteHasCropVisualContext(hints);
}

function ruleCanApplyToSprite(entry: { rule: TextureOverrideRule }, spriteKeys: Set<string>, hints: string[]): boolean {
  const mutationSprite = spriteLooksLikeMutationAsset(spriteKeys, hints);
  const isMutationRule = isMutationSpriteKey(entry.rule.targetSpriteKey);
  const isPlantBaseRule = isPlantBaseSpriteKey(entry.rule.targetSpriteKey);

  if (isPlantBaseRule && mutationSprite) return false;
  if (isMutationRule && !mutationSprite) return false;
  return true;
}

function collectSpeciesNamesFromObject(obj: any, out: Set<string>): void {
  if (!obj || typeof obj !== 'object') return;
  const add = (value: unknown) => {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (!trimmed) return;
    out.add(trimmed.toLowerCase());
  };

  add(obj.species);
  add(obj.speciesId);
  add(obj.speciesName);
  add(obj.petSpecies);
  add(obj.cropSpecies);
  add(obj.floraSpecies);

  const nested = [
    obj.tileObject,
    obj.data,
    obj.model,
    obj.state,
    obj.props,
    obj.entity,
  ];
  for (const child of nested) {
    if (!child || typeof child !== 'object') continue;
    add((child as any).species);
    add((child as any).speciesId);
    add((child as any).speciesName);
  }
}

function loadDebugSetting(): boolean {
  try {
    return storage.get<boolean>(DEBUG_STORAGE_KEY, false) ?? false;
  } catch {
    return false;
  }
}

function saveDebugSetting(enabled: boolean): void {
  try {
    storage.set(DEBUG_STORAGE_KEY, enabled);
  } catch (e) {
    log('Failed to save debug setting', e);
  }
}

function extractAncestorSpeciesHints(sprite: any, maxDepth = 7): string[] {
  const out = new Set<string>();
  let cur: any = sprite;
  let depth = 0;
  while (cur && depth <= maxDepth) {
    collectSpeciesNamesFromObject(cur, out);
    cur = cur.parent;
    depth++;
  }
  return [...out];
}

function normalizeSpeciesMatchKey(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().toLowerCase().replace(/[\s_\-]+/g, '');
}

function canonicalMutationName(raw: string): string | null {
  const key = normalizeSpeciesMatchKey(raw);
  if (!key) return null;
  return KNOWN_MUTATION_ALIASES[key] ?? null;
}

function parseMutationPrefixedSpecies(rawId: string): { speciesKey: string; mutations: string[] } | null {
  let rest = normalizeSpeciesMatchKey(rawId);
  if (!rest) return null;
  const mutations: string[] = [];
  const sortedPrefixes = [...new Set([...KNOWN_MUTATION_CANONICAL, ...Object.keys(KNOWN_MUTATION_ALIASES)])]
    .map((name) => normalizeSpeciesMatchKey(name))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  for (let i = 0; i < 4; i++) {
    let consumed = false;
    for (const prefix of sortedPrefixes) {
      if (!rest.startsWith(prefix) || rest.length <= prefix.length) continue;
      const canonical = canonicalMutationName(prefix);
      if (!canonical) continue;
      if (!mutations.includes(canonical)) mutations.push(canonical);
      rest = rest.slice(prefix.length);
      consumed = true;
      break;
    }
    if (!consumed) break;
  }

  if (mutations.length === 0 || !rest) return null;
  return { speciesKey: rest, mutations };
}

function extractMutationPrefixedPlantMatchFromKey(key: string): { speciesKey: string; mutations: string[] } | null {
  const normalized = normalizeSpriteKeyCandidate(key);
  if (!normalized) return null;
  const { category, id } = parseAtlasKey(normalized);
  if (!(category === 'plant' || category === 'crop' || category === 'tallplant')) return null;
  return parseMutationPrefixedSpecies(id);
}

function extractMutationNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean);
}

function parsePlantContextFromCandidate(obj: any): PlantSpriteContext | null {
  if (!obj || typeof obj !== 'object') return null;

  const directSpecies = normalizeSpeciesMatchKey(
    obj.species ?? obj.speciesId ?? obj.speciesName ?? obj.seedSpecies ?? obj.plantSpecies,
  );
  const directMutations = extractMutationNames(obj.mutations);
  const directObjectType = typeof obj.objectType === 'string' ? obj.objectType.toLowerCase() : '';
  const looksLikeSlot =
    Array.isArray(obj.mutations)
    || Number.isFinite(Number(obj.startTime))
    || Number.isFinite(Number(obj.endTime))
    || Number.isFinite(Number(obj.targetScale));
  if (directSpecies && (directMutations.length > 0 || directObjectType.includes('plant') || looksLikeSlot)) {
    return {
      speciesKey: directSpecies,
      mutations: directMutations,
    };
  }

  const slotsRaw = Array.isArray(obj.slots) ? obj.slots : [];
  const slotSpecies: string[] = [];
  const slotMutations: string[][] = [];
  for (const slot of slotsRaw) {
    if (!slot || typeof slot !== 'object') continue;
    const species = normalizeSpeciesMatchKey(
      (slot as any).species
      ?? (slot as any).speciesId
      ?? (slot as any).speciesName
      ?? (slot as any).seedSpecies
      ?? (slot as any).plantSpecies,
    );
    if (!species) continue;
    slotSpecies.push(species);
    slotMutations.push(extractMutationNames((slot as any).mutations));
  }

  const tileSpecies = directSpecies || slotSpecies[0] || '';
  if (!tileSpecies) return null;
  const mutations = slotMutations.find((list) => list.length > 0) ?? slotMutations[0] ?? [];
  return {
    speciesKey: tileSpecies,
    mutations,
  };
}

function extractPlantContextFromSprite(
  sprite: any,
  memo: WeakMap<object, PlantSpriteContext | null>,
  maxDepth = 18,
): PlantSpriteContext | null {
  if (!sprite || typeof sprite !== 'object') return null;
  const cached = memo.get(sprite as object);
  if (cached !== undefined) return cached;

  let cur: any = sprite;
  let depth = 0;
  let found: PlantSpriteContext | null = null;
  while (cur && depth <= maxDepth) {
    const candidates = [
      cur,
      cur.tileObject,
      cur.data,
      cur.model,
      cur.state,
      cur.props,
      cur.entity,
      cur.slot,
      cur.viewModel,
      cur.userData,
    ];
    for (const candidate of candidates) {
      const parsed = parsePlantContextFromCandidate(candidate);
      if (parsed) {
        found = parsed;
        break;
      }
    }
    if (found) break;
    cur = cur.parent;
    depth++;
  }

  memo.set(sprite as object, found);
  return found;
}

function extractVariantInfoFromTexture(tex: any): SpriteVariantInfo | null {
  if (!tex) return null;
  const candidates = [
    tex?.label,
    tex?._label,
    tex?.textureCacheIds?.[0],
    tex?.source?.label,
  ];
  for (const raw of candidates) {
    const parsed = parseVariantInfoFromLabel(raw);
    if (parsed) return parsed;
  }
  return null;
}

function isTextureRenderable(tex: any): boolean {
  if (!tex || tex?.destroyed) return false;
  const source = tex?.source ?? tex?.baseTexture ?? tex?._source ?? tex?._baseTexture ?? null;
  if (!source) return false;
  if (source.destroyed) return false;
  if (source.style === null) return false;
  return true;
}

function getFallbackTexture(): any | null {
  const fromSvc = currentSvc?.state?.ctors?.Texture?.EMPTY ?? null;
  if (isTextureRenderable(fromSvc)) return fromSvc;
  const fromPage = (pageWindow as any)?.PIXI?.Texture?.EMPTY ?? (pageWindow as any)?.__PIXI__?.Texture?.EMPTY ?? null;
  if (isTextureRenderable(fromPage)) return fromPage;
  return null;
}

function restoreSpriteSnapshot(sprite: any, snapshot: LayerBOriginalSnapshot | undefined): void {
  const restoreTexture = snapshot && isTextureRenderable(snapshot.texture) ? snapshot.texture : null;
  if (restoreTexture) {
    sprite.texture = restoreTexture;
  } else if (!isTextureRenderable(sprite?.texture)) {
    const fallback = getFallbackTexture();
    if (fallback) sprite.texture = fallback;
  }
  if (snapshot) {
    try { sprite.scale?.set(snapshot.scaleX, snapshot.scaleY); } catch {}
    sprite.alpha = snapshot.alpha;
  }
}

function queueTextureForRetirement(tex: any): void {
  if (!tex) return;
  retiredTextures.add(tex);
}

function clearRuleVariantTexturesForRule(ruleId: string): void {
  const prefix = `${ruleId}|`;
  for (const [key, tex] of ruleVariantTextures.entries()) {
    if (!key.startsWith(prefix)) continue;
    queueTextureForRetirement(tex);
    ruleVariantTextures.delete(key);
  }
}

function clearAllRuleVariantTextures(): void {
  for (const tex of ruleVariantTextures.values()) {
    queueTextureForRetirement(tex);
  }
  ruleVariantTextures.clear();
}

function bumpRuleRevision(): void {
  ruleRevision++;
  clearAllRuleVariantTextures();
}

function buildVariantTextureForStage(
  cacheKey: string,
  baseSpriteKey: string,
  mutations: string[],
  svc: SpriteService,
): any | null {
  const cached = ruleVariantTextures.get(cacheKey);
  if (cached && isTextureRenderable(cached)) return cached;
  if (cached) {
    queueTextureForRetirement(cached);
    ruleVariantTextures.delete(cacheKey);
  }

  const { category, id } = parseAtlasKey(baseSpriteKey);
  const canvas = renderSpriteToCanvas(svc, category, id, mutations);
  if (!canvas || canvas.width <= 0 || canvas.height <= 0) return null;
  try {
    const tex = svc.state.ctors?.Texture.from(canvas) ?? null;
    if (!tex) return null;
    ruleVariantTextures.set(cacheKey, tex);
    return tex;
  } catch {
    return null;
  }
}

function isMapLike(value: any): value is { entries: () => Iterable<[unknown, unknown]> } {
  return !!value && typeof value === 'object' && typeof value.entries === 'function';
}

function addRefKey(refMap: Map<object, Set<string>>, ref: any, keyCandidate: unknown): void {
  if (!ref || typeof ref !== 'object') return;
  const key = normalizeSpriteKeyCandidate(keyCandidate);
  if (!key) return;
  const normalized = key.toLowerCase();
  const prev = refMap.get(ref as object);
  if (prev) {
    prev.add(normalized);
    return;
  }
  refMap.set(ref as object, new Set([normalized]));
}

function scanTextureContainerForRefKeys(container: any, refMap: Map<object, Set<string>>): void {
  const addEntry = (rawKey: unknown, value: any) => {
    addRefKey(refMap, value, rawKey);
    addRefKey(refMap, value?.texture, rawKey);
    addRefKey(refMap, value?.tex, rawKey);
    addRefKey(refMap, value?.first, rawKey);
    addRefKey(refMap, value?.source, rawKey);
    addRefKey(refMap, value?.baseTexture, rawKey);
  };

  if (!container) return;
  if (isMapLike(container)) {
    try {
      for (const entry of container.entries()) {
        if (!Array.isArray(entry) || entry.length < 2) continue;
        addEntry(entry[0], entry[1]);
      }
    } catch {
      // Cross-realm/proxied caches may throw on iteration.
    }
    return;
  }
  if (typeof container === 'object') {
    try {
      for (const [k, v] of Object.entries(container)) {
        addEntry(k, v);
      }
    } catch {
      // Ignore hostile/proxy objects.
    }
  }
}

function buildRuntimeTextureRefKeyMap(): Map<object, Set<string>> {
  const refMap = new Map<object, Set<string>>();
  const root = pageWindow as any;
  const candidates = [
    root?.PIXI?.Cache?._cache,
    root?.__PIXI__?.Cache?._cache,
    root?.PIXI?.utils?.TextureCache,
    root?.__PIXI__?.utils?.TextureCache,
    root?.__PIXI_TEXTURE_CACHE__,
    root?.__PIXI_ASSET_CACHE__,
    root?.__QPM_PIXI_CAPTURED__?.app?.renderer?.textures,
    root?.__QPM_PIXI_CAPTURED__?.renderer?.textures,
  ];
  for (const candidate of candidates) {
    scanTextureContainerForRefKeys(candidate, refMap);
  }
  return refMap;
}

function walkSpriteTree(node: any, cb: (sprite: any) => void, depth = 0): void {
  if (!node || depth > MAX_WALK_DEPTH) return;
  if (isPixiSprite(node)) cb(node);
  const children = node.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      walkSpriteTree(child, cb, depth + 1);
    }
  }
}

function getObjectIdentity(value: any): number {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return 0;
  const obj = value as object;
  const existing = objectIdentity.get(obj);
  if (existing != null) return existing;
  const id = nextObjectIdentity++;
  objectIdentity.set(obj, id);
  return id;
}

function mixHash(seed: number, value: number): number {
  let h = (seed ^ value) >>> 0;
  h = Math.imul(h, 16777619) >>> 0;
  h ^= h >>> 13;
  return h >>> 0;
}

function buildStageSignature(stage: any): string {
  let spriteCount = 0;
  let spriteHash = 2166136261 >>> 0;
  let sourceHash = 2166136261 >>> 0;

  walkSpriteTree(stage, (sprite) => {
    spriteCount++;
    spriteHash = mixHash(spriteHash, getObjectIdentity(sprite));

    const tex = sprite?.texture ?? null;
    const source = tex?.source ?? tex?.baseTexture ?? tex?._source ?? tex?._baseTexture ?? null;
    // Keep signature stable across animated frame swaps.
    // Re-apply is still triggered when scene structure or source backing changes.
    sourceHash = mixHash(sourceHash, getObjectIdentity(source));
  });

  const childCount = Array.isArray(stage?.children) ? stage.children.length : 0;
  return [
    childCount,
    spriteCount,
    spriteHash.toString(16),
    sourceHash.toString(16),
  ].join('|');
}

function buildLayerBApplyToken(rules: TextureOverrideRule[], stage: any): string {
  const enabledRuleIds = rules.filter((r) => r.enabled).map((r) => r.id).sort().join(',');
  const stageSig = buildStageSignature(stage);
  return `${ruleRevision}|${enabledRuleIds}|${stageSig}`;
}

function maybeApplyLayerB(rules: TextureOverrideRule[], force = false): void {
  if (rules.length === 0) {
    if (layerBModified.length > 0) {
      revertAllLayerB();
    }
    lastLayerBApplyToken = `empty|${ruleRevision}`;
    return;
  }

  const app = getPixiApp();
  if (!app?.stage) {
    const noStageToken = `nostage|${ruleRevision}`;
    if (lastLayerBApplyToken !== noStageToken) {
      lastLayerBApplyToken = noStageToken;
      if (force) applyAllLayerB(rules);
    }
    return;
  }

  const beforeToken = buildLayerBApplyToken(rules, app.stage);
  if (!force && beforeToken && beforeToken === lastLayerBApplyToken) return;

  applyAllLayerB(rules);
  const afterToken = buildLayerBApplyToken(rules, app.stage);
  lastLayerBApplyToken = afterToken ?? beforeToken ?? `${ruleRevision}|unknown`;
}

function applyAllLayerB(rules: TextureOverrideRule[]): void {
  // Revert all previously modified sprites to restore clean state
  for (const sprite of layerBModified) {
    const orig = layerBOriginals.get(sprite);
    if (orig) {
      restoreSpriteSnapshot(sprite, orig);
      layerBOriginals.delete(sprite);
    }
  }
  layerBModified = [];

  if (rules.length === 0) return;

  // Key-based matching first, frame-signature fallback second.
  // QPM and game textures are often backed by different TextureSource objects.
  type RuleEntry = {
    origTex: any;
    origSig: string | null;
    targetKeys: Set<string>;
    targetIdLower: string;
    targetMatchKey: string;
    rule: TextureOverrideRule;
    customTex: any;
  };
  const ruleList: RuleEntry[] = [];
  for (const rule of rules) {
    const customTex = ruleTextures.get(rule.id);
    if (!customTex || !isTextureRenderable(customTex)) continue;
    const origTex = origTextures.get(rule.id);
    if (!origTex) continue;

    const targetKeys = new Set<string>();
    const target = normalizeSpriteKeyCandidate(rule.targetSpriteKey);
    if (target) targetKeys.add(target.toLowerCase());
    for (const key of extractTextureSpriteKeys(origTex)) {
      targetKeys.add(key);
    }

    ruleList.push({
      origTex,
      origSig: makeFrameSignature(origTex),
      targetKeys,
      targetIdLower: parseAtlasKey(rule.targetSpriteKey).id.toLowerCase(),
      targetMatchKey: normalizeSpeciesMatchKey(parseAtlasKey(rule.targetSpriteKey).id),
      rule,
      customTex,
    });
  }

  log(`applyAllLayerB: ${ruleList.length} active rules`);
  if (ruleList.length === 0) return;
  const hasMutationAssetRules = ruleList.some((entry) => isMutationSpriteKey(entry.rule.targetSpriteKey));

  const ruleBySpriteKey = new Map<string, RuleEntry>();
  const rulesByFrameSig = new Map<string, RuleEntry[]>();
  for (const entry of ruleList) {
    for (const key of entry.targetKeys) {
      if (!ruleBySpriteKey.has(key)) {
        ruleBySpriteKey.set(key, entry);
      }
    }
    if (entry.origSig) {
      const arr = rulesByFrameSig.get(entry.origSig) ?? [];
      arr.push(entry);
      rulesByFrameSig.set(entry.origSig, arr);
    }
  }
  const plantRulesBySpecies = new Map<string, RuleEntry>();
  for (const entry of ruleList) {
    if (!isPlantBaseSpriteKey(entry.rule.targetSpriteKey)) continue;
    if (!entry.targetMatchKey) continue;
    if (!plantRulesBySpecies.has(entry.targetMatchKey)) {
      plantRulesBySpecies.set(entry.targetMatchKey, entry);
    }
  }
  const runtimeRefKeys = buildRuntimeTextureRefKeyMap();

  const app = getPixiApp();
  if (!app?.stage) {
    log('applyAllLayerB: no PIXI app/stage found');
    return;
  }

  let spriteCount = 0;
  let matchCount = 0;
  let plantContextMatchCount = 0;
  let mutationPrefixMatchCount = 0;
  let hintIdMatchCount = 0;
  let skippedMutationOverlayForBaseRule = 0;
  let plantFallbackRejectedCount = 0;
  let firstSpriteTex: any = null;
  let firstSpriteKeys: string[] = [];
  let firstSpriteCacheKeys: string[] = [];
  let firstSpriteSig: string | null = null;
  let firstSpriteVariant: SpriteVariantInfo | null = null;
  let firstSpritePlantContext: PlantSpriteContext | null = null;
  let firstSpriteHints: string[] = [];
  let firstSpriteNodeKeys: string[] = [];
  const plantCtxMemo = new WeakMap<object, PlantSpriteContext | null>();
  const svc = currentSvc;

  walkSpriteTree(app.stage, (sprite) => {
    spriteCount++;
    if (!firstSpriteTex) {
      firstSpriteTex = sprite.texture;
      firstSpriteKeys = extractTextureSpriteKeys(sprite.texture);
      firstSpriteCacheKeys = [
        ...(runtimeRefKeys.get(sprite.texture as object) ?? []),
        ...(runtimeRefKeys.get((sprite.texture?.source ?? null) as object) ?? []),
      ];
      firstSpriteSig = makeFrameSignature(sprite.texture);
      firstSpriteVariant = extractVariantInfoFromTexture(sprite.texture) ?? extractVariantInfoFromSpriteNode(sprite);
      firstSpriteHints = [
        ...extractTextureHintStrings(sprite.texture),
        ...extractSpriteHintStrings(sprite),
      ];
      firstSpriteNodeKeys = extractSpriteNodeSpriteKeys(sprite);
      if (plantRulesBySpecies.size > 0) {
        firstSpritePlantContext = extractPlantContextFromSprite(sprite, plantCtxMemo);
      }
    }

    let matched: RuleEntry | null = null;
    let matchedViaPlantContext = false;
    let matchedViaMutationPrefix = false;
    let matchedViaHintId = false;
    const variant = extractVariantInfoFromTexture(sprite.texture) ?? extractVariantInfoFromSpriteNode(sprite);
    const plantContext = plantRulesBySpecies.size > 0 ? extractPlantContextFromSprite(sprite, plantCtxMemo) : null;
    let inferredMutations: string[] = [];
    const spriteHints = [
      ...extractTextureHintStrings(sprite.texture),
      ...extractSpriteHintStrings(sprite),
    ];
    const spriteKeys = new Set<string>(extractTextureSpriteKeys(sprite.texture));
    for (const key of extractSpriteNodeSpriteKeys(sprite)) {
      spriteKeys.add(key);
    }
    const byRef = runtimeRefKeys.get(sprite.texture as object);
    if (byRef) {
      for (const key of byRef) {
        spriteKeys.add(key);
      }
    }
    const bySourceRef = runtimeRefKeys.get((sprite.texture?.source ?? null) as object);
    if (bySourceRef) {
      for (const key of bySourceRef) {
        spriteKeys.add(key);
      }
    }

    for (const key of spriteKeys) {
      const byKey = ruleBySpriteKey.get(key);
      if (byKey && ruleCanApplyToSprite(byKey, spriteKeys, spriteHints)) {
        matched = byKey;
        break;
      }
      if (byKey && isPlantBaseSpriteKey(byKey.rule.targetSpriteKey)) {
        skippedMutationOverlayForBaseRule++;
      }
    }

    if (!matched) {
      const sig = makeFrameSignature(sprite.texture);
      if (sig) {
        const bySig = rulesByFrameSig.get(sig);
        if (bySig && bySig.length > 0) {
          const compatible = bySig.find((entry) => ruleCanApplyToSprite(entry, spriteKeys, spriteHints)) ?? null;
          matched = compatible;
        }
      }
    }

    if (!matched && variant?.baseKey) {
      const variantBaseKey = normalizeSpriteKeyCandidate(variant.baseKey)?.toLowerCase() ?? null;
      if (variantBaseKey) {
        const byVariantKey = ruleBySpriteKey.get(variantBaseKey) ?? null;
        if (byVariantKey && ruleCanApplyToSprite(byVariantKey, spriteKeys, spriteHints)) {
          matched = byVariantKey;
        }
      }
      if (!matched) {
        const { id: variantId } = parseAtlasKey(variant.baseKey);
        const normalizedVariantId = variantId.toLowerCase();
        if (normalizedVariantId) {
          matched = ruleList.find((entry) => {
            if (entry.targetIdLower !== normalizedVariantId) return false;
            return ruleCanApplyToSprite(entry, spriteKeys, spriteHints);
          }) ?? null;
        }
      }
    }

    if (!matched && plantContext?.speciesKey) {
      const byPlantCtx = plantRulesBySpecies.get(plantContext.speciesKey) ?? null;
      if (byPlantCtx && !allowPlantRuleFallback(byPlantCtx, spriteHints)) {
        plantFallbackRejectedCount++;
      } else if (byPlantCtx && ruleCanApplyToSprite(byPlantCtx, spriteKeys, spriteHints)) {
        matched = byPlantCtx;
        matchedViaPlantContext = true;
      }
    }

    if (!matched && plantRulesBySpecies.size > 0) {
      for (const key of spriteKeys) {
        const prefixed = extractMutationPrefixedPlantMatchFromKey(key);
        if (!prefixed) continue;
        const bySpecies = plantRulesBySpecies.get(prefixed.speciesKey);
        if (!bySpecies) continue;
        if (!allowPlantRuleFallback(bySpecies, spriteHints)) {
          plantFallbackRejectedCount++;
          continue;
        }
        if (!ruleCanApplyToSprite(bySpecies, spriteKeys, spriteHints)) continue;
        matched = bySpecies;
        matchedViaMutationPrefix = true;
        inferredMutations = prefixed.mutations;
        break;
      }
    }

    if (!matched) {
      if (spriteHints.length > 0) {
        outer: for (const entry of ruleList) {
          if (!allowPlantRuleFallback(entry, spriteHints)) {
            plantFallbackRejectedCount++;
            continue;
          }
          if (!ruleCanApplyToSprite(entry, spriteKeys, spriteHints)) continue;
          const targetKey = entry.rule.targetSpriteKey.toLowerCase();
          for (const hint of spriteHints) {
            const normalizedHint = normalizeHintForSearch(hint);
            if (normalizedHint.includes(targetKey)) {
              matched = entry;
              break outer;
            }
            if (hintContainsTargetId(hint, entry.targetIdLower)) {
              matched = entry;
              matchedViaHintId = true;
              break outer;
            }
          }
        }
      }
    }

    if (!matched) {
      const speciesHints = extractAncestorSpeciesHints(sprite);
      if (speciesHints.length > 0) {
        matched = ruleList.find((entry) => {
          if (!speciesHints.includes(entry.targetIdLower)) return false;
          if (!allowPlantRuleFallback(entry, spriteHints)) {
            plantFallbackRejectedCount++;
            return false;
          }
          return ruleCanApplyToSprite(entry, spriteKeys, spriteHints);
        }) ?? null;
      }
    }

    let nextTexture: any | null = null;
    let appliedRule: RuleEntry | null = null;

    if (matched) {
      matchCount++;
      if (matchedViaPlantContext) plantContextMatchCount++;
      if (matchedViaMutationPrefix) mutationPrefixMatchCount++;
      if (matchedViaHintId) hintIdMatchCount++;
      appliedRule = matched;
      const behavior = matched.rule.mutationBehavior ?? 'preserve';
      const preserveMutations = variant?.mutations.length
        ? variant.mutations
        : (plantContext?.mutations.length ? plantContext.mutations : inferredMutations);
      const preserveBaseKey = variant?.baseKey ?? matched.rule.targetSpriteKey;
      if (behavior === 'preserve' && svc && preserveMutations.length > 0) {
        const cacheKey = `${matched.rule.id}|${ruleRevision}|${preserveBaseKey}|PM:${preserveMutations.join(',')}`;
        nextTexture = buildVariantTextureForStage(cacheKey, preserveBaseKey, preserveMutations, svc)
          ?? matched.customTex;
      } else {
        nextTexture = matched.customTex;
      }
    } else if (hasMutationAssetRules && svc && variant && variant.mutations.length > 0) {
      const cacheKey = `mutation-only|${ruleRevision}|${variant.baseKey}|${variant.sig}`;
      nextTexture = buildVariantTextureForStage(cacheKey, variant.baseKey, variant.mutations, svc);
    }

    if (!nextTexture || !isTextureRenderable(nextTexture)) return;

    if (!layerBOriginals.has(sprite)) {
      layerBOriginals.set(sprite, {
        texture: sprite.texture,
        scaleX: sprite.scale?.x ?? 1,
        scaleY: sprite.scale?.y ?? 1,
        alpha: sprite.alpha ?? 1,
        frameSig: makeFrameSignature(sprite.texture),
        keyHints: [...spriteKeys],
      });
    }
    layerBModified.push(sprite);
    sprite.texture = nextTexture;
    if (appliedRule?.rule.params.scaleX != null) {
      try {
        sprite.scale?.set(appliedRule.rule.params.scaleX, appliedRule.rule.params.scaleY ?? appliedRule.rule.params.scaleX);
      } catch {}
    }
    if (appliedRule?.rule.params.alpha != null) sprite.alpha = appliedRule.rule.params.alpha;
  });

  log(
    `applyAllLayerB: walked ${spriteCount} sprites, matched ${matchCount}, plantContextMatches ${plantContextMatchCount}, mutationPrefixMatches ${mutationPrefixMatchCount}, hintIdMatches ${hintIdMatchCount}, skippedMutationOverlayForBaseRule ${skippedMutationOverlayForBaseRule}, plantFallbackRejected ${plantFallbackRejectedCount}`,
  );
  if (spriteCount > 0 && matchCount === 0 && ruleList.length > 0) {
    const firstEntry = ruleList[0]!;
    log('applyAllLayerB: NO MATCH - origTex structure:', {
      ref: firstEntry.origTex,
      baseTexture: firstEntry.origTex?.baseTexture,
      source: firstEntry.origTex?.source,
      frame: firstEntry.origTex?.frame ?? firstEntry.origTex?._frame,
      keys: [...firstEntry.targetKeys],
      frameSig: firstEntry.origSig,
    });
    log('applyAllLayerB: NO MATCH - first stage sprite texture structure:', {
      ref: firstSpriteTex,
      baseTexture: firstSpriteTex?.baseTexture,
      source: firstSpriteTex?.source,
      frame: firstSpriteTex?.frame ?? firstSpriteTex?._frame,
      keys: firstSpriteKeys,
      nodeKeys: firstSpriteNodeKeys,
      cacheKeys: firstSpriteCacheKeys,
      frameSig: firstSpriteSig,
      variant: firstSpriteVariant,
      plantContext: firstSpritePlantContext,
      hints: firstSpriteHints,
    });
  }
}

function revertAllLayerB(): void {
  for (const sprite of layerBModified) {
    const orig = layerBOriginals.get(sprite);
    if (orig) {
      restoreSpriteSnapshot(sprite, orig);
      layerBOriginals.delete(sprite);
    }
  }
  layerBModified = [];
  layerBOriginals = new WeakMap();
  lastLayerBApplyToken = null;
}

function revertAll(): void {
  if (currentSvc) {
    for (const rule of [...activeRules]) {
      revertLayerA(rule, currentSvc);
    }
  }
  revertAllLayerB();
  clearAllRuleVariantTextures();
}

// ---------------------------------------------------------------------------
// Public API — state access
// ---------------------------------------------------------------------------

export function getTextureSwapperState(): TextureManipulatorState {
  return swapperState;
}

export function getSvc(): SpriteService | null {
  return currentSvc;
}

export function isTextureSwapperDebugEnabled(): boolean {
  return textureSwapperDebugEnabled;
}

export function setTextureSwapperDebugEnabled(enabled: boolean): void {
  textureSwapperDebugEnabled = enabled;
  log.enabled = enabled;
  saveDebugSetting(enabled);
  dispatchCustomEventAll('qpm:texture-manipulator-updated', {
    revision: Date.now(),
    debugLogs: enabled,
  });
}

// ---------------------------------------------------------------------------
// Public API — rule CRUD
// ---------------------------------------------------------------------------

function generateId(): string {
  return `rule_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeRule(rule: TextureOverrideRule): TextureOverrideRule {
  return {
    ...rule,
    mutationBehavior: rule.mutationBehavior ?? 'preserve',
  };
}

export function addRule(rule: Omit<TextureOverrideRule, 'id'>): TextureOverrideRule {
  const newRule = normalizeRule({ ...rule, id: generateId() });
  swapperState = { ...swapperState, rules: [...swapperState.rules, newRule] };
  saveState();
  bumpRuleRevision();

  activeRules = swapperState.rules.filter(r => r.enabled);
  if (newRule.enabled && currentSvc) {
    void (async () => {
      try {
        await applyLayerA(newRule, currentSvc);
      } finally {
        refreshLayerBNow();
      }
    })();
  } else {
    refreshLayerBNow();
  }
  dispatchCustomEventAll('qpm:texture-manipulator-updated', { revision: Date.now() });
  return newRule;
}

export function updateRule(updated: TextureOverrideRule): void {
  const idx = swapperState.rules.findIndex(r => r.id === updated.id);
  if (idx === -1) return;
  const normalized = normalizeRule(updated);
  const old = swapperState.rules[idx]!;

  // Revert old rule from Layer A
  if (currentSvc) revertLayerA(old, currentSvc);

  const newRules = swapperState.rules.map((r, i) => i === idx ? normalized : r);
  swapperState = { ...swapperState, rules: newRules };
  saveState();
  bumpRuleRevision();

  activeRules = swapperState.rules.filter(r => r.enabled);
  if (normalized.enabled && currentSvc) {
    void (async () => {
      try {
        await applyLayerA(normalized, currentSvc);
      } finally {
        refreshLayerBNow();
      }
    })();
  } else {
    refreshLayerBNow();
  }
  dispatchCustomEventAll('qpm:texture-manipulator-updated', { revision: Date.now() });
}

export function deleteRule(id: string): void {
  const rule = swapperState.rules.find(r => r.id === id);
  if (!rule) return;
  if (currentSvc) revertLayerA(rule, currentSvc);

  swapperState = { ...swapperState, rules: swapperState.rules.filter(r => r.id !== id) };
  saveState();
  bumpRuleRevision();

  activeRules = swapperState.rules.filter(r => r.enabled);
  refreshLayerBNow();
  dispatchCustomEventAll('qpm:texture-manipulator-updated', { revision: Date.now() });
}

// ---------------------------------------------------------------------------
// Public API — upload management
// ---------------------------------------------------------------------------

async function loadFileAsImage(file: File): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

async function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string ?? '');
    reader.onerror = () => reject(new Error('FileReader failed'));
    reader.readAsDataURL(file);
  });
}

export async function addUploadedAsset(file: File): Promise<string | null> {
  if (!UPLOADS_ENABLED) return null;

  if (!file.type.startsWith('image/')) {
    notify({ feature: 'textureSwapper', level: 'error', message: 'Upload must be an image file' });
    return null;
  }

  let dataUrl: string;

  if (file.size > MAX_UPLOAD_BYTES) {
    const img = await loadFileAsImage(file);
    if (!img) {
      notify({ feature: 'textureSwapper', level: 'error', message: 'Failed to load image for compression' });
      return null;
    }
    const longest = Math.max(img.naturalWidth || 1, img.naturalHeight || 1);
    const scale = Math.min(1, COMPRESS_SIZE / longest);
    const targetW = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
    const targetH = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, targetW, targetH);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, targetW, targetH);
    // Keep alpha; JPEG flattens transparency to black.
    const webp = canvas.toDataURL('image/webp', 0.9);
    dataUrl = webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png');
  } else {
    dataUrl = await readFileAsDataUrl(file);
  }

  const assetId = `upload_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const assets = { ...swapperState.uploadedAssets, [assetId]: dataUrl };
  const stateWithAsset = { ...swapperState, uploadedAssets: assets };
  swapperState = stateWithAsset;
  saveState();

  // Read-back verification
  const readBack = storage.get<TextureManipulatorState | null>(STORAGE_KEY, null);
  if (!readBack?.uploadedAssets?.[assetId]) {
    notify({ feature: 'textureSwapper', level: 'error', message: 'Upload failed to save (storage quota exceeded?)' });
    const { [assetId]: _removed, ...rest } = swapperState.uploadedAssets;
    swapperState = { ...swapperState, uploadedAssets: rest };
    return null;
  }

  return assetId;
}

export function deleteUploadedAsset(assetId: string): void {
  const { [assetId]: _removed, ...rest } = swapperState.uploadedAssets;
  swapperState = { ...swapperState, uploadedAssets: rest };
  saveState();
}

// ---------------------------------------------------------------------------
// Public API — preview (for UI window, returns canvas without modifying state)
// ---------------------------------------------------------------------------

export async function buildPreviewCanvas(
  rule: Partial<TextureOverrideRule>,
): Promise<HTMLCanvasElement | null> {
  const svc = currentSvc;
  if (!svc) return null;

  // Minimal rule for building a canvas — source defaults to target (tint-only preview)
  const target = rule.targetSpriteKey;
  if (!target) return null;

  const tempRule: TextureOverrideRule = {
    id: '__preview__',
    enabled: false,
    targetSpriteKey: target,
    targetCategory: rule.targetCategory ?? 'any',
    displayLabel: rule.displayLabel ?? '',
    source: rule.source ?? { type: 'library' },
    params: rule.params ?? {},
  };

  return buildCustomCanvas(tempRule, svc);
}

export async function getOriginalSpriteCanvas(spriteKey: string): Promise<HTMLCanvasElement | null> {
  const svc = currentSvc;
  if (!svc) return null;
  const { category, id } = parseAtlasKey(spriteKey);
  return renderSpriteToCanvas(svc, category, id);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export function initTextureSwapper(): () => void {
  if (!TEXTURE_MANIPULATOR_ENABLED) return () => {};
  if (started) return () => {};
  started = true;

  swapperState = loadState();
  textureSwapperDebugEnabled = loadDebugSetting();
  log.enabled = textureSwapperDebugEnabled;
  activeRules = swapperState.rules.filter(r => r.enabled);
  clearAllRuleVariantTextures();

  const unsub = onSpritesReady(() => {
    void (async () => {
      const svc = await serviceReady;
      if (!svc) return;
      currentSvc = svc;

      await applyAllLayerA(activeRules);
      refreshLayerBNow();

      // Listen for WebGL context restore
      try {
        const captured = (pageWindow as Record<string, unknown>).__QPM_PIXI_CAPTURED__ as
          { app?: { view?: unknown; canvas?: unknown } } | undefined;
        const canvas = (captured?.app?.view ?? captured?.app?.canvas) as HTMLCanvasElement | null | undefined;
        if (canvas instanceof HTMLCanvasElement) {
          const onRestore = () => {
            // Stage sprites are gone — fresh start for Layer B
            layerBOriginals = new WeakMap();
            layerBModified = [];
            lastLayerBApplyToken = null;
            clearAllRuleVariantTextures();
            // Re-apply Layer A (tex map may have been repopulated)
            void (async () => {
              await applyAllLayerA(activeRules);
              refreshLayerBNow();
            })();
          };
          canvas.addEventListener('webglcontextrestored', onRestore);
          cleanups.push(() => canvas.removeEventListener('webglcontextrestored', onRestore));
        }
      } catch {}
    })();
  });
  cleanups.push(unsub);

  return () => {
    started = false;
    layerBRefreshRunId++;
    clearLayerBRefreshTimers();
    revertAll();
    flushPendingTextureDestroy();
    for (const fn of cleanups) fn();
    cleanups.length = 0;
    currentSvc = null;
    activeRules = [];
    ruleRevision = 0;
    lastLayerBApplyToken = null;
  };
}

















