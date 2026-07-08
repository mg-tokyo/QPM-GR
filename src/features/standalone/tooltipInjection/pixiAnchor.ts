// src/features/standalone/tooltipInjection/pixiAnchor.ts
// Locates and tracks the PIXI `GardenInfoCardSystem` container that MG
// renders at the bottom of the canvas when a tile is focused.
// Provides screen-space CSS bounds each frame so the QPM overlay can
// position itself flush against the card.
//
// Pattern mirrors src/ui/economy/inventoryCapacityOverlay.ts — same PIXI
// helpers, but tracks a dynamically-appearing card (not a fixed toolbar
// button) so we cache the node reference and re-walk only when it dies.

import { pageWindow } from '../../../core/pageContext';
import { onPixiNodeAdded, onPixiNodeRemoved } from '../../../core/pixiSceneEvents';
import { GARDEN_INFO_CARD_LABEL, PIXI_TOOLTIP_LABEL, OBJECT_CARD_LABEL } from './types';

// ---------------------------------------------------------------------------
// PIXI shapes (structural — avoids depending on pixi.js types)
// ---------------------------------------------------------------------------

interface PixiNode {
  label?: unknown;
  children?: PixiNode[];
  getBounds?: () => unknown;
  visible?: unknown;
  renderable?: unknown;
  worldVisible?: unknown;
  alpha?: unknown;
  worldAlpha?: unknown;
  destroyed?: unknown;
  parent?: unknown;
}

interface PixiRenderer {
  screen?: { width?: number; height?: number };
  view?: unknown;
  canvas?: unknown;
}

interface PixiCapture {
  app?: { stage?: PixiNode; renderer?: PixiRenderer };
  renderer?: PixiRenderer;
}

interface PixiBounds { x: number; y: number; width: number; height: number }

export interface CardBounds {
  /** CSS viewport left of the card */
  left: number;
  /** CSS viewport top of the card */
  top: number;
  /** CSS width */
  width: number;
  /** CSS height */
  height: number;
}

// ---------------------------------------------------------------------------
// PIXI helpers
// ---------------------------------------------------------------------------

function isVisible(node: PixiNode): boolean {
  if (node.visible === false || node.renderable === false || node.worldVisible === false) return false;
  if (typeof node.alpha === 'number' && node.alpha <= 0.001) return false;
  if (typeof node.worldAlpha === 'number' && node.worldAlpha <= 0.001) return false;
  return true;
}

function parseBounds(value: unknown): PixiBounds | null {
  if (!value || typeof value !== 'object') return null;
  const r = value as Record<string, unknown>;
  const x = Number(r.x); const y = Number(r.y);
  const w = Number(r.width); const h = Number(r.height);
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;
  return { x, y, width: w, height: h };
}

function nodeBounds(node: PixiNode): PixiBounds | null {
  if (typeof node.getBounds !== 'function') return null;
  try { return parseBounds(node.getBounds()); } catch { return null; }
}

// Reusable stack across walks — avoids per-frame allocation on the hot path.
// Not shared between findNodeByLabel and findAllNodesByLabel to keep the
// invariants (both fully drain before returning) simple.
const _findStack: PixiNode[] = [];
const _findAllStack: PixiNode[] = [];

function findNodeByLabel(root: PixiNode, label: string): PixiNode | null {
  const stack = _findStack;
  stack.length = 0;
  stack.push(root);
  const seen = new WeakSet<object>();
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (seen.has(node as object)) continue;
    seen.add(node as object);
    if (!isVisible(node)) continue;
    if (typeof node.label === 'string' && node.label === label) {
      stack.length = 0;
      return node;
    }
    if (Array.isArray(node.children)) {
      for (let i = node.children.length - 1; i >= 0; i--) {
        const c = node.children[i];
        if (c) stack.push(c);
      }
    }
  }
  return null;
}

/** Collect ALL visible nodes with the given label (unlike findNodeByLabel which returns the first). */
function findAllNodesByLabel(root: PixiNode, label: string): PixiNode[] {
  const stack = _findAllStack;
  stack.length = 0;
  stack.push(root);
  const seen = new WeakSet<object>();
  const out: PixiNode[] = [];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (seen.has(node as object)) continue;
    seen.add(node as object);
    if (!isVisible(node)) continue;
    if (typeof node.label === 'string' && node.label === label) out.push(node);
    if (Array.isArray(node.children)) {
      for (let i = node.children.length - 1; i >= 0; i--) {
        const c = node.children[i];
        if (c) stack.push(c);
      }
    }
  }
  return out;
}

function resolveCanvas(renderer: PixiRenderer): HTMLCanvasElement | null {
  const cls = document.querySelector('.QuinoaCanvas canvas');
  if (cls instanceof HTMLCanvasElement) return cls;
  if (renderer.view instanceof HTMLCanvasElement) return renderer.view;
  if (renderer.canvas instanceof HTMLCanvasElement) return renderer.canvas;
  const any = document.querySelector('canvas');
  return any instanceof HTMLCanvasElement ? any : null;
}

interface PixiRefs {
  renderer: PixiRenderer;
  stage: PixiNode;
  canvas: HTMLCanvasElement;
}

function getRefs(): PixiRefs | null {
  const root = pageWindow as Window & typeof globalThis & { __QPM_PIXI_CAPTURED__?: PixiCapture };
  const captured = root.__QPM_PIXI_CAPTURED__;
  if (!captured) return null;
  const app = captured.app;
  const renderer = captured.renderer ?? app?.renderer;
  const stage = app?.stage;
  if (!renderer || !stage) return null;
  const canvas = resolveCanvas(renderer);
  if (!canvas) return null;
  return { renderer, stage, canvas };
}

// ---------------------------------------------------------------------------
// Cache — node references maintained by PIXI scene-graph events (addChild /
// removeChild). Zero per-frame or per-invalidation stage walks; the cache
// updates the moment MG adds or removes the labeled container. `parent`
// chain + `destroyed` flag are still checked at read time as a safety net.
// ---------------------------------------------------------------------------

let cachedCard: PixiNode | null = null;
let cachedObjectCard: PixiNode | null = null;
let cachedRefs: PixiRefs | null = null;
let listenersInstalled = false;

function ensureSceneListeners(): void {
  if (listenersInstalled) return;
  onPixiNodeAdded(GARDEN_INFO_CARD_LABEL, (node) => { cachedCard = node; });
  onPixiNodeRemoved(GARDEN_INFO_CARD_LABEL, (node) => {
    if (cachedCard === node) cachedCard = null;
  });
  onPixiNodeAdded(OBJECT_CARD_LABEL, (node) => { cachedObjectCard = node; });
  onPixiNodeRemoved(OBJECT_CARD_LABEL, (node) => {
    if (cachedObjectCard === node) cachedObjectCard = null;
  });
  listenersInstalled = true;
}

function isNodeStillLive(node: PixiNode | null): boolean {
  if (!node) return false;
  if (node.destroyed === true) return false;
  if (!isVisible(node)) return false;
  let p: unknown = node.parent;
  let hops = 0;
  while (p && typeof p === 'object' && hops < 20) {
    if ((p as PixiNode).destroyed === true) return false;
    p = (p as PixiNode).parent;
    hops++;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Current CSS-space bounds MG's tile info panel occupies, extended upward
 * to include any visible `PixiTooltip` that horizontally overlaps the panel
 * (the expanded ability tooltip). Overlay stacks above this combined region,
 * so it never covers the ability chip in the default state and never covers
 * the expanded tooltip when it opens. Returns null when the panel is hidden.
 *
 * Cheap when the cached card node is still valid — the stage walk for the
 * card only runs when the previous card was destroyed or hidden. Tooltip
 * lookup does a stage scan every frame because tooltip nodes come and go
 * unpredictably (any PIXI hover can spawn one) and there is no reliable
 * "current tooltip" cache we can invalidate cheaply.
 */
export function getCardBounds(): CardBounds | null {
  if (!cachedRefs) {
    cachedRefs = getRefs();
    if (!cachedRefs) return null;
  }
  ensureSceneListeners();

  // Event-cache miss (listeners registered too late for an existing node,
  // or the game re-labels an already-attached container) — do a single
  // catch-up walk. Steady-state operation hits the cached reference.
  if (!isNodeStillLive(cachedCard)) {
    cachedCard = findNodeByLabel(cachedRefs.stage, GARDEN_INFO_CARD_LABEL);
    if (!cachedCard) return null;
  }

  const card = cachedCard;
  if (!card) return null;

  const b = nodeBounds(card);
  if (!b) return null;

  const cr = cachedRefs.canvas.getBoundingClientRect();
  if (cr.width <= 0 || cr.height <= 0) return null;
  const sw = Number(cachedRefs.renderer.screen?.width) || cachedRefs.canvas.width || 750;
  const sh = Number(cachedRefs.renderer.screen?.height) || cachedRefs.canvas.height || 1304;
  if (sw <= 0 || sh <= 0) return null;
  const scaleX = cr.width / sw;
  const scaleY = cr.height / sh;

  const cardLeft = cr.left + b.x * scaleX;
  const cardTop = cr.top + b.y * scaleY;
  const cardWidth = b.width * scaleX;
  const cardHeight = b.height * scaleY;
  const cardRight = cardLeft + cardWidth;

  // Extend `top` upward if a visible TooltipPopup sits above the card and
  // horizontally overlaps its column — that's MG's expanded ability tooltip.
  // Sanity-guarded: skip tooltips with zero-area bounds, those that don't
  // land inside the canvas, and cap distance so a rogue node can never push
  // the overlay off-screen.
  let effectiveTop = cardTop;
  const canvasTop = cr.top;
  const canvasBottom = cr.top + cr.height;
  const canvasLeft = cr.left;
  const canvasRight = cr.left + cr.width;
  const tooltips = findAllNodesByLabel(cachedRefs.stage, PIXI_TOOLTIP_LABEL);
  for (const tt of tooltips) {
    const tb = nodeBounds(tt);
    if (!tb || tb.width <= 0 || tb.height <= 0) continue;
    const ttLeft = cr.left + tb.x * scaleX;
    const ttTop = cr.top + tb.y * scaleY;
    const ttWidth = tb.width * scaleX;
    const ttHeight = tb.height * scaleY;
    const ttRight = ttLeft + ttWidth;
    const ttBottom = ttTop + ttHeight;
    // Must be inside the canvas viewport (rules out phantom off-screen nodes).
    if (ttRight < canvasLeft || ttLeft > canvasRight) continue;
    if (ttBottom < canvasTop || ttTop > canvasBottom) continue;
    // Tooltip's TOP must sit above the card's top. The expanded ability
    // tooltip has a downward pointer tail that extends into the card's Y
    // range, so we cannot require the bottom edge to clear the card — that
    // was the old bug (tooltip found, but skipped as "not above the card").
    if (ttTop >= cardTop) continue;
    // Horizontal overlap with the card's column.
    const overlapX = Math.min(cardRight, ttRight) - Math.max(cardLeft, ttLeft);
    if (overlapX <= 0) continue;
    if (ttTop < effectiveTop) effectiveTop = ttTop;
  }
  // Never push the anchor above the canvas top — guards against runaway math.
  if (effectiveTop < canvasTop) effectiveTop = canvasTop;

  return {
    left: cardLeft,
    top: effectiveTop,
    width: cardWidth,
    height: cardHeight + (cardTop - effectiveTop),
  };
}

/**
 * CSS bounds of the inner `GardenInfoObjectCard` node — the actual tile
 * info card (not the whole system that also contains toggles + ability
 * chip + browse buttons). Distinct from `getCardBounds()`. Returns null
 * when the card is hidden. Cheap when the cached node is still valid.
 */
export function getObjectCardBounds(): CardBounds | null {
  if (!cachedRefs) {
    cachedRefs = getRefs();
    if (!cachedRefs) return null;
  }
  ensureSceneListeners();

  // Event-cache miss safety net — same rationale as getCardBounds().
  if (!isNodeStillLive(cachedObjectCard)) {
    cachedObjectCard = findNodeByLabel(cachedRefs.stage, OBJECT_CARD_LABEL);
    if (!cachedObjectCard) return null;
  }

  const node = cachedObjectCard;
  if (!node) return null;

  const b = nodeBounds(node);
  if (!b) return null;

  const cr = cachedRefs.canvas.getBoundingClientRect();
  if (cr.width <= 0 || cr.height <= 0) return null;
  const sw = Number(cachedRefs.renderer.screen?.width) || cachedRefs.canvas.width || 750;
  const sh = Number(cachedRefs.renderer.screen?.height) || cachedRefs.canvas.height || 1304;
  if (sw <= 0 || sh <= 0) return null;
  const scaleX = cr.width / sw;
  const scaleY = cr.height / sh;

  return {
    left: cr.left + b.x * scaleX,
    top: cr.top + b.y * scaleY,
    width: b.width * scaleX,
    height: b.height * scaleY,
  };
}

/** Drop cached node + refs — call on canvas resize or subsystem stop. */
export function resetAnchor(): void {
  cachedCard = null;
  cachedObjectCard = null;
  cachedRefs = null;
}

// ---------------------------------------------------------------------------
// Debug bridge — inspect what the anchor sees from the console.
// Call as: window.__QPM_TOOLTIP_ANCHOR_DEBUG__()
// ---------------------------------------------------------------------------

interface AnchorDebugNode {
  label: string;
  visible: boolean;
  worldVisible: unknown;
  hasBounds: boolean;
  bounds: PixiBounds | null;
  destroyed: unknown;
}

interface AnchorDebugReport {
  cardLabel: string;
  tooltipLabel: string;
  refsFound: boolean;
  pixiCaptured: boolean;
  cachedCardStillValid: boolean;
  computedBounds: CardBounds | null;
  gardenInfoAllMatches: AnchorDebugNode[];
  pixiTooltipAllMatches: AnchorDebugNode[];
  /** Any node whose label contains 'GardenInfo' — helps spot renames. */
  gardenInfoLike: AnchorDebugNode[];
}

function collectAllLabeledNodes(root: PixiNode): PixiNode[] {
  const stack: PixiNode[] = [root];
  const seen = new WeakSet<object>();
  const out: PixiNode[] = [];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (seen.has(node as object)) continue;
    seen.add(node as object);
    if (typeof node.label === 'string' && node.label.length > 0) out.push(node);
    if (Array.isArray(node.children)) {
      for (const c of node.children) if (c) stack.push(c);
    }
  }
  return out;
}

function summarizeNode(n: PixiNode): AnchorDebugNode {
  return {
    label: typeof n.label === 'string' ? n.label : '',
    visible: isVisible(n),
    worldVisible: n.worldVisible,
    hasBounds: typeof n.getBounds === 'function',
    bounds: nodeBounds(n),
    destroyed: n.destroyed,
  };
}

function debugReport(): AnchorDebugReport {
  const root = pageWindow as Window & typeof globalThis & { __QPM_PIXI_CAPTURED__?: PixiCapture };
  const pixiCaptured = !!root.__QPM_PIXI_CAPTURED__;
  const refs = getRefs();
  const refsFound = !!refs;
  const cachedValid = isNodeStillLive(cachedCard);
  const bounds = getCardBounds();

  let gardenInfoAll: AnchorDebugNode[] = [];
  let tooltipAll: AnchorDebugNode[] = [];
  let gardenInfoLike: AnchorDebugNode[] = [];
  if (refs) {
    gardenInfoAll = findAllNodesByLabel(refs.stage, GARDEN_INFO_CARD_LABEL).map(summarizeNode);
    tooltipAll = findAllNodesByLabel(refs.stage, PIXI_TOOLTIP_LABEL).map(summarizeNode);
    const all = collectAllLabeledNodes(refs.stage);
    gardenInfoLike = all
      .filter((n) => typeof n.label === 'string' && /GardenInfo/.test(n.label))
      .map(summarizeNode);
  }

  return {
    cardLabel: GARDEN_INFO_CARD_LABEL,
    tooltipLabel: PIXI_TOOLTIP_LABEL,
    refsFound,
    pixiCaptured,
    cachedCardStillValid: cachedValid,
    computedBounds: bounds,
    gardenInfoAllMatches: gardenInfoAll,
    pixiTooltipAllMatches: tooltipAll,
    gardenInfoLike,
  };
}

/** Attach the debug bridge to pageWindow so it's callable from the console. */
export function installAnchorDebugBridge(): void {
  const w = pageWindow as Window & { __QPM_TOOLTIP_ANCHOR_DEBUG__?: () => AnchorDebugReport };
  w.__QPM_TOOLTIP_ANCHOR_DEBUG__ = debugReport;
}

export function uninstallAnchorDebugBridge(): void {
  const w = pageWindow as Window & { __QPM_TOOLTIP_ANCHOR_DEBUG__?: unknown };
  delete w.__QPM_TOOLTIP_ANCHOR_DEBUG__;
}
