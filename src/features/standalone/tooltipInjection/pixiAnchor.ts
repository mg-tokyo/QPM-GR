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
import { getPixiRefs } from '../../../core/pixiCapture';
import { onPixiNodeAdded, onPixiNodeRemoved } from '../../../core/pixiSceneEvents';
import { GARDEN_INFO_CARD_LABEL, PIXI_TOOLTIP_LABEL, OBJECT_CARD_LABEL, STAGE_UI_ROOT_LABEL, STAGE_UI_LAYER_LABEL } from './types';

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

// Canvas-px tolerance for the tooltip-adjacency check in getCardBounds().
// The expanded ability tooltip's tail reaches INTO the card's Y range, so
// its bottom always lands at/below the system top; 24px absorbs layout
// drift without letting far-away tooltips qualify.
const TOOLTIP_ADJACENCY_PX = 24;

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

// Per-tick walk cost is the thing that regressed (spec F1); keep it countable.
const walkStats = { lastVisited: 0, maxVisited: 0, walks: 0, fullScans: 0, rootMissing: null as string | null };

function noteWalk(visited: number): void {
  walkStats.walks += 1;
  walkStats.lastVisited = visited;
  if (visited > walkStats.maxVisited) walkStats.maxVisited = visited;
}

export function getAnchorWalkStats(): Readonly<typeof walkStats> {
  return { ...walkStats };
}

// Reusable stack across walks — avoids per-frame allocation on the hot path.
// Not shared between findNodeByLabel and findAllNodesByLabel to keep the
// invariants (both fully drain before returning) simple.
const _findStack: PixiNode[] = [];
const _findAllStack: PixiNode[] = [];

function findNodeByLabel(root: PixiNode, label: string, includeHidden = false): PixiNode | null {
  const stack = _findStack;
  stack.length = 0;
  stack.push(root);
  const seen = new WeakSet<object>();
  let visited = 0;
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (seen.has(node as object)) continue;
    seen.add(node as object);
    visited += 1;
    if (node.destroyed === true) continue;
    if (!includeHidden && !isVisible(node)) continue;
    if (typeof node.label === 'string' && node.label === label) {
      stack.length = 0;
      noteWalk(visited);
      return node;
    }
    if (Array.isArray(node.children)) {
      for (let i = node.children.length - 1; i >= 0; i--) {
        const c = node.children[i];
        if (c) stack.push(c);
      }
    }
  }
  noteWalk(visited);
  return null;
}

/** Collect ALL visible nodes with the given label (unlike findNodeByLabel which returns the first). */
function findAllNodesByLabel(root: PixiNode, label: string): PixiNode[] {
  const stack = _findAllStack;
  stack.length = 0;
  stack.push(root);
  const seen = new WeakSet<object>();
  const out: PixiNode[] = [];
  let visited = 0;
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (seen.has(node as object)) continue;
    seen.add(node as object);
    visited += 1;
    if (!isVisible(node)) continue;
    if (typeof node.label === 'string' && node.label === label) out.push(node);
    if (Array.isArray(node.children)) {
      for (let i = node.children.length - 1; i >= 0; i--) {
        const c = node.children[i];
        if (c) stack.push(c);
      }
    }
  }
  noteWalk(visited);
  return out;
}

interface PixiRefs {
  renderer: PixiRenderer;
  stage: PixiNode;
  canvas: HTMLCanvasElement;
}

function getRefs(): PixiRefs | null {
  const shared = getPixiRefs();
  if (!shared?.stage || !shared.canvas) return null;
  return {
    renderer: shared.renderer as PixiRenderer,
    stage: shared.stage as PixiNode,
    canvas: shared.canvas,
  };
}

// Scoped roots (spec D1/D2). Re-validated by parent identity every call so a
// rebuilt stage child is picked up without a walk.
let cachedUiRoot: PixiNode | null = null;
let cachedUiLayer: PixiNode | null = null;
let lastFullScanAt = 0;
const lastCardMissAt = new Map<string, number>();
const FULL_SCAN_THROTTLE_MS = 2000;
// A detached card (spectator mode, pre-load) is rediscovered on the UI layer
// at most this often — the observer can tick every rAF while bounds are null.
// The scene add/remove events cache a card the moment it mounts, so this walk
// only covers the cold start; it costs ~6 ms per 600 nodes under Firefox Xray.
const CARD_MISS_THROTTLE_MS = 2000;
const NO_TOOLTIPS: readonly PixiNode[] = [];
type ScopedRootName = 'stageUiRoot' | 'uiLayer';
const missingRoots = new Set<ScopedRootName>();

function directChild(stage: PixiNode, label: string): PixiNode | null {
  const kids = stage.children;
  if (!Array.isArray(kids)) return null;
  for (let i = 0; i < kids.length; i++) {
    const c = kids[i];
    if (c && typeof c === 'object' && typeof c.label === 'string' && c.label === label) return c;
  }
  return null;
}

function noteRootMissing(what: ScopedRootName, missing: boolean): void {
  if (missing) missingRoots.add(what); else missingRoots.delete(what);
  walkStats.rootMissing = missingRoots.size === 0 ? null : Array.from(missingRoots).join('+');
}

function scopedRoot(stage: PixiNode, cached: PixiNode | null, label: string, what: ScopedRootName): PixiNode | null {
  const root = cached && cached.parent === stage && cached.destroyed !== true ? cached : directChild(stage, label);
  noteRootMissing(what, root === null);
  return root;
}

// A label rename must never re-create the per-frame stage walk: the full
// stage is scanned at most every 2 s and the miss is recorded for P2's row.
function fallbackRoot(stage: PixiNode): PixiNode | null {
  const now = performance.now();
  if (now - lastFullScanAt < FULL_SCAN_THROTTLE_MS) return null;
  lastFullScanAt = now;
  walkStats.fullScans += 1;
  return stage;
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

function isNodeAttached(node: PixiNode | null): boolean {
  if (!node || node.destroyed === true) return false;
  let p: unknown = node.parent;
  if (!p) return false;
  let hops = 0;
  while (p && typeof p === 'object' && hops < 20) {
    if ((p as PixiNode).destroyed === true) return false;
    p = (p as PixiNode).parent;
    hops++;
  }
  return true;
}

// Prefer a visible match (the live card); accept a hidden one so a mounted
// but deselected card is cached and never re-walked until it is destroyed.
function discoverCard(stage: PixiNode, label: string): PixiNode | null {
  const now = performance.now();
  if (now - (lastCardMissAt.get(label) ?? 0) < CARD_MISS_THROTTLE_MS) return null;
  cachedUiLayer = scopedRoot(stage, cachedUiLayer, STAGE_UI_LAYER_LABEL, 'uiLayer');
  const root = cachedUiLayer ?? fallbackRoot(stage);
  if (!root) return null;
  const found = findNodeByLabel(root, label) ?? findNodeByLabel(root, label, true);
  if (!found) lastCardMissAt.set(label, now);
  return found;
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
 * Per-frame cost is the StageUiRoot subtree (open tooltips are reparented
 * there) — tens of nodes; the card itself is cached and only rediscovered on
 * the UI layer when it was destroyed or detached.
 */
export function getCardBounds(): CardBounds | null {
  if (!cachedRefs) {
    cachedRefs = getRefs();
    if (!cachedRefs) return null;
  }
  ensureSceneListeners();

  const stage = cachedRefs.stage;
  if (!isNodeAttached(cachedCard)) {
    cachedCard = discoverCard(stage, GARDEN_INFO_CARD_LABEL);
    if (!cachedCard) return null;
  }
  const card = cachedCard;
  if (!card) return null;
  // Mounted but hidden (no tile selected): keep the cache, walk nothing.
  if (!isVisible(card)) return null;

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
  cachedUiRoot = scopedRoot(stage, cachedUiRoot, STAGE_UI_ROOT_LABEL, 'stageUiRoot');
  const tooltipRoot = cachedUiRoot ?? fallbackRoot(stage);
  const tooltips = tooltipRoot ? findAllNodesByLabel(tooltipRoot, PIXI_TOOLTIP_LABEL) : NO_TOOLTIPS;
  for (const tt of tooltips) {
    const tb = nodeBounds(tt);
    if (!tb || tb.width <= 0 || tb.height <= 0) continue;
    // Adjacency (canvas space): every open popup shares the 'TooltipPopup'
    // label AND is reparented into the stageUiRoot portal (PixiTooltip.show),
    // so nav-button / side-rail hover tooltips are indistinguishable by
    // subtree. Only a tooltip whose bottom reaches the card system's top
    // can be the expanded ability tooltip — skip everything else.
    if (tb.y + tb.height < b.y - TOOLTIP_ADJACENCY_PX) continue;
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

  if (!isNodeAttached(cachedObjectCard)) {
    cachedObjectCard = discoverCard(cachedRefs.stage, OBJECT_CARD_LABEL);
    if (!cachedObjectCard) return null;
  }

  const node = cachedObjectCard;
  if (!node) return null;
  if (!isVisible(node)) return null;

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
  cachedUiRoot = null;
  cachedUiLayer = null;
  cachedRefs = null;
  lastCardMissAt.clear();
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
  walkStats: Readonly<typeof walkStats>;
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
  const cachedValid = isNodeAttached(cachedCard);
  const bounds = getCardBounds();

  let gardenInfoAll: AnchorDebugNode[] = [];
  let tooltipAll: AnchorDebugNode[] = [];
  let gardenInfoLike: AnchorDebugNode[] = [];
  // Snapshot after getCardBounds() (a real runtime walk that stays counted)
  // and restore around the diagnostic walks below so this debug call cannot
  // inflate P2's `Perf:` row.
  const saved = getAnchorWalkStats();
  if (refs) {
    gardenInfoAll = findAllNodesByLabel(refs.stage, GARDEN_INFO_CARD_LABEL).map(summarizeNode);
    tooltipAll = findAllNodesByLabel(refs.stage, PIXI_TOOLTIP_LABEL).map(summarizeNode);
    const all = collectAllLabeledNodes(refs.stage);
    gardenInfoLike = all
      .filter((n) => typeof n.label === 'string' && /GardenInfo/.test(n.label))
      .map(summarizeNode);
  }
  Object.assign(walkStats, saved);

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
    walkStats: saved,
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
