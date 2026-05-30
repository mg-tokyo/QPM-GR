// src/ui/storageValueOverlay.ts
// Storage Value overlay — positioned to the left of the modal close button.
// Walks the Pixi tree to find the unlabeled close button sprite for accurate placement.

import {
  onStorageValueChange,
  getStorageValueState,
  type StorageValueState,
} from '../../features/economy/storageValue';
import { getAnySpriteDataUrl } from '../../sprite-v2/compat';
import { pageWindow } from '../../core/pageContext';
import { visibleInterval, timerManager } from '../../utils/timerManager';

const OVERLAY_ID = 'qpm-storage-value-overlay';
const POS_SYNC_TIMER_ID = 'storageValueOverlay:posSync';
const POS_SYNC_MS = 200;

// ---------------------------------------------------------------------------
// Value formatting — 2dp k/M/B/T
// ---------------------------------------------------------------------------

function formatValue(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000_000) return `${(value / 1_000_000_000_000).toFixed(2)}T`;
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(2)}k`;
  return value.toFixed(0);
}

// ---------------------------------------------------------------------------
// Pixi types
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

interface PixiBounds { x: number; y: number; width: number; height: number; }
interface CssRect { left: number; top: number; width: number; height: number; }

// ---------------------------------------------------------------------------
// Pixi helpers
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
  const x = Number(r.x), y = Number(r.y), w = Number(r.width), h = Number(r.height);
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

function pixiToCss(bounds: PixiBounds, renderer: PixiRenderer, canvas: HTMLCanvasElement): CssRect | null {
  const cr = canvas.getBoundingClientRect();
  if (cr.width <= 0 || cr.height <= 0) return null;
  const sw = Number(renderer.screen?.width) || canvas.width;
  const sh = Number(renderer.screen?.height) || canvas.height;
  if (sw <= 0 || sh <= 0) return null;
  const sx = cr.width / sw, sy = cr.height / sh;
  if (!Number.isFinite(sx) || !Number.isFinite(sy) || sx <= 0 || sy <= 0) return null;
  return {
    left: cr.left + bounds.x * sx,
    top: cr.top + bounds.y * sy,
    width: bounds.width * sx,
    height: bounds.height * sy,
  };
}

// ---------------------------------------------------------------------------
// Anchor resolution
// ---------------------------------------------------------------------------

// Content grid labels — the scrollable grid below the modal header.
// Header (title + close button) sits above these nodes.
const CONTENT_LABEL: Record<string, string> = {
  inventory: 'InventoryContent',
  seedSilo: 'StorageContent',
  petHutch: 'StorageContent',
  decorShed: 'StorageContent',
};

interface ModalRefs {
  captured: PixiCapture;
  renderer: PixiRenderer;
  stage: PixiNode;
  canvas: HTMLCanvasElement;
}

function getModalRefs(): ModalRefs | null {
  const root = pageWindow as Window & typeof globalThis & { __QPM_PIXI_CAPTURED__?: PixiCapture };
  const captured = root.__QPM_PIXI_CAPTURED__;
  if (!captured) return null;
  const app = captured.app;
  const renderer = captured.renderer ?? app?.renderer;
  const stage = app?.stage;
  if (!renderer || !stage) return null;
  const canvas = resolveCanvas(renderer);
  if (!canvas) return null;
  return { captured, renderer, stage, canvas };
}

/** Returns the CSS rect of the content grid for the given modal, or null. */
function resolveContentRect(modalId: string): CssRect | null {
  const refs = getModalRefs();
  if (!refs) return null;

  const label = CONTENT_LABEL[modalId];
  if (!label) return null;

  const node = findNodeByLabel(refs.stage, label);
  if (!node) return null;

  const bounds = nodeBounds(node);
  if (!bounds) return null;

  return pixiToCss(bounds, refs.renderer, refs.canvas);
}

// ---------------------------------------------------------------------------
// Coin sprite
// ---------------------------------------------------------------------------

let coinUrl = '';

function getCoinUrl(): string {
  if (coinUrl) return coinUrl;
  const url = getAnySpriteDataUrl('sprite/ui/Coin') || getAnySpriteDataUrl('ui/Coin') || '';
  if (url) coinUrl = url; // only cache successful lookups — retry on next render if sprites not ready
  return url;
}

// ---------------------------------------------------------------------------
// Overlay DOM — no background, gold text, coin sprite
// ---------------------------------------------------------------------------

function buildOverlay(): HTMLDivElement {
  const el = document.createElement('div');
  el.id = OVERLAY_ID;
  el.style.cssText = [
    'position:fixed',
    'z-index:99999',
    'display:flex',
    'align-items:center',
    'gap:5px',
    'font-size:14px',
    'font-weight:700',
    'color:#f5c518',
    'text-shadow:-1px -1px 0 rgba(0,0,0,0.5),1px -1px 0 rgba(0,0,0,0.5),-1px 1px 0 rgba(0,0,0,0.5),1px 1px 0 rgba(0,0,0,0.5)',
    'pointer-events:none',
    'user-select:none',
    'white-space:nowrap',
    'opacity:0',
    'top:0',
    'left:0',
  ].join(';');
  return el;
}

function getOrCreateOverlay(): HTMLDivElement {
  let el = document.getElementById(OVERLAY_ID) as HTMLDivElement | null;
  if (!el) {
    el = buildOverlay();
    document.body.appendChild(el);
  }
  return el;
}

function removeOverlay(): void {
  document.getElementById(OVERLAY_ID)?.remove();
}

function renderContent(el: HTMLDivElement, valueText: string): void {
  el.innerHTML = '';

  const coinSrc = getCoinUrl();
  if (coinSrc) {
    const img = document.createElement('img');
    img.src = coinSrc;
    img.width = 18;
    img.height = 18;
    img.style.cssText = 'image-rendering:pixelated;flex-shrink:0;vertical-align:middle;';
    el.appendChild(img);
  }

  const span = document.createElement('span');
  span.textContent = valueText;
  el.appendChild(span);
}

// ---------------------------------------------------------------------------
// Position syncing
// ---------------------------------------------------------------------------

let currentModalId: string | null = null;
let posSyncStop: (() => void) | null = null;
let resizeHandler: (() => void) | null = null;

function syncPosition(): void {
  const el = document.getElementById(OVERLAY_ID) as HTMLDivElement | null;
  if (!el || !currentModalId) return;

  // All modals: anchor to the content grid (InventoryContent / StorageContent).
  // The modal header (title + close button) sits directly above this node.
  // pillBottom = content.top  →  pill's bottom edge aligns with content top = header bottom.
  // pillRightEdge = 15% of content width from right edge  →  left of close button area.
  const content = resolveContentRect(currentModalId);
  if (!content || content.width < 100) return;

  const w = content.width;
  // StorageContent/InventoryContent includes the header row — content.top is the
  // modal top, NOT the grid top. The header (title + "25/25" + close button) spans
  // roughly the first 5-7% of height. Place pill in the header row.
  // Anchor directly under the PixiTooltip count badge (e.g. "25/25").
  // Badge is consistently at content.top, h=42, centerX = contentRight - 50.
  // Pill top = badge bottom + 2px gap; centered on badge.
  const contentRight = content.left + w;
  const pillTop = content.top + w * 0.038;
  const pillCenterX = contentRight - w * 0.068;

  el.style.left = `${Math.round(pillCenterX)}px`;
  el.style.right = '';
  el.style.top = `${Math.round(Math.max(4, pillTop))}px`;
  el.style.transform = 'translateX(-50%)';
  el.style.opacity = '1';
}

function startPosSync(modalId: string): void {
  currentModalId = modalId;
  if (posSyncStop) return;
  syncPosition();
  posSyncStop = visibleInterval(POS_SYNC_TIMER_ID, syncPosition, POS_SYNC_MS);
}

function stopPosSync(): void {
  currentModalId = null;
  if (posSyncStop) {
    posSyncStop();
    posSyncStop = null;
  }
  timerManager.unregister(POS_SYNC_TIMER_ID);
}

// ---------------------------------------------------------------------------
// State → DOM
// ---------------------------------------------------------------------------

function applyState(state: StorageValueState): void {
  if (state.status === 'hidden') {
    removeOverlay();
    stopPosSync();
    return;
  }

  const valueText = state.status === 'loading' ? '—' : formatValue(state.value);
  const el = getOrCreateOverlay();
  renderContent(el, valueText);

  if (state.activeModal) {
    startPosSync(state.activeModal);
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

let unsub: (() => void) | null = null;

export function startStorageValueOverlay(): void {
  if (unsub) return;

  resizeHandler = () => syncPosition();
  window.addEventListener('resize', resizeHandler);

  applyState(getStorageValueState());
  unsub = onStorageValueChange((state) => applyState(state));
}

export function stopStorageValueOverlay(): void {
  unsub?.();
  unsub = null;
  stopPosSync();
  if (resizeHandler) {
    window.removeEventListener('resize', resizeHandler);
    resizeHandler = null;
  }
  removeOverlay();
}
