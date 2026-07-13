import {
  computeEventAccuracy as computeEventAccuracyNew,
  type EventAccuracy,
  type EventStatus,
} from '../../../utils/restock/accuracy';
import { t } from '../../../i18n';
import type { RowData } from './types';

export function shopLabel(shopType: string): string {
  const keys: Record<string, string> = {
    seed: 'feature.shopRestock.filterSeeds',
    egg: 'feature.shopRestock.filterEggs',
    decor: 'feature.shopRestock.filterDecor',
    tool: 'feature.shopRestock.filterTools',
    weather: 'feature.shopRestock.filterWeather',
    dawn: 'feature.shopRestock.filterDawn',
  };
  return t(keys[shopType] ?? '', undefined, shopType);
}

/** Thin wrapper: compute accuracy for a RowData using the new module. */
export function computeRowEventAccuracy(
  row: RowData,
  prevRow: RowData | null,
  medianMs: number | null,
  intervals?: number[] | null,
): EventAccuracy {
  return computeEventAccuracyNew(row, prevRow, medianMs, intervals);
}

export function getStatusConfig(): Record<EventStatus, { icon: string; label: string; color: string; bg: string }> {
  return {
    accurate: { icon: '✓', label: t('feature.itemDetail.statusAccurate'), color: '#4ade80', bg: 'rgba(74,222,128,0.10)' },
    early:    { icon: '⇗', label: t('feature.itemDetail.statusEarly'),    color: '#60a5fa', bg: 'rgba(96,165,250,0.10)' },
    late:     { icon: '⏱', label: t('feature.itemDetail.statusLate'),     color: '#fbbf24', bg: 'rgba(251,191,36,0.10)' },
    first:    { icon: '—', label: t('feature.itemDetail.statusFirstEvent'), color: 'rgba(232,224,255,0.5)', bg: 'rgba(143,130,255,0.06)' },
  };
}

export function makeCardHeader(
  itemName: string,
  shopType: string,
  spriteUrl: string | null,
): { header: HTMLElement; statusIcon: HTMLElement } {
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;gap:10px;padding:14px 16px 10px;';

  if (spriteUrl) {
    const img = document.createElement('img');
    img.src = spriteUrl;
    img.style.cssText = 'width:36px;height:36px;object-fit:contain;image-rendering:pixelated;border-radius:6px;';
    header.appendChild(img);
  }

  const headerText = document.createElement('div');
  headerText.style.cssText = 'flex:1;min-width:0;';

  const nameEl = document.createElement('div');
  nameEl.style.cssText = 'font-size:15px;font-weight:700;color:#e8e0ff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
  nameEl.textContent = itemName;
  headerText.appendChild(nameEl);

  const catBadge = document.createElement('span');
  catBadge.style.cssText = [
    'display:inline-block', 'margin-top:3px',
    'font-size:10px', 'font-weight:600',
    'padding:1px 8px', 'border-radius:10px',
    'color:#a78bfa',
    'background:rgba(143,130,255,0.12)',
    'border:1px solid rgba(143,130,255,0.2)',
    'text-transform:uppercase', 'letter-spacing:0.4px',
  ].join(';');
  catBadge.textContent = shopLabel(shopType);
  headerText.appendChild(catBadge);
  header.appendChild(headerText);

  const statusIcon = document.createElement('div');
  statusIcon.style.cssText = 'font-size:20px;flex-shrink:0;';
  header.appendChild(statusIcon);

  return { header, statusIcon };
}
