// src/ui/shopRestockWindow.ts
// Shop Restock Tracker -- main render + public entry.

import { toggleWindow } from './modalWindow';
import { openItemRestockDetail } from './itemRestockDetailWindow';
import { hideSoundPopover } from './shopRestockAlerts/soundPopover';
import { log } from '../utils/logger';
import {
  fetchRestockData,
  getRestockDataSync,
  getRestockFetchedAt,
  getRestockRefreshBudget,
  getItemProbability,
  onRestockDataUpdated,
  onWeatherPredictionsUpdated,
  weatherPredictionsAsRestockItems,
  type RestockItem,
} from '../utils/restockDataService';
import { visibleInterval } from '../utils/timerManager';
import { onSpritesReady } from '../sprite-v2/compat';
import { storage } from '../utils/storage';
import { t } from '../i18n';
import {
  SHOP_FILTERS,
  SHOP_ORDER,
  ITEM_HIDDEN,
  ITEM_EXPIRY,
  SEARCH_DEBOUNCE_MS,
  UI_STATE_SAVE_DEBOUNCE_MS,
  HISTORY_CHUNK_SIZE,
  UI_STATE_KEY,
} from './shopRestockWindowConstants';
import {
  loadUiState,
  loadTracked,
  saveTracked,
  mergeToolFallbackRows,
  mergeDawnFallbackRows,
  getItemName,
  getCatalogOrder,
  initGameData,
  isCelestial,
  type SortColumn,
  type SortDirection,
} from './shopRestockWindowMeta';
import {
  formatETA,
  etaColor,
  formatWindowCountdown,
} from './shopRestockWindowFormatters';
import {
  buildPredRow,
  buildHistRow,
  // buildHotRow,  // disabled: Hot Right Now section
  type EtaRef,
} from './shopRestockWindowRows';

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function renderShopRestockWindow(root: HTMLElement): void {
  root.innerHTML = '';
  root.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;';

  // Inject scoped styles for tooltip hover and rarity text
  const styleEl = document.createElement('style');
  styleEl.textContent = `
    .qpm-sr-metric[data-tooltip]:hover::after {
      content: attr(data-tooltip);
      position: absolute;
      bottom: 100%;
      right: 0;
      margin-bottom: 10px;
      padding: 10px 14px;
      background: rgba(14,16,24,0.97);
      border: 1px solid rgba(148,163,184,0.25);
      border-radius: 8px;
      color: #e5e7eb;
      font-size: 13px;
      font-weight: 500;
      line-height: 1.5;
      white-space: pre-line;
      z-index: 100;
      box-shadow: 0 4px 16px rgba(0,0,0,0.4);
      pointer-events: none;
    }
    .qpm-sr-th { cursor:pointer; user-select:none; }
    .qpm-sr-th:hover { opacity:1 !important; }
    .qpm-sr-tr { cursor:pointer; transition:background 0.12s; }
    .qpm-sr-tr:hover { background:rgba(143,130,255,0.06); }
  `;
  root.appendChild(styleEl);
  const persistedUi = loadUiState();

  // -- Toolbar --
  const toolbar = document.createElement('div');
  toolbar.style.cssText = [
    'display:flex', 'align-items:center', 'gap:6px',
    'padding:10px 14px 8px',
    'border-bottom:1px solid rgba(143,130,255,0.2)',
    'flex-shrink:0', 'flex-wrap:wrap',
  ].join(';');

  const filterGroup = document.createElement('div');
  filterGroup.style.cssText = 'display:flex;gap:4px;flex-shrink:0;flex-wrap:wrap;';
  filterGroup.dataset.tour = 'restock-filters';

  let currentFilter = persistedUi.filter;
  const filterBtns: HTMLButtonElement[] = [];

  const styleFilter = (btn: HTMLButtonElement, active: boolean): void => {
    btn.style.background    = active ? 'rgba(143,130,255,0.22)' : 'rgba(255,255,255,0.05)';
    btn.style.color         = active ? '#c8c0ff' : 'rgba(224,224,224,0.65)';
    btn.style.borderColor   = active ? 'rgba(143,130,255,0.55)' : 'rgba(143,130,255,0.25)';
  };

  const FILTER_LABEL_KEYS: Record<string, string> = {
    all: 'feature.shopRestock.filterAll',
    celestial: 'feature.shopRestock.filterCelestial',
    seed: 'feature.shopRestock.filterSeeds',
    egg: 'feature.shopRestock.filterEggs',
    decor: 'feature.shopRestock.filterDecor',
    tool: 'feature.shopRestock.filterTools',
    dawn: 'feature.shopRestock.filterDawn',
    weather: 'feature.shopRestock.filterWeather',
  };

  for (const f of SHOP_FILTERS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = t(FILTER_LABEL_KEYS[f.value] ?? '', undefined, f.label);
    btn.dataset.filter = f.value;
    btn.style.cssText = [
      'padding:3px 8px', 'font-size:11px', 'border-radius:5px', 'cursor:pointer',
      'border:1px solid rgba(143,130,255,0.25)',
      'background:rgba(255,255,255,0.05)', 'color:rgba(224,224,224,0.65)', 'transition:all 0.12s',
    ].join(';');
    filterBtns.push(btn);
    filterGroup.appendChild(btn);
  }

  const saveUiState = (): void => {
    storage.set(UI_STATE_KEY, {
      filter: currentFilter,
      search: searchInput.value.trim(),
      predCollapsed,
      hotCollapsed: false,
      sortColumn,
      sortDirection,
      historyScrollTop,
      pinnedHeight,
    });
  };
  let saveUiTimer: number | null = null;
  const scheduleSaveUiState = (): void => {
    if (saveUiTimer !== null) window.clearTimeout(saveUiTimer);
    saveUiTimer = window.setTimeout(() => {
      saveUiTimer = null;
      saveUiState();
    }, UI_STATE_SAVE_DEBOUNCE_MS);
  };

  const setFilter = (value: string): void => {
    if (currentFilter === value) return;
    currentFilter = value;
    filterBtns.forEach(b => styleFilter(b, b.dataset.filter === value));
    scheduleSaveUiState();
    scheduleRender(false, true);
  };
  filterBtns.forEach(btn => btn.addEventListener('click', () => setFilter(btn.dataset.filter!)));
  const activeFilterBtn = filterBtns.find(b => b.dataset.filter === currentFilter) ?? filterBtns[0]!;
  if (activeFilterBtn.dataset.filter !== currentFilter) currentFilter = activeFilterBtn.dataset.filter!;
  filterBtns.forEach(btn => styleFilter(btn, btn === activeFilterBtn));

  // Search
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = t('feature.shopRestock.searchPlaceholder');
  searchInput.dataset.tour = 'restock-search';
  searchInput.style.cssText = [
    'padding:4px 10px', 'font-size:12px', 'border-radius:5px', 'flex:1', 'min-width:100px',
    'background:rgba(255,255,255,0.06)', 'border:1px solid rgba(143,130,255,0.25)',
    'color:#e0e0e0', 'outline:none',
  ].join(';');
  searchInput.value = persistedUi.search;
  let searchDebounceTimer: number | null = null;
  searchInput.addEventListener('input', () => {
    if (searchDebounceTimer !== null) window.clearTimeout(searchDebounceTimer);
    searchDebounceTimer = window.setTimeout(() => {
      searchDebounceTimer = null;
      scheduleSaveUiState();
      scheduleRender(false, true);
    }, SEARCH_DEBOUNCE_MS);
  });

  // Refresh + quota + last updated
  const refreshBtn = document.createElement('button');
  refreshBtn.type = 'button';
  refreshBtn.textContent = t('feature.shopRestock.refresh');
  refreshBtn.title = t('feature.shopRestock.refreshData');
  refreshBtn.style.cssText = [
    'padding:4px 10px', 'font-size:13px',
    'background:rgba(143,130,255,0.15)', 'border:1px solid rgba(143,130,255,0.35)',
    'border-radius:5px', 'color:#c8c0ff', 'cursor:pointer', 'flex-shrink:0',
  ].join(';');

  const refreshBudgetEl = document.createElement('span');
  refreshBudgetEl.style.cssText = 'font-size:11px;color:rgba(200,192,255,0.72);white-space:nowrap;flex-shrink:0;';

  const lastUpdatedEl = document.createElement('span');
  lastUpdatedEl.style.cssText = 'font-size:11px;color:rgba(224,224,224,0.35);white-space:nowrap;flex-shrink:0;';

  toolbar.append(filterGroup, searchInput, refreshBtn, refreshBudgetEl, lastUpdatedEl);
  root.appendChild(toolbar);

  const updateLastUpdated = (): void => {
    const fetchedAt = getRestockFetchedAt();
    if (!fetchedAt) { lastUpdatedEl.textContent = ''; return; }
    const m = Math.round((Date.now() - fetchedAt) / 60_000);
    lastUpdatedEl.textContent = m < 1 ? t('feature.shopRestock.updatedNow') : t('feature.shopRestock.updatedAgo', { m });
  };

  const updateRefreshBudgetUi = (): void => {
    const budget = getRestockRefreshBudget();
    const resetInMs = Math.max(0, budget.resetAt - Date.now());
    const countdown = formatWindowCountdown(resetInMs);
    const budgetKey = budget.remaining === 1 ? 'feature.shopRestock.refreshLeft' : 'feature.shopRestock.refreshesLeft';
    refreshBudgetEl.textContent = t(budgetKey, { count: budget.remaining, countdown });
    refreshBtn.disabled = isLoading || budget.blocked;
    refreshBtn.style.opacity = refreshBtn.disabled ? '0.55' : '1';
    refreshBtn.style.cursor = refreshBtn.disabled ? 'not-allowed' : 'pointer';
  };

  // -- Scrollable body --
  const body = document.createElement('div');
  body.style.cssText = 'flex:1;overflow-y:auto;min-height:0;display:flex;flex-direction:column;';
  root.appendChild(body);

  // -- "Hot Right Now" section (disabled — common items dominate, not useful yet) --
  // const hotSection = …  (kept in code for future re-enablement)

  const hotEtaRefs: EtaRef[] = [];

  // -- Predictions section --
  const predSection = document.createElement('div');
  predSection.style.cssText = 'flex-shrink:0;border-bottom:1px solid rgba(143,130,255,0.15);';
  predSection.dataset.tour = 'restock-pinned';

  const predHeaderRow = document.createElement('div');
  predHeaderRow.style.cssText = [
    'display:flex', 'align-items:center', 'justify-content:space-between',
    'padding:7px 14px', 'cursor:pointer', 'user-select:none',
    'background:rgba(143,130,255,0.04)',
  ].join(';');
  const predTitle = document.createElement('span');
  predTitle.style.cssText = 'font-size:12px;font-weight:700;color:rgba(224,224,224,0.75);';
  predTitle.textContent = t('feature.shopRestock.pinned');
  const predChevron = document.createElement('span');
  predChevron.style.cssText = 'font-size:9px;color:rgba(200,192,255,0.4);';
  predChevron.textContent = 'v';
  predHeaderRow.append(predTitle, predChevron);

  const predBody = document.createElement('div');
  const DEFAULT_PINNED_MAX = 'min(240px,35vh)';
  let pinnedHeight = persistedUi.pinnedHeight;
  const pinnedMaxHeight = pinnedHeight !== null ? `${pinnedHeight}px` : DEFAULT_PINNED_MAX;
  predBody.style.cssText = `padding:6px 10px 8px;display:flex;flex-direction:column;gap:2px;max-height:${pinnedMaxHeight};overflow-y:auto;`;

  let predCollapsed = persistedUi.predCollapsed;
  predBody.style.display = predCollapsed ? 'none' : '';
  predChevron.textContent = predCollapsed ? '>' : 'v';
  predHeaderRow.addEventListener('click', () => {
    predCollapsed = !predCollapsed;
    predBody.style.display = predCollapsed ? 'none' : '';
    predChevron.textContent = predCollapsed ? '>' : 'v';
    divider.style.display = predCollapsed ? 'none' : '';
    scheduleSaveUiState();
  });
  predSection.append(predHeaderRow, predBody);
  body.appendChild(predSection);

  // -- Resizable divider between Pinned and Items --
  const MIN_PINNED = 40;
  const MIN_HIST = 60;
  const divider = document.createElement('div');
  divider.style.cssText = [
    'flex-shrink:0', 'height:6px', 'cursor:row-resize', 'user-select:none',
    'display:flex', 'align-items:center', 'justify-content:center',
    'background:rgba(143,130,255,0.08)', 'transition:background 0.12s',
  ].join(';');
  divider.title = t('feature.shopRestock.dragToResize');
  const grip = document.createElement('div');
  grip.style.cssText = 'width:32px;height:2px;border-radius:1px;background:rgba(143,130,255,0.35);';
  divider.appendChild(grip);
  divider.style.display = predCollapsed ? 'none' : '';
  divider.addEventListener('mouseenter', () => { divider.style.background = 'rgba(143,130,255,0.18)'; });
  divider.addEventListener('mouseleave', () => { divider.style.background = 'rgba(143,130,255,0.08)'; });

  divider.addEventListener('mousedown', (e: MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = predBody.getBoundingClientRect().height;
    const bodyRect = body.getBoundingClientRect();
    const maxPinned = bodyRect.height - MIN_HIST;

    const onMove = (ev: MouseEvent): void => {
      const delta = ev.clientY - startY;
      const clamped = Math.max(MIN_PINNED, Math.min(maxPinned, startHeight + delta));
      predBody.style.maxHeight = `${clamped}px`;
      pinnedHeight = clamped;
    };
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      scheduleSaveUiState();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  body.appendChild(divider);

  // -- History section --
  const histSection = document.createElement('div');
  histSection.style.cssText = `flex:1;display:flex;flex-direction:column;min-height:${MIN_HIST}px;overflow:hidden;`; // synced with MIN_HIST

  const histHeader = document.createElement('div');
  histHeader.style.cssText = [
    'display:flex', 'align-items:center', 'padding:7px 14px',
    'border-bottom:1px solid rgba(255,255,255,0.06)',
    'background:rgba(0,0,0,0.15)', 'flex-shrink:0',
  ].join(';');
  const histTitle = document.createElement('span');
  histTitle.style.cssText = 'font-size:11px;font-weight:700;color:rgba(224,224,224,0.5);text-transform:uppercase;letter-spacing:0.5px;flex:1;';
  histTitle.textContent = t('feature.shopRestock.itemsClickToPin');
  const resetSortBtn = document.createElement('button');
  resetSortBtn.type = 'button';
  resetSortBtn.textContent = t('feature.shopRestock.defaultOrder');
  resetSortBtn.style.cssText = [
    'padding:2px 8px', 'margin-right:8px', 'font-size:10px', 'font-weight:600',
    'border-radius:999px', 'cursor:pointer',
    'border:1px solid rgba(143,130,255,0.35)', 'background:rgba(143,130,255,0.12)',
    'color:rgba(200,192,255,0.85)', 'display:none',
  ].join(';');
  const itemCountEl = document.createElement('span');
  itemCountEl.style.cssText = 'font-size:11px;color:rgba(224,224,224,0.3);';
  histHeader.append(histTitle, resetSortBtn, itemCountEl);

  const tableWrap = document.createElement('div');
  tableWrap.style.cssText = 'flex:1;overflow-y:auto;min-height:0;';
  tableWrap.dataset.tour = 'restock-items';
  histSection.append(histHeader, tableWrap);
  body.appendChild(histSection);

  // -- Shared state --
  let shopData: RestockItem[] = [];
  let allData: RestockItem[] = [];
  const rebuildAllData = (): void => {
    allData = [...shopData, ...weatherPredictionsAsRestockItems()];
  };
  let trackedItems = loadTracked();
  let isLoading = false;
  updateRefreshBudgetUi();
  let sortColumn: SortColumn = persistedUi.sortColumn;
  let sortDirection: SortDirection = persistedUi.sortDirection;
  let historyScrollTop = persistedUi.historyScrollTop;
  let historyChunkRaf: number | null = null;
  let historyRenderToken = 0;

  const updateResetSortButton = (): void => {
    resetSortBtn.style.display = sortColumn ? '' : 'none';
    resetSortBtn.title = sortColumn ? t('feature.shopRestock.defaultOrderTooltip') : '';
  };

  let renderQueued = false;
  let wantsPredictionsRender = false;
  let wantsHistoryRender = false;
  const scheduleRender = (predictions: boolean, history: boolean): void => {
    wantsPredictionsRender ||= predictions;
    wantsHistoryRender ||= history;
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      if (wantsPredictionsRender) {
        wantsPredictionsRender = false;
        renderPredictions();
      }
      if (wantsHistoryRender) {
        wantsHistoryRender = false;
        renderHistory();
      }
    });
  };

  const persistTrackedAndRender = (preserveHistoryScroll = true): void => {
    if (preserveHistoryScroll) {
      historyScrollTop = tableWrap.scrollTop;
    }
    saveTracked(trackedItems);
    scheduleRender(true, true);
  };

  resetSortBtn.addEventListener('click', () => {
    if (!sortColumn) return;
    sortColumn = null;
    sortDirection = 'asc';
    updateResetSortButton();
    scheduleSaveUiState();
    scheduleRender(false, true);
  });

  tableWrap.addEventListener('scroll', () => {
    historyScrollTop = tableWrap.scrollTop;
    scheduleSaveUiState();
  }, { passive: true });

  const stopRestockDataUpdates = onRestockDataUpdated((detail) => {
    const updated = Array.isArray(detail.items) && detail.items.length > 0
      ? detail.items
      : getRestockDataSync();
    if (!updated) return;
    shopData = mergeDawnFallbackRows(mergeToolFallbackRows(updated));
    rebuildAllData();
    scheduleRender(true, true);
    updateLastUpdated();
  });

  const stopWeatherDataUpdates = onWeatherPredictionsUpdated(() => {
    rebuildAllData();
    scheduleRender(true, true);
  });

  // ETA DOM refs for live countdown
  let histEtaRefs: EtaRef[] = [];
  let predEtaRefs: EtaRef[] = [];
  // Per-render cleanups for weather badges etc.
  let predCleanups: Array<() => void> = [];
  let histCleanups: Array<() => void> = [];

  const flushPredCleanups = (): void => {
    for (const fn of predCleanups) fn();
    predCleanups = [];
  };
  const flushHistCleanups = (): void => {
    for (const fn of histCleanups) fn();
    histCleanups = [];
  };

  // -- Render predictions --
  function renderPredictions(): void {
    flushPredCleanups();
    predBody.innerHTML = '';
    predEtaRefs = [];
    const frag = document.createDocumentFragment();

    const pinned = allData
      .filter(item => trackedItems.has(`${item.shop_type}:${item.item_id}`))
      .sort((a, b) => {
        const aEmpty = (a.total_occurrences ?? 0) < 2 || !(a.estimated_next_timestamp ?? 0);
        const bEmpty = (b.total_occurrences ?? 0) < 2 || !(b.estimated_next_timestamp ?? 0);
        if (aEmpty && !bEmpty) return 1;
        if (!aEmpty && bEmpty) return -1;
        return (getItemProbability(b) ?? -1) - (getItemProbability(a) ?? -1);
      });

    if (!pinned.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:8px 4px;font-size:12px;color:rgba(224,224,224,0.35);font-style:italic;';
      empty.textContent = t('feature.shopRestock.pinHint');
      frag.appendChild(empty);
      predBody.appendChild(frag);
      return;
    }

    for (const item of pinned) {
      const key = `${item.shop_type}:${item.item_id}`;
      const { row, etaRef, cleanups } = buildPredRow(item, key, {
        onUnpin: (k) => { trackedItems.delete(k); persistTrackedAndRender(true); },
        openDetail: openItemRestockDetail,
      });
      frag.appendChild(row);
      predEtaRefs.push(etaRef);
      predCleanups.push(...cleanups);
    }

    const hint = document.createElement('div');
    hint.style.cssText = 'padding:6px 12px 2px;font-size:11px;opacity:0.5;';
    hint.textContent = t('feature.shopRestock.unpinHint');
    frag.appendChild(hint);
    predBody.appendChild(frag);
  }

  // -- Sort state helpers --
  function setSortColumn(col: Exclude<SortColumn, null>): void {
    if (sortColumn !== col) {
      sortColumn = col;
      sortDirection = 'asc';
    } else if (sortDirection === 'asc') {
      sortDirection = 'desc';
    } else {
      // Third click resets to default shop/catalog order.
      sortColumn = null;
      sortDirection = 'asc';
    }
    updateResetSortButton();
    scheduleSaveUiState();
    scheduleRender(false, true);
  }

  // -- Render history --
  function renderHistory(): void {
    if (historyChunkRaf !== null) {
      cancelAnimationFrame(historyChunkRaf);
      historyChunkRaf = null;
    }
    flushHistCleanups();
    const renderToken = ++historyRenderToken;
    const previousScrollTop = tableWrap.scrollTop;
    if (tableWrap.childElementCount > 0 || previousScrollTop > 0) {
      historyScrollTop = previousScrollTop;
    }
    tableWrap.innerHTML = '';
    updateResetSortButton();
    histEtaRefs = [];
    const search = searchInput.value.trim().toLowerCase();
    const now    = Date.now();

    let filtered = allData.filter(item => {
      const key = `${item.shop_type}:${item.item_id}`;
      if (trackedItems.has(key)) return false;           // pinned items not shown in history

      const expiryMs = ITEM_EXPIRY[key] ?? null;
      if (expiryMs && expiryMs <= now) return false;     // expired seasonal items
      if (ITEM_HIDDEN.has(key)) return false;             // manually hidden entries

      if (currentFilter === 'celestial') {
        if (!isCelestial(item.item_id)) return false;
      } else if (currentFilter !== 'all') {
        if (item.shop_type !== currentFilter) return false;
      }

      if (search) {
        const name = getItemName(item.item_id, item.shop_type).toLowerCase();
        if (!name.includes(search) && !(item.item_id ?? '').toLowerCase().includes(search)) return false;
      }
      return true;
    });

    // Sort
    if (sortColumn) {
      filtered = filtered.slice().sort((a, b) => {
        let aVal: unknown;
        let bVal: unknown;
        if (sortColumn === 'item') {
          aVal = getItemName(a.item_id, a.shop_type).toLowerCase();
          bVal = getItemName(b.item_id, b.shop_type).toLowerCase();
        } else if (sortColumn === 'qty') {
          aVal = a.total_quantity ?? (a.total_occurrences ?? 0);
          bVal = b.total_quantity ?? (b.total_occurrences ?? 0);
        } else { // last
          aVal = a.last_seen ?? 0;
          bVal = b.last_seen ?? 0;
        }
        if (aVal === bVal) return 0;
        const cmp = (aVal as number) > (bVal as number) ? 1 : -1;
        return sortDirection === 'asc' ? cmp : -cmp;
      });
    } else {
      // Default: shop type (Seeds/Eggs/Decor) -> in-game catalog order -> name fallback
      filtered = filtered.slice().sort((a, b) => {
        const shopA = SHOP_ORDER[a.shop_type] ?? 99;
        const shopB = SHOP_ORDER[b.shop_type] ?? 99;
        if (shopA !== shopB) return shopA - shopB;

        const orderA = getCatalogOrder(a.item_id, a.shop_type);
        const orderB = getCatalogOrder(b.item_id, b.shop_type);
        if (orderA !== null || orderB !== null) {
          if (orderA === null) return 1;
          if (orderB === null) return -1;
          if (orderA !== orderB) return orderA - orderB;
        }

        return getItemName(a.item_id, a.shop_type)
          .localeCompare(getItemName(b.item_id, b.shop_type), undefined, { sensitivity: 'base' });
      });
    }

    itemCountEl.textContent = filtered.length === 1
      ? t('feature.shopRestock.itemCountSingle', { count: filtered.length })
      : t('feature.shopRestock.itemCount', { count: filtered.length });

    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:40px;text-align:center;color:rgba(224,224,224,0.35);font-size:13px;';
      empty.textContent = isLoading ? t('feature.shopRestock.loadingRestock') : t('feature.shopRestock.noItemsFound');
      tableWrap.appendChild(empty);
      historyScrollTop = 0;
      tableWrap.scrollTop = 0;
      return;
    }

    // Regular table
    const sortIndicator = (col: 'item' | 'qty' | 'last'): string => {
      if (sortColumn !== col) return '';
      return sortDirection === 'asc' ? ' ^' : ' v';
    };

    const table = document.createElement('table');
    table.style.cssText = 'width:100%;border-collapse:separate;border-spacing:0 2px;font-size:12px;';

    const thead = document.createElement('thead');
    const hr = document.createElement('tr');
    const TH_BASE = 'padding:8px 12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:rgba(224,224,224,0.6);position:sticky;top:0;background:rgba(12,12,22,0.98);z-index:1;';

    const thItem = document.createElement('th');
    thItem.className = 'qpm-sr-th';
    thItem.style.cssText = TH_BASE + 'text-align:left;width:60%;';
    thItem.textContent = `${t('feature.shopRestock.thItem')}${sortIndicator('item')}`;
    thItem.addEventListener('click', () => setSortColumn('item'));

    const thQty = document.createElement('th');
    thQty.className = 'qpm-sr-th';
    thQty.style.cssText = TH_BASE + 'text-align:center;width:20%;';
    thQty.textContent = `${t('feature.shopRestock.thQty')}${sortIndicator('qty')}`;
    thQty.addEventListener('click', () => setSortColumn('qty'));

    const thLast = document.createElement('th');
    thLast.className = 'qpm-sr-th';
    thLast.style.cssText = TH_BASE + 'text-align:right;width:20%;';
    thLast.textContent = `${t('feature.shopRestock.thSeen')}${sortIndicator('last')}`;
    thLast.addEventListener('click', () => setSortColumn('last'));

    const thDetail = document.createElement('th');
    thDetail.style.cssText = TH_BASE + 'text-align:center;width:48px;';

    hr.append(thItem, thQty, thLast, thDetail);
    thead.appendChild(hr);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    table.appendChild(tbody);
    tableWrap.appendChild(table);

    let idx = 0;
    const appendChunk = (): void => {
      if (renderToken !== historyRenderToken) return;
      const frag = document.createDocumentFragment();
      for (let i = 0; i < HISTORY_CHUNK_SIZE && idx < filtered.length; i++, idx++) {
        const item = filtered[idx]!;
        const key = `${item.shop_type}:${item.item_id}`;
        const { row, cleanups: rowCleanups } = buildHistRow(item, key, {
          onPin: (k) => { trackedItems.add(k); persistTrackedAndRender(true); },
          openDetail: openItemRestockDetail,
        });
        frag.appendChild(row);
        histCleanups.push(...rowCleanups);
      }
      tbody.appendChild(frag);
      tableWrap.scrollTop = historyScrollTop;
      if (idx < filtered.length) {
        historyChunkRaf = requestAnimationFrame(appendChunk);
        return;
      }
      historyChunkRaf = null;
    };
    appendChunk();
  }

  const isWindowVisible = (): boolean => {
    if (!root.isConnected || root.style.display === 'none') return false;
    const win = root.closest('.qpm-window') as HTMLElement | null;
    return !win || win.style.display !== 'none';
  };

  // -- Live ETA countdown (30s -- ~Xm/~Xh granularity is fine) --
  const stopTicker = visibleInterval('shop-restock-countdown', () => {
    if (!isWindowVisible()) return;
    for (const ref of hotEtaRefs) {
      ref.el.textContent = formatETA(ref.ts);
      ref.el.style.color  = etaColor(ref.ts);
    }
    for (const ref of predEtaRefs) {
      ref.el.textContent = formatETA(ref.ts);
      ref.el.style.color  = etaColor(ref.ts);
    }
    for (const ref of histEtaRefs) {
      ref.el.textContent = formatETA(ref.ts);
      ref.el.style.color  = etaColor(ref.ts);
    }
    updateRefreshBudgetUi();
    updateLastUpdated();
  }, 30_000);

  const stopSpritesReady = onSpritesReady(() => {
    // Rebuild rows once UI atlas sprites (including sprite/ui/Coin) are available.
    scheduleRender(true, true);
  });

  // -- Cleanup when window is removed --
  const obs = new MutationObserver(() => {
    if (!root.isConnected) {
      obs.disconnect();
      if (searchDebounceTimer !== null) window.clearTimeout(searchDebounceTimer);
      if (saveUiTimer !== null) {
        window.clearTimeout(saveUiTimer);
        saveUiTimer = null;
      }
      if (historyChunkRaf !== null) {
        cancelAnimationFrame(historyChunkRaf);
        historyChunkRaf = null;
      }
      saveUiState();
      hideSoundPopover();
      flushPredCleanups();
      flushHistCleanups();
      stopWeatherDataUpdates();
      stopTicker();
      stopSpritesReady();
      stopRestockDataUpdates();
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });

  // -- Load data --
  const load = async (force = false): Promise<void> => {
    if (isLoading) return;

    if (force) {
      const budget = getRestockRefreshBudget();
      if (budget.blocked) {
        updateRefreshBudgetUi();
        return;
      }
    }

    isLoading = true;
    refreshBtn.textContent = t('common.loading');
    updateRefreshBudgetUi();

    const cached = getRestockDataSync();
    if (!force && cached?.length) {
      shopData = mergeDawnFallbackRows(mergeToolFallbackRows(cached));
      rebuildAllData();
      scheduleRender(true, true);
      updateLastUpdated();
    }

    try {
      shopData = mergeDawnFallbackRows(mergeToolFallbackRows(await fetchRestockData(force)));
      rebuildAllData();
      scheduleRender(true, true);
      updateLastUpdated();
    } catch (err) {
      console.error('[QPM][ShopRestock] Refresh failed', err);
      log('[ShopRestock] Fetch failed', err);
      if (force) {
        const message = err instanceof Error ? err.message : String(err);
        const inline = message.length > 64 ? `${message.slice(0, 64)}…` : message;
        lastUpdatedEl.textContent = t('feature.shopRestock.refreshFailed', { message: inline });
        lastUpdatedEl.title = message;
      }
    } finally {
      isLoading = false;
      refreshBtn.textContent = t('feature.shopRestock.refresh');
      updateRefreshBudgetUi();
    }
  };

  refreshBtn.addEventListener('click', () => load(true));

  // Kick off both in parallel -- game data load doesn't block restock data
  void initGameData().then(() => {
    shopData = mergeDawnFallbackRows(mergeToolFallbackRows(shopData));
    rebuildAllData();
    scheduleRender(true, true);
  });
  void load(false);

  // Tour system: check for first-time tour and inject replay button
  import('./tour').then(({ checkTour, injectReplayButton }) => {
    checkTour('shop-restock', root);
    injectReplayButton('shop-restock');
  });
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

export function openShopRestockWindow(): void {
  toggleWindow('shop-restock', t('feature.shopRestock.title'), renderShopRestockWindow, '880px', '88vh');
}
