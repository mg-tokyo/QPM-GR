// Uses DOM script injection for Chrome compatibility

import type { PixiHooks } from './types';
import { isDiscordSurface } from '../utils/environment';
import { pageWindow, isIsolatedContext } from '../core/pageContext';
import { spriteLog } from './diagnostics';
import { PIXI_CAPTURE_PAGE_SCRIPT } from './pageScript';
import { repairPixiCapture } from '../core/pixiCapture';

/**
 * Get the page window context.
 * Uses pageWindow from pageContext which handles unsafeWindow, wrappedJSObject (Firefox),
 * and globalThis fallback.
 */
function getRoot(): any {
  return pageWindow;
}

// Firefox Xray helpers — needed to create objects/functions visible to page context
const _cloneInto: ((obj: unknown, target: object, opts?: object) => unknown) | null =
  typeof (globalThis as unknown as Record<string, unknown>).cloneInto === 'function'
    ? (globalThis as unknown as Record<string, unknown>).cloneInto as (obj: unknown, target: object, opts?: object) => unknown
    : null;

const _exportFn: ((fn: Function, target: object) => Function) | null =
  typeof (globalThis as unknown as Record<string, unknown>).exportFunction === 'function'
    ? (globalThis as unknown as Record<string, unknown>).exportFunction as (fn: Function, target: object) => Function
    : null;

function cloneToPage(obj: unknown, target: object): unknown {
  if (!isIsolatedContext || !_cloneInto) return obj;
  try { return _cloneInto(obj, target); } catch { return obj; }
}

function exportToPage(fn: Function, target: object): Function {
  if (!isIsolatedContext || !_exportFn) return fn;
  try { return _exportFn(fn, target); } catch { return fn; }
}

/**
 * Used on Discord (where CSP blocks inline scripts) to set up bridge state
 * the injected script would normally create. On Firefox, objects/functions
 * must go through cloneInto/exportFunction to cross the Xray wrapper boundary.
 */
function setupBridgeOnRoot(root: any): void {
  if (root.__QPM_PIXI_HOOKS_ACTIVE__) return;
  root.__QPM_PIXI_HOOKS_ACTIVE__ = true;

  root.__QPM_PIXI_CAPTURED__ = root.__QPM_PIXI_CAPTURED__ ||
    cloneToPage({ app: null, renderer: null, version: null }, root);

  root.__QPM_SPRITE_BRIDGE__ = root.__QPM_SPRITE_BRIDGE__ ||
    cloneToPage({
      atlas: {},
      stats: { loads: 0, errors: 0, lastError: null, lastLoadedAt: 0 },
    }, root);

  // Passive bridge stubs — just enough for the sprite system to function
  const bridge = root.__QPM_SPRITE_BRIDGE__;
  if (!bridge.loadAtlas) {
    bridge.loadAtlas = exportToPage(
      (_a: string, _b: string, _i?: string, _d?: unknown) =>
        Promise.resolve({ ok: false, count: 0, source: 'passive', error: 'passive-loader-disabled' }),
      root,
    );
  }
  if (!bridge.getAtlasTextures) {
    bridge.getAtlasTextures = exportToPage(
      (atlasPath: string) => {
        const rec = bridge.atlas?.[atlasPath];
        return rec?.textures ?? null;
      },
      root,
    );
  }
  if (!bridge.snapshot) {
    bridge.snapshot = exportToPage(
      () => ({
        atlas: Object.fromEntries(
          Object.entries(bridge.atlas ?? {}).map(([name, rec]: [string, any]) => [
            name,
            {
              loadedAt: rec?.loadedAt ?? 0,
              source: rec?.source ?? null,
              candidate: rec?.candidate ?? null,
              count: rec?.textures ? Object.keys(rec.textures).length : 0,
            },
          ])
        ),
        stats: bridge.stats ?? {},
      }),
      root,
    );
  }
}

/**
 * Hooks getContext to capture the PIXI canvas before the Application is
 * initialised, then polls for PIXI back-references (e.g. canvas.__PIXI_APP__)
 * and stores captured canvases for the canvas-based fallback scanner.
 */
function hookCanvasGetContext(root: any): void {
  if (root.__QPM_CANVAS_HOOK__) return;
  root.__QPM_CANVAS_HOOK__ = true;

  try {
    const proto = root.HTMLCanvasElement?.prototype;
    if (!proto?.getContext) return;

    const origGetContext = proto.getContext;
    const capturedCanvases: HTMLCanvasElement[] = [];
    root.__QPM_WEBGL_CANVASES__ = capturedCanvases;

    const patchedGetContext = function (this: HTMLCanvasElement, type: string, ...args: unknown[]) {
      const ctx = origGetContext.apply(this, [type, ...args]);
      if (ctx && (type === 'webgl2' || type === 'webgl') && !capturedCanvases.includes(this)) {
        capturedCanvases.push(this);
        spriteLog('debug', 'pixi-hook-webgl-context', 'WebGL context created on canvas', { width: this.width, height: this.height });
      }
      return ctx;
    };

    // On Firefox, the patched function must be exported to the page context
    proto.getContext = _exportFn
      ? _exportFn(patchedGetContext, root) as typeof proto.getContext
      : patchedGetContext as typeof proto.getContext;
  } catch (err) {
    spriteLog('warn', 'pixi-hook-getcontext-failed', 'Failed to hook getContext', { error: String((err as Error)?.message ?? err) });
  }
}

/**
 * Injects hooks via DOM script injection — critical for Chrome, where
 * unsafeWindow doesn't share the window object PIXI DevTools uses.
 * The injected script sets window.__QPM_PIXI_CAPTURED__ when PIXI is detected.
 */
function injectPageContextHooks(): void {
  const root = getRoot();
  if (root.__QPM_HOOKS_INJECTED__) return;
  root.__QPM_HOOKS_INJECTED__ = true;

  // On Discord, CSP blocks inline scripts. The unsafeWindow hooks + polling
  // provide equivalent PIXI capture without DOM injection.
  if (isDiscordSurface) {
    setupBridgeOnRoot(root);
    hookCanvasGetContext(root);
    return;
  }

  try {
    const script = document.createElement('script');
    script.textContent = PIXI_CAPTURE_PAGE_SCRIPT;
    (document.head || document.documentElement).appendChild(script);
    script.remove();
  } catch {
    // Silent failure - will fall back to other detection methods
  }
}

async function waitWithTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  const t0 = performance.now();
  const sleep = (ms: number) => new Promise<null>((resolve) => setTimeout(() => resolve(null), ms));

  while (performance.now() - t0 < ms) {
    const result = await Promise.race([p, sleep(50)]);
    if (result !== null) return result;
  }

  throw new Error(`${label} timeout`);
}

/**
 * Creates hooks to intercept PIXI initialization.
 * Uses both userscript hooks AND injected page context hooks for Chrome compatibility.
 * 
 * CRITICAL: This function must be called at MODULE LOAD TIME, not inside async functions.
 * The game may initialize PIXI before any async code runs.
 */
export function createPixiHooks(): PixiHooks {
  let appResolver: ((app: any) => void) | undefined;
  let rdrResolver: ((renderer: any) => void) | undefined;

  const appReady = new Promise<any>((resolve) => {
    appResolver = resolve;
  });

  const rendererReady = new Promise<any>((resolve) => {
    rdrResolver = resolve;
  });

  let APP: any = null;
  let RDR: any = null;
  let PIXI_VER: string | null = null;

  const root = getRoot();
  let contextLossAttached = false;

  // Listen for WebGL context restoration to invalidate stale texture caches
  const attachContextLossListener = (app: any) => {
    if (contextLossAttached) return;
    try {
      const canvas = app?.canvas || app?.view;
      if (canvas instanceof HTMLCanvasElement) {
        contextLossAttached = true;
        canvas.addEventListener('webglcontextrestored', () => {
          const bridge = root.__QPM_SPRITE_BRIDGE__;
          if (bridge) {
            bridge.atlas = {};
            bridge.stats.lastError = 'context-restored';
          }
        });
      }
    } catch { /* ignore */ }
  };

  injectPageContextHooks();

  // Hook into a global function on the page window.
  // On Firefox, functions from the userscript sandbox are not callable from
  // page context due to Xray wrappers. Use exportFunction to make them visible.
  const hook = (name: string, cb: (...args: any[]) => void) => {
    const prev = root[name];
    const wrapper = function (this: unknown) {
      try {
        cb.apply(this, arguments as any);
      } finally {
        if (typeof prev === 'function') {
          try {
            prev.apply(this, arguments as any);
          } catch {
            /* ignore */
          }
        }
      }
    };
    root[name] = _exportFn ? _exportFn(wrapper, root) : wrapper;
  };

  // Set up hooks on unsafeWindow (works on Firefox)
  hook('__PIXI_APP_INIT__', (a: any, v: any) => {
    spriteLog('debug', 'pixi-hook-app-init', '__PIXI_APP_INIT__ fired', { app: !!a, version: v });
    if (!a) return;
    const wasUnset = !APP;
    APP = a;
    PIXI_VER = v;
    if (wasUnset) appResolver?.(a);
    attachContextLossListener(a);
    // Repair the shared capture so gardenFilters and other direct consumers
    // of root.__QPM_PIXI_CAPTURED__ see it — creates the object if the
    // injected script never ran (Discord CSP, late load order).
    repairPixiCapture({ app: a, renderer: a?.renderer ?? null, version: v ?? null }, 'hook-app-init');
  });

  hook('__PIXI_RENDERER_INIT__', (r: any, v: any) => {
    spriteLog('debug', 'pixi-hook-renderer-init', '__PIXI_RENDERER_INIT__ fired', { renderer: !!r, version: v });
    if (!r) return;
    const wasUnset = !RDR;
    RDR = r;
    PIXI_VER = v;
    if (wasUnset) rdrResolver?.(r);
    repairPixiCapture({ renderer: r, version: v ?? null }, 'hook-renderer-init');
  });

  spriteLog('debug', 'pixi-hook-setup', 'Hook setup', {
    isDiscord: isDiscordSurface,
    isolated: isIsolatedContext,
    hasExportFn: !!_exportFn,
    hookTypeOnRoot: typeof root.__PIXI_APP_INIT__,
    rootIsGlobalThis: root === globalThis,
  });

  // Canvas fallback: when __PIXI_APP_INIT__ hooks fail (Firefox Xray, Discord
  // CSP, stripped devtools), scan canvases for PIXI-specific structures.
  const tryCanvasFallback = () => {
    if (APP) return;
    try {
      const canvases = document.querySelectorAll('canvas');
      for (const canvas of canvases) {
        // Skip tiny canvases (UI elements, not the game canvas)
        if (canvas.width < 200 || canvas.height < 200) continue;

        // Check if PIXI set __PIXI_APP__ on the canvas (some builds do)
        const canvasAny = canvas as unknown as Record<string, unknown>;
        if (canvasAny.__PIXI_APP__ && (canvasAny.__PIXI_APP__ as any)?.stage) {
          spriteLog('debug', 'pixi-hook-found-app', 'Found app via canvas.__PIXI_APP__');
          APP = canvasAny.__PIXI_APP__;
          PIXI_VER = (APP as any)?.renderer?.type === 2 ? '8.x' : '7.x';
          appResolver?.(APP);
          if ((APP as any)?.renderer) {
            RDR = (APP as any).renderer;
            rdrResolver?.(RDR);
          }
          attachContextLossListener(APP);
          return;
        }

        // Scan root (pageWindow) for objects referencing this canvas
        // PIXI Application stores its canvas as app.canvas or app.view
        const searchKeys = [
          '__PIXI_APP__', 'PIXI_APP', 'app', '__pixi_app__',
          '__PIXI_STAGE__', '__PIXI_RENDERER__',
        ];
        for (const key of searchKeys) {
          try {
            const val = root[key];
            if (val && typeof val === 'object') {
              const appCanvas = val.canvas || val.view;
              if (appCanvas === canvas && val.stage) {
                spriteLog('debug', 'pixi-hook-found-app', 'Found app via root property', { key });
                APP = val;
                appResolver?.(APP);
                if (val.renderer) { RDR = val.renderer; rdrResolver?.(RDR); }
                attachContextLossListener(APP);
                return;
              }
            }
          } catch { /* Xray wrapper issues — ignore */ }
        }
      }
    } catch { /* ignore canvas scan errors */ }
  };

  const tryResolveExisting = () => {
    if (APP && RDR) return;

    // Source 1: Check injected script's captured data (Chrome)
    const captured = root.__QPM_PIXI_CAPTURED__;
    if (captured) {
      if (captured.app && APP !== captured.app) {
        const wasUnset = !APP;
        APP = captured.app;
        PIXI_VER = captured.version;
        if (wasUnset) appResolver?.(APP);
      }
      if (captured.renderer && RDR !== captured.renderer) {
        const wasUnset = !RDR;
        RDR = captured.renderer;
        PIXI_VER = captured.version;
        if (wasUnset) rdrResolver?.(RDR);
      }
    }

    // Source 2: Check global variables on unsafeWindow
    if (!APP) {
      const maybeApp = root.__PIXI_APP__ || root.PIXI_APP || root.app;
      if (maybeApp?.renderer) {
        APP = maybeApp;
        appResolver?.(APP);
      }
    }
    if (!RDR) {
      const maybeRdr = root.__PIXI_RENDERER__ || root.PIXI_RENDERER__ || root.renderer || APP?.renderer;
      if (maybeRdr) {
        RDR = maybeRdr;
        rdrResolver?.(RDR);
      }
    }

    // Source 3: Canvas-based fallback (Discord + Firefox)
    if (!APP) {
      tryCanvasFallback();
    }

    if (APP && !PIXI_VER) {
      PIXI_VER = root.__PIXI__?.VERSION || root.PIXI?.VERSION || '8.x';
    }

    if (APP) attachContextLossListener(APP);

    // Write back Source 2/3 resolutions — they only set module-local APP/RDR,
    // leaving __QPM_PIXI_CAPTURED__ consumers dead for the session otherwise.
    // Fill-only no-op when Source 1 (the capture itself) supplied the values.
    if (APP || RDR) {
      repairPixiCapture(
        { app: APP, renderer: RDR ?? APP?.renderer ?? null, version: PIXI_VER },
        'hooks-fallback',
      );
    }
  };

  tryResolveExisting();

  // Poll for captured PIXI (especially important for Chrome)
  let fallbackPolls = 0;
  const fallbackInterval = setInterval(() => {
    if (APP && RDR) {
      clearInterval(fallbackInterval);
      return;
    }
    tryResolveExisting();
    fallbackPolls += 1;
    if (fallbackPolls >= 100) { // 10 seconds at 100ms intervals
      clearInterval(fallbackInterval);
    }
  }, 100);

  return {
    get app() {
      return APP;
    },
    get renderer() {
      return RDR;
    },
    get pixiVersion() {
      return PIXI_VER;
    },
    appReady,
    rendererReady,
  };
}

export async function waitForPixi(
  handles: PixiHooks,
  timeoutMs = 15000
): Promise<{ app: any; renderer: any; version: string | null }> {
  const app = await waitWithTimeout(handles.appReady, timeoutMs, 'PIXI app');
  const renderer = await waitWithTimeout(handles.rendererReady, timeoutMs, 'PIXI renderer');

  return { app, renderer, version: handles.pixiVersion };
}

export function ensureDocumentReady(): Promise<void> {
  if (document.readyState !== 'loading') {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const onReady = () => {
      document.removeEventListener('DOMContentLoaded', onReady);
      resolve();
    };
    document.addEventListener('DOMContentLoaded', onReady);
  });
}
