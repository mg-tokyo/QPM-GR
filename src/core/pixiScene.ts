// src/core/pixiScene.ts
// Shared PIXI scene graph access, traversal, and manipulation utilities.
// Consolidates patterns from gardenFilters, bulkFavorite, and universalProbe.

import { pageWindow } from './pageContext';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PixiBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CssRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PixiRuntime {
  app: Record<string, unknown> | null;
  renderer: Record<string, unknown> | null;
  stage: Record<string, unknown> | null;
  canvas: HTMLCanvasElement | null;
  ready: boolean;
}

export interface PixiNodeMatch {
  node: Record<string, unknown>;
  bounds: PixiBounds;
  area: number;
}

/** Constructors extracted from the live PIXI scene graph. */
export interface PixiCtors {
  Container: new () => Record<string, unknown>;
  Graphics: new () => Record<string, unknown>;
  Text: new (opts: { text: string; style: Record<string, unknown> }) => Record<string, unknown>;
}

type PixiNode = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

// ---------------------------------------------------------------------------
// Scene Access
// ---------------------------------------------------------------------------

/** Get the captured PIXI app, renderer, stage, and canvas. */
export function getPixiRuntime(): PixiRuntime {
  const root = pageWindow as Window & typeof globalThis & Record<string, unknown>;
  const captured = isObject(root.__QPM_PIXI_CAPTURED__)
    ? root.__QPM_PIXI_CAPTURED__
    : null;

  const app = isObject(captured?.app) ? captured.app as Record<string, unknown> : null;
  const renderer =
    isObject(captured?.renderer)
      ? captured.renderer as Record<string, unknown>
      : isObject(app?.renderer)
        ? app.renderer as Record<string, unknown>
        : null;
  const stage = isObject(app?.stage) ? app.stage as Record<string, unknown> : null;
  const canvas = resolveCanvas(renderer);

  return { app, renderer, stage, canvas, ready: !!(app && renderer && stage && canvas) };
}

/** Resolve the game canvas element from multiple sources. */
export function resolveCanvas(renderer: unknown): HTMLCanvasElement | null {
  const preferred = document.querySelector('.QuinoaCanvas canvas');
  if (preferred instanceof HTMLCanvasElement) return preferred;

  if (isObject(renderer)) {
    if (renderer.view instanceof HTMLCanvasElement) return renderer.view;
    if (renderer.canvas instanceof HTMLCanvasElement) return renderer.canvas;
  }

  // Fallback: largest canvas on page
  const canvases = Array.from(document.querySelectorAll('canvas'))
    .filter((el): el is HTMLCanvasElement => el instanceof HTMLCanvasElement);
  let best: HTMLCanvasElement | null = null;
  let bestArea = 0;
  for (const c of canvases) {
    const r = c.getBoundingClientRect();
    const area = Math.max(0, r.width) * Math.max(0, r.height);
    if (area > bestArea) { best = c; bestArea = area; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Node Inspection
// ---------------------------------------------------------------------------

/** Get a node's label string (falls back to name). */
export function getLabel(node: unknown): string {
  if (!isObject(node)) return '';
  if (typeof node.label === 'string') return node.label;
  if (typeof node.name === 'string') return node.name;
  return '';
}

/** Check if a PIXI node is visible, renderable, and has nonzero alpha. */
export function isVisible(node: unknown): boolean {
  if (!isObject(node)) return false;
  if (node.visible === false || node.renderable === false || node.worldVisible === false) return false;
  if (typeof node.alpha === 'number' && node.alpha <= 0.001) return false;
  if (typeof node.worldAlpha === 'number' && node.worldAlpha <= 0.001) return false;
  return true;
}

/** Parse a bounds-like object into PixiBounds. */
function parseBounds(value: unknown): PixiBounds | null {
  if (!isObject(value)) return null;
  const x = Number(value.x);
  const y = Number(value.y);
  const width = Number(value.width);
  const height = Number(value.height);
  if (![x, y, width, height].every(Number.isFinite)) return null;
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

/** Get a node's bounds via getBounds(). */
export function getBounds(node: unknown): PixiBounds | null {
  if (!isObject(node) || typeof node.getBounds !== 'function') return null;
  try {
    return parseBounds(node.getBounds());
  } catch {
    return null;
  }
}

/** Convert PIXI bounds to CSS pixel rect on the page. */
export function toCssRect(
  bounds: PixiBounds,
  renderer: unknown,
  canvas: HTMLCanvasElement,
): CssRect | null {
  const canvasRect = canvas.getBoundingClientRect();
  if (canvasRect.width <= 0 || canvasRect.height <= 0) return null;

  const screen = isObject(renderer) && isObject((renderer as Record<string, unknown>).screen)
    ? (renderer as Record<string, unknown>).screen as Record<string, unknown>
    : null;
  const screenW = Number(screen?.width) || canvas.width || 0;
  const screenH = Number(screen?.height) || canvas.height || 0;
  if (screenW <= 0 || screenH <= 0) return null;

  const scaleX = canvasRect.width / screenW;
  const scaleY = canvasRect.height / screenH;
  if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) return null;

  return {
    left: canvasRect.left + bounds.x * scaleX,
    top: canvasRect.top + bounds.y * scaleY,
    width: bounds.width * scaleX,
    height: bounds.height * scaleY,
  };
}

// ---------------------------------------------------------------------------
// Traversal
// ---------------------------------------------------------------------------

type WalkVisitor = (node: PixiNode, depth: number) => boolean | void;

/** Stack-based BFS/DFS traversal of the PIXI scene graph. */
export function walkScene(
  root: unknown,
  visitor: WalkVisitor,
  opts?: { maxDepth?: number; maxNodes?: number; visibleOnly?: boolean },
): void {
  if (!isObject(root)) return;
  const maxDepth = opts?.maxDepth ?? 30;
  const maxNodes = opts?.maxNodes ?? 50_000;
  const visibleOnly = opts?.visibleOnly ?? false;

  const seen = new WeakSet<object>();
  const stack: Array<{ node: PixiNode; depth: number }> = [{ node: root as PixiNode, depth: 0 }];
  let visited = 0;

  while (stack.length > 0 && visited < maxNodes) {
    const item = stack.pop()!;
    if (seen.has(item.node)) continue;
    seen.add(item.node);
    if (visibleOnly && !isVisible(item.node)) continue;
    visited++;

    const stop = visitor(item.node, item.depth);
    if (stop === true) return;

    if (item.depth < maxDepth && Array.isArray(item.node.children)) {
      const children = item.node.children as PixiNode[];
      for (let i = children.length - 1; i >= 0; i--) {
        const child = children[i];
        if (child && typeof child === 'object' && !seen.has(child)) {
          stack.push({ node: child, depth: item.depth + 1 });
        }
      }
    }
  }
}

type LabelMatcher = string | RegExp | ((label: string) => boolean);

function matchLabel(label: string, matcher: LabelMatcher): boolean {
  if (typeof matcher === 'string') return label === matcher;
  if (matcher instanceof RegExp) return matcher.test(label);
  return matcher(label);
}

/** Find first node matching a label criterion. */
export function findByLabel(root: unknown, matcher: LabelMatcher): PixiNode | null {
  let found: PixiNode | null = null;
  walkScene(root, (node): boolean | void => {
    if (matchLabel(getLabel(node), matcher)) {
      found = node;
      return true;
    }
  });
  return found;
}

/** Find all nodes matching a label criterion. */
export function findAllByLabel(
  root: unknown,
  matcher: LabelMatcher,
  opts?: { maxResults?: number },
): PixiNode[] {
  const results: PixiNode[] = [];
  const limit = opts?.maxResults ?? 500;
  walkScene(root, (node): boolean | void => {
    if (matchLabel(getLabel(node), matcher)) {
      results.push(node);
      if (results.length >= limit) return true;
    }
  });
  return results;
}

/** Find the largest (by area) node matching a label criterion. */
export function findLargest(root: unknown, matcher: LabelMatcher): PixiNodeMatch | null {
  let best: PixiNodeMatch | null = null;
  let bestArea = 0;
  walkScene(root, (node): boolean | void => {
    if (!matchLabel(getLabel(node), matcher)) return;
    const b = getBounds(node);
    if (!b) return;
    const area = b.width * b.height;
    if (area > bestArea) {
      bestArea = area;
      best = { node, bounds: b, area };
    }
  }, { visibleOnly: true });
  return best;
}

// ---------------------------------------------------------------------------
// Constructor Extraction
// ---------------------------------------------------------------------------

/**
 * Extract PIXI constructors from existing scene nodes.
 * Walks the scene to find Graphics (has `.rect` or `.beginFill`), Text (has `.text`),
 * and uses the stage constructor for Container.
 */
export function getCtors(stage: unknown): PixiCtors | null {
  if (!isObject(stage)) return null;

  let GraphicsCtor: (new () => Record<string, unknown>) | null = null;
  let TextCtor: (new (opts: { text: string; style: Record<string, unknown> }) => Record<string, unknown>) | null = null;
  const ContainerCtor = (stage as Record<string, unknown>).constructor as (new () => Record<string, unknown>) | undefined;

  if (!ContainerCtor) return null;

  walkScene(stage, (node): boolean | void => {
    if (!GraphicsCtor && typeof node.rect === 'function') {
      GraphicsCtor = node.constructor as new () => Record<string, unknown>;
    }
    if (!TextCtor && typeof node.text === 'string' && node.constructor !== ContainerCtor) {
      TextCtor = node.constructor as new (opts: { text: string; style: Record<string, unknown> }) => Record<string, unknown>;
    }
    if (GraphicsCtor && TextCtor) return true;
  }, { maxNodes: 2000 });

  if (!GraphicsCtor || !TextCtor) return null;
  return { Container: ContainerCtor, Graphics: GraphicsCtor, Text: TextCtor };
}

/** Create a new Graphics instance from extracted constructors. */
export function createGraphics(ctors: PixiCtors): Record<string, unknown> {
  return new ctors.Graphics();
}

/** Create a new Text instance from extracted constructors. */
export function createText(
  ctors: PixiCtors,
  text: string,
  style: Record<string, unknown>,
): Record<string, unknown> {
  return new ctors.Text({ text, style });
}

/** Create a new Container instance from extracted constructors. */
export function createContainer(ctors: PixiCtors): Record<string, unknown> {
  return new ctors.Container();
}

// ---------------------------------------------------------------------------
// Injection & Cleanup (QPM-tagged children)
// ---------------------------------------------------------------------------

const QPM_TAG_PREFIX = '__qpm_';

/** Inject a tagged child into a parent. Idempotent — skips if tag already exists. */
export function inject(parent: unknown, child: unknown, tag: string): void {
  if (!isObject(parent) || !isObject(child)) return;
  if (hasInjected(parent, tag)) return;

  (child as Record<string, unknown>).label = `${QPM_TAG_PREFIX}${tag}`;

  if (typeof (parent as Record<string, unknown>).addChild === 'function') {
    (parent as { addChild: (c: unknown) => void }).addChild(child);
  }
}

/** Check if a QPM-tagged child already exists. */
export function hasInjected(parent: unknown, tag: string): boolean {
  if (!isObject(parent) || !Array.isArray((parent as Record<string, unknown>).children)) return false;
  const fullTag = `${QPM_TAG_PREFIX}${tag}`;
  // Manual for loop — .some() silently fails on page-realm arrays with sandbox callbacks
  const children = (parent as { children: PixiNode[] }).children;
  for (let i = 0; i < children.length; i++) {
    const c = children[i];
    if (isObject(c) && c.label === fullTag) return true;
  }
  return false;
}

/** Remove all QPM-injected children from a parent. Returns count removed. */
export function removeInjected(parent: unknown, tagPrefix?: string): number {
  if (!isObject(parent) || !Array.isArray((parent as Record<string, unknown>).children)) return 0;

  const prefix = tagPrefix ? `${QPM_TAG_PREFIX}${tagPrefix}` : QPM_TAG_PREFIX;
  const parentObj = parent as { children: PixiNode[]; removeChild?: (c: unknown) => void };
  const toRemove: PixiNode[] = [];

  for (const child of parentObj.children) {
    if (isObject(child) && typeof child.label === 'string' && child.label.startsWith(prefix)) {
      toRemove.push(child);
    }
  }

  for (const child of toRemove) {
    if (typeof parentObj.removeChild === 'function') {
      try { parentObj.removeChild(child); } catch { /* ignore */ }
    }
    // Also destroy if available
    if (typeof (child as Record<string, unknown>).destroy === 'function') {
      try { (child as { destroy: () => void }).destroy(); } catch { /* ignore */ }
    }
  }

  return toRemove.length;
}

// ---------------------------------------------------------------------------
// Layout Helpers
// ---------------------------------------------------------------------------

/**
 * Reorder children's y positions based on a sort function.
 * Only reassigns y values of children matched by the filter; preserves spacing.
 * Non-matched children (e.g. footer text) stay at their original positions.
 */
export function reorderByY(
  container: unknown,
  filter: (node: PixiNode) => boolean,
  sortFn: (a: PixiNode, b: PixiNode) => number,
): void {
  if (!isObject(container) || !Array.isArray((container as Record<string, unknown>).children)) return;

  const children = (container as { children: PixiNode[] }).children;
  const matched: Array<{ node: PixiNode; originalY: number }> = [];

  for (const child of children) {
    if (!isObject(child)) continue;
    if (filter(child) && typeof child.y === 'number') {
      matched.push({ node: child, originalY: child.y as number });
    }
  }

  if (matched.length < 2) return;

  // Capture original y slots (sorted ascending)
  const ySlots = matched.map((m) => m.originalY).sort((a, b) => a - b);

  // Sort nodes by the provided function
  const sorted = [...matched].sort((a, b) => sortFn(a.node, b.node));

  // Assign sorted nodes to the original y slots
  for (let i = 0; i < sorted.length; i++) {
    sorted[i]!.node.y = ySlots[i]!;
  }
}
