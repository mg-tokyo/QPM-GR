import type { RestockItem } from '../../../utils/restock/dataService';
import { getItemProbability } from '../../../utils/restock/dataService';
import { t } from '../../../i18n';
import type { OverviewHandle } from './types';
import { CARD_STYLE } from './constants';
import { makeCardHeader } from './cardShared';
import { fmtAbsoluteWithZone, fmtCountdown, fmtDuration, fmtPercent, fmtRelative } from './format';

export function buildOverviewCard(
  itemName: string,
  shopType: string,
  item: RestockItem,
  spriteUrl: string | null,
): OverviewHandle {
  const card = document.createElement('div');
  card.style.cssText = CARD_STYLE;

  const { header, statusIcon } = makeCardHeader(itemName, shopType, spriteUrl);
  const prob = getItemProbability(item);
  if (prob != null && prob >= 0.5) {
    statusIcon.textContent = '\u{1F525}';
    statusIcon.title = t('feature.itemDetail.highProbability');
  } else {
    statusIcon.textContent = '\u{1F4CA}';
    statusIcon.title = t('feature.itemDetail.overview');
  }
  card.appendChild(header);

  // Stats chips
  const statsRow = document.createElement('div');
  statsRow.style.cssText = 'display:flex;border-top:1px solid rgba(143,130,255,0.12);border-bottom:1px solid rgba(143,130,255,0.12);';

  const makeChip = (value: string, label: string, color = '#e8e0ff'): HTMLElement => {
    const chip = document.createElement('div');
    chip.style.cssText = [
      'flex:1', 'display:flex', 'flex-direction:column', 'align-items:center',
      'padding:10px 6px', 'gap:2px', 'min-width:0', 'overflow:hidden',
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

  const eventCountChip = makeChip(String(item.total_occurrences ?? 0), t('feature.itemDetail.sightings'));
  statsRow.appendChild(eventCountChip);
  if (item.average_quantity != null && item.average_quantity > 0) {
    const qty = item.average_quantity >= 10
      ? `~${Math.round(item.average_quantity)}`
      : `~${item.average_quantity.toFixed(1)}`;
    statsRow.appendChild(makeChip(qty, t('feature.itemDetail.avgQty')));
  }
  const lastChip = statsRow.lastElementChild as HTMLElement | null;
  if (lastChip) lastChip.style.borderRight = 'none';
  card.appendChild(statsRow);

  // Prediction + last seen section
  const infoSection = document.createElement('div');
  infoSection.style.cssText = 'padding:12px 16px;display:flex;flex-direction:column;gap:8px;';

  // Last seen
  const lastSeenRow = document.createElement('div');
  lastSeenRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;';
  const lastSeenLabel = document.createElement('span');
  lastSeenLabel.style.cssText = 'font-size:12px;color:rgba(232,224,255,0.5);';
  lastSeenLabel.textContent = t('feature.itemDetail.lastSeen');
  const lastSeenValue = document.createElement('span');
  lastSeenValue.style.cssText = 'font-size:13px;font-weight:600;color:#e8e0ff;';
  const setLastSeen = (timestamp: number | null): void => {
    lastSeenValue.textContent = timestamp ? fmtRelative(timestamp) : t('feature.itemDetail.never');
    lastSeenValue.title = timestamp ? fmtAbsoluteWithZone(timestamp) : t('feature.itemDetail.neverSeen');
  };
  setLastSeen(item.last_seen ?? null);
  lastSeenRow.append(lastSeenLabel, lastSeenValue);
  infoSection.appendChild(lastSeenRow);

  // Next estimated
  const nextRow = document.createElement('div');
  nextRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;';
  const nextLabel = document.createElement('span');
  nextLabel.style.cssText = 'font-size:12px;color:rgba(232,224,255,0.5);';
  nextLabel.textContent = t('feature.itemDetail.nextEstimated');
  const nextValue = document.createElement('span');
  const isOverdue = item.estimated_next_timestamp != null && item.estimated_next_timestamp <= Date.now();
  nextValue.style.cssText = `font-size:13px;font-weight:600;color:${isOverdue ? '#4ade80' : '#e8e0ff'};`;
  nextValue.textContent = item.estimated_next_timestamp
    ? fmtCountdown(item.estimated_next_timestamp)
    : '—';
  nextRow.append(nextLabel, nextValue);
  infoSection.appendChild(nextRow);

  // Current probability bar
  if (prob != null) {
    const probRow = document.createElement('div');
    probRow.style.cssText = 'margin-top:4px;';
    const probHeader = document.createElement('div');
    probHeader.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;margin-bottom:5px;';
    const probLabel = document.createElement('span');
    probLabel.style.cssText = 'font-size:12px;color:rgba(232,224,255,0.5);';
    probLabel.textContent = t('feature.itemDetail.currentProbability');
    const probValue = document.createElement('span');
    probValue.style.cssText = [
      'font-size:18px', 'font-weight:800',
      'background:linear-gradient(to right, #8f82ff, #f0abfc)',
      '-webkit-background-clip:text', '-webkit-text-fill-color:transparent',
      'background-clip:text',
    ].join(';');
    probValue.textContent = fmtPercent(prob);
    probHeader.append(probLabel, probValue);
    probRow.appendChild(probHeader);

    const barTrack = document.createElement('div');
    barTrack.style.cssText = 'width:100%;height:8px;border-radius:4px;background:rgba(143,130,255,0.12);overflow:hidden;';
    const barFill = document.createElement('div');
    barFill.style.cssText = `height:100%;border-radius:4px;background:linear-gradient(to right, #8f82ff, #f0abfc);width:${Math.round(prob * 100)}%;`;
    barTrack.appendChild(barFill);
    probRow.appendChild(barTrack);
    infoSection.appendChild(probRow);
  }

  // Prediction decomposition (collapsible)
  if (item.empirical_weight != null) {
    const decompRow = document.createElement('div');
    decompRow.style.cssText = 'margin-top:8px;';

    const decompToggle = document.createElement('button');
    decompToggle.type = 'button';
    decompToggle.style.cssText = [
      'display:flex', 'align-items:center', 'gap:6px', 'width:100%',
      'background:none', 'border:none', 'cursor:pointer', 'padding:0',
      'font-size:11px', 'font-weight:600', 'color:rgba(232,224,255,0.5)',
      'text-transform:uppercase', 'letter-spacing:0.3px',
    ].join(';');
    decompToggle.textContent = '▶ ' + t('feature.itemDetail.predictionDetails');

    const decompContent = document.createElement('div');
    decompContent.style.cssText = 'display:none;margin-top:6px;padding:8px 10px;border-radius:8px;background:rgba(143,130,255,0.04);border:1px solid rgba(143,130,255,0.10);';
    let decompOpen = false;
    decompToggle.addEventListener('click', () => {
      decompOpen = !decompOpen;
      decompContent.style.display = decompOpen ? '' : 'none';
      decompToggle.textContent = `${decompOpen ? '▼' : '▶'} ${t('feature.itemDetail.predictionDetails')}`;
    });

    const decompGrid = document.createElement('div');
    decompGrid.style.cssText = 'display:grid;grid-template-columns:1fr auto;gap:3px 12px;font-size:12px;';

    const addDecompLine = (label: string, value: string, color = '#e8e0ff'): void => {
      const lbl = document.createElement('span');
      lbl.style.cssText = 'color:rgba(232,224,255,0.5);';
      lbl.textContent = label;
      const val = document.createElement('span');
      val.style.cssText = `font-weight:600;color:${color};text-align:right;font-variant-numeric:tabular-nums;`;
      val.textContent = value;
      decompGrid.append(lbl, val);
    };

    if (item.fallback_rate != null) {
      const ratePct = (item.fallback_rate * 100).toFixed(2);
      const oneIn = item.fallback_rate > 0 ? Math.round(1 / item.fallback_rate) : 0;
      addDecompLine(t('feature.itemDetail.baseRate'), oneIn > 0 ? t('feature.itemDetail.baseRateOneIn', { pct: ratePct, oneIn }) : `${ratePct}%`);
    }
    if (item.empirical_probability != null) {
      addDecompLine(t('feature.itemDetail.empirical'), t('feature.itemDetail.pctConditional', { pct: (item.empirical_probability * 100).toFixed(2) }));
    }
    if (item.empirical_weight != null) {
      addDecompLine(t('feature.itemDetail.blendWeight'), t('feature.itemDetail.pctEmpirical', { pct: Math.round(item.empirical_weight * 100) }));
    }
    if (prob != null) {
      addDecompLine(t('feature.itemDetail.finalProbability'), fmtPercent(prob), '#a78bfa');
    }

    decompContent.appendChild(decompGrid);
    decompRow.append(decompToggle, decompContent);
    infoSection.appendChild(decompRow);
  }

  // Interval distribution histogram
  if (item.recent_intervals_ms && item.recent_intervals_ms.length >= 2) {
    const histRow = document.createElement('div');
    histRow.style.cssText = 'margin-top:8px;';

    const histLabel = document.createElement('div');
    histLabel.style.cssText = 'font-size:11px;font-weight:600;color:rgba(232,224,255,0.5);text-transform:uppercase;letter-spacing:0.3px;margin-bottom:6px;';
    histLabel.textContent = t('feature.itemDetail.intervalDistribution');
    histRow.appendChild(histLabel);

    const intervals = item.recent_intervals_ms;
    const bucketCount = Math.min(12, Math.max(5, Math.ceil(intervals.length / 3)));
    const minVal = Math.min(...intervals);
    const maxVal = Math.max(...intervals);
    const range = maxVal - minVal;

    if (range > 0) {
      const bucketSize = range / bucketCount;
      const buckets = new Array<number>(bucketCount).fill(0);
      for (const val of intervals) {
        const idx = Math.min(Math.floor((val - minVal) / bucketSize), bucketCount - 1);
        buckets[idx] = (buckets[idx] ?? 0) + 1;
      }
      const maxBucket = Math.max(...buckets);

      const histContainer = document.createElement('div');
      histContainer.style.cssText = 'display:flex;align-items:flex-end;gap:2px;height:32px;padding:0 2px;';

      const medianVal = item.median_interval_ms ?? 0;
      const medianBucket = range > 0 ? Math.min(Math.floor((medianVal - minVal) / bucketSize), bucketCount - 1) : -1;

      for (let i = 0; i < bucketCount; i++) {
        const bar = document.createElement('div');
        const heightPct = maxBucket > 0 ? Math.max(4, Math.round((buckets[i]! / maxBucket) * 100)) : 4;
        const isMedian = i === medianBucket;
        bar.style.cssText = [
          'flex:1',
          `height:${heightPct}%`,
          'border-radius:2px 2px 0 0',
          `background:${isMedian ? '#a78bfa' : 'rgba(143,130,255,0.25)'}`,
          'min-width:4px',
        ].join(';');
        const bucketStart = minVal + i * bucketSize;
        const bucketEnd = bucketStart + bucketSize;
        bar.title = `${fmtDuration(bucketStart)}–${fmtDuration(bucketEnd)}: ${buckets[i]!} interval${buckets[i] !== 1 ? 's' : ''}${isMedian ? ' (median)' : ''}`;
        histContainer.appendChild(bar);
      }

      histRow.appendChild(histContainer);

      // Range labels
      const rangeRow = document.createElement('div');
      rangeRow.style.cssText = 'display:flex;justify-content:space-between;font-size:9px;color:rgba(232,224,255,0.3);margin-top:2px;';
      const minLabel = document.createElement('span');
      minLabel.textContent = fmtDuration(minVal);
      const maxLabel = document.createElement('span');
      maxLabel.textContent = fmtDuration(maxVal);
      rangeRow.append(minLabel, maxLabel);
      histRow.appendChild(rangeRow);
    } else {
      const uniformNote = document.createElement('div');
      uniformNote.style.cssText = 'font-size:11px;color:rgba(232,224,255,0.3);';
      uniformNote.textContent = t('feature.itemDetail.allIntervals', { count: intervals.length, duration: fmtDuration(minVal) });
      histRow.appendChild(uniformNote);
    }

    infoSection.appendChild(histRow);
  }

  const accuracyRateRow = document.createElement('div');
  accuracyRateRow.style.cssText = 'margin-top:4px;display:none;';
  const accuracyRateHeader = document.createElement('div');
  accuracyRateHeader.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;margin-bottom:5px;';
  const accuracyRateLabel = document.createElement('span');
  accuracyRateLabel.style.cssText = 'font-size:12px;color:rgba(232,224,255,0.5);';
  accuracyRateLabel.textContent = t('feature.itemDetail.predictionAccuracy');
  const accuracyRateValue = document.createElement('span');
  accuracyRateValue.style.cssText = 'font-size:16px;font-weight:700;color:#e8e0ff;';
  accuracyRateHeader.append(accuracyRateLabel, accuracyRateValue);
  accuracyRateRow.appendChild(accuracyRateHeader);

  const accBarTrack = document.createElement('div');
  accBarTrack.style.cssText = 'width:100%;height:6px;border-radius:3px;background:rgba(143,130,255,0.12);overflow:hidden;';
  const accBarFill = document.createElement('div');
  accBarFill.style.cssText = 'height:100%;border-radius:3px;transition:width 0.3s ease;';
  accBarTrack.appendChild(accBarFill);
  accuracyRateRow.appendChild(accBarTrack);
  const accSubtitle = document.createElement('div');
  accSubtitle.style.cssText = 'font-size:10px;color:rgba(232,224,255,0.35);margin-top:4px;';
  accuracyRateRow.appendChild(accSubtitle);
  infoSection.appendChild(accuracyRateRow);
  card.appendChild(infoSection);

  // Browse events button
  const btnWrap = document.createElement('div');
  btnWrap.style.cssText = 'padding:0 16px 14px;';
  const browseBtn = document.createElement('button');
  browseBtn.type = 'button';
  browseBtn.textContent = t('feature.itemDetail.loadingEvents');
  browseBtn.disabled = true;
  browseBtn.style.cssText = [
    'display:block', 'width:100%', 'padding:9px',
    'font-size:13px', 'font-weight:600', 'cursor:pointer',
    'background:rgba(143,130,255,0.12)',
    'border:1px solid rgba(143,130,255,0.3)',
    'border-radius:8px', 'color:#c8c0ff',
    'transition:background 0.15s',
    'opacity:0.6',
  ].join(';');
  browseBtn.addEventListener('mouseenter', () => {
    if (!browseBtn.disabled) browseBtn.style.background = 'rgba(143,130,255,0.22)';
  });
  browseBtn.addEventListener('mouseleave', () => {
    browseBtn.style.background = 'rgba(143,130,255,0.12)';
  });
  btnWrap.appendChild(browseBtn);
  card.appendChild(btnWrap);

  return {
    container: card,
    setEventCount: (count: number, totalSightings?: number) => {
      browseBtn.disabled = count === 0;
      browseBtn.style.opacity = count === 0 ? '0.4' : '1';
      browseBtn.style.cursor = count === 0 ? 'default' : 'pointer';
      browseBtn.textContent = count > 0
        ? (count === 1 ? t('feature.itemDetail.browseEvent', { count }) : t('feature.itemDetail.browseEvents', { count }))
        : t('feature.itemDetail.noEventsRecorded');
      const chipValue = eventCountChip.firstElementChild as HTMLElement | null;
      if (chipValue) chipValue.textContent = String(totalSightings ?? count);
    },
    setAccuracyRate: (accuratePct: number, accurateCount: number, totalCount: number) => {
      accuracyRateRow.style.display = '';
      const capped = Math.min(99, accuratePct);
      accuracyRateValue.textContent = `${capped}%`;
      const color = capped >= 70 ? '#4ade80' : capped >= 40 ? '#fbbf24' : '#f87171';
      accBarFill.style.width = `${capped}%`;
      accBarFill.style.background = color;
      accuracyRateValue.style.color = color;
      accSubtitle.textContent = t('feature.itemDetail.accuracyRate', { count: accurateCount, total: totalCount });
    },
    setLastSeen,
    browseBtn,
  };
}
