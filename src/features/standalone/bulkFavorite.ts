// src/features/bulkFavorite.ts
// Bulk Favorite Feature
// Shows per-species buttons near inventory and toggles favorites in bulk.

import { log } from '../../utils/logger';
import { getInventoryItems, getFavoritedItemIds, onInventoryChange, type InventoryItem } from '../../store/inventory';
import { getCropSpriteDataUrl, getAnySpriteDataUrl, onSpritesReady, Sprites } from '../../sprite-v2/compat';
import { addStyle } from '../../utils/dom';
import { getAllPlantSpecies, areCatalogsReady } from '../../catalogs/gameCatalogs';
import { sendRoomAction } from '../../websocket/api';
import { storage } from '../../utils/storage';
import { pageWindow } from '../../core/pageContext';

interface ProduceGroup {
  species: string;
  itemIds: string[];
  allLocked: boolean;
}

export interface BulkFavoriteConfig {
  enabled: boolean;
}

type SidebarPlacement = 'right' | 'top';

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface PixiBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface InventoryAnchor {
  rect: Rect;
  source: 'InventoryItems' | 'InventoryContent';
}

interface SidebarLayout {
  placement: SidebarPlacement;
  left: number;
  top: number;
  maxHeight: number;
  maxWidth?: number;
}

interface PixiDisplayObject {
  label?: unknown;
  children?: PixiDisplayObject[];
  getBounds?: () => unknown;
  visible?: unknown;
  renderable?: unknown;
  worldVisible?: unknown;
  alpha?: unknown;
  worldAlpha?: unknown;
}

interface PixiRendererLike {
  screen?: { width?: number; height?: number };
  view?: unknown;
  canvas?: unknown;
}

interface PixiAppLike {
  stage?: PixiDisplayObject;
  renderer?: PixiRendererLike;
}

interface PixiCaptureLike {
  app?: PixiAppLike;
  renderer?: PixiRendererLike;
}

interface PixiNodeMatch {
  node: PixiDisplayObject;
  bounds: PixiBounds;
  area: number;
}

let observer: MutationObserver | null = null;
let sidebar: HTMLElement | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let resizeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let closeProbeTimer: ReturnType<typeof setTimeout> | null = null;
let immediateMutationRaf: number | null = null;
let inventoryUnsubscribe: (() => void) | null = null;
let resizeListener: (() => void) | null = null;
let spritesReadyUnsubscribe: (() => void) | null = null;
let stylesInjected = false;
let lastRenderSignature = '';
let lastLayoutSignature = '';
let anchorMissCount = 0;
let lockUiSpriteCache: { locked: string; unlocked: string } | null = null;

const STYLE_ID = 'qpm-bulk-favorite-styles';
const SIDEBAR_ID = 'qpm-bulk-favorite-sidebar';
const CONFIG_KEY = 'qpm.bulkFavorite.v1';
const DEBOUNCE_MS = 180;
const RESIZE_DEBOUNCE_MS = 140;
const CLOSE_PROBE_MS = 150;

const VIEWPORT_MARGIN = 8;
const SIDEBAR_GAP = 8;
const TOP_STRIP_HEIGHT = 78;
const RIGHT_MIN_SPACE = 80;
const MIN_INVENTORY_WIDTH = 220;
const MIN_INVENTORY_HEIGHT = 160;
const MIN_VISIBLE_AREA = 12000;
const MIN_OPEN_ITEM_VIEW_COUNT = 12;
const MAX_ANCHOR_MISSES = 3;
const DEFAULT_CONFIG: BulkFavoriteConfig = { enabled: true };

const CSS = `
  #${SIDEBAR_ID} {
    display: flex;
    gap: 6px;
    pointer-events: auto;
    padding: 8px;
    background: transparent;
    border-radius: 0;
    backdrop-filter: none;
  }

  #${SIDEBAR_ID}.qpm-bulk-fav--right {
    flex-direction: column;
    align-items: stretch;
  }

  #${SIDEBAR_ID}.qpm-bulk-fav--top {
    flex-direction: row;
    align-items: flex-start;
    white-space: nowrap;
  }

  #${SIDEBAR_ID}.qpm-bulk-fav--top .qpm-bulk-fav-btn {
    flex: 0 0 auto;
  }

  #${SIDEBAR_ID}::-webkit-scrollbar {
    width: 4px;
    height: 4px;
  }

  #${SIDEBAR_ID}::-webkit-scrollbar-track {
    background: rgba(0, 0, 0, 0.2);
    border-radius: 2px;
  }

  #${SIDEBAR_ID}::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.3);
    border-radius: 2px;
  }

  .qpm-bulk-fav-btn {
    position: relative;
    width: 62px;
    height: 62px;
    background: rgba(0, 0, 0, 0.85);
    border-radius: 6px;
    border: none;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: box-shadow 0.15s ease, background 0.15s ease;
    padding: 4px;
    gap: 2px;
    overflow: visible;
    z-index: 1;
    transform-origin: center center;
  }

  .qpm-bulk-fav-btn:hover {
    transform: scale(1.05);
    background: rgba(0, 0, 0, 0.92);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.42);
    z-index: 2;
  }

  .qpm-bulk-fav-btn:active {
    transform: scale(0.98);
    background: rgba(0, 0, 0, 0.96);
  }

  .qpm-bulk-fav-sprite {
    width: 36px;
    height: 36px;
    object-fit: contain;
    image-rendering: pixelated;
  }

  .qpm-bulk-fav-status {
    position: absolute;
    top: -6px;
    right: -6px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    z-index: 3;
    pointer-events: none;
  }

  .qpm-bulk-fav-status-icon {
    width: 22px;
    height: 22px;
    object-fit: contain;
    image-rendering: pixelated;
    flex: 0 0 auto;
  }

  .qpm-bulk-fav-label {
    color: #ffffff;
    font-size: 9px;
    font-weight: 600;
    text-align: center;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9);
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: 1.1;
  }
`;

function loadConfig(): BulkFavoriteConfig {
  const saved = storage.get<Partial<BulkFavoriteConfig> | null>(CONFIG_KEY, null);
  return {
    ...DEFAULT_CONFIG,
    ...(saved ?? {}),
  };
}

function saveConfig(): void {
  storage.set(CONFIG_KEY, config);
}

let config: BulkFavoriteConfig = loadConfig();

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function ensureStyles(): void {
  if (stylesInjected) return;
  if (document.getElementById(STYLE_ID)) {
    stylesInjected = true;
    return;
  }

  const style = addStyle(CSS);
  style.id = STYLE_ID;
  stylesInjected = true;
}

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

function resolveInventoryAnchor(): InventoryAnchor | null {
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

function getItemUUID(item: InventoryItem): string | null {
  const raw = item.raw as Record<string, unknown> | undefined;
  const uuid = raw?.id ?? item.itemId ?? null;
  return typeof uuid === 'string' && uuid.length > 0 ? uuid : null;
}

function isValidSpecies(species: string): boolean {
  if (!areCatalogsReady()) return true;
  const knownSpecies = getAllPlantSpecies();
  return knownSpecies.includes(species);
}

function getProduceGroups(): ProduceGroup[] {
  const items = getInventoryItems();
  const favoritedIds = getFavoritedItemIds();
  const groupMap = new Map<string, string[]>();

  for (const item of items) {
    const raw = item.raw as Record<string, unknown> | undefined;
    const itemType = raw?.itemType ?? item.itemType;
    const species = (raw?.species ?? item.species) as string | undefined;
    const uuid = getItemUUID(item);

    if (itemType !== 'Produce' || !species || !uuid) continue;

    if (!isValidSpecies(species)) {
      log(`[BulkFavorite] Unknown species in bulk favorite: ${species}`);
    }

    const existing = groupMap.get(species);
    if (existing) {
      existing.push(uuid);
    } else {
      groupMap.set(species, [uuid]);
    }
  }

  const groups: ProduceGroup[] = [];
  for (const [species, itemIds] of groupMap) {
    const allLocked = itemIds.length > 0 && itemIds.every((uuid) => favoritedIds.has(uuid));
    groups.push({ species, itemIds, allLocked });
  }
  groups.sort((a, b) => a.species.localeCompare(b.species));
  return groups;
}

function sendFavoriteToggle(itemId: string): boolean {
  const sent = sendRoomAction('ToggleLockItem', { itemId }, { throttleMs: 50 });
  if (!sent.ok && sent.reason !== 'throttled') {
    log(`[BulkFavorite] Failed to send lock toggle (${sent.reason ?? 'unknown'})`);
  }
  return sent.ok;
}

function tryGetAnySpriteUrl(keys: string[]): string {
  for (const key of keys) {
    const url = getAnySpriteDataUrl(key);
    if (url && url.startsWith('data:image')) {
      return url;
    }
  }
  return '';
}

function scoreSpriteKeyForLock(key: string, target: 'locked' | 'unlocked'): number {
  const normalized = key.toLowerCase();
  let score = 0;

  if (normalized.includes('/ui/')) score += 3;
  if (normalized.includes('sprite/ui/')) score += 3;

  if (target === 'locked') {
    if (normalized.includes('unlocked') || normalized.includes('unlock')) return -100;
    if (normalized.includes('locked')) score += 8;
    else if (normalized.includes('lock')) score += 5;
  } else {
    if (normalized.includes('unlocked')) score += 8;
    else if (normalized.includes('unlock')) score += 6;
    if (normalized.includes('locked') && !normalized.includes('unlocked')) score -= 5;
  }

  return score;
}

function findBestLockSprite(target: 'locked' | 'unlocked'): string {
  const directCandidates =
    target === 'locked'
      ? ['sprite/ui/Locked', 'ui/Locked', 'sprite/ui/Lock', 'ui/Lock']
      : ['sprite/ui/Unlocked', 'ui/Unlocked', 'sprite/ui/Unlock', 'ui/Unlock'];

  const direct = tryGetAnySpriteUrl(directCandidates);
  if (direct) return direct;

  const allKeys = Sprites.lists().all;
  if (!Array.isArray(allKeys) || allKeys.length === 0) return '';

  const scored = allKeys
    .map((key) => ({ key, score: scoreSpriteKeyForLock(String(key), target) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  for (const candidate of scored) {
    const url = getAnySpriteDataUrl(candidate.key);
    if (url && url.startsWith('data:image')) {
      return url;
    }
  }

  return '';
}

function getLockUiSprites(): { locked: string; unlocked: string } {
  if (lockUiSpriteCache) return lockUiSpriteCache;

  lockUiSpriteCache = {
    locked: findBestLockSprite('locked'),
    unlocked: findBestLockSprite('unlocked'),
  };

  return lockUiSpriteCache;
}

function createButton(group: ProduceGroup): HTMLButtonElement {
  const { species, itemIds, allLocked } = group;

  const btn = document.createElement('button');
  btn.className = 'qpm-bulk-fav-btn';
  btn.title = `Click to ${allLocked ? 'Unlock' : 'Lock'} all ${itemIds.length} ${species}`;
  btn.dataset.species = species;

  const sprite = document.createElement('img');
  sprite.className = 'qpm-bulk-fav-sprite';
  sprite.alt = species;

  const spriteUrl = getCropSpriteDataUrl(species);
  if (spriteUrl && spriteUrl.startsWith('data:image')) {
    sprite.src = spriteUrl;
  } else {
    const fallback = document.createElement('div');
    fallback.className = 'qpm-bulk-fav-sprite';
    fallback.style.cssText = 'display:flex;align-items:center;justify-content:center;font-size:18px;color:#fff;background:rgba(255,255,255,0.15);border-radius:4px;';
    fallback.textContent = species.charAt(0).toUpperCase();
    btn.appendChild(fallback);
  }

  const status = document.createElement('span');
  status.className = 'qpm-bulk-fav-status';

  const statusIcon = document.createElement('img');
  statusIcon.className = 'qpm-bulk-fav-status-icon';
  statusIcon.alt = allLocked ? 'Locked' : 'Unlocked';
  const lockUiSprites = getLockUiSprites();
  const statusIconUrl = allLocked ? lockUiSprites.locked : lockUiSprites.unlocked;
  if (statusIconUrl) {
    statusIcon.src = statusIconUrl;
  } else {
    statusIcon.style.display = 'none';
    status.style.display = 'none';
  }

  status.appendChild(statusIcon);

  const label = document.createElement('span');
  label.className = 'qpm-bulk-fav-label';
  label.textContent = species;

  if (spriteUrl && spriteUrl.startsWith('data:image')) {
    btn.appendChild(sprite);
  }
  btn.appendChild(status);
  btn.appendChild(label);

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    void handleToggle(species);
  });

  return btn;
}

function createSidebar(): HTMLElement {
  const sidebarEl = document.createElement('div');
  sidebarEl.id = SIDEBAR_ID;
  sidebarEl.classList.add('qpm-bulk-fav--right');
  return sidebarEl;
}

function getGroupsSignature(groups: ProduceGroup[]): string {
  return groups
    .map((group) => `${group.species}:${group.itemIds.length}:${group.allLocked ? 1 : 0}`)
    .join('|');
}

function renderSidebar(force = false): void {
  if (!sidebar) return;

  const groups = getProduceGroups();
  const signature = getGroupsSignature(groups);
  if (!force && signature === lastRenderSignature) {
    return;
  }
  lastRenderSignature = signature;

  if (groups.length === 0) {
    sidebar.replaceChildren();
    sidebar.style.display = 'none';
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const group of groups) {
    fragment.appendChild(createButton(group));
  }

  sidebar.replaceChildren(fragment);
  sidebar.style.display = 'flex';
}

function getLayoutSignature(layout: SidebarLayout): string {
  return [
    layout.placement,
    Math.round(layout.left),
    Math.round(layout.top),
    Math.round(layout.maxHeight),
    Math.round(layout.maxWidth ?? 0),
  ].join('|');
}

function computeSidebarLayout(anchor: Rect): SidebarLayout {
  const rightLeft = anchor.left + anchor.width + SIDEBAR_GAP;
  const rightTop = clamp(anchor.top, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, window.innerHeight - 120));
  const rightSpace = window.innerWidth - rightLeft - VIEWPORT_MARGIN;

  if (rightSpace >= RIGHT_MIN_SPACE) {
    return {
      placement: 'right',
      left: rightLeft,
      top: rightTop,
      maxHeight: Math.max(200, Math.min(anchor.height, window.innerHeight - rightTop - VIEWPORT_MARGIN)),
    };
  }

  const topY = Math.max(VIEWPORT_MARGIN, anchor.top - TOP_STRIP_HEIGHT - SIDEBAR_GAP);
  const topLeft = clamp(anchor.left, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, window.innerWidth - 200));
  const topMaxWidth = Math.max(180, Math.min(anchor.width, window.innerWidth - topLeft - VIEWPORT_MARGIN));

  return {
    placement: 'top',
    left: topLeft,
    top: topY,
    maxHeight: TOP_STRIP_HEIGHT,
    maxWidth: topMaxWidth,
  };
}

function applySidebarLayout(layout: SidebarLayout, force = false): void {
  if (!sidebar) return;

  const signature = getLayoutSignature(layout);
  if (!force && signature === lastLayoutSignature) {
    return;
  }
  lastLayoutSignature = signature;

  sidebar.classList.toggle('qpm-bulk-fav--right', layout.placement === 'right');
  sidebar.classList.toggle('qpm-bulk-fav--top', layout.placement === 'top');

  if (layout.placement === 'right') {
    sidebar.style.cssText = [
      'position: fixed',
      `top: ${Math.round(layout.top)}px`,
      `left: ${Math.round(layout.left)}px`,
      `max-height: ${Math.round(layout.maxHeight)}px`,
      'overflow-y: auto',
      'overflow-x: visible',
      'z-index: 2147483646',
      'pointer-events: auto',
    ].join(';');
    return;
  }

  sidebar.style.cssText = [
    'position: fixed',
    `top: ${Math.round(layout.top)}px`,
    `left: ${Math.round(layout.left)}px`,
      `max-height: ${Math.round(layout.maxHeight)}px`,
      `max-width: ${Math.round(layout.maxWidth ?? 240)}px`,
      'overflow-x: auto',
      'overflow-y: visible',
      'z-index: 2147483646',
      'pointer-events: auto',
    ].join(';');
}

function showSidebar(anchor: InventoryAnchor): void {
  ensureStyles();
  if (!sidebar) {
    sidebar = createSidebar();
    document.body.appendChild(sidebar);
    log(`[BulkFavorite] Sidebar shown (${anchor.source})`);
  }

  applySidebarLayout(computeSidebarLayout(anchor.rect), true);
  renderSidebar(true);
}

function hideSidebar(): void {
  if (!sidebar) return;
  sidebar.remove();
  sidebar = null;
  if (closeProbeTimer) {
    clearTimeout(closeProbeTimer);
    closeProbeTimer = null;
  }
  if (immediateMutationRaf !== null) {
    cancelAnimationFrame(immediateMutationRaf);
    immediateMutationRaf = null;
  }
  lastLayoutSignature = '';
  lastRenderSignature = '';
  anchorMissCount = 0;
  log('[BulkFavorite] Sidebar hidden');
}

function syncSidebar(refreshContent: boolean, forceHideOnMiss = false): void {
  const anchor = resolveInventoryAnchor();
  if (!anchor) {
    if (forceHideOnMiss) {
      hideSidebar();
      return;
    }

    if (sidebar && !closeProbeTimer) {
      closeProbeTimer = setTimeout(() => {
        closeProbeTimer = null;
        syncSidebar(false, true);
      }, CLOSE_PROBE_MS);
    }

    anchorMissCount += 1;
    if (anchorMissCount >= MAX_ANCHOR_MISSES) {
      hideSidebar();
    }
    return;
  }

  if (closeProbeTimer) {
    clearTimeout(closeProbeTimer);
    closeProbeTimer = null;
  }
  anchorMissCount = 0;

  if (!sidebar) {
    showSidebar(anchor);
    return;
  }

  applySidebarLayout(computeSidebarLayout(anchor.rect));
  if (refreshContent) {
    renderSidebar();
  }
}

async function handleToggle(species: string): Promise<void> {
  const items = getInventoryItems();
  const favoritedIds = getFavoritedItemIds();
  const itemUUIDs: string[] = [];

  for (const item of items) {
    const raw = item.raw as Record<string, unknown> | undefined;
    const itemType = raw?.itemType ?? item.itemType;
    const itemSpecies = (raw?.species ?? item.species) as string | undefined;
    if (itemType !== 'Produce' || itemSpecies !== species) continue;
    const uuid = getItemUUID(item);
    if (uuid) itemUUIDs.push(uuid);
  }

  if (itemUUIDs.length === 0) {
    log(`[BulkFavorite] No items found for species: ${species}`);
    return;
  }

  const lockedCount = itemUUIDs.filter((uuid) => favoritedIds.has(uuid)).length;
  const allLocked = lockedCount === itemUUIDs.length;

  const uuidsToToggle = allLocked
    ? itemUUIDs.filter((uuid) => favoritedIds.has(uuid))
    : itemUUIDs.filter((uuid) => !favoritedIds.has(uuid));

  const action = allLocked ? 'Unlocking' : 'Locking';
  log(`[BulkFavorite] ${action} ${uuidsToToggle.length}/${itemUUIDs.length} ${species} items (${lockedCount} already locked)`);

  let successCount = 0;
  for (const uuid of uuidsToToggle) {
    if (sendFavoriteToggle(uuid)) {
      successCount += 1;
      await delay(40);
    }
  }

  log(`[BulkFavorite] Toggled ${successCount}/${uuidsToToggle.length} ${species} items`);
  setTimeout(() => renderSidebar(true), 250);
}

function handleMutations(): void {
  // Mutation observer should only manage visibility/position.
  // Content refresh is driven by inventory-store updates and explicit refresh calls.
  syncSidebar(false);
}

function debouncedMutationHandler(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(handleMutations, DEBOUNCE_MS);
}

function shouldIgnoreMutations(records: MutationRecord[]): boolean {
  if (!sidebar) return false;
  const sb = sidebar;

  return records.every((record) => {
    const target = record.target;
    const targetInsideSidebar = target instanceof Node && sb.contains(target);
    if (!targetInsideSidebar) return false;

    const addedInsideSidebar = Array.from(record.addedNodes).every((node) => sb.contains(node));
    const removedInsideSidebar = Array.from(record.removedNodes).every((node) => {
      // Removed nodes might no longer be connected, so fallback to previous-parent target check.
      return sb.contains(node) || targetInsideSidebar;
    });

    return addedInsideSidebar && removedInsideSidebar;
  });
}

function handleResize(): void {
  if (!sidebar) return;

  if (resizeDebounceTimer) {
    clearTimeout(resizeDebounceTimer);
  }

  resizeDebounceTimer = setTimeout(() => {
    resizeDebounceTimer = null;
    syncSidebar(false, true);
  }, RESIZE_DEBOUNCE_MS);
}

export function startBulkFavorite(): void {
  if (!config.enabled) {
    hideSidebar();
    return;
  }

  if (observer) {
    log('[BulkFavorite] Already started');
    return;
  }

  ensureStyles();

  observer = new MutationObserver((records) => {
    if (shouldIgnoreMutations(records)) return;

    // When the sidebar is already visible, prioritize close detection speed.
    // This keeps hide behavior near-instant when inventory closes.
    if (sidebar) {
      if (immediateMutationRaf !== null) return;
      immediateMutationRaf = requestAnimationFrame(() => {
        immediateMutationRaf = null;
        syncSidebar(false, true);
      });
      return;
    }

    debouncedMutationHandler();
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: false,
    characterData: false,
  });

  inventoryUnsubscribe = onInventoryChange(() => {
    if (sidebar) {
      renderSidebar();
    }
  });

  spritesReadyUnsubscribe = onSpritesReady(() => {
    lockUiSpriteCache = null;
    renderSidebar(true);
  });

  resizeListener = handleResize;
  window.addEventListener('resize', resizeListener);

  syncSidebar(true);
  log('[BulkFavorite] Started');
}

export function stopBulkFavorite(): void {
  if (observer) {
    observer.disconnect();
    observer = null;
  }

  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  if (resizeDebounceTimer) {
    clearTimeout(resizeDebounceTimer);
    resizeDebounceTimer = null;
  }

  if (closeProbeTimer) {
    clearTimeout(closeProbeTimer);
    closeProbeTimer = null;
  }

  if (immediateMutationRaf !== null) {
    cancelAnimationFrame(immediateMutationRaf);
    immediateMutationRaf = null;
  }

  if (inventoryUnsubscribe) {
    inventoryUnsubscribe();
    inventoryUnsubscribe = null;
  }

  if (resizeListener) {
    window.removeEventListener('resize', resizeListener);
    resizeListener = null;
  }

  if (spritesReadyUnsubscribe) {
    spritesReadyUnsubscribe();
    spritesReadyUnsubscribe = null;
  }

  lastLayoutSignature = '';
  lastRenderSignature = '';
  anchorMissCount = 0;
  lockUiSpriteCache = null;

  hideSidebar();
  log('[BulkFavorite] Stopped');
}

export function refreshBulkFavorite(): void {
  syncSidebar(true);
}

export function isBulkFavoriteActive(): boolean {
  return observer !== null;
}

export function isBulkFavoriteEnabled(): boolean {
  return config.enabled;
}

export function setBulkFavoriteEnabled(enabled: boolean): void {
  const next = Boolean(enabled);
  if (config.enabled === next) return;

  config = { ...config, enabled: next };
  saveConfig();

  if (next) {
    startBulkFavorite();
  } else {
    stopBulkFavorite();
  }
}
