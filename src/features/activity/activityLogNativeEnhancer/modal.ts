import { visibleInterval } from '../../../utils/scheduling/timerManager';
import { getAtomByLabel, readAtomValue, writeAtomValue } from '../../../core/jotaiBridge';
import { subscribeAtomValue } from '../../../core/atomRegistry';
import { warnFeature } from './_diagnostics';
import type {
  ActivityLogEntry,
  ModalRef,
  ModalHandles,
  OrderFilter,
} from './types';
import {
  FAST_REPLAY_DELAY_MS,
  VIRTUAL_WINDOW_SIZE,
  VIRTUAL_SCROLL_THROTTLE_MS,
  VIRTUAL_DEFAULT_ROW_HEIGHT,
  LARGE_LIST_REFRESH_THRESHOLD,
  LARGE_LIST_REFRESH_DELAY_MS,
  TOOLBAR_ATTR,
  TITLE_SELECTOR,
  NATIVE_LIST_SELECTOR,
  TYPE_OPTIONS,
  ORDER_OPTIONS,
} from './constants';
import { S } from './state';
import {
  isRecord,
  normalizeWhitespace,
  normalizeList,
  extractActivityArray,
  getEntryElements,
  deepClone,
  isReplaySafeEntry,
} from './parsing';
import { persistFilters, saveHistory, mergeSnapshots, invalidateVirtualCaches } from './persistence';
import {
  buildRowMetadata,
  buildSpeciesOptions,
  getHistoryEntryFilterMetadata,
} from './matching';
import {
  ensureStyles,
  createSpeciesDropdown,
  buildSelect,
  applyFiltersToRows,
  normalizeSpeciesFilterValue,
  updateSummary,
} from './rendering';
import {
  resetVirtualMode,
  getFilteredHistoryEntries,
  getOrderedHistoryRefs,
  getLoadMoreButtonFromTarget,
  hideNativeLoadMoreButtons,
  restoreNativeLoadMoreButtons,
  removeVirtualLoadMoreButton,
  getAdaptiveHydrationChunkSize,
  ensureVirtualLoadMoreButton,
  applyVirtualListLayout,
  restoreVirtualListLayout,
  removeVirtualSpacers,
  updateVirtualSpacers,
  updateVirtualAverageRowHeight,
  resetVirtualScrollToStart,
  resolveReplayStartIndex,
  resolveReplayMaxEntries,
  clearReplayHydrationTimer,
  entryMatchesFilters,
  computeScrollBasedWindowStart,
} from './virtualList';
import {
  installMyDataReadPatch,
  uninstallMyDataReadPatch,
  buildDisplayLogsWithHistory,
} from './patchHooks';

function findActivityModal(): ModalRef | null {
  const titles = Array.from(document.querySelectorAll(TITLE_SELECTOR));
  const title = titles.find((node) => /activity\s*log/i.test(node.textContent || ''));
  if (!(title instanceof HTMLElement)) return null;

  const root = title.closest('div.McGrid');
  if (!(root instanceof HTMLElement)) return null;

  const content = root.querySelector('div.McFlex.css-iek5kf')
    ?? root.querySelectorAll('div.McFlex')[1];
  if (!(content instanceof HTMLElement)) return null;

  const list = (
    content.querySelector(NATIVE_LIST_SELECTOR)
    ?? Array.from(content.children).find((child) => (
      child instanceof HTMLElement
      && child.classList.contains('McFlex')
      && child.getAttribute(TOOLBAR_ATTR) !== '1'
    ))
  );
  if (!(list instanceof HTMLElement)) return null;

  return {
    root,
    content,
    list,
  };
}

function hasAriesActivityFilter(modal: ModalRef): boolean {
  if (modal.content.querySelector('.mg-activity-log-filter')) return true;
  if (modal.root.hasAttribute('data-mg-activity-log-filter-ready')) return true;
  return false;
}

function resolveScrollHost(modal: ModalRef): HTMLElement {
  const scrollableNodes: HTMLElement[] = [];
  const isScrollable = (node: HTMLElement): boolean => {
    try {
      const style = window.getComputedStyle(node);
      const overflowY = String(style.overflowY || '').toLowerCase();
      if (!(overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay')) return false;
      return (node.scrollHeight - node.clientHeight) > 8;
    } catch {
      return false;
    }
  };

  let cursor: HTMLElement | null = modal.list.parentElement;
  while (cursor) {
    if (cursor.contains(modal.list) && isScrollable(cursor)) {
      scrollableNodes.push(cursor);
    }
    if (cursor === document.body) break;
    cursor = cursor.parentElement;
  }

  if (isScrollable(modal.list)) return modal.list;
  if (scrollableNodes.length > 0) return scrollableNodes[0]!;

  if (isScrollable(modal.content)) return modal.content;
  return modal.list;
}

function collectScrollTargets(scrollHost: HTMLElement, list: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();
  const push = (node: HTMLElement | null): void => {
    if (!node) return;
    if (seen.has(node)) return;
    seen.add(node);
    out.push(node);
  };

  push(list);
  push(scrollHost);
  let cursor: HTMLElement | null = scrollHost.parentElement;
  while (cursor) {
    if (cursor.contains(list)) {
      push(cursor);
    }
    if (cursor === document.body) break;
    cursor = cursor.parentElement;
  }

  return out;
}

function ensureSpeciesDropdownOptions(handles: ModalHandles): void {
  if (handles.speciesOptionsReady) return;
  const petOptions = buildSpeciesOptions('pet');
  const plantOptions = buildSpeciesOptions('plant');
  const nextPetFilter = normalizeSpeciesFilterValue(petOptions, S.filters.petSpecies);
  const nextPlantFilter = normalizeSpeciesFilterValue(plantOptions, S.filters.plantSpecies);

  handles.petDropdown.setOptions(petOptions);
  handles.plantDropdown.setOptions(plantOptions);
  handles.petDropdown.setValue(nextPetFilter);
  handles.plantDropdown.setValue(nextPlantFilter);
  handles.speciesOptionsReady = petOptions.length > 1 && plantOptions.length > 1;

  let shouldPersist = false;
  if (nextPetFilter !== S.filters.petSpecies) {
    S.filters.petSpecies = nextPetFilter;
    shouldPersist = true;
  }
  if (nextPlantFilter !== S.filters.plantSpecies) {
    S.filters.plantSpecies = nextPlantFilter;
    shouldPersist = true;
  }
  if (S.filters.action !== 'all') {
    S.filters.action = 'all';
    shouldPersist = true;
  }
  if (shouldPersist) {
    persistFilters();
  }
}

export function refreshModalUI(handles: ModalHandles): void {
  ensureSpeciesDropdownOptions(handles);
  if (S.virtualMode === 'virtual-expanded') {
    applyVirtualListLayout(handles.list);
    hideNativeLoadMoreButtons(handles.list);
    updateVirtualSpacers(handles.list);
    const rows = getEntryElements(handles.list);
    updateVirtualAverageRowHeight(handles.list, rows);
    ensureVirtualLoadMoreButton(handles);
    updateSummary(handles, rows.length, S.virtualTotalFiltered);
    return;
  }

  restoreVirtualListLayout(handles.list);
  restoreNativeLoadMoreButtons(handles.list);
  removeVirtualSpacers(handles.list);
  removeVirtualLoadMoreButton(handles.list);
  const metadata = buildRowMetadata(handles.list);

  const totalRows = metadata.length;
  const visibleRows = applyFiltersToRows(metadata);
  updateSummary(handles, visibleRows, totalRows);
}

export function scheduleModalRefresh(handles: ModalHandles): void {
  if (handles.refreshQueued) return;
  handles.refreshQueued = true;
  const schedule = (): void => {
    requestAnimationFrame(() => {
      handles.refreshQueued = false;
      handles.refreshTimer = null;
      if (!S.modalHandles) return;
      refreshModalUI(S.modalHandles);
    });
  };
  if (handles.list.childElementCount >= LARGE_LIST_REFRESH_THRESHOLD) {
    handles.refreshTimer = window.setTimeout(schedule, LARGE_LIST_REFRESH_DELAY_MS);
    return;
  }
  schedule();
}

function saveAndRenderFilters(): void {
  persistFilters();
  if (S.modalHandles) {
    if (S.virtualMode === 'virtual-expanded') {
      S.virtualWindowStart = 0;
      S.virtualHydratedCount = VIRTUAL_WINDOW_SIZE;
      S.virtualWindowEnd = S.virtualHydratedCount;
      invalidateVirtualCaches();
      queueReplay('filter-change');
      return;
    }
    refreshModalUI(S.modalHandles);
  }
}

function getReplaySourceEntries(order: import('./types').OrderFilter): ActivityLogEntry[] {
  if (S.virtualMode === 'virtual-expanded') {
    return getFilteredHistoryEntries(order);
  }
  return getOrderedHistoryRefs(order);
}

async function applyVirtualWindow(
  reason: string,
  preserveScroll: boolean,
  requestedStart?: number,
): Promise<void> {
  if (!S.modalHandles) return;
  if (S.replayInFlight) {
    S.virtualPendingWindowStart = requestedStart ?? S.virtualWindowStart;
    S.virtualPendingReason = reason;
    S.virtualPendingPreserveScroll = S.virtualPendingPreserveScroll || preserveScroll;
    return;
  }

  const filteredEntries = getFilteredHistoryEntries(S.filters.order);
  const total = filteredEntries.length;
  S.virtualTotalFiltered = total;

  const maxStart = Math.max(0, total - VIRTUAL_WINDOW_SIZE);
  const rawStart = requestedStart ?? S.virtualWindowStart;
  const start = Math.max(0, Math.min(maxStart, Math.floor(rawStart)));
  const end = Math.min(total, start + VIRTUAL_WINDOW_SIZE);
  S.virtualWindowStart = start;
  S.virtualWindowEnd = end;
  S.virtualHydratedCount = end - start;
  const rowHeight = Math.max(1, S.virtualAvgRowHeight);
  S.virtualTopSpacerPx = start * rowHeight;
  S.virtualBottomSpacerPx = Math.max(0, total - end) * rowHeight;

  await replayHistoryToModal({
    preserveScroll,
    reason,
    startIndex: start,
    maxEntries: end - start,
  });
}

function enterVirtualExpandedMode(handles: ModalHandles, sourceButton?: HTMLButtonElement | null): void {
  if (S.virtualMode === 'virtual-expanded') return;
  S.virtualMode = 'virtual-expanded';
  S.virtualWindowStart = 0;
  S.virtualWindowEnd = VIRTUAL_WINDOW_SIZE;
  S.virtualTopSpacerPx = 0;
  S.virtualBottomSpacerPx = 0;
  S.virtualAvgRowHeight = VIRTUAL_DEFAULT_ROW_HEIGHT;
  S.virtualLastScrollUpdateAt = 0;
  S.virtualIgnoreScrollUntil = Date.now() + 220;
  invalidateVirtualCaches();
  S.virtualHydratedCount = VIRTUAL_WINDOW_SIZE;
  S.readPatchOrder = S.filters.order;
  S.readPatchStartIndex = 0;
  S.readPatchMaxEntries = VIRTUAL_WINDOW_SIZE;
  S.virtualLoadButtonClassName = sourceButton?.className ?? S.virtualLoadButtonClassName;
  applyVirtualListLayout(handles.list);
  removeVirtualLoadMoreButton(handles.list);
  resetVirtualScrollToStart(handles);
  void applyVirtualWindow('virtual-enter', false, 0);
  scheduleModalRefresh(handles);
}

function hydrateMoreVirtualEntries(): void {
  if (S.virtualMode !== 'virtual-expanded') return;
  const chunk = getAdaptiveHydrationChunkSize();
  const maxStart = Math.max(0, S.virtualTotalFiltered - VIRTUAL_WINDOW_SIZE);
  const nextStart = Math.min(maxStart, S.virtualWindowStart + chunk);
  if (nextStart === S.virtualWindowStart) return;
  S.virtualIgnoreScrollUntil = Date.now() + 180;
  void applyVirtualWindow('virtual-load-more', false, nextStart);
}

function maybeUpdateVirtualWindowFromScroll(handles: ModalHandles): void {
  if (S.virtualMode !== 'virtual-expanded') return;
  const now = Date.now();
  if (now < S.virtualIgnoreScrollUntil) return;
  if ((now - S.virtualLastScrollUpdateAt) < VIRTUAL_SCROLL_THROTTLE_MS) return;
  S.virtualLastScrollUpdateAt = now;

  const total = S.virtualTotalFiltered;
  if (total <= VIRTUAL_WINDOW_SIZE) return;
  const targetStart = computeScrollBasedWindowStart(handles);
  if (targetStart === S.virtualWindowStart) return;
  void applyVirtualWindow('virtual-scroll', true, targetStart);
}

export function queueReplay(reason: string): void {
  clearReplayHydrationTimer();
  if (S.virtualMode === 'virtual-expanded') {
    void applyVirtualWindow(reason, reason === 'manual' || reason === 'snapshot-change');
    return;
  }
  if (reason !== 'manual' && reason !== 'clear-history') return;
  if (S.replayQueued) return;
  S.replayQueued = true;
  window.setTimeout(() => {
    S.replayQueued = false;
    void replayHistoryToModal({
      preserveScroll: true,
      reason,
      startIndex: 0,
      maxEntries: 10,
    });
  }, FAST_REPLAY_DELAY_MS);
}

async function replayHistoryToModal(opts?: {
  preserveScroll?: boolean;
  reason?: string;
  startIndex?: number;
  maxEntries?: number;
}): Promise<void> {
  if (!S.started) return;
  if (S.replayInFlight) return;

  const sourceEntries = getReplaySourceEntries(S.filters.order);
  const sourceTotal = sourceEntries.length;
  const requestedStartIndex = resolveReplayStartIndex(sourceTotal, Number(opts?.startIndex));
  const requestedMaxEntries = resolveReplayMaxEntries(sourceTotal, Number(opts?.maxEntries));
  const requestedCount = requestedMaxEntries == null
    ? Math.max(0, sourceTotal - requestedStartIndex)
    : requestedMaxEntries;

  if (S.virtualMode === 'virtual-expanded') {
    S.readPatchOrder = S.filters.order;
    S.readPatchStartIndex = requestedStartIndex;
    S.readPatchMaxEntries = requestedCount;
  }

  if (S.writeSupported === false) {
    S.readPatchOrder = S.filters.order;
    S.readPatchStartIndex = requestedStartIndex;
    S.readPatchMaxEntries = requestedCount;
    S.replayHydratedCount = requestedCount;
    const patched = installMyDataReadPatch();
    if (!patched) {
      S.replayMode = 'none';
      if (S.modalHandles) {
        S.modalHandles.orderSelect.disabled = true;
        S.modalHandles.orderSelect.title = 'Order replay unavailable (read-only Jotai store)';
      }
    } else if (S.modalHandles) {
      S.modalHandles.orderSelect.disabled = false;
      S.modalHandles.orderSelect.title = 'Sort order';
      scheduleModalRefresh(S.modalHandles);
    }
    return;
  }

  const myDataAtom = getAtomByLabel('myDataAtom');
  if (!myDataAtom) {
    S.writeSupported = false;
    return;
  }

  S.replayInFlight = true;
  const startedAt = performance.now();
  const scrollElement = (S.modalHandles?.scrollHost ?? S.modalHandles?.list) ?? null;
  const preserveScroll = opts?.preserveScroll !== false;
  const beforeScroll = preserveScroll && scrollElement ? scrollElement.scrollTop : 0;
  const payloadEnd = Math.max(
    requestedStartIndex,
    Math.min(sourceTotal, requestedStartIndex + requestedCount),
  );
  const payload = sourceEntries
    .slice(requestedStartIndex, payloadEnd)
    .map((entry) => deepClone(entry));

  S.suppressIngestUntil = Date.now() + 1200;

  try {
    const current = await readAtomValue<unknown>(myDataAtom);
    if (!isRecord(current)) {
      S.writeSupported = false;
      return;
    }

    const next = {
      ...current,
      activityLogs: payload,
    };

    await writeAtomValue(myDataAtom, next);
    S.writeSupported = true;
    S.replayMode = 'write';
    S.replayHydratedCount = payload.length;
    S.readPatchStartIndex = 0;
    S.readPatchMaxEntries = null;
    uninstallMyDataReadPatch();
    if (S.modalHandles) {
      S.modalHandles.orderSelect.disabled = false;
      S.modalHandles.orderSelect.title = 'Sort order';
    }
    clearReplayHydrationTimer();
  } catch (error) {
    clearReplayHydrationTimer();
    S.writeSupported = false;
    S.readPatchOrder = S.filters.order;
    S.readPatchStartIndex = requestedStartIndex;
    S.readPatchMaxEntries = requestedCount;
    S.replayHydratedCount = requestedCount;
    const patched = installMyDataReadPatch();
    if (S.modalHandles) {
      if (patched) {
        S.modalHandles.orderSelect.disabled = false;
        S.modalHandles.orderSelect.title = 'Sort order';
      } else {
        S.modalHandles.orderSelect.disabled = true;
        S.modalHandles.orderSelect.title = 'Order replay unavailable (read-only Jotai store)';
      }
    }
    if (!patched) {
      S.replayMode = 'none';
    }
    warnFeature('QPM-FEATURE-004', {
      what: 'replay',
      reason: opts?.reason ?? 'unknown',
      patched,
    }, error);
  } finally {
    S.replayInFlight = false;
    if (S.virtualMode === 'virtual-expanded') {
      S.virtualReplayDurationMs = Math.max(0, performance.now() - startedAt);
    }
    if (preserveScroll && scrollElement) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const maxScrollable = Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight);
          scrollElement.scrollTop = Math.min(Math.max(0, beforeScroll), maxScrollable);
        });
      });
    }
    if (S.modalHandles) {
      scheduleModalRefresh(S.modalHandles);
    }

    if (
      S.virtualMode === 'virtual-expanded'
      && S.virtualPendingWindowStart != null
      && S.modalHandles
    ) {
      const pendingStart = S.virtualPendingWindowStart;
      const pendingReason = S.virtualPendingReason || 'virtual-pending';
      const pendingPreserve = S.virtualPendingPreserveScroll;
      S.virtualPendingWindowStart = null;
      S.virtualPendingReason = '';
      S.virtualPendingPreserveScroll = false;
      void applyVirtualWindow(pendingReason, pendingPreserve, pendingStart);
    }
  }
}

function attachModal(modal: ModalRef): void {
  if (
    S.modalHandles
    && S.modalHandles.root === modal.root
    && S.modalHandles.list === modal.list
    && S.modalHandles.root.isConnected
  ) {
    return;
  }

  detachModal();
  ensureStyles();
  const ariesFilterPresent = hasAriesActivityFilter(modal);
  const scrollHost = resolveScrollHost(modal);

  const toolbar = document.createElement('div');
  toolbar.className = 'qpm-activity-toolbar';
  toolbar.setAttribute(TOOLBAR_ATTR, '1');

  const typeSelect = buildSelect(TYPE_OPTIONS, S.filters.type);
  typeSelect.title = 'Filter by type';
  typeSelect.addEventListener('change', () => {
    S.filters.type = typeSelect.value as import('./types').TypeFilter;
    saveAndRenderFilters();
  });

  const orderSelect = buildSelect(ORDER_OPTIONS, S.filters.order);
  orderSelect.title = 'Sort order';
  const replayUnavailable = S.writeSupported === false && !(S.patchedMyDataAtom && S.patchedMyDataReadKey && S.patchedMyDataReadOriginal);
  if (replayUnavailable) {
    orderSelect.disabled = true;
    orderSelect.title = 'Order replay unavailable (read-only Jotai store)';
  }
  orderSelect.addEventListener('change', () => {
    S.filters.order = orderSelect.value as import('./types').OrderFilter;
    persistFilters();
    if (S.virtualMode === 'virtual-expanded') {
      S.virtualWindowStart = 0;
      S.virtualHydratedCount = VIRTUAL_WINDOW_SIZE;
      S.virtualWindowEnd = S.virtualHydratedCount;
      invalidateVirtualCaches();
      queueReplay('order-change');
      return;
    }
    if (S.writeSupported === false && !(S.patchedMyDataAtom && S.patchedMyDataReadKey && S.patchedMyDataReadOriginal)) {
      if (S.modalHandles) {
        scheduleModalRefresh(S.modalHandles);
      }
      return;
    }
    if (S.modalHandles) {
      scheduleModalRefresh(S.modalHandles);
    }
  });

  const petDropdown = createSpeciesDropdown({
    placeholder: 'Pet: All',
    onChange: (value) => {
      S.filters.petSpecies = value;
      saveAndRenderFilters();
    },
  });
  petDropdown.setValue(S.filters.petSpecies);

  const plantDropdown = createSpeciesDropdown({
    placeholder: 'Plant: All',
    onChange: (value) => {
      S.filters.plantSpecies = value;
      saveAndRenderFilters();
    },
  });
  plantDropdown.setValue(S.filters.plantSpecies);

  const summary = document.createElement('div');
  summary.className = 'qpm-activity-summary';
  if (!S.showSummaryInDebug) {
    summary.classList.add('is-hidden');
  }

  toolbar.append(typeSelect, orderSelect, petDropdown.root, plantDropdown.root, summary);
  modal.content.insertBefore(toolbar, modal.content.firstChild);

  const listScrollListener: EventListener = () => {
    if (!S.modalHandles) return;
    maybeUpdateVirtualWindowFromScroll(S.modalHandles);
  };

  const listClickCaptureListener: EventListener = (event) => {
    if (!S.modalHandles) return;
    const loadMoreButton = getLoadMoreButtonFromTarget(event.target);
    if (!loadMoreButton) return;
    if (S.virtualMode === 'collapsed') {
      window.setTimeout(() => {
        if (!S.modalHandles) return;
        if (S.virtualMode !== 'collapsed') return;
        enterVirtualExpandedMode(S.modalHandles, loadMoreButton);
      }, 0);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    hydrateMoreVirtualEntries();
  };

  const scrollTargets = collectScrollTargets(scrollHost, modal.list);

  const handles: ModalHandles = {
    ...modal,
    toolbar,
    typeSelect,
    orderSelect,
    petDropdown,
    plantDropdown,
    summary,
    ariesFilterPresent,
    scrollHost,
    scrollTargets,
    listObserver: new MutationObserver(() => {
      if (!S.modalHandles) return;
      scheduleModalRefresh(S.modalHandles);
    }),
    listScrollListener,
    listClickCaptureListener,
    refreshQueued: false,
    refreshTimer: null,
    speciesOptionsReady: false,
  };

  handles.listObserver.observe(modal.list, {
    childList: true,
    subtree: true,
  });
  for (const target of scrollTargets) {
    target.addEventListener('scroll', listScrollListener, { passive: true });
  }
  modal.list.addEventListener('click', listClickCaptureListener, true);

  S.modalHandles = handles;
  ensureSpeciesDropdownOptions(handles);
  scheduleModalRefresh(handles);
}

function detachModal(): void {
  if (!S.modalHandles) return;
  clearReplayHydrationTimer();
  if (S.modalHandles.refreshTimer != null) {
    clearTimeout(S.modalHandles.refreshTimer);
    S.modalHandles.refreshTimer = null;
  }
  try {
    S.modalHandles.listObserver.disconnect();
  } catch {}
  try {
    for (const target of S.modalHandles.scrollTargets) {
      target.removeEventListener('scroll', S.modalHandles.listScrollListener);
    }
  } catch {}
  try {
    S.modalHandles.list.removeEventListener('click', S.modalHandles.listClickCaptureListener, true);
  } catch {}
  try {
    restoreNativeLoadMoreButtons(S.modalHandles.list);
  } catch {}
  try {
    removeVirtualLoadMoreButton(S.modalHandles.list);
  } catch {}
  try {
    restoreVirtualListLayout(S.modalHandles.list);
  } catch {}
  try {
    removeVirtualSpacers(S.modalHandles.list);
  } catch {}
  try {
    S.modalHandles.petDropdown.destroy();
    S.modalHandles.plantDropdown.destroy();
  } catch {}
  try {
    S.modalHandles.toolbar.remove();
  } catch {}
  uninstallMyDataReadPatch();
  resetVirtualMode();
  S.modalHandles = null;
}

function syncModalMount(): void {
  // Skip the document-wide querySelectorAll sweep in findActivityModal() while
  // still attached; modal swaps detach the root, flipping isConnected to re-trigger it.
  const current = S.modalHandles;
  if (current && current.root.isConnected && current.list.isConnected) {
    return;
  }

  const modal = findActivityModal();
  if (!modal) {
    detachModal();
    return;
  }
  attachModal(modal);
}

function queueModalSync(): void {
  if (S.modalSyncTimer != null) return;
  S.modalSyncTimer = window.setTimeout(() => {
    S.modalSyncTimer = null;
    syncModalMount();
  }, 100);
}

export function startModalObserver(): void {
  if (S.modalPollStop) return;
  syncModalMount();
  S.modalPollStop = visibleInterval('qpm-activity-modal-sync', syncModalMount, 250);
}

export function stopModalObserver(): void {
  if (S.modalPollStop) {
    S.modalPollStop();
    S.modalPollStop = null;
  }
  if (S.modalSyncTimer != null) {
    clearTimeout(S.modalSyncTimer);
    S.modalSyncTimer = null;
  }
  detachModal();
}

export function ingestActivityLogs(value: unknown): void {
  if (Date.now() < S.suppressIngestUntil) return;

  // Fingerprint gate: skip normalize+diff if length/first-ts/last-ts match the
  // previous ingest — entries are append-only, so this triple is a stable proxy.
  const raw = extractActivityArray(value);
  const rawLen = raw.length;
  const firstRaw = rawLen > 0 ? (raw[0] as { timestamp?: unknown } | null) : null;
  const lastRaw = rawLen > 0 ? (raw[rawLen - 1] as { timestamp?: unknown } | null) : null;
  const firstTsRaw = firstRaw && typeof firstRaw.timestamp === 'number' ? firstRaw.timestamp : 0;
  const lastTsRaw = lastRaw && typeof lastRaw.timestamp === 'number' ? lastRaw.timestamp : 0;
  if (
    rawLen === S.lastIngestLength
    && firstTsRaw === S.lastIngestFirstTs
    && lastTsRaw === S.lastIngestLastTs
  ) {
    return;
  }
  S.lastIngestLength = rawLen;
  S.lastIngestFirstTs = firstTsRaw;
  S.lastIngestLastTs = lastTsRaw;

  const nextSnapshot = normalizeList(raw);
  const prevSnapshot = S.lastSnapshot;
  S.lastSnapshot = nextSnapshot;

  if (!prevSnapshot.length && !nextSnapshot.length) return;
  const changed = mergeSnapshots(prevSnapshot, nextSnapshot);
  if (!changed) {
    if (S.modalHandles) scheduleModalRefresh(S.modalHandles);
    return;
  }

  if (S.modalHandles) {
    if (S.virtualMode === 'virtual-expanded') {
      invalidateVirtualCaches();
      queueReplay('snapshot-change');
    } else {
      scheduleModalRefresh(S.modalHandles);
    }
  }
}

export async function startMyDataActivitySubscription(): Promise<void> {
  if (S.myDataUnsubscribe) return;
  const atom = getAtomByLabel('myDataAtom');
  if (!atom) {
    S.replayMode = 'none';
    warnFeature('QPM-FEATURE-003', { what: 'subscribe:atom_missing', atom: 'myDataAtom' });
    return;
  }

  try {
    const initial = await readAtomValue<unknown>(atom);
    const snapshot = normalizeList(extractActivityArray(initial));
    mergeSnapshots([], snapshot);
    S.lastSnapshot = snapshot;
  } catch (error) {
    warnFeature('QPM-FEATURE-004', { what: 'subscribe:initial_read' }, error);
  }

  try {
    const unsub = await subscribeAtomValue('myData', (next) => {
      ingestActivityLogs(next);
    });
    S.myDataUnsubscribe = unsub;
  } catch (error) {
    S.myDataUnsubscribe = null;
    warnFeature('QPM-FEATURE-003', { what: 'subscribe:subscribe' }, error);
  }
}

export function stopMyDataActivitySubscription(): void {
  if (!S.myDataUnsubscribe) return;
  try {
    S.myDataUnsubscribe();
  } catch {}
  S.myDataUnsubscribe = null;
}
