import { storage } from '../../../utils/storage';
import { notify } from '../../../core/notifications';
import { dispatchCustomEventAll } from '../../../core/pageContext';
import { pageWindow } from '../../../core/pageContext';
import { serviceReady, onSpritesReady } from '../../../sprite-v2/compat';
import { invalidateByFamilyRoot as invalidateThumbCache } from '../../../ui/standalone/textureSwapperWindow/thumbnailCache';
import { invalidateSpecies as invalidateStitcherCache } from '../../../sprite-v2/stitcher';

import {
  log,
  diag,
  warnFeature,
  ensureBusRegistered,
  publishOk,
  ctx,
  parseAtlasKey,
  scopeKey,
  STORAGE_KEY,
  DEBUG_STORAGE_KEY,
  TEXTURE_MANIPULATOR_ENABLED,
  UPLOADS_ENABLED,
  MAX_UPLOAD_BYTES,
  COMPRESS_SIZE,
} from './types';

export { diag, warnFeature } from './types';
import type {
  TextureOverrideRule,
  TextureManipulatorState,
  RuleScope,
} from './types';
import { renderSpriteToCanvas as renderSpriteToCanvasInternal, buildCustomCanvas } from './canvas';
export { renderSpriteToCanvas } from './canvas';
import {
  applyLayerA,
  revertLayerA,
  applyAllLayerA,
  refreshLayerBNow,
  clearLayerBRefreshTimers,
  cancelPendingRefresh,
  initStageChildAddedHook,
  revertAll,
  flushPendingTextureDestroy,
  clearAllRuleVariantTextures,
  bumpRuleRevision,
  getStoredOriginalForKey,
  disposeRuleOverlayFilter,
} from './apply';
import { installRiveAdapter } from './riveAdapter';
import { uninstallScaleAsserter } from './layerB-overlay';
import { ruleIndex } from './ruleIndex';
import { stripRenderState } from './matcher/state';
import { initTileObjectHook, initPetSwapHook } from './tileObjectHook';
import { initAssetFamily, clearAssetFamily } from './assetFamily';

// Re-exports for consumers
export {
  TEXTURE_MANIPULATOR_ENABLED,
  UPLOADS_ENABLED,
  parseAtlasKey,
  scopeKey,
} from './types';
export type {
  TextureOverrideRule,
  TextureManipulatorState,
} from './types';

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
          forceNoMutations: rule.forceNoMutations ?? false,
          scope: rule.scope ?? { kind: 'all' as const },
        }))
        : [];
      return { ...saved, rules: normalizedRules };
    }
  } catch (e) {
    warnFeature('QPM-TEXTURESWAP-002', { what: 'state:load' }, e);
  }
  return { version: 1, rules: [], uploadedAssets: {} };
}

function saveState(): void {
  try {
    storage.set(STORAGE_KEY, ctx.state);
  } catch (e) {
    warnFeature('QPM-TEXTURESWAP-002', { what: 'state:save' }, e);
    notify({ feature: 'gardenPainter', level: 'error', message: 'Texture rules failed to save' });
  }
}

// ---------------------------------------------------------------------------
// Debug settings
// ---------------------------------------------------------------------------

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
    warnFeature('QPM-TEXTURESWAP-002', { what: 'debug:save' }, e);
  }
}

// ---------------------------------------------------------------------------
// Public API — state access
// ---------------------------------------------------------------------------

export function getTextureSwapperState(): TextureManipulatorState {
  return ctx.state;
}

export function getSvc() {
  return ctx.currentSvc;
}

export function isTextureSwapperDebugEnabled(): boolean {
  return ctx.debugEnabled;
}

export function setTextureSwapperDebugEnabled(enabled: boolean): void {
  ctx.debugEnabled = enabled;
  log.enabled = enabled;
  saveDebugSetting(enabled);
  dispatchCustomEventAll('qpm:texture-manipulator-updated', {
    revision: Date.now(),
    debugLogs: enabled,
  });
}

// ---------------------------------------------------------------------------
// Public API — rule lookup (Spec 2)
// ---------------------------------------------------------------------------

/**
 * Find a rule matching the given (targetSpriteKey, scope). Scope defaults to
 * { kind: 'all' } when omitted. Returns null when no rule matches.
 *
 * Used by the editor to load existing rules per scope (Task 16) and by the
 * Pick-a-tile entry-points to detect "edit existing" vs "create new on first
 * param change" (Spec-1 lazy-create pattern preserved).
 */
export function findRule(args: { targetSpriteKey: string; scope?: RuleScope }): TextureOverrideRule | null {
  const wantedScopeKey = scopeKey(args.scope);
  for (const rule of ctx.state.rules) {
    if (rule.targetSpriteKey !== args.targetSpriteKey) continue;
    if (scopeKey(rule.scope) !== wantedScopeKey) continue;
    return rule;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public API — rule-change subscription (Spec 2)
// ---------------------------------------------------------------------------

type RuleChangeReason = 'add' | 'update' | 'delete';
type RuleChangeListener = (event: { rule: TextureOverrideRule; reason: RuleChangeReason }) => void;

const ruleChangeListeners: Set<RuleChangeListener> = new Set();

/**
 * Subscribe to rule add/update/delete events. Used by:
 *   - the RuleIndex (Task 6) to rebuild its family + scope-key maps
 *   - the cache-eviction fan-out (Task 11) to invalidate thumbnail / stitcher /
 *     Rive filter caches when an all-instances rule changes
 *
 * Returns an unsubscribe function.
 */
export function onRuleChanged(cb: RuleChangeListener): () => void {
  ruleChangeListeners.add(cb);
  return () => { ruleChangeListeners.delete(cb); };
}

function fireRuleChanged(rule: TextureOverrideRule, reason: RuleChangeReason): void {
  ruleIndex.rebuild(ctx.state.rules);
  for (const cb of ruleChangeListeners) {
    try { cb({ rule, reason }); } catch (e) { warnFeature('QPM-TEXTURESWAP-002', { what: 'ruleChange:notify' }, e); }
  }
}

// ---------------------------------------------------------------------------
// Public API — rule CRUD
// ---------------------------------------------------------------------------

function generateId(): string {
  return `rule_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

const REGULAR_USER_CATEGORIES = new Set(['plant', 'tallplant', 'crop', 'pet', 'decor', 'item', 'seed']);

function normalizeRule(rule: TextureOverrideRule): TextureOverrideRule {
  const category = parseAtlasKey(rule.targetSpriteKey).category;
  const needsDev = !REGULAR_USER_CATEGORIES.has(category) || !!rule.riveOverrides;
  const base: TextureOverrideRule = {
    ...rule,
    mutationBehavior: rule.mutationBehavior ?? 'preserve',
    forceNoMutations: rule.forceNoMutations ?? false,
    scope: rule.scope ?? { kind: 'all' },
  };
  if (needsDev) base.devOnly = true;
  return base;
}

export function addRule(rule: Omit<TextureOverrideRule, 'id'>, options?: { silent?: boolean }): TextureOverrideRule {
  const newRule = normalizeRule({ ...rule, id: generateId() });
  ctx.state = { ...ctx.state, rules: [...ctx.state.rules, newRule] };
  saveState();
  bumpRuleRevision();
  fireRuleChanged(newRule, 'add');

  ctx.activeRules = ctx.state.rules.filter(r => r.enabled);
  if (newRule.enabled && ctx.currentSvc) {
    const svc = ctx.currentSvc;
    void (async () => {
      try {
        await applyLayerA(newRule, svc);
      } finally {
        refreshLayerBNow();
      }
    })();
  } else {
    refreshLayerBNow();
  }
  // Silent adds skip the panel-refresh event so live controls (color picker,
  // slider drags) aren't destroyed when the first interaction creates the rule.
  if (!options?.silent) {
    dispatchCustomEventAll('qpm:texture-manipulator-updated', { revision: Date.now() });
  }
  return newRule;
}

export function updateRule(updated: TextureOverrideRule, options?: { silent?: boolean }): void {
  const idx = ctx.state.rules.findIndex(r => r.id === updated.id);
  if (idx === -1) return;
  const normalized = normalizeRule(updated);
  const old = ctx.state.rules[idx]!;

  if (ctx.currentSvc) revertLayerA(old, ctx.currentSvc);

  const newRules = ctx.state.rules.map((r, i) => i === idx ? normalized : r);
  ctx.state = { ...ctx.state, rules: newRules };
  saveState();
  bumpRuleRevision();
  fireRuleChanged(normalized, 'update');

  ctx.activeRules = ctx.state.rules.filter(r => r.enabled);
  if (normalized.enabled && ctx.currentSvc) {
    const svc = ctx.currentSvc;
    void (async () => {
      try {
        await applyLayerA(normalized, svc);
      } finally {
        refreshLayerBNow();
      }
    })();
  } else {
    refreshLayerBNow();
  }
  // Silent updates skip the panel-refresh event so live controls (color picker,
  // slider drags) aren't destroyed mid-interaction. Layer A still re-applies.
  if (!options?.silent) {
    dispatchCustomEventAll('qpm:texture-manipulator-updated', { revision: Date.now() });
  }
}

export function deleteRule(id: string): void {
  const rule = ctx.state.rules.find(r => r.id === id);
  if (!rule) return;
  if (ctx.currentSvc) revertLayerA(rule, ctx.currentSvc);
  // Layer A revert preserves the overlay filter (so silent updates can reuse
  // it); on real deletion we explicitly dispose it.
  disposeRuleOverlayFilter(rule.id);

  ctx.state = { ...ctx.state, rules: ctx.state.rules.filter(r => r.id !== id) };
  saveState();
  bumpRuleRevision();
  fireRuleChanged(rule, 'delete');

  ctx.activeRules = ctx.state.rules.filter(r => r.enabled);
  refreshLayerBNow();
  dispatchCustomEventAll('qpm:texture-manipulator-updated', { revision: Date.now() });
}

export function clearAllRules(): void {
  const clearedRules = [...ctx.state.rules];
  for (const rule of ctx.state.rules) {
    if (ctx.currentSvc) revertLayerA(rule, ctx.currentSvc);
    disposeRuleOverlayFilter(rule.id);
  }
  ctx.state = { ...ctx.state, rules: [] };
  saveState();
  bumpRuleRevision();
  for (const rule of clearedRules) fireRuleChanged(rule, 'delete');
  ctx.activeRules = [];
  refreshLayerBNow();
  dispatchCustomEventAll('qpm:texture-manipulator-updated', { revision: Date.now() });
}

export function replaceAllRules(snapshot: TextureManipulatorState): void {
  for (const rule of ctx.state.rules) {
    if (ctx.currentSvc) revertLayerA(rule, ctx.currentSvc);
    disposeRuleOverlayFilter(rule.id);
  }

  const normalizedRules = snapshot.rules.map(r => normalizeRule(r));
  ctx.state = {
    version: 1,
    rules: normalizedRules,
    uploadedAssets: { ...snapshot.uploadedAssets },
  };
  saveState();
  bumpRuleRevision();
  clearAllRuleVariantTextures();
  ruleIndex.rebuild(ctx.state.rules);
  ctx.activeRules = ctx.state.rules.filter(r => r.enabled);

  if (ctx.currentSvc) {
    void (async () => {
      try {
        await applyAllLayerA(ctx.activeRules);
      } finally {
        refreshLayerBNow();
      }
    })();
  } else {
    refreshLayerBNow();
  }
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
    notify({ feature: 'gardenPainter', level: 'error', message: 'Upload must be an image file' });
    return null;
  }

  let dataUrl: string;

  if (file.size > MAX_UPLOAD_BYTES) {
    const img = await loadFileAsImage(file);
    if (!img) {
      notify({ feature: 'gardenPainter', level: 'error', message: 'Failed to load image for compression' });
      return null;
    }
    const longest = Math.max(img.naturalWidth || 1, img.naturalHeight || 1);
    const scale = Math.min(1, COMPRESS_SIZE / longest);
    const targetW = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
    const targetH = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx2d = canvas.getContext('2d')!;
    ctx2d.clearRect(0, 0, targetW, targetH);
    ctx2d.imageSmoothingEnabled = true;
    ctx2d.imageSmoothingQuality = 'high';
    ctx2d.drawImage(img, 0, 0, targetW, targetH);
    const webp = canvas.toDataURL('image/webp', 0.9);
    dataUrl = webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png');
  } else {
    dataUrl = await readFileAsDataUrl(file);
  }

  const assetId = `upload_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const assets = { ...ctx.state.uploadedAssets, [assetId]: dataUrl };
  const stateWithAsset = { ...ctx.state, uploadedAssets: assets };
  ctx.state = stateWithAsset;
  saveState();

  const readBack = storage.get<TextureManipulatorState | null>(STORAGE_KEY, null);
  if (!readBack?.uploadedAssets?.[assetId]) {
    notify({ feature: 'gardenPainter', level: 'error', message: 'Upload failed to save (storage quota exceeded?)' });
    const { [assetId]: _removed, ...rest } = ctx.state.uploadedAssets;
    ctx.state = { ...ctx.state, uploadedAssets: rest };
    return null;
  }

  return assetId;
}

export function deleteUploadedAsset(assetId: string): void {
  const { [assetId]: _removed, ...rest } = ctx.state.uploadedAssets;
  ctx.state = { ...ctx.state, uploadedAssets: rest };
  saveState();
}

// ---------------------------------------------------------------------------
// Public API — preview
// ---------------------------------------------------------------------------

export async function buildPreviewCanvas(
  rule: Partial<TextureOverrideRule>,
): Promise<HTMLCanvasElement | null> {
  const svc = ctx.currentSvc;
  if (!svc) return null;

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
  const svc = ctx.currentSvc;
  if (!svc) return null;

  // If any active rule has stored the pre-override texture, render that
  // directly. After applyLayerA, svc.state.tex and item.first both point at
  // the customTex, so going through the standard lookup would return the
  // overridden version, not the original.
  const stored = getStoredOriginalForKey(spriteKey);
  if (stored) {
    try {
      const c = svc.renderToCanvas(stored);
      if (c) return c;
    } catch {
      // fall through to standard render
    }
  }

  const { category, id } = parseAtlasKey(spriteKey);
  return renderSpriteToCanvasInternal(svc, category, id);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export function initTextureSwapper(): () => void {
  if (!TEXTURE_MANIPULATOR_ENABLED) return () => {};
  if (ctx.started) return () => {};
  ctx.started = true;

  ensureBusRegistered();

  ctx.state = loadState();
  ruleIndex.rebuild(ctx.state.rules);
  ctx.debugEnabled = loadDebugSetting();
  log.enabled = ctx.debugEnabled;
  ctx.activeRules = ctx.state.rules.filter(r => r.enabled);
  clearAllRuleVariantTextures();

  const unsubCacheEviction = onRuleChanged(({ rule }) => {
    if (rule.scope && rule.scope.kind !== 'all') return;
    const family = stripRenderState(rule.targetSpriteKey);
    invalidateThumbCache(family);
    invalidateStitcherCache(family);
  });
  ctx.cleanups.push(unsubCacheEviction);

  const unsub = onSpritesReady(() => {
    void (async () => {
      const svc = await serviceReady;
      if (!svc) return;
      ctx.currentSvc = svc;

      // Build the base→variants map BEFORE Layer A so the first index build
      // already sees family pairings (DawnCelestialPlant → ...Active, etc.).
      initAssetFamily(svc);

      await applyAllLayerA(ctx.activeRules);
      refreshLayerBNow();

      const cleanupChildAdded = initStageChildAddedHook();
      ctx.cleanups.push(cleanupChildAdded);

      ctx.cleanups.push(initTileObjectHook());
      ctx.cleanups.push(initPetSwapHook());

      try {
        const captured = (pageWindow as Record<string, unknown>).__QPM_PIXI_CAPTURED__ as
          { app?: { view?: unknown; canvas?: unknown } } | undefined;
        const canvas = (captured?.app?.view ?? captured?.app?.canvas) as HTMLCanvasElement | null | undefined;
        if (canvas instanceof HTMLCanvasElement) {
          const onRestore = () => {
            ctx.layerBOriginals = new WeakMap();
            ctx.layerBModified = [];
            ctx.lastLayerBApplyToken = null;
            clearAllRuleVariantTextures();
            void (async () => {
              await applyAllLayerA(ctx.activeRules);
              refreshLayerBNow();
            })();
          };
          canvas.addEventListener('webglcontextrestored', onRestore);
          ctx.cleanups.push(() => canvas.removeEventListener('webglcontextrestored', onRestore));
        }
      } catch (e) {
        warnFeature('QPM-TEXTURESWAP-001', { what: 'webgl:contextRestoredHook' }, e);
      }
    })();
  });
  ctx.cleanups.push(unsub);

  // Install the SharedRiveSprite scale-setter patch. Lazy: the patch is
  // applied the first time a Rive sprite is observed in the scene graph,
  // either now (if a Rive decor is already on screen) or on the next Layer B
  // apply pass (via captureFromScene() in layerB-apply.ts).
  const cleanupRiveAdapter = installRiveAdapter();
  ctx.cleanups.push(cleanupRiveAdapter);

  publishOk('Ready — waiting for sprites', {
    rules: ctx.state.rules.length,
    activeRules: ctx.activeRules.length,
    uploads: Object.keys(ctx.state.uploadedAssets).length,
  });

  return () => {
    ctx.started = false;
    ctx.layerBRefreshRunId++;
    clearLayerBRefreshTimers();
    cancelPendingRefresh();
    revertAll();
    flushPendingTextureDestroy();
    for (const fn of ctx.cleanups) fn();
    ctx.cleanups.length = 0;
    ctx.currentSvc = null;
    ctx.activeRules = [];
    ctx.ruleRevision = 0;
    ctx.lastLayerBApplyToken = null;
    // PR #4 task 17 + 18 — clear Layer A run-tokens + texture fingerprints.
    ctx.lastLayerAApplyTokenByRule.clear();
    ctx.ruleTextureFingerprints.clear();
    // 2026-06-27 — tear down the per-frame scale re-asserter.
    ctx.scaledSpritesActive.clear();
    uninstallScaleAsserter();
    // Asset-family map is tied to the currentSvc — drop it on stop so the
    // next start rebuilds against a fresh items list.
    clearAssetFamily();
  };
}
