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
import { GARDEN_INFO_CARD_LABEL } from './types';

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

function findNodeByLabel(root: PixiNode, label: string): PixiNode | null {
  const stack: PixiNode[] = [root];
  const seen = new WeakSet<object>();
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (seen.has(node as object)) continue;
    seen.add(node as object);
    if (!isVisible(node)) continue;
    if (typeof node.label === 'string' && node.label === label) return node;
    if (Array.isArray(node.children)) {
      for (let i = node.children.length - 1; i >= 0; i--) {
        const c = node.children[i];
        if (c) stack.push(c);
      }
    }
  }
  return null;
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
// Cache — node reference (re-walk on invalidation) plus refs
// ---------------------------------------------------------------------------

let cachedCard: PixiNode | null = null;
let cachedRefs: PixiRefs | null = null;

function isCardStillValid(): boolean {
  if (!cachedCard) return false;
  if (cachedCard.destroyed === true) return false;
  if (!isVisible(cachedCard)) return false;
  // Ensure still attached to a live parent chain — MG's controller destroys
  // parents on some transitions without touching the child's `destroyed` flag.
  let p: unknown = cachedCard.parent;
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
 * Current CSS-space bounds of `GardenInfoCardSystem` when visible, else null.
 * Cheap when the cached node is still valid — only re-walks the stage when
 * the previous card was destroyed or hidden.
 */
export function getCardBounds(): CardBounds | null {
  if (!cachedRefs) {
    cachedRefs = getRefs();
    if (!cachedRefs) return null;
  }

  if (!isCardStillValid()) {
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
  cachedRefs = null;
}
