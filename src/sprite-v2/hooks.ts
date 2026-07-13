// Uses DOM script injection for Chrome compatibility

import type { PixiHooks } from './types';
import { isDiscordSurface } from '../utils/environment';
import { pageWindow, isIsolatedContext } from '../core/pageContext';

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
        console.log('[QPM PIXI] WebGL context created on canvas', this.width, 'x', this.height);
      }
      return ctx;
    };

    // On Firefox, the patched function must be exported to the page context
    proto.getContext = _exportFn
      ? _exportFn(patchedGetContext, root) as typeof proto.getContext
      : patchedGetContext as typeof proto.getContext;
  } catch (err) {
    console.warn('[QPM PIXI] Failed to hook getContext', err);
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

  const scriptContent = `
(function() {
  if (window.__QPM_PIXI_HOOKS_ACTIVE__) return;
  window.__QPM_PIXI_HOOKS_ACTIVE__ = true;
  
  // Storage for captured PIXI objects
  window.__QPM_PIXI_CAPTURED__ = { app: null, renderer: null, version: null };

  // Sprite bridge state (page context)
  window.__QPM_SPRITE_BRIDGE__ = window.__QPM_SPRITE_BRIDGE__ || {
    atlas: {},
    stats: {
      loads: 0,
      errors: 0,
      lastError: null,
      lastLoadedAt: 0
    }
  };

  function normalizeSpriteKey(raw) {
    return String(raw || '')
      .replace(/\\\\/g, '/')
      .replace(/[?#].*$/, '')
      .replace(/^\\/+/, '')
      .replace(/\\.(png|webp|avif|jpg|jpeg|ktx2)$/i, '')
      .trim()
      .toLowerCase();
  }

  function isTextureLike(value) {
    return !!(
      value &&
      typeof value === 'object' &&
      (value.frame || value._frame) &&
      (value.source || value.orig || value._orig || value._source)
    );
  }

  var collectSeen = typeof WeakSet === 'function' ? new WeakSet() : null;

  function collectTextures(target, container) {
    if (!container) return;
    if (collectSeen && container && typeof container === 'object') {
      if (collectSeen.has(container)) return;
      collectSeen.add(container);
    }

    var isMapLike = container && typeof container.entries === 'function' && typeof container.forEach === 'function';
    if (isMapLike) {
      try {
        var mapEntries = container.entries();
        var step = mapEntries.next();
        while (!step.done) {
          var pair = step.value;
          if (Array.isArray(pair) && pair.length >= 2) {
            var key = String(pair[0]);
            var value = pair[1];
            if (isTextureLike(value)) {
              target[key] = value;
              var nk = normalizeSpriteKey(key);
              if (nk && !target[nk]) target[nk] = value;
            }
            if (value && value.textures) collectTextures(target, value.textures);
          }
          step = mapEntries.next();
        }
      } catch (_) {
        try {
          container.forEach(function(value, key) {
            var k = String(key);
            if (isTextureLike(value)) {
              target[k] = value;
              var nk = normalizeSpriteKey(k);
              if (nk && !target[nk]) target[nk] = value;
            }
            if (value && value.textures) collectTextures(target, value.textures);
          });
        } catch (_) {}
      }
      return;
    }

    if (Array.isArray(container)) {
      for (var i = 0; i < container.length; i++) {
        collectTextures(target, container[i]);
      }
      return;
    }

    if (typeof container === 'object') {
      var keys = Object.keys(container);
      for (var j = 0; j < keys.length; j++) {
        var objKey = keys[j];
        var objVal = container[objKey];
        if (isTextureLike(objVal)) {
          target[objKey] = objVal;
          var nko = normalizeSpriteKey(objKey);
          if (nko && !target[nko]) target[nko] = objVal;
        }
        if (objVal && objVal.textures) collectTextures(target, objVal.textures);
        if (objVal && objVal.frames) collectTextures(target, objVal.frames);
        if (objVal && objVal._managedTextures) collectTextures(target, objVal._managedTextures);
        if (objVal && objVal._boundTextures) collectTextures(target, objVal._boundTextures);
        if (objVal && objVal._uploads) collectTextures(target, objVal._uploads);
        if (objVal && objVal.texture && typeof objVal.texture === 'object') {
          if (objVal.texture._managedTextures) collectTextures(target, objVal.texture._managedTextures);
          if (objVal.texture._boundTextures) collectTextures(target, objVal.texture._boundTextures);
          if (objVal.texture._uploads) collectTextures(target, objVal.texture._uploads);
        }
      }
    }
  }

  function readDims(value) {
    if (!value || typeof value !== 'object') return null;
    var w = Number(
      value.width ??
      value.w ??
      value.pixelWidth ??
      (value.source && (value.source.width ?? value.source.pixelWidth)) ??
      (value.resource && (value.resource.width ?? value.resource.pixelWidth))
    );
    var h = Number(
      value.height ??
      value.h ??
      value.pixelHeight ??
      (value.source && (value.source.height ?? value.source.pixelHeight)) ??
      (value.resource && (value.resource.height ?? value.resource.pixelHeight))
    );
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
    return { w: w, h: h };
  }

  function dimsMatch(a, b) {
    if (!a || !b) return false;
    return Math.abs(a.w - b.w) <= 3 && Math.abs(a.h - b.h) <= 3;
  }

  function atlasTokens(atlasPath, imagePath) {
    var tokens = [];
    function add(v) {
      var n = normalizeSpriteKey(v);
      if (n) tokens.push(n);
    }
    add(atlasPath);
    add(imagePath);
    var p = String(atlasPath || '').replace(/[?#].*$/, '');
    var i = String(imagePath || '').replace(/[?#].*$/, '');
    add(p.replace(/\\.[^/.]+$/i, ''));
    add(i.replace(/\\.[^/.]+$/i, ''));
    var ps = p.split('/').filter(Boolean).pop() || '';
    var is = i.split('/').filter(Boolean).pop() || '';
    add(ps);
    add(is);
    add(ps.replace(/\\.[^/.]+$/i, ''));
    add(is.replace(/\\.[^/.]+$/i, ''));
    return Array.from(new Set(tokens));
  }

  function scoreLabels(labels, tokens) {
    var score = 0;
    for (var i = 0; i < labels.length; i++) {
      var n = normalizeSpriteKey(labels[i]);
      if (!n) continue;
      for (var t = 0; t < tokens.length; t++) {
        var tok = tokens[t];
        if (!tok) continue;
        if (n === tok) score += 8;
        else if (n.indexOf(tok) >= 0 || tok.indexOf(n) >= 0) score += 3;
      }
    }
    return score;
  }

  function findRuntimeAtlasSource(atlasPath, imagePath, atlasData) {
    var expected = atlasData && atlasData.meta && atlasData.meta.size
      ? { w: Number(atlasData.meta.size.w || 0), h: Number(atlasData.meta.size.h || 0) }
      : null;
    var tokens = atlasTokens(atlasPath, imagePath);

    var renderer =
      (window.__QPM_PIXI_CAPTURED__ && window.__QPM_PIXI_CAPTURED__.renderer) ||
      (window.__QPM_PIXI_CAPTURED__ && window.__QPM_PIXI_CAPTURED__.app && window.__QPM_PIXI_CAPTURED__.app.renderer) ||
      null;
    var texSys = renderer && renderer.texture;
    if (!texSys) return null;

    var best = null;
    function consider(key, value) {
      if (!value || typeof value !== 'object') return;
      var src = value.source || value._source || value;
      if (!src || typeof src !== 'object') return;
      var dims = readDims(src) || readDims(value);
      var labels = [
        String(key || ''),
        value.label,
        value.src,
        value.url,
        src.label,
        src.src,
        src.url,
        src.path,
        src.resource && src.resource.src,
        src.resource && src.resource.url
      ].filter(Boolean);

      var score = scoreLabels(labels, tokens);
      if (expected && dimsMatch(dims, expected)) score += 6;
      if (score <= 0) return;

      if (!best || score > best.score) {
        best = { score: score, src: src, dims: dims, labels: labels };
      }
    }

    var bound = texSys._boundTextures;
    if (Array.isArray(bound)) {
      for (var i = 0; i < bound.length; i++) {
        consider('bound[' + i + ']', bound[i]);
      }
    }

    var managed = texSys._managedTextures;
    if (managed && typeof managed.entries === 'function') {
      try {
        var it = managed.entries();
        var step = it.next();
        var count = 0;
        while (!step.done && count++ < 2000) {
          var pair = step.value;
          if (Array.isArray(pair) && pair.length >= 2) {
            consider(pair[0], pair[1]);
            consider('managed:key', pair[0]);
          }
          step = it.next();
        }
      } catch (_) {}
    }

    if (!best) return null;
    return best.src;
  }

  function buildAtlasTexturesFromSource(atlasData, atlasSource) {
    var P = window.PIXI || window.__PIXI__;
    if (!P || !P.Texture || !P.Rectangle) return {};

    var Texture = P.Texture;
    var Rectangle = P.Rectangle;
    var textures = {};
    var frames = (atlasData && atlasData.frames) || {};
    var keys = Object.keys(frames);

    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var fd = frames[key];
      if (!fd || !fd.frame) continue;

      var fr = fd.frame;
      var rot = fd.rotated ? 2 : 0;
      var w = fd.rotated ? fr.h : fr.w;
      var h = fd.rotated ? fr.w : fr.h;
      var frame = new Rectangle(fr.x, fr.y, w, h);
      var ss = fd.sourceSize || { w: fr.w, h: fr.h };
      var orig = new Rectangle(0, 0, ss.w, ss.h);

      var trim = null;
      if (fd.trimmed && fd.spriteSourceSize) {
        var s = fd.spriteSourceSize;
        trim = new Rectangle(s.x, s.y, s.w, s.h);
      }

      var t = null;
      try {
        t = new Texture({ source: atlasSource, frame: frame, orig: orig, trim: trim || undefined, rotate: rot || 0 });
      } catch (_) {
        try {
          t = new Texture(atlasSource, frame, orig, trim || undefined, rot || 0);
        } catch (_) {}
      }
      if (!t) continue;

      if (fd.anchor) {
        try {
          if (t.defaultAnchor && typeof t.defaultAnchor.set === 'function') {
            t.defaultAnchor.set(fd.anchor.x, fd.anchor.y);
          } else {
            t.defaultAnchor = { x: fd.anchor.x, y: fd.anchor.y };
          }
        } catch (_) {}
      }

      try { t.label = key; } catch (_) {}
      try { t.updateUvs && t.updateUvs(); } catch (_) {}
      textures[key] = t;
    }

    return textures;
  }

  function bridgeLoadAtlas(atlasPath, _base, imagePath, atlasData) {
    var bridge = window.__QPM_SPRITE_BRIDGE__;
    if (!bridge) return Promise.resolve({ ok: false, count: 0, source: 'none', error: 'bridge-missing' });

    var cached = bridge.atlas && bridge.atlas[atlasPath];
    if (cached && cached.textures && Object.keys(cached.textures).length > 0) {
      return Promise.resolve({
        ok: true,
        count: Object.keys(cached.textures).length,
        source: cached.source || 'cache',
        loadedAt: cached.loadedAt || 0
      });
    }

    // Passive diagnostics mode: bridge does not actively load or reconstruct atlas textures.
    bridge.__passiveMisses = bridge.__passiveMisses || {};
    if (!bridge.__passiveMisses[atlasPath]) {
      bridge.__passiveMisses[atlasPath] = true;
      bridge.stats.errors = (bridge.stats.errors || 0) + 1;
    }
    bridge.stats.lastError = bridge.stats.lastError || 'passive-loader-disabled';
    return Promise.resolve({
      ok: false,
      count: 0,
      source: 'passive',
      error: bridge.stats.lastError
    });
  }

  function bridgeGetAtlasTextures(atlasPath) {
    var bridge = window.__QPM_SPRITE_BRIDGE__;
    var rec = bridge && bridge.atlas && bridge.atlas[atlasPath];
    return rec && rec.textures ? rec.textures : null;
  }

  function bridgeSnapshot() {
    var bridge = window.__QPM_SPRITE_BRIDGE__;
    var out = {
      atlas: {},
      stats: bridge && bridge.stats ? bridge.stats : {}
    };
    if (bridge && bridge.atlas) {
      var names = Object.keys(bridge.atlas);
      for (var i = 0; i < names.length; i++) {
        var name = names[i];
        var rec = bridge.atlas[name];
        var count = rec && rec.textures ? Object.keys(rec.textures).length : 0;
        out.atlas[name] = {
          loadedAt: rec && rec.loadedAt ? rec.loadedAt : 0,
          source: rec && rec.source ? rec.source : null,
          candidate: rec && rec.candidate ? rec.candidate : null,
          count: count
        };
      }
    }
    return out;
  }

  window.__QPM_SPRITE_BRIDGE__.loadAtlas = bridgeLoadAtlas;
  window.__QPM_SPRITE_BRIDGE__.getAtlasTextures = bridgeGetAtlasTextures;
  window.__QPM_SPRITE_BRIDGE__.snapshot = bridgeSnapshot;
  
  // Hook into a global function, preserving any previous hook
  function hook(name, cb) {
    var prev = window[name];
    window[name] = function() {
      try { cb.apply(this, arguments); }
      finally { if (typeof prev === 'function') try { prev.apply(this, arguments); } catch(e) {} }
    };
  }
  
  // Hook PIXI initialization
  hook('__PIXI_APP_INIT__', function(app, version) {
    if (app) {
      window.__QPM_PIXI_CAPTURED__.app = app;
      window.__QPM_PIXI_CAPTURED__.version = version;
      if (app.renderer) window.__QPM_PIXI_CAPTURED__.renderer = app.renderer;
    }
  });
  
  hook('__PIXI_RENDERER_INIT__', function(renderer, version) {
    if (renderer) {
      window.__QPM_PIXI_CAPTURED__.renderer = renderer;
      window.__QPM_PIXI_CAPTURED__.version = version;
    }
  });
  
  // Poll for already-existing PIXI globals
  function checkExisting() {
    var maybeApp = window.__PIXI_APP__ || window.PIXI_APP || window.app;
    if (maybeApp && maybeApp.renderer) {
      window.__QPM_PIXI_CAPTURED__.app = maybeApp;
      window.__QPM_PIXI_CAPTURED__.renderer = maybeApp.renderer;
    }
    var maybeRdr = window.__PIXI_RENDERER__ || window.PIXI_RENDERER__;
    if (maybeRdr) {
      window.__QPM_PIXI_CAPTURED__.renderer = maybeRdr;
    }
  }
  
  checkExisting();
  var pollCount = 0;
  var pollInterval = setInterval(function() {
    checkExisting();
    if (++pollCount >= 100 || (window.__QPM_PIXI_CAPTURED__.app && window.__QPM_PIXI_CAPTURED__.renderer)) {
      clearInterval(pollInterval);
    }
  }, 100);
})();
`;

  try {
    const script = document.createElement('script');
    script.textContent = scriptContent;
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
    console.log('[QPM PIXI] __PIXI_APP_INIT__ fired!', { app: !!a, version: v });
    if (!a) return;
    const wasUnset = !APP;
    APP = a;
    PIXI_VER = v;
    if (wasUnset) appResolver?.(a);
    attachContextLossListener(a);
    // Update the shared captured object so gardenFilters and other features
    // can access the PIXI app via root.__QPM_PIXI_CAPTURED__.
    // On non-Discord, the inline script handles this; on Discord we must do
    // it here since the inline script is skipped due to CSP.
    try {
      const captured = root.__QPM_PIXI_CAPTURED__;
      if (captured) {
        captured.app = a;
        captured.version = v;
        if (a?.renderer) captured.renderer = a.renderer;
      }
    } catch { /* Xray wrapper edge case - ignore */ }
  });

  hook('__PIXI_RENDERER_INIT__', (r: any, v: any) => {
    console.log('[QPM PIXI] __PIXI_RENDERER_INIT__ fired!', { renderer: !!r, version: v });
    if (!r) return;
    const wasUnset = !RDR;
    RDR = r;
    PIXI_VER = v;
    if (wasUnset) rdrResolver?.(r);
    try {
      const captured = root.__QPM_PIXI_CAPTURED__;
      if (captured) {
        captured.renderer = r;
        captured.version = v;
      }
    } catch { /* ignore */ }
  });

  console.log('[QPM PIXI] Hook setup:', {
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
          console.log('[QPM PIXI] Found app via canvas.__PIXI_APP__');
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
                console.log(`[QPM PIXI] Found app via root.${key}`);
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
