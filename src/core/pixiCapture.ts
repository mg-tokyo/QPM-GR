// Canonical accessor for the shared PIXI capture (__QPM_PIXI_CAPTURED__).
// The primary page-script hooks lose the race when QPM loads late in the
// userscript order; every late-resolution path must call repairPixiCapture()
// so direct consumers of the global recover. MUST NOT import from sprite-v2
// (sprite-v2 imports core — cycle); service fallback goes through window globals.

import { pageWindow, readSharedGlobal, ensurePageObject } from './pageContext';
import { createNamedLogger } from '../diagnostics/logger';

export type PixiAppLike = Record<string, unknown>;
export type PixiRendererLike = Record<string, unknown>;
export type PixiNodeLike = Record<string, unknown>;

export interface PixiCaptureBundle {
  app: PixiAppLike | null;
  renderer: PixiRendererLike | null;
  version: string | null;
}

export interface PixiRefs {
  app: PixiAppLike | null;
  renderer: PixiRendererLike;
  stage: PixiNodeLike | null;
  canvas: HTMLCanvasElement | null;
}

const log = createNamedLogger('pixiCapture');
const repairedSources = new Set<string>();

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function readRawCapture(): Record<string, unknown> | null {
  try {
    const raw = (pageWindow as unknown as Record<string, unknown>).__QPM_PIXI_CAPTURED__;
    return isObject(raw) ? raw : null;
  } catch {
    return null;
  }
}

function toBundle(raw: Record<string, unknown>): PixiCaptureBundle {
  return {
    app: isObject(raw.app) ? raw.app : null,
    renderer: isObject(raw.renderer) ? raw.renderer : null,
    version: typeof raw.version === 'string' ? raw.version : null,
  };
}

function readServiceState(): PixiCaptureBundle | null {
  // QPM's own resolved service/state first, then any __MG_SPRITE_SERVICE__
  // (Aries or QPM) — all published as window globals, not imports.
  const candidates: unknown[] = [];
  const qpmSvc = readSharedGlobal('__QPM_SPRITE_SERVICE__');
  if (isObject(qpmSvc)) candidates.push(qpmSvc.state);
  candidates.push(readSharedGlobal('__MG_SPRITE_STATE__'));
  try {
    const svc = (pageWindow as unknown as Record<string, unknown>).__MG_SPRITE_SERVICE__;
    if (isObject(svc)) candidates.push(svc.state);
  } catch {}
  for (const cand of candidates) {
    if (!isObject(cand)) continue;
    const app = isObject(cand.app) ? cand.app : null;
    const renderer = isObject(cand.renderer)
      ? cand.renderer
      : app && isObject(app.renderer) ? app.renderer as PixiRendererLike : null;
    if (!renderer) continue;
    return {
      app,
      renderer,
      version: typeof cand.version === 'string' ? cand.version : null,
    };
  }
  return null;
}

/**
 * Fill missing fields of pageWindow.__QPM_PIXI_CAPTURED__, creating it if
 * absent. Idempotent, fill-only — never nulls out existing non-null fields.
 */
export function repairPixiCapture(partial: Partial<PixiCaptureBundle>, source: string): void {
  const target = ensurePageObject('__QPM_PIXI_CAPTURED__');
  if (!target) return;
  let filled = false;
  try {
    if (partial.app && !isObject(target.app)) {
      target.app = partial.app;
      filled = true;
    }
    if (partial.renderer && !isObject(target.renderer)) {
      target.renderer = partial.renderer;
      filled = true;
    }
    if (partial.version && typeof target.version !== 'string') {
      target.version = partial.version;
      filled = true;
    }
    if (!isObject(target.renderer) && isObject(target.app) && isObject((target.app as PixiAppLike).renderer)) {
      target.renderer = (target.app as PixiAppLike).renderer;
      filled = true;
    }
  } catch {
    return;
  }
  if (filled && !repairedSources.has(source)) {
    repairedSources.add(source);
    log.info('pixi-capture-repaired', { source });
  }
}

/**
 * Read __QPM_PIXI_CAPTURED__; on miss, fall back to sprite-service state and
 * repair the global. Cheap synchronous reads only — no polling, no fiber walk.
 */
export function getPixiCapture(): PixiCaptureBundle | null {
  const raw = readRawCapture();
  if (raw && isObject(raw.app) && isObject(raw.renderer)) {
    return toBundle(raw);
  }

  const fromService = readServiceState();
  if (fromService) {
    repairPixiCapture(fromService, 'service-state');
    const healed = readRawCapture();
    return healed ? toBundle(healed) : fromService;
  }

  if (raw && (isObject(raw.app) || isObject(raw.renderer))) {
    return toBundle(raw);
  }
  return null;
}

/** Derived accessor most consumers want; null when no renderer is resolvable. */
export function getPixiRefs(): PixiRefs | null {
  const capture = getPixiCapture();
  if (!capture) return null;
  const app = capture.app;
  const renderer = capture.renderer
    ?? (app && isObject(app.renderer) ? app.renderer as PixiRendererLike : null);
  if (!renderer) return null;
  const stage = app && isObject(app.stage) ? app.stage as PixiNodeLike : null;
  return { app, renderer, stage, canvas: getGameCanvas(renderer) };
}

/**
 * Resolve the game canvas: '.QuinoaCanvas canvas' → renderer.view →
 * renderer.canvas → null. Deliberately NO blind querySelector('canvas') —
 * another mod's canvas yields wrong rects.
 */
export function getGameCanvas(renderer?: unknown): HTMLCanvasElement | null {
  const preferred = document.querySelector('.QuinoaCanvas canvas');
  if (preferred instanceof HTMLCanvasElement) return preferred;

  const rdr = renderer ?? getPixiCapture()?.renderer ?? null;
  if (isObject(rdr)) {
    if (rdr.view instanceof HTMLCanvasElement) return rdr.view;
    if (rdr.canvas instanceof HTMLCanvasElement) return rdr.canvas;
  }
  return null;
}
