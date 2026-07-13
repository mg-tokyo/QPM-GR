import { openWindow, destroyWindow } from '../../core/modalWindow';
import { fetchItemEvents, fetchAlgorithmHistory, type AlgorithmVersionEntry } from '../../../utils/itemEventService';
import type { RestockItem } from '../../../utils/restock/dataService';
import { canonicalItemId, patchCachedItemLastSeen } from '../../../utils/restock/dataService';
import { watchDetach } from '../../../utils/dom/dom';
import { storage } from '../../../utils/storage';
import { t } from '../../../i18n';
import type { EventCardHandle, RowData } from './types';
import {
  INITIAL_ROWS,
  DETAIL_WINDOW_SCALE_KEY,
  DETAIL_WINDOW_SCALE_MIN,
  DETAIL_WINDOW_SCALE_MAX,
  DETAIL_WINDOW_SCALE_DEFAULT,
} from './constants';
import {
  isDetailShopType,
  resolveDetailRestockItem,
  rememberDetailWindow,
  registerDetailWindowOpener,
  getDetailWindowId,
} from './registry';
import { normalizeEpochMs, sortEventsNewestFirst } from './format';
import { buildAlgorithmMarkerSlots, makeAlgorithmUpdateMarkerEl } from './markers';
import { getItemSpriteUrl } from './sprite';
import { computeRowEventAccuracy } from './cardShared';
import { buildOverviewCard } from './overviewCard';
import { buildEventCard } from './eventCard';
import { makeRowEl } from './rowList';

let detailScaleLegacyCleared = false;

function clampDetailScale(value: number): number {
  if (!Number.isFinite(value)) return DETAIL_WINDOW_SCALE_DEFAULT;
  return Math.min(DETAIL_WINDOW_SCALE_MAX, Math.max(DETAIL_WINDOW_SCALE_MIN, value));
}

export function openItemRestockDetail(item: RestockItem, itemName: string): void {
  if (!detailScaleLegacyCleared) {
    // Old manual scale controls were removed; clear any stale persisted value once.
    storage.remove(DETAIL_WINDOW_SCALE_KEY);
    detailScaleLegacyCleared = true;
  }

  const shopType = item.shop_type;
  if (!isDetailShopType(shopType)) return;

  const canonicalId = canonicalItemId(shopType, item.item_id);
  const safeItemName = itemName.trim() || canonicalId;
  const selectedItem = resolveDetailRestockItem(shopType, canonicalId, item);

  rememberDetailWindow(shopType, canonicalId, safeItemName);
  registerDetailWindowOpener(shopType, canonicalId, safeItemName);

  const winId = getDetailWindowId(shopType, canonicalId);
  destroyWindow(winId);

  openWindow(winId, `${safeItemName} — ${t('feature.itemDetail.restockHistory')}`, (root) => {
    root.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden;';
    const item = selectedItem;

    const contentViewport = document.createElement('div');
    contentViewport.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;overflow:auto;';
    root.appendChild(contentViewport);

    const contentRoot = document.createElement('div');
    contentRoot.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;transform-origin:top left;will-change:transform;';
    contentViewport.appendChild(contentRoot);

    const manualScale = DETAIL_WINDOW_SCALE_DEFAULT;
    let linkedScaleFactor = 1;
    let baseViewportWidth: number | null = null;
    let baseViewportHeight: number | null = null;
    const hostWindow = root.closest('.qpm-window') as HTMLElement | null;

    const renderScale = (): void => {
      let effectiveScale = clampDetailScale(manualScale * linkedScaleFactor);

      const applyScale = (scale: number): void => {
        contentRoot.style.transform = `scale(${scale.toFixed(3)})`;
        contentRoot.style.width = `${(100 / scale).toFixed(3)}%`;
      };

      applyScale(effectiveScale);

      // Safety correction: if scaled content still overflows horizontally, shrink further.
      const viewportRect = contentViewport.getBoundingClientRect();
      const visualRect = contentRoot.getBoundingClientRect();
      if (viewportRect.width > 0 && visualRect.width > viewportRect.width + 1) {
        const ratio = viewportRect.width / visualRect.width;
        if (Number.isFinite(ratio) && ratio > 0) {
          effectiveScale = clampDetailScale(effectiveScale * ratio);
          applyScale(effectiveScale);
        }
      }
    };

    const updateLinkedScaleFromWindow = (): void => {
      const viewportWidth = contentViewport.clientWidth;
      const viewportHeight = contentViewport.clientHeight;
      if (!Number.isFinite(viewportWidth) || !Number.isFinite(viewportHeight) || viewportWidth <= 0 || viewportHeight <= 0) return;
      if (baseViewportWidth == null || baseViewportHeight == null) {
        baseViewportWidth = viewportWidth;
        baseViewportHeight = viewportHeight;
        linkedScaleFactor = 1;
        renderScale();
        return;
      }
      const widthRatio = viewportWidth / baseViewportWidth;
      const heightRatio = viewportHeight / baseViewportHeight;
      if (!Number.isFinite(widthRatio) || !Number.isFinite(heightRatio) || widthRatio <= 0 || heightRatio <= 0) return;
      // Use the tighter dimension so content always scales down enough to fit.
      linkedScaleFactor = Math.min(widthRatio, heightRatio);
      renderScale();
    };

    let resizeObserver: ResizeObserver | null = null;
    if (hostWindow && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        updateLinkedScaleFromWindow();
      });
      resizeObserver.observe(hostWindow);
      resizeObserver.observe(contentViewport);
      updateLinkedScaleFromWindow();

      watchDetach(root, () => {
        resizeObserver?.disconnect();
        resizeObserver = null;
      });
    } else {
      renderScale();
    }

    const spriteUrl = getItemSpriteUrl(item.shop_type, item.item_id);
    const medianMs = item.median_interval_ms;
    const itemIntervals = item.recent_intervals_ms ?? null;
    const algorithmUpdatedAtMs = normalizeEpochMs(item.algorithm_updated_at);

    // ── Overview card (shown immediately with RestockItem data) ──
    const overview = buildOverviewCard(safeItemName, item.shop_type, item, spriteUrl);
    contentRoot.appendChild(overview.container);

    // ── Placeholder for event card (hidden initially) ──
    let eventCard: EventCardHandle | null = null;
    let eventCardEl: HTMLElement | null = null;

    // ── Event list container (populated after fetch) ──
    const eventListSection = document.createElement('div');
    eventListSection.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;';

    const spinner = document.createElement('div');
    spinner.style.cssText = 'display:flex;align-items:center;justify-content:center;padding:20px;font-size:12px;color:rgba(224,224,224,0.4);';
    spinner.textContent = '⏳ ' + t('feature.itemDetail.loadingEvents');
    eventListSection.appendChild(spinner);
    contentRoot.appendChild(eventListSection);
    updateLinkedScaleFromWindow();

    // ── Shared state ──
    let rows: RowData[] = [];
    const rowElements: HTMLElement[] = [];
    let activeRowIndex = -1;

    function setActiveRow(index: number): void {
      const prev = rowElements[activeRowIndex];
      if (prev) {
        delete prev.dataset.active;
        prev.style.background = '';
      }
      activeRowIndex = index;
      const next = rowElements[index];
      if (next) {
        next.dataset.active = '1';
        next.style.background = 'rgba(143,130,255,0.10)';
        next.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }

    function showOverview(): void {
      overview.container.style.display = '';
      if (eventCardEl) eventCardEl.style.display = 'none';
      setActiveRow(-1);
    }

    function showEventCard(index: number): void {
      if (!eventCard || !eventCardEl || rows.length === 0) return;
      overview.container.style.display = 'none';
      eventCardEl.style.display = '';
      eventCard.update(index);
      setActiveRow(index);
    }

    // ── Fetch events + algorithm history ──
    void (async () => {
      let events: Awaited<ReturnType<typeof fetchItemEvents>> = [];
      let algoHistory: AlgorithmVersionEntry[] = [];
      try {
        [events, algoHistory] = await Promise.all([
          fetchItemEvents(item.shop_type, item.item_id).catch(() => [] as Awaited<ReturnType<typeof fetchItemEvents>>),
          fetchAlgorithmHistory().catch(() => [] as AlgorithmVersionEntry[]),
        ]);
      } catch {
        /* network error — both stay [] */
      }

      if (!eventListSection.contains(spinner)) return; // window closed
      eventListSection.removeChild(spinner);

      if (!events.length) {
        overview.setEventCount(0);
        const empty = document.createElement('div');
        empty.style.cssText = 'display:flex;align-items:center;justify-content:center;padding:24px;font-size:12px;color:rgba(224,224,224,0.35);';
        empty.textContent = t('feature.itemDetail.noEventHistory');
        eventListSection.appendChild(empty);
        updateLinkedScaleFromWindow();
        return;
      }

      const normalizedEvents = events
        .map((ev) => {
          const ts = normalizeEpochMs(ev.timestamp);
          if (ts == null) return null;
          return {
            timestamp: ts,
            quantity: ev.quantity,
            predicted_next_ms: normalizeEpochMs(ev.predicted_next_ms),
          };
        })
        .filter((ev): ev is { timestamp: number; quantity: number | null; predicted_next_ms: number | null } => ev !== null);
      const orderedEvents = sortEventsNewestFirst(normalizedEvents);
      overview.setEventCount(orderedEvents.length, item.total_occurrences ?? undefined);

      rows = orderedEvents.map((ev, i): RowData => {
        const prev    = i + 1 < orderedEvents.length ? orderedEvents[i + 1]! : null;
        const gapMs   = prev !== null ? ev.timestamp - prev.timestamp : null;
        const errorMs = (gapMs !== null && medianMs != null) ? gapMs - medianMs : null;
        return {
          timestamp: ev.timestamp,
          quantity: ev.quantity,
          predicted_next_ms: ev.predicted_next_ms,
          gapMs,
          errorMs,
        };
      });

      const latestEventTs = rows[0]?.timestamp ?? null;
      if (latestEventTs != null) {
        if ((item.last_seen ?? 0) < latestEventTs) {
          item.last_seen = latestEventTs;
          patchCachedItemLastSeen(item.shop_type, item.item_id, latestEventTs);
        }
        overview.setLastSeen(item.last_seen ?? latestEventTs);
      }

      {
        let accurateCount = 0;
        let scoredCount = 0;
        for (let i = 0; i < rows.length; i++) {
          const prevRow = i + 1 < rows.length ? rows[i + 1]! : null;
          const acc = computeRowEventAccuracy(rows[i]!, prevRow, medianMs, itemIntervals);
          if (acc.status === 'first') continue;
          scoredCount++;
          if (acc.status === 'accurate') accurateCount++;
        }
        if (scoredCount >= 3) {
          const pct = Math.round((accurateCount / scoredCount) * 100);
          overview.setAccuracyRate(pct, accurateCount, scoredCount);
        }
      }

      // Build event card (hidden initially)
      eventCard = buildEventCard(
        safeItemName, item.shop_type, rows, medianMs, itemIntervals, spriteUrl,
        (index) => setActiveRow(index),
        showOverview,
      );
      eventCardEl = eventCard.container;
      eventCardEl.style.display = 'none';
      contentRoot.insertBefore(eventCardEl, eventListSection);

      // Wire browse button
      overview.browseBtn.addEventListener('click', () => {
        if (rows.length > 0) showEventCard(0);
      });

      // ── Summary strip ──
      const strip = document.createElement('div');
      strip.style.cssText = 'display:flex;flex-shrink:0;border-bottom:1px solid rgba(143,130,255,0.15);margin-top:8px;';

      const makeChip = (value: string, label: string, color = 'rgba(232,224,255,0.9)'): HTMLElement => {
        const chip = document.createElement('div');
        chip.style.cssText = [
          'flex:1', 'display:flex', 'flex-direction:column', 'align-items:center',
          'padding:10px 8px', 'gap:2px', 'min-width:0', 'overflow:hidden',
          'border-right:1px solid rgba(143,130,255,0.08)',
        ].join(';');
        const v = document.createElement('div');
        v.style.cssText = `font-size:15px;font-weight:700;color:${color};font-variant-numeric:tabular-nums;white-space:nowrap;`;
        v.textContent = value;
        const l = document.createElement('div');
        l.style.cssText = 'font-size:9px;text-transform:uppercase;letter-spacing:0.55px;color:rgba(224,224,224,0.32);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;';
        l.textContent = label;
        chip.append(v, l);
        return chip;
      };

      strip.appendChild(makeChip(String(rows.length), t('feature.itemDetail.events')));
      const lastChip = strip.lastElementChild as HTMLElement | null;
      if (lastChip) lastChip.style.borderRight = 'none';
      eventListSection.appendChild(strip);

      // ── Column headers ──
      const colHdr = document.createElement('div');
      colHdr.style.cssText = [
        'display:grid', 'grid-template-columns:1fr auto',
        'padding:6px 10px 3px 18px',
        'font-size:10px', 'font-weight:700', 'letter-spacing:0.5px',
        'text-transform:uppercase', 'color:rgba(224,224,224,0.25)',
        'flex-shrink:0',
      ].join(';');
      const hL = document.createElement('span');
      hL.textContent = t('feature.itemDetail.restocked');
      const hR = document.createElement('span');
      hR.style.textAlign = 'right';
      hR.textContent = t('feature.itemDetail.statusHeader');
      colHdr.append(hL, hR);
      eventListSection.appendChild(colHdr);

      // ── Scrollable event list ──
      const listWrap = document.createElement('div');
      listWrap.style.cssText = 'flex:1;overflow-y:auto;min-height:0;padding:4px 10px 10px;';

      const handleRowClick = (index: number): void => {
        showEventCard(index);
      };

      let renderedCount = 0;
      const markerSlots = buildAlgorithmMarkerSlots(rows, algorithmUpdatedAtMs, algoHistory);

      const appendMarkersIfNeeded = (beforeIndex: number): void => {
        for (const slot of markerSlots) {
          if (slot.inserted || slot.insertIdx !== beforeIndex) continue;
          listWrap.appendChild(makeAlgorithmUpdateMarkerEl(slot));
          slot.inserted = true;
        }
      };

      for (let i = 0; i < Math.min(INITIAL_ROWS, rows.length); i++) {
        appendMarkersIfNeeded(i);
        const rowEl = makeRowEl(rows[i]!, i + 1 < rows.length ? rows[i + 1]! : null, i, medianMs, itemIntervals, handleRowClick);
        rowElements[i] = rowEl;
        listWrap.appendChild(rowEl);
        renderedCount++;
      }
      appendMarkersIfNeeded(renderedCount);

      if (rows.length > INITIAL_ROWS) {
        const remaining = rows.length - INITIAL_ROWS;
        const moreBtn = document.createElement('button');
        moreBtn.type = 'button';
        moreBtn.textContent = t('feature.itemDetail.showMore', { count: remaining });
        moreBtn.style.cssText = [
          'display:block', 'width:100%', 'margin-top:6px', 'padding:7px',
          'font-size:12px', 'font-weight:600', 'cursor:pointer',
          'background:rgba(143,130,255,0.08)',
          'border:1px solid rgba(143,130,255,0.2)',
          'border-radius:7px', 'color:rgba(200,192,255,0.55)',
          'transition:background 0.1s',
        ].join(';');
        moreBtn.addEventListener('mouseenter', () => { moreBtn.style.background = 'rgba(143,130,255,0.14)'; });
        moreBtn.addEventListener('mouseleave', () => { moreBtn.style.background = 'rgba(143,130,255,0.08)'; });
        moreBtn.addEventListener('click', () => {
          moreBtn.remove();
          for (let i = renderedCount; i < rows.length; i++) {
            appendMarkersIfNeeded(i);
            const rowEl = makeRowEl(rows[i]!, i + 1 < rows.length ? rows[i + 1]! : null, i, medianMs, itemIntervals, handleRowClick);
            rowElements[i] = rowEl;
            listWrap.appendChild(rowEl);
          }
          appendMarkersIfNeeded(rows.length);
          if (activeRowIndex >= 0) setActiveRow(activeRowIndex);
          updateLinkedScaleFromWindow();
        });
        listWrap.appendChild(moreBtn);
      }

      eventListSection.appendChild(listWrap);
      updateLinkedScaleFromWindow();
    })();
  }, '520px', '80vh');
}
