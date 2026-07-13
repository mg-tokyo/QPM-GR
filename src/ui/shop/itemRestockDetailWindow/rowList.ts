import { getAccuracyWindows } from '../../../utils/restock/accuracy';
import { t } from '../../../i18n';
import type { RowData } from './types';
import { TIER_COLOR } from './constants';
import { computeRowEventAccuracy } from './cardShared';
import { fmtDuration, fmtTimestamp } from './format';

export function makeRowEl(
  row: RowData,
  prevRow: RowData | null,
  index: number,
  medianMs: number | null,
  intervals: number[] | null,
  onClick: (i: number) => void,
): HTMLElement {
  const acc = computeRowEventAccuracy(row, prevRow, medianMs, intervals);
  const { color, pill } = acc.status === 'first'
    ? { color: TIER_COLOR.none, pill: '' }
    : acc.status === 'accurate'
      ? { color: TIER_COLOR.good, pill: '✓ ' + t('feature.itemDetail.onTime') }
      : {
          color: Math.abs(acc.diffMs) <= getAccuracyWindows(medianMs, intervals).warnMs
            ? TIER_COLOR.warn
            : TIER_COLOR.bad,
          pill: acc.diffMs < 0 ? t('feature.itemDetail.durationEarly', { duration: fmtDuration(acc.diffMs) }) : t('feature.itemDetail.durationLate', { duration: fmtDuration(acc.diffMs) }),
        };
  const el = document.createElement('div');
  el.style.cssText = [
    'display:grid',
    'grid-template-columns:1fr auto',
    'align-items:center',
    `border-left:3px solid ${color}`,
    'padding:7px 10px 7px 11px',
    'border-radius:0 6px 6px 0',
    'margin-bottom:2px',
    'cursor:pointer',
    'transition:background 0.15s',
  ].join(';');
  el.addEventListener('mouseenter', () => {
    if (!el.dataset.active) el.style.background = 'rgba(143,130,255,0.08)';
  });
  el.addEventListener('mouseleave', () => {
    if (!el.dataset.active) el.style.background = '';
  });
  el.addEventListener('click', () => onClick(index));

  const tsEl = document.createElement('span');
  tsEl.style.cssText = 'font-size:12px;font-variant-numeric:tabular-nums;color:rgba(232,224,255,0.50);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
  tsEl.textContent = fmtTimestamp(row.timestamp);
  el.appendChild(tsEl);

  const pillCell = document.createElement('div');
  pillCell.style.cssText = 'display:flex;justify-content:flex-end;min-width:0;';
  if (pill) {
    const badge = document.createElement('span');
    badge.style.cssText = [
      `color:${color}`,
      `background:${color}14`,
      `border:1px solid ${color}38`,
      'font-size:10px', 'font-weight:600',
      'padding:2px 7px', 'border-radius:20px',
      'white-space:nowrap', 'font-variant-numeric:tabular-nums',
    ].join(';');
    badge.textContent = pill;
    pillCell.appendChild(badge);
  }
  el.appendChild(pillCell);

  return el;
}
