import type {
  ActivityLogEntry,
  ModalHandles,
  OrderFilter,
  ActionKey,
  TypeFilter,
  SpeciesLookupEntry,
} from './types';
import {
  VIRTUAL_WINDOW_SIZE,
  VIRTUAL_SCROLL_THROTTLE_MS,
  VIRTUAL_DEFAULT_ROW_HEIGHT,
  VIRTUAL_SPACER_ATTR,
  VIRTUAL_SPACER_TOP,
  VIRTUAL_SPACER_BOTTOM,
  VIRTUAL_HIDDEN_LOAD_ATTR,
  VIRTUAL_CUSTOM_LOAD_ATTR,
  VIRTUAL_HYDRATE_CHUNK_MIN,
  VIRTUAL_HYDRATE_CHUNK_MAX,
  VIRTUAL_HYDRATE_NEAR_BOTTOM_PX,
} from './constants';
import { S } from './state';
import {
  isReplaySafeEntry,
  normalizeWhitespace,
  getEntryElements,
  normalizeAction,
  inferActionFromMessage,
  actionToType,
  normalizeToken,
  readString,
  readEntryMessage,
  normalizePetNameKey,
  detectSpeciesKeyFromText,
  entryKey,
} from './parsing';
import { invalidateVirtualCaches } from './persistence';
import {
  getPetLookupEntriesCached,
  getPlantLookupEntriesCached,
  buildHistorySpeciesContext,
  getHistoryEntryFilterMetadata,
} from './matching';

export function resetVirtualMode(): void {
  S.virtualMode = 'collapsed';
  S.virtualWindowStart = 0;
  S.virtualWindowEnd = 0;
  S.virtualTotalFiltered = 0;
  S.virtualTopSpacerPx = 0;
  S.virtualBottomSpacerPx = 0;
  S.virtualAvgRowHeight = VIRTUAL_DEFAULT_ROW_HEIGHT;
  S.virtualLastScrollUpdateAt = 0;
  S.virtualIgnoreScrollUntil = 0;
  S.readPatchStartIndex = 0;
  S.readPatchMaxEntries = null;
  S.virtualSpacerTopEl = null;
  S.virtualSpacerBottomEl = null;
  S.virtualListLayoutApplied = false;
  S.virtualListPrevJustifyContent = '';
  S.virtualListPrevAlignContent = '';
  S.virtualListPrevAlignItems = '';
  S.virtualPendingWindowStart = null;
  S.virtualPendingReason = '';
  S.virtualPendingPreserveScroll = false;
  S.virtualHydratedCount = 0;
  S.virtualReplayDurationMs = 0;
  S.virtualLoadMoreButton = null;
  S.virtualLoadButtonClassName = '';
  invalidateVirtualCaches();
}

export function entryMatchesFilters(meta: {
  action: ActionKey;
  type: TypeFilter;
  petFilterKey: string | null;
  plantFilterKey: string | null;
}): boolean {
  const matchAction = S.filters.action === 'all' || meta.action === S.filters.action;
  const matchType = S.filters.type === 'all' || meta.type === S.filters.type;
  const petFilterKey = S.filters.petSpecies;
  const plantFilterKey = S.filters.plantSpecies;
  const matchPet = !petFilterKey || meta.petFilterKey === petFilterKey;
  const matchPlant = !plantFilterKey || meta.plantFilterKey === plantFilterKey;
  const matchSpecies = petFilterKey && plantFilterKey
    ? (matchPet || matchPlant)
    : (matchPet && matchPlant);
  return matchAction && matchType && matchSpecies;
}

export function getOrderedHistoryRefs(order: OrderFilter): ActivityLogEntry[] {
  const key = `${S.historyRevision}|${S.history.length}|${S.history[0]?.timestamp ?? 0}|${S.history[S.history.length - 1]?.timestamp ?? 0}`;
  if (S.orderedHistoryCacheKey !== key) {
    S.orderedHistoryCacheKey = key;
    S.orderedHistoryNewestCache = null;
    S.orderedHistoryOldestCache = null;
  }

  if (order === 'oldest') {
    if (!S.orderedHistoryOldestCache) {
      S.orderedHistoryOldestCache = S.history.slice().sort((a, b) => a.timestamp - b.timestamp);
    }
    return S.orderedHistoryOldestCache;
  }

  if (!S.orderedHistoryNewestCache) {
    S.orderedHistoryNewestCache = S.history.slice().sort((a, b) => b.timestamp - a.timestamp);
  }
  return S.orderedHistoryNewestCache;
}

export function getFilteredHistoryEntries(order: OrderFilter): ActivityLogEntry[] {
  const cacheKey = `${S.historyRevision}|${order}|${S.filters.action}|${S.filters.type}|${S.filters.petSpecies}|${S.filters.plantSpecies}`;
  if (S.virtualFilteredCacheKey === cacheKey) {
    return S.virtualFilteredCache;
  }

  const ordered = getOrderedHistoryRefs(order);
  const needsFiltering = S.filters.action !== 'all'
    || S.filters.type !== 'all'
    || Boolean(S.filters.petSpecies)
    || Boolean(S.filters.plantSpecies);

  const out: ActivityLogEntry[] = [];
  if (!needsFiltering) {
    for (const entry of ordered) {
      if (!isReplaySafeEntry(entry)) continue;
      out.push(entry);
    }
  } else {
    const hasSpeciesFilter = Boolean(S.filters.petSpecies || S.filters.plantSpecies);
    const pets = hasSpeciesFilter ? getPetLookupEntriesCached() : null;
    const plants = hasSpeciesFilter ? getPlantLookupEntriesCached() : null;
    const context = hasSpeciesFilter
      ? buildHistorySpeciesContext(pets ?? [], plants ?? [])
      : null;

    for (const entry of ordered) {
      if (!isReplaySafeEntry(entry)) continue;
      const meta = getHistoryEntryFilterMetadata(entry, context, pets, plants);
      if (!entryMatchesFilters(meta)) continue;
      out.push(entry);
    }
  }

  S.virtualFilteredCacheKey = cacheKey;
  S.virtualFilteredCache = out;
  S.virtualTotalFiltered = out.length;
  return out;
}

export function getLoadMoreButtonFromTarget(target: EventTarget | null): HTMLButtonElement | null {
  if (!(target instanceof Element)) return null;
  const button = target.closest('button');
  if (!(button instanceof HTMLButtonElement)) return null;
  if (!S.modalHandles?.list.contains(button)) return null;
  if (button.getAttribute(VIRTUAL_CUSTOM_LOAD_ATTR) === '1') return button;
  const text = normalizeWhitespace(button.textContent || '');
  if (!text) return null;
  return /\bload\b/i.test(text) && /\bmore\b/i.test(text)
    ? button
    : null;
}

export function hideNativeLoadMoreButtons(list: HTMLElement): void {
  const buttons = Array.from(list.querySelectorAll('button'));
  for (const node of buttons) {
    if (!(node instanceof HTMLButtonElement)) continue;
    if (node.getAttribute(VIRTUAL_CUSTOM_LOAD_ATTR) === '1') continue;
    const text = normalizeWhitespace(node.textContent || '');
    if (!/\bload\b/i.test(text) || !/\bmore\b/i.test(text)) continue;
    if (node.getAttribute(VIRTUAL_HIDDEN_LOAD_ATTR) !== '1') {
      node.setAttribute(VIRTUAL_HIDDEN_LOAD_ATTR, '1');
      node.style.display = 'none';
      node.style.pointerEvents = 'none';
    }
  }
}

export function restoreNativeLoadMoreButtons(list: HTMLElement): void {
  const buttons = Array.from(list.querySelectorAll(`button[${VIRTUAL_HIDDEN_LOAD_ATTR}="1"]`));
  for (const node of buttons) {
    if (!(node instanceof HTMLButtonElement)) continue;
    node.removeAttribute(VIRTUAL_HIDDEN_LOAD_ATTR);
    node.style.removeProperty('display');
    node.style.removeProperty('pointer-events');
  }
}

export function removeVirtualLoadMoreButton(list: HTMLElement): void {
  if (S.virtualLoadMoreButton && S.virtualLoadMoreButton.isConnected) {
    try {
      S.virtualLoadMoreButton.remove();
    } catch {}
  }
  const existing = list.querySelector(`button[${VIRTUAL_CUSTOM_LOAD_ATTR}="1"]`);
  if (existing instanceof HTMLButtonElement) {
    try {
      existing.remove();
    } catch {}
  }
  S.virtualLoadMoreButton = null;
}

export function getAdaptiveHydrationChunkSize(): number {
  if (!Number.isFinite(S.virtualReplayDurationMs) || S.virtualReplayDurationMs <= 0) {
    return 20;
  }
  if (S.virtualReplayDurationMs > 42) return VIRTUAL_HYDRATE_CHUNK_MIN;
  if (S.virtualReplayDurationMs > 28) return 12;
  if (S.virtualReplayDurationMs > 20) return 16;
  if (S.virtualReplayDurationMs > 12) return 22;
  return VIRTUAL_HYDRATE_CHUNK_MAX;
}

export function ensureVirtualLoadMoreButton(handles: ModalHandles): void {
  if (S.virtualMode !== 'virtual-expanded') {
    removeVirtualLoadMoreButton(handles.list);
    return;
  }

  const remaining = Math.max(0, S.virtualTotalFiltered - S.virtualHydratedCount);
  if (remaining <= 0) {
    removeVirtualLoadMoreButton(handles.list);
    return;
  }

  if (!(S.virtualLoadMoreButton instanceof HTMLButtonElement) || !S.virtualLoadMoreButton.isConnected) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute(VIRTUAL_CUSTOM_LOAD_ATTR, '1');
    if (S.virtualLoadButtonClassName) {
      button.className = S.virtualLoadButtonClassName;
    } else {
      button.className = 'qpm-activity-load-more';
      button.style.marginTop = '8px';
      button.style.minHeight = '30px';
      button.style.alignSelf = 'stretch';
    }
    S.virtualLoadMoreButton = button;
  }

  S.virtualLoadMoreButton.textContent = `Load ${remaining} more`;
  if (!handles.list.contains(S.virtualLoadMoreButton)) {
    handles.list.appendChild(S.virtualLoadMoreButton);
  }
}

export function applyVirtualListLayout(list: HTMLElement): void {
  if (!S.virtualListLayoutApplied) {
    S.virtualListPrevJustifyContent = list.style.justifyContent;
    S.virtualListPrevAlignContent = list.style.alignContent;
    S.virtualListPrevAlignItems = list.style.alignItems;
    S.virtualListLayoutApplied = true;
  }
  list.style.justifyContent = 'flex-start';
  list.style.alignContent = 'stretch';
  list.style.alignItems = 'stretch';
}

export function restoreVirtualListLayout(list: HTMLElement): void {
  if (!S.virtualListLayoutApplied) return;
  list.style.justifyContent = S.virtualListPrevJustifyContent;
  list.style.alignContent = S.virtualListPrevAlignContent;
  list.style.alignItems = S.virtualListPrevAlignItems;
  S.virtualListLayoutApplied = false;
  S.virtualListPrevJustifyContent = '';
  S.virtualListPrevAlignContent = '';
  S.virtualListPrevAlignItems = '';
}

export function removeVirtualSpacers(list: HTMLElement): void {
  const spacers = list.querySelectorAll(`[${VIRTUAL_SPACER_ATTR}]`);
  for (const node of spacers) {
    try {
      node.remove();
    } catch {}
  }
  S.virtualSpacerTopEl = null;
  S.virtualSpacerBottomEl = null;
}

export function ensureVirtualSpacers(list: HTMLElement): { top: HTMLDivElement; bottom: HTMLDivElement } {
  if (!(S.virtualSpacerTopEl instanceof HTMLDivElement) || !S.virtualSpacerTopEl.isConnected) {
    S.virtualSpacerTopEl = document.createElement('div');
    S.virtualSpacerTopEl.setAttribute(VIRTUAL_SPACER_ATTR, VIRTUAL_SPACER_TOP);
    S.virtualSpacerTopEl.style.pointerEvents = 'none';
    S.virtualSpacerTopEl.style.flex = '0 0 auto';
    S.virtualSpacerTopEl.style.width = '100%';
  }
  if (!(S.virtualSpacerBottomEl instanceof HTMLDivElement) || !S.virtualSpacerBottomEl.isConnected) {
    S.virtualSpacerBottomEl = document.createElement('div');
    S.virtualSpacerBottomEl.setAttribute(VIRTUAL_SPACER_ATTR, VIRTUAL_SPACER_BOTTOM);
    S.virtualSpacerBottomEl.style.pointerEvents = 'none';
    S.virtualSpacerBottomEl.style.flex = '0 0 auto';
    S.virtualSpacerBottomEl.style.width = '100%';
  }

  if (!list.contains(S.virtualSpacerTopEl)) {
    list.insertBefore(S.virtualSpacerTopEl, list.firstChild);
  }
  if (!list.contains(S.virtualSpacerBottomEl)) {
    list.appendChild(S.virtualSpacerBottomEl);
  }

  return {
    top: S.virtualSpacerTopEl,
    bottom: S.virtualSpacerBottomEl,
  };
}

export function updateVirtualSpacers(list: HTMLElement): void {
  if (S.virtualMode !== 'virtual-expanded') {
    removeVirtualSpacers(list);
    return;
  }
  const { top, bottom } = ensureVirtualSpacers(list);
  top.style.height = `${Math.max(0, Math.floor(S.virtualTopSpacerPx))}px`;
  bottom.style.height = `${Math.max(0, Math.floor(S.virtualBottomSpacerPx))}px`;
}

export function updateVirtualAverageRowHeight(list: HTMLElement): void {
  const rows = getEntryElements(list);
  if (!rows.length) return;
  let totalHeight = 0;
  for (const row of rows) {
    totalHeight += Math.max(1, Math.round(row.getBoundingClientRect().height || 0));
  }
  if (totalHeight <= 0) return;
  const avg = totalHeight / rows.length;
  if (!Number.isFinite(avg) || avg <= 0) return;
  S.virtualAvgRowHeight = Math.max(24, Math.min(120, avg));
}

export function getScrollOffsetWithinList(handles: ModalHandles): number {
  const host = handles.scrollHost;
  const list = handles.list;
  if (!host || !list) return 0;
  if (host === list) return Math.max(0, list.scrollTop);
  const hostRect = host.getBoundingClientRect();
  const listRect = list.getBoundingClientRect();
  if (!Number.isFinite(hostRect.top) || !Number.isFinite(listRect.top)) {
    return Math.max(0, host.scrollTop);
  }
  return Math.max(0, Math.round(hostRect.top - listRect.top));
}

export function resetVirtualScrollToStart(handles: ModalHandles): void {
  const host = handles.scrollHost;
  const list = handles.list;
  if (host === list) {
    list.scrollTop = 0;
    return;
  }
  const offset = getScrollOffsetWithinList(handles);
  if (offset <= 0) return;
  host.scrollTop = Math.max(0, host.scrollTop - offset);
}

export function resolveReplayStartIndex(totalEntries: number, candidate: number): number {
  const total = Math.max(0, Math.floor(totalEntries));
  if (!Number.isFinite(candidate) || candidate < 0) return 0;
  return Math.max(0, Math.min(total, Math.floor(candidate)));
}

export function resolveReplayMaxEntries(totalEntries: number, candidate: number): number | null {
  const total = Math.max(0, Math.floor(totalEntries));
  if (!Number.isFinite(candidate)) return null;
  return Math.max(0, Math.min(total, Math.floor(candidate)));
}

export function clearReplayHydrationTimer(): void {
  if (S.replayHydrationTimer == null) return;
  clearTimeout(S.replayHydrationTimer);
  S.replayHydrationTimer = null;
}
