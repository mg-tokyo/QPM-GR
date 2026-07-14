// src/ui/inventoryCapacityOverlay.ts
// Persistent HUD indicator that shows !! (warning) or FULL!! (full) when
// inventory slot count approaches or reaches the 100-slot cap.
//
// Position strategy (reactive, no polling):
// 1. Walk Pixi tree to find PixiTooltip (inventory button) or
//    InventoryScrollView (bottom toolbar). Only accepts nodes in the
//    bottom 40% of the canvas — rejects modal-open states where these
//    nodes shift upward.
// 2. Cache position as fractions of canvas Pixi dimensions.
// 3. Compute CSS from cached fractions × canvas.getBoundingClientRect()
//    on: window resize, ResizeObserver on canvas, state change.
// 4. Invalidate anchor on modal close + canvas resize so it re-walks Pixi.
// 5. Hide when inventory modal is open (activeModalAtom === 'inventory').

import {
  onInventoryCapacityChange,
  getInventoryCapacityState,
  type InventoryCapacityState,
  getInventoryCapacityConfig,
  subscribeToInventoryCapacityConfig,
} from '../../features/economy/inventoryCapacity';
import { pageWindow } from '../../core/pageContext';
import { subscribeAtomValue } from '../../core/atomRegistry';
import { createNamedLogger } from '../../diagnostics/logger';

const log = createNamedLogger('ui.inventoryCapacityOverlay');

const OVERLAY_ID = 'qpm-inv-capacity-overlay';
const FLASH_STYLE_ID = 'qpm-inv-capacity-flash-style';

// ---------------------------------------------------------------------------
// Pixi types (same as storageValueOverlay)
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

// ---------------------------------------------------------------------------
// Pixi refs
// ---------------------------------------------------------------------------

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
// Cached anchor — position as fractions of canvas Pixi dimensions
// ---------------------------------------------------------------------------

interface CachedAnchor {
  /** Fraction from left edge (0 = left, 1 = right) */
  xFrac: number;
  /** Fraction from top edge (0 = top, 1 = bottom) */
  yFrac: number;
}

let cachedAnchor: CachedAnchor | null = null;
let canvasRef: HTMLCanvasElement | null = null;

/** Invalidate the cached anchor so the next sync re-walks the Pixi tree. */
function invalidateAnchor(): void {
  cachedAnchor = null;
}

/**
 * Walk the Pixi tree to find the inventory area anchor.
 * Only accepts nodes in the bottom 40% of the canvas height,
 * which rejects modal-open states where these nodes shift upward.
 * Returns true if anchor was successfully locked.
 */
function lockAnchor(): boolean {
  const refs = getRefs();
  if (!refs) return false;

  const sw = Number(refs.renderer.screen?.width) || 750;
  const sh = Number(refs.renderer.screen?.height) || 1304;
  const bottomThreshold = sh * 0.60;

  // Primary: PixiTooltip — the inventory open button in the bottom toolbar
  const tooltip = findNodeByLabel(refs.stage, 'PixiTooltip');
  if (tooltip) {
    const b = nodeBounds(tooltip);
    if (b && b.y > bottomThreshold && b.width > 10 && b.height > 10) {
      // Position: 6px left of button, vertically centered with it
      cachedAnchor = {
        xFrac: (b.x - 6) / sw,
        yFrac: (b.y + b.height / 2) / sh,
      };
      canvasRef = refs.canvas;
      return true;
    }
  }

  // Fallback: InventoryScrollView — always-visible bottom toolbar item row
  const scrollView = findNodeByLabel(refs.stage, 'InventoryScrollView');
  if (scrollView) {
    const b = nodeBounds(scrollView);
    if (b && b.y > bottomThreshold && b.width > 100) {
      // Position: right end of scroll view, 26px above
      cachedAnchor = {
        xFrac: (b.x + b.width) / sw,
        yFrac: (b.y - 26) / sh,
      };
      canvasRef = refs.canvas;
      return true;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Inventory modal detection (activeModalAtom subscription)
// ---------------------------------------------------------------------------

let inventoryModalOpen = false;
let modalUnsub: (() => void) | null = null;
let modalRetryTimer: ReturnType<typeof setTimeout> | null = null;

function onModalChange(value: string | null): void {
  const wasOpen = inventoryModalOpen;
  inventoryModalOpen = value === 'inventory';
  if (wasOpen === inventoryModalOpen) return;

  if (inventoryModalOpen) {
    // Inventory modal opened — hide overlay
    const el = document.getElementById(OVERLAY_ID) as HTMLDivElement | null;
    if (el) {
      el.classList.remove('qpm-inv-full');
      el.style.opacity = '0';
    }
  } else {
    // Inventory modal closed — invalidate anchor because the toolbar moved,
    // then re-apply state which will re-walk Pixi to find the new position.
    invalidateAnchor();
    applyState(getInventoryCapacityState());
  }
}

function trySubscribeModal(retriesLeft = 15): void {
  if (modalUnsub) return;

  subscribeAtomValue('activeModal', (value) => onModalChange(value as string | null))
    .then(unsub => {
      if (!unsub) {
        if (retriesLeft > 0) {
          modalRetryTimer = setTimeout(() => {
            modalRetryTimer = null;
            trySubscribeModal(retriesLeft - 1);
          }, 1000);
        }
        return;
      }
      modalUnsub = unsub;
    })
    .catch(err => log.warn('QPM-ATOM-002', { atom: 'activeModal', op: 'subscribe' }, err));
}

function cleanupModalSubscription(): void {
  if (modalRetryTimer !== null) {
    clearTimeout(modalRetryTimer);
    modalRetryTimer = null;
  }
  modalUnsub?.();
  modalUnsub = null;
  inventoryModalOpen = false;
}

// ---------------------------------------------------------------------------
// Position computation (uses cached anchor + canvas rect — no Pixi walking)
// ---------------------------------------------------------------------------

let overlayVisible = false;

function syncPosition(): void {
  const el = document.getElementById(OVERLAY_ID) as HTMLDivElement | null;
  if (!el || !overlayVisible || inventoryModalOpen) return;

  // Try to lock anchor if not yet locked (or was invalidated)
  if (!cachedAnchor || !canvasRef) {
    if (!lockAnchor()) return; // no anchor yet — stay hidden until lock succeeds
  }

  const cr = canvasRef!.getBoundingClientRect();
  if (cr.width <= 0 || cr.height <= 0) return;

  // Convert cached fractions → CSS viewport position (left-based)
  const cssLeft = cr.left + cr.width * cachedAnchor!.xFrac;
  const cssTop = cr.top + cr.height * cachedAnchor!.yFrac;

  el.style.right = '';
  el.style.left = `${Math.round(cssLeft)}px`;
  el.style.top = `${Math.round(cssTop)}px`;
  el.style.transform = 'translate(-100%, -50%)';
  el.style.opacity = '1';
}

// ---------------------------------------------------------------------------
// Deferred anchor lock — retries briefly on startup then stops
// ---------------------------------------------------------------------------

let lockRetryTimer: ReturnType<typeof setTimeout> | null = null;

function tryLockAnchorDeferred(retriesLeft = 10, delay = 250): void {
  if (cachedAnchor || !overlayVisible) return;
  if (lockRetryTimer !== null) return; // already scheduled

  lockRetryTimer = setTimeout(() => {
    lockRetryTimer = null;
    if (cachedAnchor || !overlayVisible) return;
    if (lockAnchor()) {
      syncPosition();
      setupResizeObserver();
    } else if (retriesLeft > 0) {
      tryLockAnchorDeferred(retriesLeft - 1, Math.min(delay * 1.5, 2000));
    }
  }, delay);
}

function cancelLockRetry(): void {
  if (lockRetryTimer !== null) {
    clearTimeout(lockRetryTimer);
    lockRetryTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Reactive position updates (ResizeObserver + window resize — no polling)
// ---------------------------------------------------------------------------

let resizeObserver: ResizeObserver | null = null;
let resizeHandler: (() => void) | null = null;

function onCanvasResize(): void {
  // Canvas resized — Pixi layout may have changed, invalidate and re-lock.
  invalidateAnchor();
  syncPosition();
}

function setupResizeObserver(): void {
  if (resizeObserver || !canvasRef) return;
  resizeObserver = new ResizeObserver(() => onCanvasResize());
  resizeObserver.observe(canvasRef);
}

function teardownResizeObserver(): void {
  resizeObserver?.disconnect();
  resizeObserver = null;
}

// ---------------------------------------------------------------------------
// Flash animation style
// ---------------------------------------------------------------------------

function ensureFlashStyle(): void {
  if (document.getElementById(FLASH_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = FLASH_STYLE_ID;
  style.textContent = `
    @keyframes qpm-inv-flash {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }
    .qpm-inv-full {
      animation: qpm-inv-flash 0.8s ease-in-out infinite;
    }
  `;
  document.documentElement.appendChild(style);
}

// ---------------------------------------------------------------------------
// Overlay DOM
// ---------------------------------------------------------------------------

function buildOverlay(): HTMLDivElement {
  ensureFlashStyle();
  const el = document.createElement('div');
  el.id = OVERLAY_ID;
  el.style.cssText = [
    'position:fixed',
    'z-index:99998',
    'padding:4px 10px',
    'border-radius:6px',
    'background:rgba(0,0,0,0.72)',
    'pointer-events:none',
    'user-select:none',
    'white-space:nowrap',
    'font-family:var(--qpm-font,"Inter","Segoe UI",Arial,sans-serif)',
    'font-size:13px',
    'font-weight:800',
    'letter-spacing:0.4px',
    'text-shadow:-1px -1px 0 rgba(0,0,0,0.5),1px -1px 0 rgba(0,0,0,0.5),-1px 1px 0 rgba(0,0,0,0.5),1px 1px 0 rgba(0,0,0,0.5)',
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

// ---------------------------------------------------------------------------
// State -> DOM
// ---------------------------------------------------------------------------

function applyState(state: InventoryCapacityState): void {
  const cfg = getInventoryCapacityConfig();

  if (state.level === 'ok') {
    overlayVisible = false;
    const el = document.getElementById(OVERLAY_ID) as HTMLDivElement | null;
    if (el) {
      el.classList.remove('qpm-inv-full');
      el.style.opacity = '0';
    }
    return;
  }

  overlayVisible = true;
  const el = getOrCreateOverlay();

  if (state.level === 'full') {
    el.textContent = `FULL!! (${state.count}/${state.max})`;
    el.style.color = cfg.fullColor;
    el.style.border = `1px solid ${cfg.fullColor}44`;
    el.classList.add('qpm-inv-full');
  } else {
    el.textContent = `!! ${state.count}/${state.max}`;
    el.style.color = cfg.warningColor;
    el.style.border = `1px solid ${cfg.warningColor}44`;
    el.classList.remove('qpm-inv-full');
  }

  // Hide while inventory modal is open
  if (inventoryModalOpen) {
    el.style.opacity = '0';
    return;
  }

  // Position the overlay (re-walks Pixi if anchor was invalidated)
  if (cachedAnchor) {
    syncPosition();
  } else if (lockAnchor()) {
    syncPosition();
    setupResizeObserver();
  } else {
    tryLockAnchorDeferred();
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

let unsubState: (() => void) | null = null;
let unsubConfig: (() => void) | null = null;

export function startInventoryCapacityOverlay(): void {
  if (unsubState) return;

  resizeHandler = () => {
    // Window resized — invalidate anchor and re-sync.
    invalidateAnchor();
    syncPosition();
  };
  window.addEventListener('resize', resizeHandler);

  // Try to lock anchor immediately
  if (lockAnchor()) {
    setupResizeObserver();
  }

  // Subscribe to activeModalAtom to hide when inventory modal is open
  trySubscribeModal();

  applyState(getInventoryCapacityState());
  unsubState = onInventoryCapacityChange((state) => applyState(state));
  unsubConfig = subscribeToInventoryCapacityConfig(() => {
    applyState(getInventoryCapacityState());
  });
}

export function stopInventoryCapacityOverlay(): void {
  unsubState?.();
  unsubState = null;
  unsubConfig?.();
  unsubConfig = null;
  overlayVisible = false;
  cancelLockRetry();
  cleanupModalSubscription();
  teardownResizeObserver();
  cachedAnchor = null;
  canvasRef = null;
  if (resizeHandler) {
    window.removeEventListener('resize', resizeHandler);
    resizeHandler = null;
  }
  removeOverlay();
}
