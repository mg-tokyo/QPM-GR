// Canonical accessor for the shared PIXI capture (__QPM_PIXI_CAPTURED__).
// The primary page-script hooks lose the race when QPM loads late in the
// userscript order; every late-resolution path must call repairPixiCapture()
// so direct consumers of the global recover. MUST NOT import from sprite-v2
// (sprite-v2 imports core — cycle); service fallback goes through window globals.

import { pageWindow, readSharedGlobal, ensurePageObject } from './pageContext';
import { createNamedLogger } from '../diagnostics/logger';
import { isRecord } from '../utils/typeGuards';
import { isDiscordSurface } from '../utils/environment';

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

let captureGeneration = 0;

/** Bumped whenever a dead app is replaced by a live one. Consumers compare it to drop stale caches. */
export function getCaptureGeneration(): number {
  return captureGeneration;
}

// Which writer last filled or replaced the capture — the field a Discord
// report needs to say whether the vendor hook ever re-fired (spec D5).
let lastSource: string | null = null;
// Structural recoveries memoised per renderer: while the app stays dead
// and only renderer.lastObjectRendered is live, this is the fast path
// (spec D3) — a stage is not an app, so the capture itself cannot be repaired.
const structuralStages = new WeakMap<object, PixiNodeLike>();

type CaptureChange = { kind: 'filled' | 'replaced'; source: string; generation: number };
const captureListeners = new Set<(e: CaptureChange) => void>();

/** Fires after repairPixiCapture fills a missing field or replaces a dead app. Never fires on reads. */
export function onPixiCaptureChange(cb: (e: CaptureChange) => void): () => void {
  captureListeners.add(cb);
  return () => { captureListeners.delete(cb); };
}

function emitCaptureChange(kind: CaptureChange['kind'], source: string): void {
  lastSource = source;
  for (const cb of captureListeners) {
    try { cb({ kind, source, generation: captureGeneration }); } catch { /* isolate listeners */ }
  }
}

function isStructuralStageLive(stage: unknown): stage is PixiNodeLike {
  return isRecord(stage) && stage.destroyed !== true && !stage.parent
    && Array.isArray(stage.children) && stage.children.length > 0;
}

/** The build's Application has no `destroyed` flag; liveness is the stage. */
function isAppStageLive(app: unknown): app is PixiAppLike {
  if (!isRecord(app)) return false;
  const stage = (app as PixiAppLike).stage;
  return isRecord(stage) && (stage as { destroyed?: unknown }).destroyed !== true;
}

function readRawCapture(): Record<string, unknown> | null {
  try {
    const raw = (pageWindow as unknown as Record<string, unknown>).__QPM_PIXI_CAPTURED__;
    return isRecord(raw) ? raw : null;
  } catch {
    return null;
  }
}

function toBundle(raw: Record<string, unknown>): PixiCaptureBundle {
  return {
    app: isRecord(raw.app) ? raw.app : null,
    renderer: isRecord(raw.renderer) ? raw.renderer : null,
    version: typeof raw.version === 'string' ? raw.version : null,
  };
}

function rendererOf(cand: Record<string, unknown>): PixiRendererLike | null {
  if (isRecord(cand.renderer)) return cand.renderer;
  const app = cand.app;
  return isRecord(app) && isRecord(app.renderer) ? app.renderer : null;
}

function readServiceState(): PixiCaptureBundle | null {
  // QPM's own resolved service/state first, then any __MG_SPRITE_SERVICE__
  // (Aries or QPM) — all published as window globals, not imports.
  const candidates: unknown[] = [];
  const qpmSvc = readSharedGlobal('__QPM_SPRITE_SERVICE__');
  if (isRecord(qpmSvc)) candidates.push(qpmSvc.state);
  candidates.push(readSharedGlobal('__MG_SPRITE_STATE__'));
  try {
    const svc = (pageWindow as unknown as Record<string, unknown>).__MG_SPRITE_SERVICE__;
    if (isRecord(svc)) candidates.push(svc.state);
  } catch {}
  // Pass 1: a live app wins. Candidate #1 normally mirrors the SAME app as
  // the capture (spec RC1 svcAppSameAsCap:true), so first-with-renderer
  // could never see a rebuilt app that a later candidate published.
  for (const cand of candidates) {
    if (!isRecord(cand) || !isAppStageLive(cand.app)) continue;
    const renderer = rendererOf(cand);
    if (renderer) return { app: cand.app, renderer, version: typeof cand.version === 'string' ? cand.version : null };
  }
  // Pass 2: anything with a renderer — structural recovery can still use it.
  for (const cand of candidates) {
    if (!isRecord(cand)) continue;
    const renderer = rendererOf(cand);
    if (!renderer) continue;
    return { app: isRecord(cand.app) ? cand.app : null, renderer, version: typeof cand.version === 'string' ? cand.version : null };
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
    // Replace a present-but-dead app with a live one (rebuild heal — the only
    // path that reaches the Discord capture, where the page script never runs).
    if (partial.app && isAppStageLive(partial.app) && partial.app !== target.app
        && isRecord(target.app) && !isAppStageLive(target.app)) {
      target.app = partial.app;
      if (partial.renderer) target.renderer = partial.renderer;
      if (typeof partial.version === 'string') target.version = partial.version;
      captureGeneration += 1;
      log.info('pixi-capture-replaced', { source, generation: captureGeneration });
      emitCaptureChange('replaced', source);
      return;
    }
    if (partial.app && !isRecord(target.app)) {
      target.app = partial.app;
      filled = true;
    }
    if (partial.renderer && !isRecord(target.renderer)) {
      target.renderer = partial.renderer;
      filled = true;
    }
    if (partial.version && typeof target.version !== 'string') {
      target.version = partial.version;
      filled = true;
    }
    if (!isRecord(target.renderer) && isRecord(target.app) && isRecord((target.app as PixiAppLike).renderer)) {
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
  if (filled) emitCaptureChange('filled', source);
}

/**
 * Read __QPM_PIXI_CAPTURED__; on miss, fall back to sprite-service state and
 * repair the global. Cheap synchronous reads only — no polling, no fiber walk.
 */
export function getPixiCapture(): PixiCaptureBundle | null {
  const raw = readRawCapture();
  if (raw && isAppStageLive(raw.app) && isRecord(raw.renderer)) {
    return toBundle(raw);
  }

  const fromService = readServiceState();
  if (fromService && isAppStageLive(fromService.app)) {
    repairPixiCapture(fromService, 'service-live');
    const healed = readRawCapture();
    if (healed && isAppStageLive(healed.app)) return toBundle(healed);
    return fromService;
  }
  if (fromService) {
    repairPixiCapture(fromService, 'service-state');
    const healed = readRawCapture();
    return healed ? toBundle(healed) : fromService;
  }

  if (raw && (isRecord(raw.app) || isRecord(raw.renderer))) {
    return toBundle(raw);
  }
  return null;
}

/** Label-free stage recovery: renderer.lastObjectRendered is the parent-less stage. Memoised per renderer. */
function recoverStageStructurally(renderer: unknown): PixiNodeLike | null {
  if (!isRecord(renderer)) return null;
  const memo = structuralStages.get(renderer);
  if (memo && isStructuralStageLive(memo)) return memo;
  const lo = renderer.lastObjectRendered;
  if (!isStructuralStageLive(lo)) return null;
  structuralStages.set(renderer, lo);
  return lo;
}

let lastStageSource: 'app' | 'structural' | null = null;

export function getPixiRefs(): PixiRefs | null {
  // Fast path while the cached app is dead: a memoised structural stage
  // skips the three global reads + repair attempt of getPixiCapture().
  const raw = readRawCapture();
  if (raw && !isAppStageLive(raw.app) && isRecord(raw.renderer)) {
    const memo = structuralStages.get(raw.renderer);
    if (memo && isStructuralStageLive(memo)) {
      lastStageSource = 'structural';
      return {
        app: isRecord(raw.app) ? raw.app : null,
        renderer: raw.renderer,
        stage: memo,
        canvas: getGameCanvas(raw.renderer),
      };
    }
  }
  const capture = getPixiCapture();
  if (!capture) { lastStageSource = null; return null; }
  const app = capture.app;
  const renderer = capture.renderer ?? (app && isRecord(app.renderer) ? app.renderer as PixiRendererLike : null);
  if (!renderer) { lastStageSource = null; return null; }
  let stage = isAppStageLive(app) ? (app.stage as PixiNodeLike) : null;
  lastStageSource = stage ? 'app' : null;
  if (!stage) {
    stage = recoverStageStructurally(renderer);
    if (stage) lastStageSource = 'structural';
  }
  return { app, renderer, stage, canvas: getGameCanvas(renderer) };
}

export interface PixiCaptureDiag {
  appPresent: boolean;
  appLive: boolean;
  stageLive: boolean;
  stageSource: 'app' | 'structural' | null;
  lastSource: string | null;
  generation: number;
  surface: 'discord' | 'web';
}

/** Pass the refs you already hold to avoid a second resolve (scanner hot path). */
export function getCaptureDiag(refs: PixiRefs | null = getPixiRefs()): PixiCaptureDiag {
  const raw = readRawCapture();
  const app = raw && isRecord(raw.app) ? raw.app : null;
  return {
    appPresent: !!app,
    appLive: isAppStageLive(app),
    stageLive: !!refs?.stage,
    stageSource: refs?.stage ? lastStageSource : null,
    lastSource,
    generation: captureGeneration,
    surface: isDiscordSurface ? 'discord' : 'web',
  };
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
  if (isRecord(rdr)) {
    if (rdr.view instanceof HTMLCanvasElement) return rdr.view;
    if (rdr.canvas instanceof HTMLCanvasElement) return rdr.canvas;
  }
  return null;
}
