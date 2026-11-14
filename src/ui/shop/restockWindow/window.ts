// Shop Restock Tracker -- main render + public entry.

import { toggleWindow } from '../../core/modalWindow';
import { openItemRestockDetail } from '../itemRestockDetailWindow';
import { hideSoundPopover } from '../restockAlerts/soundPopover';
import { warnFeature } from '../restockWindowDiagnostics';
import {
  fetchRestockData,
  getRestockDataSync,
  getRestockFetchedAt,
  getRestockRefreshBudget,
  onRestockDataUpdated,
  onWeatherPredictionsUpdated,
  weatherPredictionsAsRestockItems,
  type RestockItem,
} from '../../../utils/restock/dataService';
import { visibleInterval } from '../../../utils/scheduling/timerManager';
import { watchDetach } from '../../../utils/dom/dom';
import { onSpritesReady } from '../../../sprite-v2/compat';
import { onCatalogsReady } from '../../../utils/game/catalogHelpers';
import { storage } from '../../../utils/storage';
import { t } from '../../../i18n';
import {
  SEARCH_DEBOUNCE_MS,
  UI_STATE_SAVE_DEBOUNCE_MS,
  HISTORY_CHUNK_SIZE,
  UI_STATE_KEY,
} from '../restockWindowConstants';
import {
  loadUiState,
  loadTracked,
  saveTracked,
  mergeToolFallbackRows,
  mergeWeatherShopFallbackRows,
  initGameData,
  type SortColumn,
  type SortDirection,
} from '../restockWindowMeta';
import {
  formatETA,
  etaColor,
  formatWindowCountdown,
} from '../restockWindowFormatters';
import {
  buildHistRow,
  // buildHotRow,  // disabled: Hot Right Now section
  type EtaRef,
} from '../restockWindowRows';
import { SR_STYLE_CSS } from './constants';
import {
  attachPinnedResize,
  buildDivider,
  buildItemsSection,
  buildPinnedSection,
  buildToolbar,
  styleFilterButton,
} from './layout';
import { buildHistoryTable, filterAndSortHistory, renderPinnedRows } from './lists';

function renderShopRestockWindow(root: HTMLElement): void {
  root.innerHTML = '';
  root.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;';

  // Inject scoped styles for tooltip hover and rarity text
  const styleEl = document.createElement('style');
  styleEl.textContent = SR_STYLE_CSS;
  root.appendChild(styleEl);
  const persistedUi = loadUiState();

  // -- Toolbar --
  const { toolbar, filterBtns, searchInput, refreshBtn, refreshBudgetEl, lastUpdatedEl } = buildToolbar(persistedUi.search);

  let currentFilter = persistedUi.filter;

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
    filterBtns.forEach(b => styleFilterButton(b, b.dataset.filter === value));
    scheduleSaveUiState();
    scheduleRender(false, true);
  };
  filterBtns.forEach(btn => btn.addEventListener('click', () => setFilter(btn.dataset.filter!)));
  const activeFilterBtn = filterBtns.find(b => b.dataset.filter === currentFilter) ?? filterBtns[0]!;
  if (activeFilterBtn.dataset.filter !== currentFilter) currentFilter = activeFilterBtn.dataset.filter!;
  filterBtns.forEach(btn => styleFilterButton(btn, btn === activeFilterBtn));

  let searchDebounceTimer: number | null = null;
  searchInput.addEventListener('input', () => {
    if (searchDebounceTimer !== null) window.clearTimeout(searchDebounceTimer);
    searchDebounceTimer = window.setTimeout(() => {
      searchDebounceTimer = null;
      scheduleSaveUiState();
      scheduleRender(false, true);
    }, SEARCH_DEBOUNCE_MS);
  });

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
  let pinnedHeight = persistedUi.pinnedHeight;
  let predCollapsed = persistedUi.predCollapsed;
  const { predSection, predHeaderRow, predChevron, predBody } = buildPinnedSection(pinnedHeight, predCollapsed);
  predHeaderRow.addEventListener('click', () => {
    predCollapsed = !predCollapsed;
    predBody.style.display = predCollapsed ? 'none' : '';
    predChevron.textContent = predCollapsed ? '>' : 'v';
    divider.style.display = predCollapsed ? 'none' : '';
    scheduleSaveUiState();
  });
  body.appendChild(predSection);

  // -- Resizable divider between Pinned and Items --
  const divider = buildDivider(predCollapsed);
  attachPinnedResize(divider, predBody, body, (height) => { pinnedHeight = height; }, scheduleSaveUiState);
  body.appendChild(divider);

  // -- History section --
  const { histSection, resetSortBtn, itemCountEl, tableWrap } = buildItemsSection();
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
    // Chunked renders clamp scrollTop while the table is still short; don't
    // let those programmatic events overwrite the restore target.
    if (historyChunkRaf !== null) return;
    historyScrollTop = tableWrap.scrollTop;
    scheduleSaveUiState();
  }, { passive: true });

  const stopRestockDataUpdates = onRestockDataUpdated((detail) => {
    const updated = Array.isArray(detail.items) && detail.items.length > 0
      ? detail.items
      : getRestockDataSync();
    if (!updated) return;
    shopData = mergeWeatherShopFallbackRows(mergeToolFallbackRows(updated));
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
    const rendered = renderPinnedRows(predBody, allData, trackedItems, (k) => {
      trackedItems.delete(k);
      persistTrackedAndRender(true);
    });
    predEtaRefs = rendered.etaRefs;
    predCleanups = rendered.cleanups;
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
    const targetScrollTop = historyScrollTop;
    tableWrap.innerHTML = '';
    updateResetSortButton();
    histEtaRefs = [];
    const search = searchInput.value.trim().toLowerCase();
    const now    = Date.now();

    const filtered = filterAndSortHistory(allData, trackedItems, currentFilter, search, sortColumn, sortDirection, now);

    itemCountEl.textContent = filtered.length === 1
      ? t('feature.shopRestock.itemCountSingle', { count: filtered.length })
      : t('feature.shopRestock.itemCount', { count: filtered.length });

    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:40px;text-align:center;color:var(--qpm-text-muted);font-size:12px;';
      empty.textContent = isLoading ? t('feature.shopRestock.loadingRestock') : t('feature.shopRestock.noItemsFound');
      tableWrap.appendChild(empty);
      historyScrollTop = 0;
      tableWrap.scrollTop = 0;
      return;
    }

    const { table, tbody } = buildHistoryTable(sortColumn, sortDirection, setSortColumn);
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
      tableWrap.scrollTop = targetScrollTop;
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
  // polling-justified: ETA and "updated ago" text follow the wall clock; no event fires while time passes.
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

  // Weather-shop rows show a loading placeholder until eligibleShops is known;
  // re-merge and re-render as soon as catalogs resolve so the placeholders swap out.
  const stopCatalogsReady = onCatalogsReady(() => {
    const source = getRestockDataSync();
    if (source) {
      shopData = mergeWeatherShopFallbackRows(mergeToolFallbackRows(source));
      rebuildAllData();
    }
    scheduleRender(true, true);
  });

  // -- Cleanup when window is removed --
  watchDetach(root, () => {
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
    stopCatalogsReady();
    stopRestockDataUpdates();
  });

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
      shopData = mergeWeatherShopFallbackRows(mergeToolFallbackRows(cached));
      rebuildAllData();
      scheduleRender(true, true);
      updateLastUpdated();
    }

    try {
      shopData = mergeWeatherShopFallbackRows(mergeToolFallbackRows(await fetchRestockData(force)));
      rebuildAllData();
      scheduleRender(true, true);
      updateLastUpdated();
    } catch (err) {
      warnFeature('QPM-FEATURE-004', { what: 'window:fetchRestock', force }, err);
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
    shopData = mergeWeatherShopFallbackRows(mergeToolFallbackRows(shopData));
    rebuildAllData();
    scheduleRender(true, true);
  });
  void load(false);

  // Tour system: check for first-time tour and inject replay button
  import('../../tour').then(({ checkTour, injectReplayButton }) => {
    checkTour('shop-restock', root);
    injectReplayButton('shop-restock');
  });
}

export function openShopRestockWindow(): void {
  toggleWindow('shop-restock', t('feature.shopRestock.title'), renderShopRestockWindow, '880px', '88vh');
}
