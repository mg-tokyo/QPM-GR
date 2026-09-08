import { getPixiRefs } from '../../../core/pixiCapture';
import { STAGE_UI_LAYER_LABEL } from '../tooltipInjection/types';
import {
  MIN_INVENTORY_WIDTH,
  MIN_INVENTORY_HEIGHT,
  MIN_VISIBLE_AREA,
  MIN_OPEN_ITEM_VIEW_COUNT,
} from './constants';
import type {
  AnchorMissDetail,
  AnchorMissReason,
  AnchorResolveOptions,
  AnchorResolveResult,
  InventoryAnchor,
  PixiBounds,
  PixiDisplayObject,
  PixiNodeMatch,
  PixiRendererLike,
  Rect,
} from './types';

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

// InventoryModal lives under the direct stage child 'UI'; the world under
// 'Camera' is 4–10× larger and this scan runs on every DOM-mutation debounce.
// The stage itself is only the fallback for a renamed layer.
function inventoryScanRoot(stage: PixiDisplayObject): PixiDisplayObject {
  const kids = stage.children;
  if (Array.isArray(kids)) {
    for (const child of kids) {
      if (child && typeof child === 'object' && child.label === STAGE_UI_LAYER_LABEL) return child;
    }
  }
  return stage;
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

function isRectOpenAndVisible(rect: Rect, relaxed: boolean): boolean {
  if (rect.width < MIN_INVENTORY_WIDTH) return false;
  // A confirmed-open inventory with ≤2 rows is shorter than the strict floor.
  if (!relaxed && rect.height < MIN_INVENTORY_HEIGHT) return false;

  const right = rect.left + rect.width;
  const bottom = rect.top + rect.height;
  const interWidth = Math.min(right, window.innerWidth) - Math.max(rect.left, 0);
  const interHeight = Math.min(bottom, window.innerHeight) - Math.max(rect.top, 0);

  if (interWidth <= 0 || interHeight <= 0) return false;
  if (interWidth * interHeight < MIN_VISIBLE_AREA) return false;

  return true;
}

// The InventoryModal container exists in BOTH the docked (passive) bar and the
// expanded modal; the game's activeModal atom is the authoritative open signal.
// The viewport-ratio and item-count gates below only exist to tell those two
// states apart when the atom is unavailable — with confirmedOpen they are
// skipped, because the modal is capped at 9 items/row (~734px) and fails a
// 45%-of-viewport test on any window wider than ~1630px.
function rectSummary(rect: Rect | null): string | null {
  if (!rect) return null;
  return `${Math.round(rect.left)},${Math.round(rect.top)} ${Math.round(rect.width)}x${Math.round(rect.height)}`;
}

export function resolveInventoryAnchor(opts?: AnchorResolveOptions): AnchorResolveResult {
  const confirmedOpen = opts?.confirmedOpen === true;
  const detail: AnchorMissDetail = {
    confirmedOpen,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
  };
  const miss = (reason: AnchorMissReason): AnchorResolveResult => ({ anchor: null, miss: reason, detail });

  const refs = getPixiRefs();
  detail.capture = refs ? { app: !!refs.app, renderer: !!refs.renderer, stage: !!refs.stage } : null;
  if (!refs?.stage) return miss('no-capture');
  const renderer = refs.renderer as PixiRendererLike;
  const stage = refs.stage as PixiDisplayObject;
  detail.stageChildren = Array.isArray(stage.children) ? stage.children.length : null;

  const canvas = refs.canvas;
  if (!canvas) return miss('no-canvas');
  detail.canvas = `${canvas.className || canvas.tagName} ${canvas.width}x${canvas.height}`;

  // Guard against HUD/hotbar containers that may reuse inventory-like labels.
  // The actual full inventory view is wrapped by InventoryModal when open.
  const modalMatch = findLargestNodeByLabel(inventoryScanRoot(stage), (label) => label === 'InventoryModal');
  if (!modalMatch) return miss('no-modal');

  const modalRect = toCssRect(modalMatch.bounds, renderer, canvas);
  detail.modalRect = rectSummary(modalRect);
  if (!modalRect) return miss('no-modal');
  if (
    !confirmedOpen &&
    (modalRect.width < window.innerWidth * 0.45 || modalRect.height < window.innerHeight * 0.35)
  ) {
    return miss('modal-small');
  }
  const minViewCount = confirmedOpen ? 1 : MIN_OPEN_ITEM_VIEW_COUNT;

  const itemsMatch = findLargestNodeByLabel(modalMatch.node, (label) => label === 'InventoryItems');
  const contentMatch = findLargestNodeByLabel(modalMatch.node, (label) => label === 'InventoryContent');

  const candidates: Array<{ match: PixiNodeMatch; source: InventoryAnchor['source'] }> = [];
  if (itemsMatch) candidates.push({ match: itemsMatch, source: 'InventoryItems' });
  if (contentMatch) candidates.push({ match: contentMatch, source: 'InventoryContent' });

  const tried: string[] = [];
  for (const candidate of candidates) {
    const rect = toCssRect(candidate.match.bounds, renderer, canvas);
    const open = !!rect && isRectOpenAndVisible(rect, confirmedOpen);
    const viewCount = open
      ? countVisibleInventoryItemViews(candidate.match.node, candidate.match.bounds, minViewCount)
      : -1;
    tried.push(`${candidate.source} ${rectSummary(rect)} open=${open} views=${viewCount}`);
    if (open && viewCount >= minViewCount) {
      const anchor: InventoryAnchor = { rect: rect!, source: candidate.source };
      return { anchor, miss: null, detail: null };
    }
  }
  detail.candidates = tried;

  return miss('below-threshold');
}
