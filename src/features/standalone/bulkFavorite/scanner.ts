import { pageWindow } from '../../../core/pageContext';
import {
  MIN_INVENTORY_WIDTH,
  MIN_INVENTORY_HEIGHT,
  MIN_VISIBLE_AREA,
  MIN_OPEN_ITEM_VIEW_COUNT,
} from './constants';
import type {
  InventoryAnchor,
  PixiBounds,
  PixiCaptureLike,
  PixiDisplayObject,
  PixiNodeMatch,
  PixiRendererLike,
  Rect,
} from './types';

function getPageWindow(): Window & typeof globalThis {
  return pageWindow as Window & typeof globalThis;
}

function getDisplayLabel(node: PixiDisplayObject): string {
  return typeof node.label === 'string' ? node.label : '';
}

function isNodeVisiblyRenderable(node: PixiDisplayObject): boolean {
  if (node.visible === false) return false;
  if (node.renderable === false) return false;
  if (node.worldVisible === false) return false;

  const alpha = typeof node.alpha === 'number' ? node.alpha : null;
  if (alpha !== null && alpha <= 0.001) return false;

  const worldAlpha = typeof node.worldAlpha === 'number' ? node.worldAlpha : null;
  if (worldAlpha !== null && worldAlpha <= 0.001) return false;

  return true;
}

function parsePixiBounds(value: unknown): PixiBounds | null {
  if (!value || typeof value !== 'object') return null;
  const rec = value as Record<string, unknown>;
  const x = Number(rec.x);
  const y = Number(rec.y);
  const width = Number(rec.width);
  const height = Number(rec.height);
  if (![x, y, width, height].every(Number.isFinite)) return null;
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

function getNodeBounds(node: PixiDisplayObject): PixiBounds | null {
  if (typeof node.getBounds !== 'function') return null;
  try {
    return parsePixiBounds(node.getBounds());
  } catch {
    return null;
  }
}

function findLargestNodeByLabel(
  root: PixiDisplayObject,
  matcher: (label: string) => boolean,
): PixiNodeMatch | null {
  const stack: PixiDisplayObject[] = [root];
  const seen = new WeakSet<object>();
  let best: PixiNodeMatch | null = null;
  let bestArea = 0;

  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (seen.has(node as object)) continue;
    seen.add(node as object);
    if (!isNodeVisiblyRenderable(node)) continue;

    const label = getDisplayLabel(node);
    if (label && matcher(label)) {
      const bounds = getNodeBounds(node);
      if (bounds) {
        const area = bounds.width * bounds.height;
        if (area > bestArea) {
          bestArea = area;
          best = { node, bounds, area };
        }
      }
    }

    if (Array.isArray(node.children)) {
      for (let i = node.children.length - 1; i >= 0; i -= 1) {
        const child = node.children[i];
        if (child) stack.push(child);
      }
    }
  }

  return best;
}

function boundsIntersect(a: PixiBounds, b: PixiBounds): boolean {
  const ax2 = a.x + a.width;
  const ay2 = a.y + a.height;
  const bx2 = b.x + b.width;
  const by2 = b.y + b.height;
  return a.x < bx2 && ax2 > b.x && a.y < by2 && ay2 > b.y;
}

function countVisibleInventoryItemViews(
  root: PixiDisplayObject,
  withinBounds: PixiBounds,
  limit: number,
): number {
  if (limit <= 0) return 0;

  const stack: PixiDisplayObject[] = [root];
  const seen = new WeakSet<object>();
  let count = 0;

  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (seen.has(node as object)) continue;
    seen.add(node as object);
    if (!isNodeVisiblyRenderable(node)) continue;

    const label = getDisplayLabel(node);
    if (label.startsWith('InventoryItemView(')) {
      const bounds = getNodeBounds(node);
      if (bounds && boundsIntersect(bounds, withinBounds)) {
        count += 1;
        if (count >= limit) {
          return count;
        }
      }
    }

    if (Array.isArray(node.children)) {
      for (let i = node.children.length - 1; i >= 0; i -= 1) {
        const child = node.children[i];
        if (child) stack.push(child);
      }
    }
  }

  return count;
}

function resolveRendererCanvas(renderer: PixiRendererLike): HTMLCanvasElement | null {
  const classCanvas = document.querySelector('.QuinoaCanvas canvas');
  if (classCanvas instanceof HTMLCanvasElement) return classCanvas;

  if (renderer.view instanceof HTMLCanvasElement) return renderer.view;
  if (renderer.canvas instanceof HTMLCanvasElement) return renderer.canvas;

  const anyCanvas = document.querySelector('canvas');
  return anyCanvas instanceof HTMLCanvasElement ? anyCanvas : null;
}

function toCssRect(bounds: PixiBounds, renderer: PixiRendererLike, canvas: HTMLCanvasElement): Rect | null {
  const canvasRect = canvas.getBoundingClientRect();
  if (canvasRect.width <= 0 || canvasRect.height <= 0) return null;

  const screenWidth = Number(renderer.screen?.width) || canvas.width;
  const screenHeight = Number(renderer.screen?.height) || canvas.height;
  if (screenWidth <= 0 || screenHeight <= 0) return null;

  const scaleX = canvasRect.width / screenWidth;
  const scaleY = canvasRect.height / screenHeight;
  if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) return null;

  return {
    left: canvasRect.left + bounds.x * scaleX,
    top: canvasRect.top + bounds.y * scaleY,
    width: bounds.width * scaleX,
    height: bounds.height * scaleY,
  };
}

function isRectOpenAndVisible(rect: Rect): boolean {
  if (rect.width < MIN_INVENTORY_WIDTH || rect.height < MIN_INVENTORY_HEIGHT) {
    return false;
  }

  const right = rect.left + rect.width;
  const bottom = rect.top + rect.height;
  const interWidth = Math.min(right, window.innerWidth) - Math.max(rect.left, 0);
  const interHeight = Math.min(bottom, window.innerHeight) - Math.max(rect.top, 0);

  if (interWidth <= 0 || interHeight <= 0) return false;
  if (interWidth * interHeight < MIN_VISIBLE_AREA) return false;

  return true;
}

export function resolveInventoryAnchor(): InventoryAnchor | null {
  const root = getPageWindow() as Window & typeof globalThis & { __QPM_PIXI_CAPTURED__?: PixiCaptureLike };
  const captured = root.__QPM_PIXI_CAPTURED__;
  if (!captured) return null;

  const app = captured.app;
  const renderer = captured.renderer ?? app?.renderer;
  const stage = app?.stage;
  if (!renderer || !stage) return null;

  const canvas = resolveRendererCanvas(renderer);
  if (!canvas) return null;

  // Guard against HUD/hotbar containers that may reuse inventory-like labels.
  // The actual full inventory view is wrapped by InventoryModal when open.
  const modalMatch = findLargestNodeByLabel(stage, (label) => label === 'InventoryModal');
  if (!modalMatch) return null;

  const modalRect = toCssRect(modalMatch.bounds, renderer, canvas);
  if (!modalRect) return null;
  if (modalRect.width < window.innerWidth * 0.45 || modalRect.height < window.innerHeight * 0.35) {
    return null;
  }

  const itemsMatch = findLargestNodeByLabel(modalMatch.node, (label) => label === 'InventoryItems');
  const contentMatch = findLargestNodeByLabel(modalMatch.node, (label) => label === 'InventoryContent');

  const candidates: Array<{ match: PixiNodeMatch; source: InventoryAnchor['source'] }> = [];
  if (itemsMatch) candidates.push({ match: itemsMatch, source: 'InventoryItems' });
  if (contentMatch) candidates.push({ match: contentMatch, source: 'InventoryContent' });

  for (const candidate of candidates) {
    const rect = toCssRect(candidate.match.bounds, renderer, canvas);
    if (!rect || !isRectOpenAndVisible(rect)) continue;

    const viewCount = countVisibleInventoryItemViews(
      candidate.match.node,
      candidate.match.bounds,
      MIN_OPEN_ITEM_VIEW_COUNT,
    );
    if (viewCount >= MIN_OPEN_ITEM_VIEW_COUNT) {
      return { rect, source: candidate.source };
    }
  }

  return null;
}
