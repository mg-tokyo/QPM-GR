import type { SpriteService, GetSpriteParams, RenderOptions } from './types';
import { DEFAULT_CFG } from './settings';
import { detectGameVersionWithRetry, buildAssetsBaseUrl, getRuntimeWindow } from './detector';
import { ensureDocumentReady } from './hooks';
import { getCtors } from './utils';
import { computeVariantSignature, textureToCanvas } from './renderer';
import { clearVariantCache, getCacheStats } from './cache';
import { clearSpriteDataUrlCache } from './compat';
import * as api from './api';
import { yieldToBrowser, delay } from '../utils/scheduling/scheduling';
import { spriteLog } from './diagnostics';
import { ctxRef, createInitialState } from './service/state';
import { notifyWarmup } from './service/warmup';
import { dispatchHydrationEvent } from './service/hydrationEvents';
import {
  bootReportRef,
  renderErrorState,
  buildRendererReport,
  updateBootReportRenderer,
  hasExtractCanvas,
  getRendererUid,
  getRendererType,
} from './service/bootReport';
import { rememberRenderFailure } from './service/healthIntegration';
import { loadTextures, prefetchAtlasData } from './service/loadTextures';
import { runBackgroundCompressedRehydrate, runPostHydrationMutationPass } from './service/postHydration';
import { resolvePixiFast, resolveActiveRenderer } from './service/pixiResolve';
import type { LoadTexturesResult, PrefetchedAtlas, SpriteBootReport } from './service/types';

export { initPixiHooks, probePixiPresence } from './service/pixiResolve';
export { getSpriteWarmupState, onSpriteWarmupProgress } from './service/warmup';
export type { SpriteWarmupState } from './service/warmup';
export { getSpriteBootReport } from './service/bootReport';
export {
  startSpriteV2Diagnostics,
  stopSpriteV2Diagnostics,
  reportSpriteV2InitFailed,
  reportSpriteV2InitRecovered,
} from './service/healthIntegration';
export { spriteProbe } from './service/probe';
export type {
  SpriteProbeInput,
  SpriteProbeResult,
  AtlasBootReport,
  SpriteRendererReport,
  SpriteBootReport,
} from './service/types';

let prefetchPromise: Promise<PrefetchedAtlas | null> | null = null;
let contextRestoreReloadPromise: Promise<void> | null = null;

async function start(): Promise<SpriteService> {
  const runtimeOrigin = getRuntimeWindow().location?.origin || DEFAULT_CFG.origin;

  ctxRef.current = {
    cfg: { ...DEFAULT_CFG, origin: runtimeOrigin },
    state: createInitialState(),
  };

  // Note: hooks are created at module load time (see service/pixiResolve.ts)
  // This ensures we catch PIXI init events even if they happen before start() is called

  if (ctxRef.current.state.started) {
    throw new Error('Sprite system already started');
  }

  ctxRef.current.state.started = true;
  notifyWarmup({ phase: 'init', total: 0, done: 0, completed: false });

  // Detect version and build base URL early so we can start prefetching
  const version = await detectGameVersionWithRetry();
  const base = buildAssetsBaseUrl(ctxRef.current!.cfg.origin, version);
  ctxRef.current!.state.version = version;
  ctxRef.current!.state.base = base;
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

  const resolved = await resolvePixiFast() as any;
  const { app, renderer: _renderer, version: pixiVersion } = resolved;
  await ensureDocumentReady();

  // Brief yield to let the browser catch up after PIXI init
  await yieldToBrowser();

  ctxRef.current!.state.app = app; // May be null if we got renderer through canvasSpriteCache
  ctxRef.current!.state.renderer = _renderer || app?.renderer || app?.render || null;
  const renderer = resolveActiveRenderer(ctxRef.current!.state, _renderer || app?.renderer || app?.render || null);
  if (!renderer) {
    throw new Error('No PIXI renderer found');
  }

  ctxRef.current!.state.ctors = getCtors(app, renderer);
  ctxRef.current!.state.runtimeTextureHints = Array.isArray(resolved?.runtimeHints)
    ? resolved.runtimeHints.filter(Boolean)
    : [];
  ctxRef.current!.state.sig = computeVariantSignature(ctxRef.current!.state).sig;

  const publishLoadResult = (loadResult: LoadTexturesResult, eventReason?: string): void => {
    ctxRef.current!.state.loadMode = loadResult.loadMode;
    ctxRef.current!.state.fallbackBase = loadResult.fallbackBase ?? null;
    ctxRef.current!.state.decoder = { ...loadResult.decoder };

    const coverage = loadResult.expectedFrames > 0
      ? loadResult.hydratedFrames / loadResult.expectedFrames
      : 1;

    const report: SpriteBootReport = {
      version: ctxRef.current!.state.version,
      base: ctxRef.current!.state.base,
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
      renderer: buildRendererReport(ctxRef.current!.state),
      decoder: { ...loadResult.decoder },
      generatedAt: Date.now(),
    };
    bootReportRef.current = report;

    dispatchHydrationEvent(eventReason ?? (loadResult.status === 'ok' ? 'hydrated' : 'degraded/final'), {
      mode: loadResult.finalMode,
      loadMode: loadResult.loadMode,
      status: loadResult.status,
      degraded: loadResult.status !== 'ok',
      expectedFrames: loadResult.expectedFrames,
      hydratedFrames: loadResult.hydratedFrames,
      coverage: Number(coverage.toFixed(3)),
      renderer: report.renderer,
    });
  };

  const scheduleContextRestoreReload = (): void => {
    if (contextRestoreReloadPromise) return;
    contextRestoreReloadPromise = (async () => {
      try {
        await delay(80);
        const current = ctxRef.current;
        if (!current?.state?.base) return;
        resolveActiveRenderer(current.state);
        const reloaded = await loadTextures(current.state.base, current.state);
        publishLoadResult(reloaded, reloaded.status === 'ok' ? 'rehydrated' : 'degraded/final');
        if (reloaded.compressedEntries.length > 0) {
          await runBackgroundCompressedRehydrate(current.state.base, reloaded.compressedEntries, reloaded.atlasReports, current.state);
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
        const current = ctxRef.current;
        if (current) {
          current.state.tex.clear();
          current.state.srcCan.clear();
          current.state.atlasBases.clear();
          clearVariantCache(current.state);
          clearSpriteDataUrlCache();
          resolveActiveRenderer(current.state);
          spriteLog('warn', 'webgl-context-restored', 'WebGL context restored - sprite caches cleared, scheduling reload');
          scheduleContextRestoreReload();
        }
      });
    }
  } catch { /* ignore */ }

  const prefetched = await (prefetchPromise ?? Promise.resolve(null));

  const loadResult = await loadTextures(ctxRef.current!.state.base!, ctxRef.current!.state, prefetched);
  const hasCompressedAtlases = loadResult.atlasReports.some((report) => report.mode === 'compressed');
  publishLoadResult(loadResult);

  // Variant-job pipeline is dormant — nothing pushes to state.jobs. The ticker
  // registration was a permanent no-op every frame. Register on first enqueue
  // instead if the pipeline is ever revived; see processVariantJobs in renderer.ts.
  ctxRef.current!.state.open = true;

  const renderTextureToCanvas = (tex: any): HTMLCanvasElement | null => {
    const state = ctxRef.current!.state;
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
      renderErrorState.message = message;
      renderErrorState.at = message ? Date.now() : null;
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
      const fallback = textureToCanvas(tex, state, ctxRef.current!.cfg);
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

    const resolvedRenderer = resolveActiveRenderer(state);
    const resolvedHit = tryExtract(resolvedRenderer, 'resolved.renderer');
    if (resolvedHit) return resolvedHit;

    return null;
  };

  const service: SpriteService = {
    ready: Promise.resolve(),
    state: ctxRef.current.state,
    cfg: ctxRef.current.cfg,

    list(category = 'any') {
      return api.listItemsByCategory(ctxRef.current!.state, category);
    },

    getBaseSprite(params) {
      return api.getBaseSprite(params, ctxRef.current!.state);
    },

    getSpriteWithMutations(params) {
      return api.getSpriteWithMutations(params, ctxRef.current!.state, ctxRef.current!.cfg);
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
      const item = ctxRef.current!.state.items.find((it) => it.key === `sprite/${params.category}/${params.id}` || it.key === params.id);
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
    (target as any).__MG_SPRITE_STATE__ = ctxRef.current.state;
    (target as any).__MG_SPRITE_CFG__ = ctxRef.current.cfg;
    (target as any).__MG_SPRITE_SERVICE__ = service;
    (target as any).MG_SPRITE_HELPERS = service;
  }

  for (const target of targets) {
    if (!target) continue;
    (target as any).getSpriteWithMutations = service.getSpriteWithMutations;
    (target as any).getBaseSprite = service.getBaseSprite;
    (target as any).buildSpriteVariant = service.buildVariant;
    (target as any).listSpritesByCategory = service.list;
    (target as any).renderSpriteToCanvas = service.renderToCanvas;
    (target as any).renderSpriteToDataURL = service.renderToDataURL;
  }

  const spriteCatalogApi = {
    open() {
      ctxRef.current!.state.open = true;
    },
    close() {
      ctxRef.current!.state.open = false;
    },
    toggle() {
      ctxRef.current!.state.open = !ctxRef.current!.state.open;
    },
    setCategory(cat: string) {
      ctxRef.current!.state.cat = cat || '__all__';
    },
    setFilterText(text: string) {
      ctxRef.current!.state.q = String(text || '').trim();
    },
    setSpriteFilter(name: string) {
      ctxRef.current!.state.f = name;
      ctxRef.current!.state.mutOn = false;
    },
    setMutation(on: boolean, ...muts: string[]) {
      ctxRef.current!.state.mutOn = !!on;
      ctxRef.current!.state.f = '';
      ctxRef.current!.state.mutations = ctxRef.current!.state.mutOn ? muts.filter(Boolean).map((name) => name) : [];
    },
    filters() {
      return [];
    },
    categories() {
      return [...ctxRef.current!.state.cats.keys()].sort((a, b) => a.localeCompare(b));
    },
    cacheStats() {
      return getCacheStats(ctxRef.current!.state);
    },
    clearCache() {
      clearVariantCache(ctxRef.current!.state);
    },
    curVariant: () => computeVariantSignature(ctxRef.current!.state),
  };
  for (const target of targets) {
    if (!target) continue;
    (target as any).MGSpriteCatalog = spriteCatalogApi;
  }

  spriteLog('debug', 'sprite-v2-initialized', 'Sprite system initialized', {
    version: ctxRef.current.state.version,
    pixi: pixiVersion,
    textures: ctxRef.current.state.tex.size,
    items: ctxRef.current.state.items.length,
    categories: ctxRef.current.state.cats.size,
    coverage: Number((bootReportRef.current?.coverage ?? 0).toFixed(3)),
    mode: bootReportRef.current?.finalMode ?? 'unknown',
    loadMode: ctxRef.current.state.loadMode ?? 'unknown',
  });

  if (hasCompressedAtlases) {
    void (async () => {
      await delay(0);
      const current = ctxRef.current;
      if (current?.state?.base && loadResult.compressedEntries.length > 0) {
        await runBackgroundCompressedRehydrate(current.state.base, loadResult.compressedEntries, loadResult.atlasReports, current.state);
      }
      if (loadResult.status === 'ok') {
        await runPostHydrationMutationPass(ctxRef.current!.state, ctxRef.current!.cfg);
        dispatchHydrationEvent('hydrated', {
          mode: bootReportRef.current?.finalMode ?? 'unknown',
          loadMode: ctxRef.current?.state?.loadMode ?? 'unknown',
          expectedFrames: bootReportRef.current?.expectedFrames ?? 0,
          hydratedFrames: bootReportRef.current?.hydratedFrames ?? 0,
          coverage: Number((bootReportRef.current?.coverage ?? 0).toFixed(3)),
          degraded: (bootReportRef.current?.status ?? 'ok') !== 'ok',
          renderer: bootReportRef.current?.renderer ?? null,
        });
      }
    })();
  }

  return service;
}

export { start as initSpriteSystem };

/**
 * Reset the module-scope guards so a failed initSpriteSystem() can be retried
 * by the late-boot watcher in init.ts. Only clears the pre-PIXI-resolve state
 * — safe to call after resolvePixiFast() threw; unsafe if any prior boot got
 * past the `state.started = true` gate AND published a boot report.
 *
 * Idempotent. No-op if there is no context to reset.
 */
export function resetSpriteBootStateForRetry(): void {
  prefetchPromise = null;
  if (ctxRef.current) {
    ctxRef.current.state.started = false;
  }
}

export type { SpriteService, GetSpriteParams, RenderOptions };
