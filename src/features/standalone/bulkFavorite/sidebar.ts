import { getCropSpriteDataUrl } from '../../../sprite-v2/compat';
import { findLockSpriteUrl } from '../../../utils/lockSprite';
import { addStyle } from '../../../utils/dom/dom';
import {
  STYLE_ID,
  SIDEBAR_ID,
  CLOSE_PROBE_MS,
  VIEWPORT_MARGIN,
  SIDEBAR_GAP,
  TOP_STRIP_HEIGHT,
  RIGHT_MIN_SPACE,
  MAX_ANCHOR_MISSES,
  CSS,
} from './constants';
import { log, ui } from './state';
import { getProduceGroups, getGroupsSignature } from './groups';
import { resolveInventoryAnchor } from './scanner';
import { handleToggle } from './actions';
import type { InventoryAnchor, ProduceGroup, Rect, SidebarLayout } from './types';

let stylesInjected = false;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function ensureStyles(): void {
  if (stylesInjected) return;
  if (document.getElementById(STYLE_ID)) {
    stylesInjected = true;
    return;
  }

  const style = addStyle(CSS);
  style.id = STYLE_ID;
  stylesInjected = true;
}

function getLockUiSprites(): { locked: string; unlocked: string } {
  if (ui.lockUiSpriteCache) return ui.lockUiSpriteCache;

  ui.lockUiSpriteCache = {
    locked: findLockSpriteUrl('locked'),
    unlocked: findLockSpriteUrl('unlocked'),
  };

  return ui.lockUiSpriteCache;
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

export function renderSidebar(force = false): void {
  if (!ui.sidebar) return;

  const groups = getProduceGroups();
  const signature = getGroupsSignature(groups);
  if (!force && signature === ui.lastRenderSignature) {
    return;
  }
  ui.lastRenderSignature = signature;

  if (groups.length === 0) {
    ui.sidebar.replaceChildren();
    ui.sidebar.style.display = 'none';
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const group of groups) {
    fragment.appendChild(createButton(group));
  }

  ui.sidebar.replaceChildren(fragment);
  ui.sidebar.style.display = 'flex';
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
  if (!ui.sidebar) return;

  const signature = getLayoutSignature(layout);
  if (!force && signature === ui.lastLayoutSignature) {
    return;
  }
  ui.lastLayoutSignature = signature;

  ui.sidebar.classList.toggle('qpm-bulk-fav--right', layout.placement === 'right');
  ui.sidebar.classList.toggle('qpm-bulk-fav--top', layout.placement === 'top');

  if (layout.placement === 'right') {
    ui.sidebar.style.cssText = [
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

  ui.sidebar.style.cssText = [
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
  if (!ui.sidebar) {
    ui.sidebar = createSidebar();
    document.body.appendChild(ui.sidebar);
    log.debug(`Sidebar shown (${anchor.source})`);
  }

  applySidebarLayout(computeSidebarLayout(anchor.rect), true);
  renderSidebar(true);
}

export function hideSidebar(): void {
  if (!ui.sidebar) return;
  ui.sidebar.remove();
  ui.sidebar = null;
  if (ui.closeProbeTimer) {
    clearTimeout(ui.closeProbeTimer);
    ui.closeProbeTimer = null;
  }
  if (ui.immediateSyncTimer !== null) {
    clearTimeout(ui.immediateSyncTimer);
    ui.immediateSyncTimer = null;
  }
  ui.lastLayoutSignature = '';
  ui.lastRenderSignature = '';
  ui.anchorMissCount = 0;
  log.debug('Sidebar hidden');
}

export function syncSidebar(refreshContent: boolean, forceHideOnMiss = false): void {
  const anchor = resolveInventoryAnchor();
  if (!anchor) {
    if (forceHideOnMiss) {
      hideSidebar();
      return;
    }

    if (ui.sidebar && !ui.closeProbeTimer) {
      ui.closeProbeTimer = setTimeout(() => {
        ui.closeProbeTimer = null;
        syncSidebar(false, true);
      }, CLOSE_PROBE_MS);
    }

    ui.anchorMissCount += 1;
    if (ui.anchorMissCount >= MAX_ANCHOR_MISSES) {
      hideSidebar();
    }
    return;
  }

  if (ui.closeProbeTimer) {
    clearTimeout(ui.closeProbeTimer);
    ui.closeProbeTimer = null;
  }
  ui.anchorMissCount = 0;

  if (!ui.sidebar) {
    showSidebar(anchor);
    return;
  }

  applySidebarLayout(computeSidebarLayout(anchor.rect));
  if (refreshContent) {
    renderSidebar();
  }
}
