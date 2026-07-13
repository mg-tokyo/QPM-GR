import { t } from '../../../i18n';
import type { EventCardHandle, RowData } from './types';
import { CARD_STYLE } from './constants';
import { computeRowEventAccuracy, getStatusConfig, makeCardHeader } from './cardShared';
import { fmtDuration, fmtTimestamp } from './format';

export function buildEventCard(
  itemName: string,
  shopType: string,
  rows: RowData[],
  medianMs: number | null,
  intervals: number[] | null,
  spriteUrl: string | null,
  onNavigate: (index: number) => void,
  onBack: () => void,
): EventCardHandle {
  const card = document.createElement('div');
  card.style.cssText = CARD_STYLE;

  const { header, statusIcon } = makeCardHeader(itemName, shopType, spriteUrl);
  card.appendChild(header);

  // Time comparison
  const timeSection = document.createElement('div');
  timeSection.style.cssText = 'padding:0 16px 12px;display:flex;flex-direction:column;gap:8px;';

  const makeTimeBox = (labelText: string, iconChar: string, color: string, bgColor: string): { box: HTMLElement; valueEl: HTMLElement; labelEl: HTMLElement } => {
    const box = document.createElement('div');
    box.style.cssText = `border-radius:8px;border:1px solid ${color}30;background:${bgColor};padding:10px 12px;`;
    const topRow = document.createElement('div');
    topRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:4px;';
    const icon = document.createElement('span');
    icon.style.cssText = `font-size:12px;color:${color};`;
    icon.textContent = iconChar;
    const lbl = document.createElement('span');
    lbl.style.cssText = `font-size:11px;font-weight:600;color:${color};text-transform:uppercase;letter-spacing:0.3px;`;
    lbl.textContent = labelText;
    topRow.append(icon, lbl);
    const valueEl = document.createElement('div');
    valueEl.style.cssText = 'font-size:13px;font-weight:600;color:#e8e0ff;font-variant-numeric:tabular-nums;';
    box.append(topRow, valueEl);
    return { box, valueEl, labelEl: lbl };
  };

  const estimated = makeTimeBox(t('feature.itemDetail.estimatedRestock'), '\u{1F52E}', '#a78bfa', 'rgba(143,130,255,0.06)');
  const actual    = makeTimeBox(t('feature.itemDetail.actualRestock'), '\u{1F4CD}', '#f0abfc', 'rgba(255,143,230,0.06)');
  timeSection.append(estimated.box, actual.box);
  card.appendChild(timeSection);

  // Status + diff
  const statusSection = document.createElement('div');
  statusSection.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 16px;border-top:1px solid rgba(143,130,255,0.12);';

  const statusBadge = document.createElement('span');
  statusBadge.style.cssText = 'font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;';

  const diffText = document.createElement('span');
  diffText.style.cssText = 'font-size:12px;color:rgba(232,224,255,0.6);font-variant-numeric:tabular-nums;';

  statusSection.append(statusBadge, diffText);
  card.appendChild(statusSection);

  // Navigation
  const navSection = document.createElement('div');
  navSection.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:12px;padding:8px 16px 12px;border-top:1px solid rgba(143,130,255,0.08);';

  const makeNavBtn = (text: string): HTMLButtonElement => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = text;
    btn.style.cssText = [
      'padding:4px 12px', 'font-size:12px', 'font-weight:600',
      'border-radius:6px', 'cursor:pointer',
      'background:rgba(143,130,255,0.10)',
      'border:1px solid rgba(143,130,255,0.2)',
      'color:#c8c0ff', 'transition:background 0.15s',
    ].join(';');
    btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(143,130,255,0.20)'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = 'rgba(143,130,255,0.10)'; });
    return btn;
  };

  const prevBtn = makeNavBtn('◀ ' + t('feature.itemDetail.prev'));
  const nextBtn = makeNavBtn(t('feature.itemDetail.nextNav') + ' ▶');
  const counter = document.createElement('span');
  counter.style.cssText = 'font-size:12px;color:rgba(232,224,255,0.5);font-variant-numeric:tabular-nums;min-width:60px;text-align:center;';

  let currentIndex = 0;

  prevBtn.addEventListener('click', () => {
    if (currentIndex < rows.length - 1) {
      update(currentIndex + 1);
      onNavigate(currentIndex);
    }
  });
  nextBtn.addEventListener('click', () => {
    if (currentIndex > 0) {
      update(currentIndex - 1);
      onNavigate(currentIndex);
    }
  });

  navSection.append(prevBtn, counter, nextBtn);
  card.appendChild(navSection);

  // Back to overview link
  const backRow = document.createElement('div');
  backRow.style.cssText = 'text-align:center;padding:0 16px 10px;';
  const backLink = document.createElement('button');
  backLink.type = 'button';
  backLink.textContent = '← ' + t('feature.itemDetail.backToOverview');
  backLink.style.cssText = [
    'background:none', 'border:none', 'cursor:pointer',
    'font-size:11px', 'color:rgba(200,192,255,0.55)',
    'text-decoration:underline', 'text-underline-offset:2px',
  ].join(';');
  backLink.addEventListener('mouseenter', () => { backLink.style.color = '#c8c0ff'; });
  backLink.addEventListener('mouseleave', () => { backLink.style.color = 'rgba(200,192,255,0.55)'; });
  backLink.addEventListener('click', onBack);
  backRow.appendChild(backLink);
  card.appendChild(backRow);

  function update(index: number): void {
    currentIndex = index;
    const row = rows[index]!;
    const prevRow = index + 1 < rows.length ? rows[index + 1]! : null;
    const acc = computeRowEventAccuracy(row, prevRow, medianMs, intervals);
    const cfg = getStatusConfig()[acc.status];
    const hasLoggedPrediction = row.predicted_next_ms != null;

    statusIcon.textContent = cfg.icon;
    statusIcon.style.color = cfg.color;

    if (acc.status === 'first') {
      estimated.labelEl.textContent = t('feature.itemDetail.estimatedRestock');
      estimated.valueEl.textContent = '—';
      estimated.valueEl.style.color = 'rgba(232,224,255,0.3)';
      actual.valueEl.textContent = fmtTimestamp(acc.actualTs);
      actual.valueEl.style.color = '#e8e0ff';
    } else {
      estimated.labelEl.textContent = hasLoggedPrediction ? t('feature.itemDetail.predictedRestock') : t('feature.itemDetail.medianEstimate');
      estimated.valueEl.textContent = acc.estimatedTs != null ? fmtTimestamp(acc.estimatedTs) : '—';
      estimated.valueEl.style.color = '#e8e0ff';
      actual.valueEl.textContent = fmtTimestamp(acc.actualTs);
      actual.valueEl.style.color = '#e8e0ff';
    }

    statusBadge.textContent = `${cfg.icon}  ${cfg.label}`;
    statusBadge.style.color = cfg.color;
    statusBadge.style.background = cfg.bg;
    statusBadge.style.border = `1px solid ${cfg.color}30`;

    if (acc.status === 'first') {
      diffText.textContent = t('feature.itemDetail.firstRecorded');
    } else {
      const absDiff = Math.abs(acc.diffMs);
      const dir = acc.diffMs < 0 ? 'early' : acc.diffMs > 0 ? 'late' : 'exact';
      diffText.textContent = dir === 'exact'
        ? t('feature.itemDetail.exactMatch')
        : dir === 'early'
          ? t('feature.itemDetail.durationEarly', { duration: fmtDuration(absDiff) })
          : t('feature.itemDetail.durationLate', { duration: fmtDuration(absDiff) });
    }

    counter.textContent = t('feature.itemDetail.counterOf', { current: index + 1, total: rows.length });
    prevBtn.disabled = index >= rows.length - 1;
    nextBtn.disabled = index <= 0;
    prevBtn.style.opacity = prevBtn.disabled ? '0.3' : '1';
    nextBtn.style.opacity = nextBtn.disabled ? '0.3' : '1';
    prevBtn.style.cursor = prevBtn.disabled ? 'default' : 'pointer';
    nextBtn.style.cursor = nextBtn.disabled ? 'default' : 'pointer';
  }

  return { container: card, update };
}
