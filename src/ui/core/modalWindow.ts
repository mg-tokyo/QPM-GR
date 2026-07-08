// src/ui/modalWindow.ts - Modal Window System inspired by Aries mod
// Windows open when clicking tab buttons, draggable, with persistent position.
// Position is stored as viewport ratios (0–1) so windows survive any viewport resize.

import { removeStorageKeysByPrefix, storage } from '../../utils/storage';
import { log } from '../../utils/logger';
import { createNamedLogger } from '../../diagnostics/logger';
import { clampPct } from '../../utils/windowPosition';
import { t } from '../../i18n';
import { renderWindowRenderError } from './modalWindowErrorBoundary';

const windowLog = createNamedLogger('ui.window');

/**
 * PanelRender may optionally return a cleanup fn — run on close/destroy/invalidate.
 * Existing callers returning void keep compiling; opting in is per-window.
 * Async renders (Promise<void>) remain valid — they should register cleanups
 * via `registerWindowCleanup(id, fn)` once their async setup completes.
 */
export type PanelRender = (root: HTMLElement) => void | (() => void) | Promise<void>;

export interface WindowConfig {
  id: string;
  title: string;
  render: PanelRender;
  maxWidth?: string;
  maxHeight?: string;
}

interface WindowState {
  id: string;
  el: HTMLElement;
  head: HTMLElement;
  body: HTMLElement;
  titleEl: HTMLElement;
  minimizeBtn: HTMLElement;
  closeBtn: HTMLElement;
  isMinimized: boolean;
  maxWidth: string;
  maxHeight: string;
  /** Position as viewport ratio — the single source of truth. */
  position: { xPct: number; yPct: number };
  restoreWidth: string | null;
  restoreHeight: string | null;
  restoreMinHeight: string | null;
  restoreMaxHeight: string | null;
  /** Optional teardown for content subscriptions/timers — invoked on close/destroy/invalidate. */
  contentCleanup: (() => void) | null;
}

const WINDOW_POSITION_KEY = 'qpm-window-pos-';
const WINDOW_STATE_KEY = 'qpm-window-state-';
const WINDOW_SIZE_KEY = 'qpm-window-size-';
const WINDOW_MARGIN = 8;
const WINDOW_MIN_WIDTH = 260;
const WINDOW_MIN_HEIGHT = 120;
const QPM_UI_FONT_STACK = "'Inter', 'Segoe UI', 'Roboto', 'Helvetica Neue', Arial, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji', sans-serif";
const windows = new Map<string, WindowState>();
let currentZ = 10000;
let resizeListenerAdded = false;

// ─── Ratio positioning (margin-aware) ─────────────────────────────────────────

/** Convert viewport ratios → pixel left/top, respecting WINDOW_MARGIN. */
function ratioPctToPixels(xPct: number, yPct: number, w: number, h: number): { x: number; y: number } {
  const availW = Math.max(0, window.innerWidth - w - WINDOW_MARGIN * 2);
  const availH = Math.max(0, window.innerHeight - h - WINDOW_MARGIN * 2);
  return {
    x: Math.round(WINDOW_MARGIN + clampPct(xPct) * availW),
    y: Math.round(WINDOW_MARGIN + clampPct(yPct) * availH),
  };
}

/** Convert pixel left/top → viewport ratios (0–1), accounting for WINDOW_MARGIN. */
function ratioPixelsToPct(x: number, y: number, w: number, h: number): { xPct: number; yPct: number } {
  const availW = Math.max(1, window.innerWidth - w - WINDOW_MARGIN * 2);
  const availH = Math.max(1, window.innerHeight - h - WINDOW_MARGIN * 2);
  return {
    xPct: clampPct((x - WINDOW_MARGIN) / availW),
    yPct: clampPct((y - WINDOW_MARGIN) / availH),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function emitWindowEvent(eventName: string, id: string): void {
  window.dispatchEvent(new CustomEvent(eventName, { detail: { id } }));
}

/**
 * Run and clear a window's content cleanup, if registered. Errors are logged, never thrown —
 * cleanup failure must not block close/destroy.
 */
function runContentCleanup(w: WindowState): void {
  const fn = w.contentCleanup;
  if (!fn) return;
  w.contentCleanup = null;
  try {
    fn();
  } catch (err) {
    log(`[Window] Content cleanup failed for "${w.id}"`, err);
  }
}

function showWindowElement(el: HTMLElement, displayMode: 'flex' | 'block' = 'flex'): void {
  el.style.display = displayMode;
}

function setResizeHandleVisible(w: WindowState, visible: boolean): void {
  const handle = w.el.querySelector<HTMLElement>('.qpm-window-resize-handle');
  if (handle) handle.style.display = visible ? '' : 'none';
}

/** Apply position from stored ratios. */
function applyRatioPosition(w: WindowState): void {
  const rect = w.el.getBoundingClientRect();
  const { x, y } = ratioPctToPixels(w.position.xPct, w.position.yPct, rect.width, rect.height);
  w.el.style.left = `${x}px`;
  w.el.style.top = `${y}px`;
  w.el.style.right = 'auto';
  w.el.style.bottom = 'auto';
}

function restoreWindowFromMinimize(w: WindowState): void {
  showWindowElement(w.body, 'flex');
  if (w.restoreWidth) w.el.style.width = w.restoreWidth;
  if (w.restoreHeight) w.el.style.height = w.restoreHeight;
  if (w.restoreMinHeight) w.el.style.minHeight = w.restoreMinHeight;
  if (w.restoreMaxHeight) w.el.style.maxHeight = w.restoreMaxHeight;
  w.minimizeBtn.textContent = '−';
  w.minimizeBtn.title = t('window.chrome.minimize');
  setResizeHandleVisible(w, true);
  requestAnimationFrame(() => {
    clampWindowSize(w.el);
    applyRatioPosition(w);
  });
}

// ─── Size clamping ────────────────────────────────────────────────────────────

function clampWindowSizeToViewport(width: number, height: number): { width: number; height: number } {
  const maxWidth = Math.max(160, window.innerWidth - (WINDOW_MARGIN * 2));
  const maxHeight = Math.max(80, window.innerHeight - (WINDOW_MARGIN * 2));
  const minWidth = Math.min(WINDOW_MIN_WIDTH, maxWidth);
  const minHeight = Math.min(WINDOW_MIN_HEIGHT, maxHeight);
  return {
    width: Math.min(Math.max(width, minWidth), maxWidth),
    height: Math.min(Math.max(height, minHeight), maxHeight),
  };
}

function clampWindowSize(win: HTMLElement): void {
  const rect = win.getBoundingClientRect();
  const clamped = clampWindowSizeToViewport(rect.width, rect.height);

  if (Math.abs(clamped.width - rect.width) > 0.5) {
    win.style.width = `${Math.round(clamped.width)}px`;
  }
  if (Math.abs(clamped.height - rect.height) > 0.5) {
    win.style.height = `${Math.round(clamped.height)}px`;
  }
}

// ─── Viewport resize ─────────────────────────────────────────────────────────

/** Reposition all open windows from their stored ratios on browser resize. */
function repositionAllWindows(): void {
  windows.forEach((state) => {
    if (!state.isMinimized) {
      clampWindowSize(state.el);
      applyRatioPosition(state);
    }
  });
}

function ensureResizeListener(): void {
  if (resizeListenerAdded) return;
  window.addEventListener('resize', repositionAllWindows);
  resizeListenerAdded = true;
}

// ─── Position persistence ─────────────────────────────────────────────────────

/** Save position as viewport ratios. */
function saveWindowPosition(id: string): void {
  const w = windows.get(id);
  if (!w) return;
  storage.set(WINDOW_POSITION_KEY + id, { xPct: w.position.xPct, yPct: w.position.yPct });
}

/** Update position from current pixel rect and save. */
function captureAndSavePosition(w: WindowState): void {
  const rect = w.el.getBoundingClientRect();
  const pct = ratioPixelsToPct(rect.left, rect.top, rect.width, rect.height);
  w.position.xPct = pct.xPct;
  w.position.yPct = pct.yPct;
  saveWindowPosition(w.id);
}

/**
 * Load saved position, with auto-migration from old pixel-based format.
 * Returns null if no saved position exists.
 */
function loadSavedPosition(id: string, win: HTMLElement): { xPct: number; yPct: number } | null {
  const saved = storage.get<Record<string, unknown>>(WINDOW_POSITION_KEY + id);
  if (!saved || typeof saved !== 'object') return null;

  // New format: xPct/yPct ratios
  if (typeof saved.xPct === 'number' && typeof saved.yPct === 'number') {
    return { xPct: clampPct(saved.xPct), yPct: clampPct(saved.yPct) };
  }

  // Old format: { right, top } in pixels — migrate to ratios
  if (typeof saved.right === 'number' && typeof saved.top === 'number') {
    const rect = win.getBoundingClientRect();
    const left = window.innerWidth - saved.right - rect.width;
    return ratioPixelsToPct(left, saved.top, rect.width, rect.height);
  }

  return null;
}

/** Restore window position from storage or center on screen. */
function restoreWindowPosition(id: string, win: HTMLElement, state: WindowState): void {
  const saved = loadSavedPosition(id, win);

  if (saved) {
    state.position.xPct = saved.xPct;
    state.position.yPct = saved.yPct;
  } else {
    // Center on screen
    state.position.xPct = 0.5;
    state.position.yPct = 0.5;
  }

  applyRatioPosition(state);
  // Re-save to persist migration and initial centering
  saveWindowPosition(id);
}

// ─── Size persistence ─────────────────────────────────────────────────────────

function saveWindowSize(id: string, win: HTMLElement): void {
  const rect = win.getBoundingClientRect();
  storage.set(WINDOW_SIZE_KEY + id, { width: Math.round(rect.width), height: Math.round(rect.height) });
}

function restoreWindowSize(id: string, win: HTMLElement): void {
  const saved = storage.get<{ width: number; height: number }>(WINDOW_SIZE_KEY + id);
  if (saved && saved.width > 0 && saved.height > 0) {
    const clamped = clampWindowSizeToViewport(saved.width, saved.height);
    win.style.width = `${Math.round(clamped.width)}px`;
    win.style.height = `${Math.round(clamped.height)}px`;
    win.style.maxWidth = 'none';
    win.style.maxHeight = 'none';
  }
}

// ─── Window state persistence ─────────────────────────────────────────────────

function saveWindowState(id: string, isOpen: boolean, isMinimized: boolean): void {
  storage.set(WINDOW_STATE_KEY + id, { isOpen, isMinimized });
}

// ─── Window chrome helpers ────────────────────────────────────────────────────

function isWindowShown(el: HTMLElement): boolean {
  return el.style.display !== 'none';
}

function bumpZ(el: HTMLElement): void {
  el.style.zIndex = String(currentZ++);
}

function createWindowButton(text: string, title: string): HTMLElement {
  const btn = document.createElement('button');
  btn.className = 'qpm-window-btn';
  btn.textContent = text;
  btn.title = title;
  btn.style.cssText = `
    width: 26px;
    height: 26px;
    border: none;
    background: rgba(255, 255, 255, 0.08);
    color: #e0e0e0;
    font-size: ${text === '×' ? '20px' : '18px'};
    font-weight: 300;
    line-height: 1;
    cursor: pointer;
    border-radius: 4px;
    transition: all 0.15s ease;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  `;

  btn.addEventListener('mouseenter', () => {
    if (text === '×') {
      btn.style.background = 'rgba(244, 67, 54, 0.8)';
    } else {
      btn.style.background = 'rgba(143, 130, 255, 0.5)';
    }
    btn.style.color = '#fff';
  });

  btn.addEventListener('mouseleave', () => {
    btn.style.background = 'rgba(255, 255, 255, 0.08)';
    btn.style.color = '#e0e0e0';
  });

  return btn;
}

// ─── Drag ─────────────────────────────────────────────────────────────────────

function makeDraggable(win: HTMLElement, head: HTMLElement, state: WindowState): void {
  let down = false;
  let sx = 0;
  let sy = 0;
  let startLeft = 0;
  let startTop = 0;
  let dragWidth = 0;
  let dragHeight = 0;

  const onMove = (e: MouseEvent) => {
    if (!down) return;
    e.preventDefault();

    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    const rawLeft = startLeft + dx;
    const rawTop = startTop + dy;

    // Window size is stable during drag — reuse dragWidth/dragHeight captured
    // at dragstart instead of forcing layout via getBoundingClientRect per move.
    const maxLeft = Math.max(WINDOW_MARGIN, window.innerWidth - dragWidth - WINDOW_MARGIN);
    const maxTop = Math.max(WINDOW_MARGIN, window.innerHeight - dragHeight - WINDOW_MARGIN);
    const clampedLeft = Math.max(WINDOW_MARGIN, Math.min(maxLeft, rawLeft));
    const clampedTop = Math.max(WINDOW_MARGIN, Math.min(maxTop, rawTop));

    win.style.left = `${clampedLeft}px`;
    win.style.top = `${clampedTop}px`;
  };

  const onUp = () => {
    if (!down) return;
    down = false;
    head.style.cursor = 'move';
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);

    // Convert final pixel position to ratios and save
    captureAndSavePosition(state);
  };

  head.addEventListener('mousedown', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('.qpm-window-btn')) return;

    down = true;
    head.style.cursor = 'grabbing';
    sx = e.clientX;
    sy = e.clientY;

    const rect = win.getBoundingClientRect();
    startLeft = rect.left;
    startTop = rect.top;
    dragWidth = rect.width;
    dragHeight = rect.height;

    // Ensure left-anchored for drag
    win.style.left = `${rect.left}px`;
    win.style.top = `${rect.top}px`;
    win.style.right = 'auto';
    win.style.bottom = 'auto';

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    bumpZ(win);
  });
}

// ─── Resize ───────────────────────────────────────────────────────────────────

function makeResizable(win: HTMLElement, state: WindowState): void {
  const handle = document.createElement('div');
  handle.className = 'qpm-window-resize-handle';
  handle.title = t('window.chrome.resizeHint');
  handle.style.cssText = [
    'position:absolute',
    'bottom:0',
    'right:0',
    'width:16px',
    'height:16px',
    'cursor:se-resize',
    'background:linear-gradient(135deg,transparent 50%,rgba(143,130,255,0.4) 50%)',
    'border-radius:0 0 7px 0',
    'z-index:2',
    'flex-shrink:0',
  ].join(';');
  win.appendChild(handle);

  let down = false;
  let startX = 0;
  let startY = 0;
  let startW = 0;
  let startH = 0;
  let startLeft = 0;
  let startTop = 0;

  const onMove = (e: MouseEvent): void => {
    if (!down) return;
    e.preventDefault();
    const rawWidth = startW + (e.clientX - startX);
    const rawHeight = startH + (e.clientY - startY);
    const maxWidth = Math.max(160, window.innerWidth - startLeft - WINDOW_MARGIN);
    const maxHeight = Math.max(80, window.innerHeight - startTop - WINDOW_MARGIN);
    const minWidth = Math.min(WINDOW_MIN_WIDTH, maxWidth);
    const minHeight = Math.min(WINDOW_MIN_HEIGHT, maxHeight);
    const newW = Math.min(Math.max(rawWidth, minWidth), maxWidth);
    const newH = Math.min(Math.max(rawHeight, minHeight), maxHeight);
    win.style.width = `${newW}px`;
    win.style.height = `${newH}px`;
  };

  const onUp = (): void => {
    if (!down) return;
    down = false;
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    clampWindowSize(win);
    // Re-capture position ratios with new size and save both
    captureAndSavePosition(state);
    saveWindowSize(state.id, win);
  };

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = win.getBoundingClientRect();
    startW = rect.width;
    startH = rect.height;
    startLeft = rect.left;
    startTop = rect.top;
    // Ensure left-anchored so resize handle tracks cursor correctly
    win.style.left = `${rect.left}px`;
    win.style.top = `${rect.top}px`;
    win.style.right = 'auto';
    win.style.bottom = 'auto';
    win.style.width = `${startW}px`;
    win.style.height = `${startH}px`;
    win.style.maxWidth = 'none';
    win.style.maxHeight = 'none';
    startX = e.clientX;
    startY = e.clientY;
    down = true;
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    bumpZ(win);
  });
}

// ─── Shared window styles ─────────────────────────────────────────────────────

const SHARED_WINDOW_STYLES_ID = 'qpm-window-shared-styles';

function ensureSharedWindowStyles(): void {
  if (document.getElementById(SHARED_WINDOW_STYLES_ID)) return;

  const style = document.createElement('style');
  style.id = SHARED_WINDOW_STYLES_ID;
  style.textContent = `
    .qpm-window::-webkit-scrollbar {
      width: 8px;
    }
    .qpm-window::-webkit-scrollbar-track {
      background: rgba(0, 0, 0, 0.2);
      border-radius: 4px;
    }
    .qpm-window::-webkit-scrollbar-thumb {
      background: rgba(143, 130, 255, 0.35);
      border-radius: 4px;
      transition: background 0.2s;
    }
    .qpm-window::-webkit-scrollbar-thumb:hover {
      background: rgba(143, 130, 255, 0.55);
    }

    .qpm-window *,
    .qpm-window *::before,
    .qpm-window *::after {
      box-sizing: border-box;
      max-width: 100%;
      word-wrap: break-word;
      overflow-wrap: break-word;
    }

    .qpm-window .qpm-card,
    .qpm-window .qpm-card__body,
    .qpm-window .qpm-card__header,
    .qpm-window .qpm-section-muted,
    .qpm-window input,
    .qpm-window button,
    .qpm-window select,
    .qpm-window div {
      max-width: 100%;
      min-width: 0;
    }

    .qpm-window pre,
    .qpm-window code {
      white-space: pre-wrap;
      word-break: break-all;
    }
  `;
  document.head.appendChild(style);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Open a window by ID. If already exists, show it and bump to front.
 */
export function openWindow(id: string, title: string, render: PanelRender, maxWidth?: string, maxHeight?: string): void {
  if (windows.has(id)) {
    const w = windows.get(id)!;
    showWindowElement(w.el, 'flex');
    if (w.isMinimized) {
      w.isMinimized = false;
      restoreWindowFromMinimize(w);
    }
    bumpZ(w.el);
    saveWindowState(id, true, false);
    emitWindowEvent('qpm:window-restored', id);
    return;
  }

  const windowMaxWidth = maxWidth || '90vw';
  const windowMaxHeight = maxHeight || '90vh';

  // Create new window
  const win = document.createElement('div');
  win.className = 'qpm-window';
  win.id = `qpm-window-${id}`;
  win.style.cssText = `
    position: fixed;
    display: flex;
    flex-direction: column;
    width: ${windowMaxWidth};
    min-width: 260px;
    min-height: 120px;
    max-width: ${windowMaxWidth};
    max-height: ${windowMaxHeight};
    background: rgba(18, 20, 26, 0.96);
    border: 1px solid rgba(143, 130, 255, 0.5);
    border-radius: 8px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255, 255, 255, 0.05);
    backdrop-filter: blur(6px);
    font-family: ${QPM_UI_FONT_STACK};
    font-size: 13px;
    color: #e0e0e0;
    z-index: ${currentZ++};
    box-sizing: border-box;
    overflow: hidden;
  `;

  // Header
  const head = document.createElement('div');
  head.className = 'qpm-window-head';
  head.style.cssText = `
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    background: linear-gradient(135deg, rgba(143, 130, 255, 0.12) 0%, rgba(143, 130, 255, 0.04) 100%);
    border-bottom: 1px solid rgba(143, 130, 255, 0.25);
    cursor: move;
    user-select: none;
  `;

  const titleEl = document.createElement('div');
  titleEl.className = 'qpm-window-title';
  titleEl.textContent = title;
  titleEl.style.cssText = `
    font-size: 15px;
    font-weight: 600;
    color: #8f82ff;
    flex: 1;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
  `;

  const btnContainer = document.createElement('div');
  btnContainer.style.cssText = 'display: flex; gap: 6px;';

  const minimizeBtn = createWindowButton('−', t('window.chrome.minimize'));
  const closeBtn = createWindowButton('×', t('window.chrome.close'));

  btnContainer.appendChild(minimizeBtn);
  btnContainer.appendChild(closeBtn);

  head.appendChild(titleEl);
  head.appendChild(btnContainer);

  // Body
  const body = document.createElement('div');
  body.className = 'qpm-window-body';
  body.style.cssText = `
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    padding: 16px;
    background: rgba(0, 0, 0, 0.25);
    box-sizing: border-box;
  `;

  ensureSharedWindowStyles();

  win.appendChild(head);
  win.appendChild(body);

  document.body.appendChild(win);

  // Button handlers
  minimizeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMinimize(id);
  });

  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeWindow(id);
  });

  // Bump to front on click
  win.addEventListener('mousedown', () => bumpZ(win));

  // Prevent game zoom from interfering with window scrolling
  win.addEventListener('wheel', (e) => {
    e.stopPropagation();
  }, { passive: false });

  // Register window state BEFORE render
  const state: WindowState = {
    id,
    el: win,
    head,
    body,
    titleEl,
    minimizeBtn,
    closeBtn,
    isMinimized: false,
    maxWidth: windowMaxWidth,
    maxHeight: windowMaxHeight,
    position: { xPct: 0.5, yPct: 0.5 },
    restoreWidth: null,
    restoreHeight: null,
    restoreMinHeight: null,
    restoreMaxHeight: null,
    contentCleanup: null,
  };

  windows.set(id, state);
  saveWindowState(id, true, false);

  // Render content — error boundary per diagnostics design §13 Phase 5.
  // QPM-UI-001 lands in the bus + error buffer; renderWindowRenderError paints
  // a structured card in the body so the window is never left blank.
  try {
    const result = render(body);
    if (typeof result === 'function') {
      state.contentCleanup = result;
    }
  } catch (error) {
    windowLog.error('QPM-UI-001', { id }, error);
    try {
      renderWindowRenderError(body, id, error);
    } catch (boundaryErr) {
      log(`[Window] Error boundary failed for "${id}"`, boundaryErr);
    }
  }

  // Restore size first (so we know dimensions for ratio conversion)
  restoreWindowSize(id, win);

  // Restore position (reads ratios, with migration from old format)
  // Deferred to rAF so the browser has laid out the window at its final size.
  requestAnimationFrame(() => {
    clampWindowSize(win);
    restoreWindowPosition(id, win, state);
  });

  ensureResizeListener();

  // Make draggable and resizable
  makeDraggable(win, head, state);
  makeResizable(win, state);
}

/**
 * Close a window
 */
export function closeWindow(id: string): void {
  const w = windows.get(id);
  if (!w) return;

  runContentCleanup(w);
  w.el.style.display = 'none';
  saveWindowState(id, false, w.isMinimized);
  emitWindowEvent('qpm:window-closed', id);
}

/**
 * Toggle window open/close.
 * During restoreOpenWindows(), toggle is forced open-only (never closes).
 */
let _restoring = false;

export function toggleWindow(id: string, title: string, render: PanelRender, maxWidth?: string, maxHeight?: string): boolean {
  const existing = windows.get(id);
  if (!existing) {
    openWindow(id, title, render, maxWidth, maxHeight);
    return true;
  }

  if (isWindowShown(existing.el) && !_restoring) {
    closeWindow(id);
    return false;
  } else if (!isWindowShown(existing.el)) {
    showWindowElement(existing.el, 'flex');
    if (existing.isMinimized) {
      existing.isMinimized = false;
      restoreWindowFromMinimize(existing);
    }
    bumpZ(existing.el);
    saveWindowState(id, true, false);
    emitWindowEvent('qpm:window-restored', id);
    return true;
  } else {
    // _restoring && already shown — no-op
    return true;
  }
}

/**
 * Toggle minimize/restore
 */
export function toggleMinimize(id: string): void {
  const w = windows.get(id);
  if (!w) return;

  w.isMinimized = !w.isMinimized;

  if (w.isMinimized) {
    const rect = w.el.getBoundingClientRect();
    w.restoreWidth = `${Math.round(rect.width)}px`;
    w.restoreHeight = `${Math.round(rect.height)}px`;
    w.restoreMinHeight = w.el.style.minHeight || '120px';
    w.restoreMaxHeight = w.el.style.maxHeight || w.maxHeight;
    w.body.style.display = 'none';
    w.el.style.width = w.restoreWidth;
    const collapsed = Math.max(36, Math.round(w.head.getBoundingClientRect().height));
    w.el.style.height = `${collapsed}px`;
    w.el.style.minHeight = `${collapsed}px`;
    w.el.style.maxHeight = `${collapsed}px`;
    w.minimizeBtn.textContent = '□';
    w.minimizeBtn.title = t('window.chrome.restore');
    setResizeHandleVisible(w, false);
    emitWindowEvent('qpm:window-minimized', id);
  } else {
    restoreWindowFromMinimize(w);
    emitWindowEvent('qpm:window-restored', id);
  }

  saveWindowState(id, true, w.isMinimized);
}

/**
 * Get window by ID
 */
export function getWindow(id: string): WindowState | null {
  return windows.get(id) || null;
}

/**
 * Check if window exists and is open
 */
export function isWindowOpen(id: string): boolean {
  const w = windows.get(id);
  return w ? isWindowShown(w.el) : false;
}

/**
 * Close all windows
 */
export function closeAllWindows(): void {
  windows.forEach((w) => closeWindow(w.id));
}

/**
 * Destroy a window completely
 */
export function destroyWindow(id: string): void {
  const w = windows.get(id);
  if (!w) return;

  runContentCleanup(w);
  w.el.remove();
  windows.delete(id);
  saveWindowState(id, false, false);
}

/**
 * Destroy all windows
 */
export function destroyAllWindows(): void {
  windows.forEach((w) => destroyWindow(w.id));
}

/**
 * Register (or replace) the content cleanup fn for a window. Use when the render
 * completes after `openWindow` returns — e.g. lazyWindow renders a placeholder first
 * and installs real content later. Any previously registered cleanup is invoked
 * before the new one is stored.
 * If the window no longer exists, the cleanup is invoked immediately.
 */
export function registerWindowCleanup(id: string, cleanup: () => void): void {
  const w = windows.get(id);
  if (!w) {
    try {
      cleanup();
    } catch (err) {
      log(`[Window] Late cleanup failed for "${id}"`, err);
    }
    return;
  }
  runContentCleanup(w);
  w.contentCleanup = cleanup;
}

/**
 * Run and clear the registered content cleanup for a window, if any.
 * Used by `lazyWindow.invalidateWindow` to tear down before a fresh re-render.
 */
export function runWindowContentCleanup(id: string): void {
  const w = windows.get(id);
  if (!w) return;
  runContentCleanup(w);
}

/**
 * Reset all window sizes and positions to defaults.
 * Clears persisted size/position for every window and restores open windows
 * to CSS auto-sizing within their original maxWidth/maxHeight constraints.
 */
export function resetAllWindowLayouts(): void {
  // Clear stored sizes and positions from storage
  const prefixes = [WINDOW_SIZE_KEY, WINDOW_POSITION_KEY];
  removeStorageKeysByPrefix(prefixes);

  // Reset currently open windows to their original constraints
  windows.forEach((w) => {
    if (w.isMinimized) {
      w.isMinimized = false;
      restoreWindowFromMinimize(w);
    }
    // Restore to the originally configured size, not blank — clearing
    // `width`/`height` leaves the window with no inline size, so flex shrinks
    // it to the min-width default. Match the initial creation at
    // openWindow() (line 525).
    w.el.style.width = w.maxWidth;
    w.el.style.height = w.maxHeight;
    w.el.style.maxWidth = w.maxWidth;
    w.el.style.maxHeight = w.maxHeight;

    // Center on screen using ratios
    w.position.xPct = 0.5;
    w.position.yPct = 0.5;

    requestAnimationFrame(() => {
      applyRatioPosition(w);
      saveWindowPosition(w.id);
    });
  });

  log('[Window] All window layouts reset to defaults');
}

// ─── Window persistence ───────────────────────────────────────────────────────

const windowOpeners = new Map<string, () => void | Promise<void>>();

/**
 * Register an opener function for a window ID.
 * Called at init time for each restorable window.
 */
export function registerWindowOpener(id: string, opener: () => void | Promise<void>): void {
  windowOpeners.set(id, opener);
}

/**
 * Re-open any windows that were open when the page was last closed.
 * Reads saved state for each registered opener and calls it if isOpen is true.
 */
export function restoreOpenWindows(): void {
  _restoring = true;
  try {
    for (const [id, opener] of windowOpeners) {
      try {
        const saved = storage.get<{ isOpen: boolean; isMinimized: boolean }>(WINDOW_STATE_KEY + id);
        if (!saved?.isOpen) continue;

        // Skip if the window is somehow already open
        if (isWindowOpen(id)) continue;

        const result = opener();
        const isAsync = result != null && typeof (result as Promise<unknown>).then === 'function';

        // Restore minimized state
        const applyMinimized = (): void => {
          if (!saved.isMinimized) return;
          const w = windows.get(id);
          if (w && !w.isMinimized) {
            toggleMinimize(id);
          }
        };

        if (isAsync) {
          (result as Promise<unknown>)
            .then(applyMinimized)
            .catch((err) => {
              log(`[Window] Failed to restore window "${id}"`, err);
            });
        } else {
          applyMinimized();
        }
      } catch (error) {
        log(`[Window] Failed to restore window "${id}"`, error);
      }
    }
  } finally {
    _restoring = false;
  }
}
