import { readSync } from '../../core/gameState';
import { getPixiRefs } from '../../core/pixiCapture';
import { findStageLayer, getBounds, getLabel, getPixiRuntime, toCssRect } from '../../core/pixiScene';
import { isOverPixiUi, type PixiUiHitRenderer } from '../../core/pixiUiHit';
import type { GridPosition } from '../../types/gameAtoms';
import { getEngineSystem } from '../../utils/quinoaEngine';
import { isRecord } from '../../utils/typeGuards';
import { WORLD_PX_PER_TILE, type AvatarSysLike } from './follow';

export interface SpecTicker {
  add(fn: () => void, ctx: null, priority: number): unknown;
  remove(fn: () => void, ctx?: null): unknown;
  lastTime: number;
  elapsedMS: number;
  deltaMS: number;
  maxFPS: number;
}

/** The game's zoom controller (live 1448): `intent` is the real zoom, zoomIntentAtom only mirrors it (null = default). */
export interface SpecZoom {
  readonly effective: number;
  readonly intentTileSize: number;
  readonly inputBlocked: boolean;
  readonly region: { w: number; h: number };
  stepKeyboard(dir: number): void;
  applySteppedZoom(tileSize: number): void;
  setIntent(tileSize: number): void;
}
export interface SpecZoomSys { zoom: SpecZoom; shouldBlockZoom(): boolean }

/** World presses (S §4.6): the game canvas, PIXI's own client → global mapping, the HUD test and World's transform. */
export interface SpecPointerHandles {
  isCanvas(t: EventTarget | null): boolean;
  toGlobal(clientX: number, clientY: number): { x: number; y: number } | null;
  overUi(x: number, y: number): boolean;
  toGrid(x: number, y: number): GridPosition | null;
}

export interface SpecHandles {
  engine: object;
  ticker: SpecTicker;
  zoomSys: SpecZoomSys;
  /** The stage size in CSS px (autoDensity, live 1448). */
  viewSize(): { w: number; h: number };
  /** Where the 2D camera is drawn now (its smoothed point), null when that is unreadable. */
  cameraPoint(): GridPosition | null;
  /** Tells the game's idle frame-rate tracker about input it did not see; a no-op when that tracker is unreadable. */
  notifyActivity(): void;
  /** The zoom controller of the engine running now (an engine swap replaces it), null when none. */
  liveZoom(): SpecZoom | null;
  avatars: AvatarSysLike;
  pointer: SpecPointerHandles;
}

const fn = (o: Record<string, unknown>, k: string): boolean => typeof o[k] === 'function';

export function tickerOf(): SpecTicker | null {
  const app = getPixiRefs()?.app;
  const t: unknown = isRecord(app) ? app.ticker : null;
  return isRecord(t) && fn(t, 'add') && fn(t, 'remove') && typeof t.lastTime === 'number' && typeof t.deltaMS === 'number'
    ? t as unknown as SpecTicker : null;
}

export function zoomSystemOf(engine: unknown): SpecZoomSys | null {
  const sys = getEngineSystem(engine, 'zoom');
  const z = isRecord(sys) ? sys.zoom : null;
  const region = isRecord(z) ? z.region : null;
  const ok = isRecord(sys) && fn(sys, 'shouldBlockZoom') && isRecord(z) && fn(z, 'stepKeyboard') && fn(z, 'applySteppedZoom')
    && fn(z, 'setIntent') && typeof z.effective === 'number' && typeof z.intentTileSize === 'number'
    && isRecord(region) && Number.isFinite(region.w) && Number.isFinite(region.h);
  return ok ? sys as unknown as SpecZoomSys : null;
}

function cameraPointOf(engine: Record<string, unknown>): GridPosition | null {
  const page = engine.page;
  const scope = isRecord(page) ? page.rendererScope : null;
  const cs = isRecord(scope) ? scope.cameraSmoothing : null;
  if (!isRecord(cs) || !Number.isFinite(cs.goalLerpWorldX) || !Number.isFinite(cs.goalLerpWorldY)) return null;
  return { x: (cs.goalLerpWorldX as number) / WORLD_PX_PER_TILE - 0.5, y: (cs.goalLerpWorldY as number) / WORLD_PX_PER_TILE - 0.5 };
}

// Optional, as camera3d reads it (engine/zoomBridge.ts): the Automatic-FPS policy drops to its idle rate after 4 s
// without input it saw (window keydowns, canvas pointer events; live 1448).
function activityOf(engine: Record<string, unknown>): (() => void) {
  const page = engine.page;
  const scope = isRecord(page) ? page.rendererScope : null;
  const policy = isRecord(scope) ? scope.performancePolicy : null;
  if (!isRecord(policy) || !fn(policy, 'notifyActivity')) return () => {};
  return () => { try { (policy.notifyActivity as () => void).call(policy); } catch { /* the frame rate is only advisory */ } };
}

export function avatarSystemOf(engine: unknown): AvatarSysLike | null {
  const sys = getEngineSystem(engine, 'avatar');
  if (!isRecord(sys) || !(sys.views instanceof Map)) return null;
  return { views: sys.views, ...(sys.userPositions instanceof Map ? { userPositions: sys.userPositions } : {}) };
}

function childLabelled(node: unknown, label: string): unknown {
  const kids: unknown = isRecord(node) ? node.children : null;
  return Array.isArray(kids) ? (kids as unknown[]).find((c) => getLabel(c) === label) ?? null : null;
}

/** The top of the game's hotbar panel in CSS px (live 1448: UI > InventoryModal > InventoryContent, its frame; top 504 on a
 * 632 px window), null when it is not there. Read on show and after a resize, never per frame. */
export function hotbarTopCss(): number | null {
  const rt = getPixiRuntime();
  if (!rt.stage || !rt.canvas) return null;
  const panel = childLabelled(childLabelled(findStageLayer(rt.stage, 'UI'), 'InventoryModal'), 'InventoryContent');
  const b = getBounds(panel);
  return b ? toCssRect(b, rt.renderer, rt.canvas)?.top ?? null : null;
}

interface Affine { a: number; b: number; c: number; d: number; tx: number; ty: number }
const isAffine = (m: unknown): m is Affine => isRecord(m) && ['a', 'b', 'c', 'd', 'tx', 'ty'].every((k) => typeof m[k] === 'number');

type MapToPoint = (point: { x: number; y: number }, x: number, y: number) => void;
interface PointerRenderer extends PixiUiHitRenderer { events: PixiUiHitRenderer['events'] & { mapPositionToPoint: MapToPoint } }
const isPointerRenderer = (r: unknown): r is PointerRenderer => {
  const ev = isRecord(r) ? r.events : null;
  return isRecord(ev) && fn(ev, 'mapPositionToPoint') && isRecord(ev.rootBoundary) && fn(ev.rootBoundary, 'hitTest');
};

// World is rendererScope.worldContainer (live 1448: the Camera > World node, also the avatar system's worldContainer).
function pointerHandlesOf(engine: Record<string, unknown>, renderer: unknown, canvas: unknown): SpecPointerHandles | null {
  const page = engine.page;
  const scope = isRecord(page) ? page.rendererScope : null;
  const world = isRecord(scope) ? scope.worldContainer : null;
  if (!isRecord(world) || !isAffine(world.worldTransform) || !('interactiveChildren' in world)) return null;
  if (!isPointerRenderer(renderer) || !(canvas instanceof HTMLCanvasElement)) return null;
  const events = renderer.events;
  return {
    isCanvas: (t) => t === canvas,
    toGlobal(cx, cy) {
      const p = { x: 0, y: 0 };
      events.mapPositionToPoint.call(events, p, cx, cy);
      return Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null;
    },
    overUi: (x, y) => isOverPixiUi(renderer, world, x, y),
    toGrid(x, y) {
      const m = world.worldTransform as Affine;
      const det = m.a * m.d - m.b * m.c;
      if (!det) return null;
      const dx = x - m.tx, dy = y - m.ty;
      return { x: (m.d * dx - m.c * dy) / det / WORLD_PX_PER_TILE - 0.5, y: (m.a * dy - m.b * dx) / det / WORLD_PX_PER_TILE - 0.5 };
    },
  };
}

/** Everything the 2D driver touches, or the names of what is missing. */
export function resolveHandles(): SpecHandles | string[] {
  const engine = readSync('quinoaEngine');
  const ticker = tickerOf();
  const zoomSys = zoomSystemOf(engine);
  const refs = getPixiRefs();
  const renderer: unknown = refs?.renderer;
  const screen: unknown = isRecord(renderer) ? renderer.screen : null;
  const avatars = avatarSystemOf(engine);
  const pointer = isRecord(engine) ? pointerHandlesOf(engine, renderer, refs?.canvas) : null;
  const missing: string[] = [];
  if (!isRecord(engine)) missing.push('engine');
  if (!ticker) missing.push('ticker');
  if (!zoomSys) missing.push('zoom');
  if (!isRecord(screen) || typeof screen.width !== 'number' || typeof screen.height !== 'number') missing.push('screen');
  if (!avatars) missing.push('avatar-views');
  if (!pointer) missing.push('pointer');
  if (missing.length > 0 || !isRecord(engine) || !ticker || !zoomSys || !isRecord(screen) || !avatars || !pointer) return missing;
  return {
    engine, ticker, zoomSys, avatars, pointer,
    viewSize: () => ({ w: screen.width as number, h: screen.height as number }),
    cameraPoint: () => cameraPointOf(engine),
    notifyActivity: activityOf(engine),
    liveZoom: () => {
      try { return zoomSystemOf(readSync('quinoaEngine'))?.zoom ?? null; } catch { return null; }
    },
  };
}
