// src/ui/shopRestockWindowRows.ts
// Prediction and history row builders for the Shop Restock window.
// Row builders receive callbacks instead of closing over render state.

import { openItemRestockDetail } from './itemRestockDetailWindow';
import { getItemName, getItemRarity, getItemPrice, getItemMeta, getSpriteUrl, getCoinSpriteUrl } from './shopRestockWindowMeta';
import {
  rarityColor,
  rarityBorderStyle,
  formatETA,
  etaColor,
  ratePercent,
  rateColor,
  formatFrequency,
  formatAvgQty,
  formatPrice,
  formatRelative,
  formatClock,
  formatRelativeDay,
} from './shopRestockWindowFormatters';
import { getItemProbability } from '../utils/restockDataService';
import { isCelestial } from './shopRestockWindowMeta';
import { t } from '../i18n';
import { getSoundConfig } from './shopRestockAlerts/soundConfig';
import { showSoundPopover } from './shopRestockAlerts/soundPopover';
import { getRequiredWeather } from './shopRestockWindowConstants';
import { getWeatherSnapshot, onWeatherSnapshot } from '../store/weatherHub';
import type { RestockItem } from '../utils/restockDataService';

export type EtaRef = { el: HTMLElement; ts: number };

// ---------------------------------------------------------------------------
// Weather availability badge
// ---------------------------------------------------------------------------

export function makeWeatherBadge(itemId: string): { el: HTMLElement; cleanup: () => void } | null {
  const required = getRequiredWeather(itemId);
  if (!required) return null;

  const badge = document.createElement('span');
  badge.style.cssText = 'font-size:9px;padding:1px 6px;border-radius:8px;white-space:nowrap;font-weight:600;letter-spacing:0.3px;';

  const update = (snapshot: { kind: string }): void => {
    const active = snapshot.kind === required;
    badge.textContent = active ? t('feature.shopRestock.weatherActive', { weather: required }) : t('feature.shopRestock.weatherOnly', { weather: required });
    badge.style.color = active ? '#4ade80' : 'rgba(232,224,255,0.4)';
    badge.style.background = active ? 'rgba(74,222,128,0.12)' : 'rgba(143,130,255,0.06)';
    badge.style.border = `1px solid ${active ? 'rgba(74,222,128,0.3)' : 'rgba(143,130,255,0.15)'}`;
  };

  update(getWeatherSnapshot());
  const unsub = onWeatherSnapshot(update, false);
  return { el: badge, cleanup: unsub };
}

// ---------------------------------------------------------------------------
// Icon wrap element (shared between pred + hist rows)
// ---------------------------------------------------------------------------

export function makeIconWrap(item: RestockItem, size = 42): HTMLElement {
  const rarity  = getItemRarity(item.item_id, item.shop_type);
  const wrap    = document.createElement('div');
  const spriteSize = Math.round(size * 0.76);
  wrap.style.cssText = [
    `width:${size}px`, `height:${size}px`, 'border-radius:10px',
    'background:rgba(229,231,235,0.05)',
    rarityBorderStyle(rarity),
    'display:flex', 'align-items:center', 'justify-content:center',
    'flex-shrink:0', 'transition:border-color 0.2s',
  ].join(';');

  const url = getSpriteUrl(item);
  if (url) {
    const img = document.createElement('img');
    img.src = url;
    img.style.cssText = `width:${spriteSize}px;height:${spriteSize}px;image-rendering:pixelated;object-fit:contain;`;
    wrap.appendChild(img);
  }
  return wrap;
}

// ---------------------------------------------------------------------------
// Prediction row
// ---------------------------------------------------------------------------

export function buildPredRow(
  item: RestockItem,
  key: string,
  opts: {
    onUnpin(key: string): void;
    openDetail(item: RestockItem, name: string): void;
  },
): { row: HTMLElement; etaRef: EtaRef; cleanups: Array<() => void> } {
  const ts       = item.estimated_next_timestamp ?? 0;
  const hasData  = (item.total_occurrences ?? 0) >= 2 && ts > 0;
  const rate     = getItemProbability(item);
  const rarity   = getItemRarity(item.item_id, item.shop_type);
  const cel      = isCelestial(item.item_id);
  const rowCleanups: Array<() => void> = [];

  const row = document.createElement('div');
  row.style.cssText = [
    'display:flex', 'align-items:center', 'justify-content:space-between', 'gap:12px',
    'padding:10px 12px', 'min-height:52px',
    `border:1px solid ${cel ? 'rgba(255,215,0,0.22)' : 'transparent'}`,
    `background:${cel ? 'rgba(255,215,0,0.04)' : 'color-mix(in srgb, rgba(30,30,40,0.5) 50%, transparent)'}`,
    'border-radius:10px', 'cursor:pointer',
    'transition:transform 0.15s, background 0.15s',
  ].join(';');
  row.title = t('feature.shopRestock.clickToUnpin');
  row.addEventListener('mouseenter', () => {
    row.style.transform  = 'scale(1.01)';
    row.style.background = cel ? 'rgba(255,215,0,0.09)' : 'rgba(255,255,255,0.06)';
  });
  row.addEventListener('mouseleave', () => {
    row.style.transform  = '';
    row.style.background = cel ? 'rgba(255,215,0,0.04)' : '';
  });

  // Left: icon-wrap + text
  const left = document.createElement('div');
  left.style.cssText = 'display:flex;align-items:center;gap:12px;min-width:0;flex:1;max-width:calc(100% - 220px);';
  left.appendChild(makeIconWrap(item, 42));

  const textBlock = document.createElement('div');
  textBlock.style.cssText = 'display:flex;flex-direction:column;gap:3px;min-width:0;';

  const nameLine = document.createElement('div');
  nameLine.style.cssText = 'display:flex;align-items:center;gap:6px;min-width:0;';
  const nameEl = document.createElement('div');
  nameEl.style.cssText = `font-size:14px;font-weight:700;color:${rarityColor(rarity)};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
  nameEl.textContent = getItemName(item.item_id, item.shop_type);
  nameLine.appendChild(nameEl);

  const weatherBadge = makeWeatherBadge(item.item_id);
  if (weatherBadge) {
    nameLine.appendChild(weatherBadge.el);
    rowCleanups.push(weatherBadge.cleanup);
  }
  textBlock.appendChild(nameLine);

  const subEl = document.createElement('div');
  subEl.style.cssText = 'font-size:12px;opacity:0.7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
  if (!hasData) {
    const seen = item.total_occurrences ?? 0;
    subEl.textContent = seen > 0
      ? (seen === 1 ? t('feature.shopRestock.sightingRecorded', { count: seen }) : t('feature.shopRestock.sightingsRecorded', { count: seen }))
      : t('feature.shopRestock.notEnoughData');
  } else {
    subEl.textContent = item.last_seen ? t('feature.shopRestock.seenRelative', { time: formatRelative(item.last_seen) }) : t('feature.shopRestock.tracked');
  }
  textBlock.appendChild(subEl);
  left.appendChild(textBlock);
  row.appendChild(left);

  // Right: metrics
  const metrics = document.createElement('div');
  metrics.style.cssText = 'display:flex;gap:18px;align-items:center;flex-shrink:0;';

  const detailBtn = document.createElement('button');
  detailBtn.type = 'button';
  detailBtn.textContent = '\uD83D\uDCCA';
  detailBtn.title = t('feature.shopRestock.viewHistory');
  detailBtn.style.cssText = [
    'background:none', 'border:none', 'cursor:pointer',
    'font-size:14px', 'padding:2px 4px', 'opacity:0.72',
    'border-radius:4px', 'line-height:1', 'flex-shrink:0',
  ].join(';');
  detailBtn.addEventListener('mouseenter', () => { detailBtn.style.opacity = '1'; });
  detailBtn.addEventListener('mouseleave', () => { detailBtn.style.opacity = '0.72'; });
  detailBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    opts.openDetail(item, getItemName(item.item_id, item.shop_type));
  });
  metrics.appendChild(detailBtn);

  // Sound config button
  const hasSoundCfg = getSoundConfig(key) !== null;
  const soundBtn = document.createElement('button');
  soundBtn.type = 'button';
  soundBtn.textContent = hasSoundCfg ? '\uD83D\uDD14' : '\uD83D\uDD15'; // 🔔 / 🔕
  soundBtn.title = hasSoundCfg ? t('feature.shopRestock.soundConfigured') : t('feature.shopRestock.soundConfigure');
  soundBtn.style.cssText = [
    'background:none', 'border:none', 'cursor:pointer',
    'font-size:14px', 'padding:2px 4px',
    `opacity:${hasSoundCfg ? '0.9' : '0.45'}`,
    'border-radius:4px', 'line-height:1', 'flex-shrink:0',
  ].join(';');
  soundBtn.addEventListener('mouseenter', () => { soundBtn.style.opacity = '1'; });
  soundBtn.addEventListener('mouseleave', () => { soundBtn.style.opacity = hasSoundCfg ? '0.9' : '0.45'; });
  soundBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    showSoundPopover(soundBtn, key, () => {
      // Update icon after save/clear
      const nowHasCfg = getSoundConfig(key) !== null;
      soundBtn.textContent = nowHasCfg ? '\uD83D\uDD14' : '\uD83D\uDD15';
      soundBtn.style.opacity = nowHasCfg ? '0.9' : '0.45';
    });
  });
  metrics.appendChild(soundBtn);

  if (!hasData) {
    const dash = document.createElement('div');
    dash.style.cssText = 'font-size:20px;color:#f87171;';
    dash.textContent = '--';
    metrics.appendChild(dash);
    row.addEventListener('click', () => { opts.onUnpin(key); });
    row.appendChild(metrics);
    return { row, etaRef: { el: document.createElement('span'), ts: 0 }, cleanups: rowCleanups };
  }

  // Dormant items: seasonal/removed — suppress ETA and rate.
  if (item.is_dormant === true) {
    row.style.background = cel ? 'rgba(255,215,0,0.04)' : 'rgba(255,165,0,0.04)';

    const dormantEtaWrap = document.createElement('div');
    dormantEtaWrap.style.cssText = 'display:flex;flex-direction:column;align-items:flex-end;min-width:68px;width:68px;';
    const dormantLabel = document.createElement('div');
    dormantLabel.style.cssText = 'font-size:14px;font-weight:700;color:rgba(255,165,0,0.6);white-space:nowrap;line-height:1.15;';
    dormantLabel.textContent = t('feature.shopRestock.seasonal');
    const dormantSub = document.createElement('div');
    dormantSub.style.cssText = 'font-size:10px;opacity:0.5;text-transform:uppercase;letter-spacing:0.5px;';
    dormantSub.textContent = t('feature.shopRestock.next');
    dormantEtaWrap.append(dormantLabel, dormantSub);
    metrics.appendChild(dormantEtaWrap);

    const dormantRateWrap = document.createElement('div');
    dormantRateWrap.style.cssText = 'display:flex;flex-direction:column;align-items:flex-end;min-width:70px;width:70px;';
    const dormantDash = document.createElement('div');
    dormantDash.style.cssText = 'font-size:19px;font-weight:700;color:rgba(232,224,255,0.3);font-variant-numeric:tabular-nums;line-height:1.15;';
    dormantDash.textContent = '\u2014';
    const dormantRateLbl = document.createElement('div');
    dormantRateLbl.style.cssText = 'font-size:10px;opacity:0.5;text-transform:uppercase;letter-spacing:0.5px;';
    dormantRateLbl.textContent = t('feature.shopRestock.rate');
    dormantRateWrap.append(dormantDash, dormantRateLbl);
    metrics.appendChild(dormantRateWrap);

    row.appendChild(metrics);
    row.addEventListener('click', () => { opts.onUnpin(key); });
    return { row, etaRef: { el: document.createElement('span'), ts: 0 }, cleanups: rowCleanups };
  }

  const etaLabel = formatETA(ts);
  const etaCol   = etaColor(ts);

  const etaWrap = document.createElement('div');
  etaWrap.style.cssText = 'display:flex;flex-direction:column;align-items:flex-end;min-width:68px;width:68px;position:relative;';
  const etaEl = document.createElement('div');
  etaEl.style.cssText = `font-size:19px;font-weight:700;color:${etaCol};font-variant-numeric:tabular-nums;letter-spacing:-0.3px;line-height:1.15;white-space:nowrap;`;
  etaEl.textContent = etaLabel;
  const etaLbl = document.createElement('div');
  etaLbl.style.cssText = 'font-size:10px;opacity:0.5;text-transform:uppercase;letter-spacing:0.5px;';
  etaLbl.textContent = t('feature.shopRestock.next');
  etaWrap.append(etaEl, etaLbl);
  metrics.appendChild(etaWrap);

  const freqLine  = formatFrequency(rate, item.shop_type);
  const avgLine   = formatAvgQty(item.average_quantity);
  const tooltipTx = [avgLine, freqLine].filter(Boolean).join('\n');

  const rateWrap = document.createElement('div');
  rateWrap.className = 'qpm-sr-metric';
  rateWrap.style.cssText = 'display:flex;flex-direction:column;align-items:flex-end;min-width:70px;width:70px;position:relative;cursor:help;';
  if (tooltipTx) rateWrap.dataset.tooltip = tooltipTx;
  const rateEl = document.createElement('div');
  rateEl.style.cssText = `font-size:19px;font-weight:700;color:${rateColor(rate)};font-variant-numeric:tabular-nums;letter-spacing:-0.3px;line-height:1.15;white-space:nowrap;`;
  rateEl.textContent = ratePercent(rate);
  const rateLbl = document.createElement('div');
  rateLbl.style.cssText = 'font-size:10px;opacity:0.5;text-transform:uppercase;letter-spacing:0.5px;';
  rateLbl.textContent = t('feature.shopRestock.rate');
  rateWrap.append(rateEl, rateLbl);
  metrics.appendChild(rateWrap);

  row.appendChild(metrics);
  row.addEventListener('click', () => { opts.onUnpin(key); });
  return { row, etaRef: { el: etaEl, ts }, cleanups: rowCleanups };
}

// ---------------------------------------------------------------------------
// History table row
// ---------------------------------------------------------------------------

export function buildHistRow(
  item: RestockItem,
  key: string,
  opts: {
    onPin(key: string): void;
    openDetail(item: RestockItem, name: string): void;
  },
): { row: HTMLElement; cleanups: Array<() => void> } {
  const rarity = getItemRarity(item.item_id, item.shop_type);
  const price  = getItemPrice(item.item_id, item.shop_type);
  const cel    = isCelestial(item.item_id);
  const histCleanups: Array<() => void> = [];

  const tr = document.createElement('tr');
  tr.className = 'qpm-sr-tr';
  tr.title = t('feature.shopRestock.clickToPinPredictions');
  if (cel) tr.style.background = 'rgba(255,215,0,0.025)';

  // Item cell: icon-wrap (42px) + name (rarity color) + price
  const itemTd = document.createElement('td');
  itemTd.style.cssText = 'padding:8px 12px;';
  const itemCell = document.createElement('div');
  itemCell.style.cssText = 'display:flex;align-items:center;gap:12px;padding:4px 0;';
  itemCell.appendChild(makeIconWrap(item, 42));

  const itemInfo = document.createElement('div');
  itemInfo.style.cssText = 'display:flex;flex-direction:column;justify-content:center;gap:3px;min-width:0;';
  const histNameLine = document.createElement('div');
  histNameLine.style.cssText = 'display:flex;align-items:center;gap:6px;min-width:0;';
  const nameEl = document.createElement('div');
  nameEl.style.cssText = `font-weight:700;font-size:14px;color:${rarityColor(rarity)};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.2;`;
  nameEl.textContent = getItemName(item.item_id, item.shop_type);
  histNameLine.appendChild(nameEl);

  const histWeatherBadge = makeWeatherBadge(item.item_id);
  if (histWeatherBadge) {
    histNameLine.appendChild(histWeatherBadge.el);
    histCleanups.push(histWeatherBadge.cleanup);
  }
  itemInfo.appendChild(histNameLine);

  const dustPrice = getItemMeta(item.item_id, item.shop_type)?.priceMagicDust ?? 0;
  if (price > 0 || dustPrice > 0) {
    const priceRow = document.createElement('div');
    priceRow.style.cssText = 'font-size:12px;opacity:0.9;display:flex;align-items:center;gap:6px;line-height:1;';
    if (price > 0) {
      const coinWrap = document.createElement('span');
      coinWrap.style.cssText = 'display:flex;align-items:center;gap:3px;';
      const coinSrc = getCoinSpriteUrl();
      const coinSpan = coinSrc ? document.createElement('img') : document.createElement('span');
      if (coinSrc && coinSpan instanceof HTMLImageElement) {
        coinSpan.src = coinSrc;
        coinSpan.alt = 'Coin';
        coinSpan.style.cssText = 'width:11px;height:11px;object-fit:contain;image-rendering:auto;opacity:0.95;';
      } else {
        coinSpan.style.cssText = 'color:#FFC734;font-weight:700;font-size:11px;';
        coinSpan.textContent = 'C';
      }
      const priceSpan = document.createElement('span');
      priceSpan.style.cssText = 'color:#FFC734;font-weight:700;';
      priceSpan.textContent = formatPrice(price);
      coinWrap.append(coinSpan, priceSpan);
      priceRow.appendChild(coinWrap);
    }
    if (dustPrice > 0) {
      const dustWrap = document.createElement('span');
      dustWrap.style.cssText = 'display:flex;align-items:center;gap:2px;';
      const dustIcon = document.createElement('span');
      dustIcon.style.cssText = 'font-size:10px;';
      dustIcon.textContent = '\u2728'; // ✨
      const dustSpan = document.createElement('span');
      dustSpan.style.cssText = 'color:#CE93D8;font-weight:700;';
      dustSpan.textContent = formatPrice(dustPrice);
      dustWrap.append(dustIcon, dustSpan);
      priceRow.appendChild(dustWrap);
    }
    itemInfo.appendChild(priceRow);
  }
  itemCell.appendChild(itemInfo);
  itemTd.appendChild(itemCell);

  // Qty cell
  const qtyTd = document.createElement('td');
  qtyTd.style.cssText = 'padding:8px 12px;text-align:center;font-variant-numeric:tabular-nums;font-weight:600;opacity:0.9;';
  qtyTd.textContent = formatPrice(item.total_quantity ?? 0);

  // Last seen cell
  const lastTd = document.createElement('td');
  lastTd.title = item.last_seen ? new Date(item.last_seen).toLocaleString() : '--';
  const timeCell = document.createElement('div');
  timeCell.style.cssText = 'display:flex;flex-direction:column;align-items:flex-end;font-variant-numeric:tabular-nums;font-weight:600;opacity:0.9;line-height:1.1;white-space:nowrap;padding:8px 12px;';
  const clockEl = document.createElement('div');
  clockEl.textContent = formatClock(item.last_seen);
  const relDay = formatRelativeDay(item.last_seen);
  timeCell.appendChild(clockEl);
  if (relDay) {
    const relEl = document.createElement('div');
    relEl.style.cssText = 'opacity:0.7;font-size:11px;';
    relEl.textContent = relDay;
    timeCell.appendChild(relEl);
  }
  lastTd.appendChild(timeCell);

  const detailTd = document.createElement('td');
  detailTd.style.cssText = 'padding:8px 6px;text-align:center;';
  const detailBtn = document.createElement('button');
  detailBtn.textContent = '\uD83D\uDCCA';
  detailBtn.title = t('feature.shopRestock.viewHistory');
  detailBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:14px;padding:2px 4px;opacity:0.6;border-radius:4px;line-height:1;';
  detailBtn.addEventListener('mouseenter', () => { detailBtn.style.opacity = '1'; });
  detailBtn.addEventListener('mouseleave', () => { detailBtn.style.opacity = '0.6'; });
  detailBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    opts.openDetail(item, getItemName(item.item_id, item.shop_type));
  });
  detailTd.appendChild(detailBtn);

  tr.append(itemTd, qtyTd, lastTd, detailTd);
  tr.addEventListener('click', () => { opts.onPin(key); });

  return { row: tr, cleanups: histCleanups };
}

// ---------------------------------------------------------------------------
// Hot row (compact prediction row for "Hot Right Now")
// ---------------------------------------------------------------------------

export function buildHotRow(
  item: RestockItem,
  score: number,
  opts: {
    onPin(key: string): void;
    openDetail(item: RestockItem, name: string): void;
  },
): { row: HTMLElement; etaRef: EtaRef; cleanups: Array<() => void> } {
  const ts       = item.estimated_next_timestamp ?? 0;
  const rate     = getItemProbability(item);
  const rarity   = getItemRarity(item.item_id, item.shop_type);
  const key      = `${item.shop_type}:${item.item_id}`;
  const hotCleanups: Array<() => void> = [];

  const row = document.createElement('div');
  row.style.cssText = [
    'display:flex', 'align-items:center', 'gap:10px',
    'padding:6px 10px', 'min-height:40px',
    'background:rgba(255,165,0,0.03)',
    'border:1px solid rgba(255,165,0,0.10)',
    'border-radius:8px', 'cursor:pointer',
    'transition:transform 0.12s, background 0.12s',
  ].join(';');
  row.title = t('feature.shopRestock.clickToPin');
  row.addEventListener('mouseenter', () => {
    row.style.transform  = 'scale(1.01)';
    row.style.background = 'rgba(255,165,0,0.07)';
  });
  row.addEventListener('mouseleave', () => {
    row.style.transform  = '';
    row.style.background = 'rgba(255,165,0,0.03)';
  });

  // Icon (36px)
  row.appendChild(makeIconWrap(item, 36));

  // Name + rate inline
  const textBlock = document.createElement('div');
  textBlock.style.cssText = 'display:flex;align-items:center;gap:8px;flex:1;min-width:0;';

  const hotNameEl = document.createElement('div');
  hotNameEl.style.cssText = `font-size:13px;font-weight:700;color:${rarityColor(rarity)};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
  hotNameEl.textContent = getItemName(item.item_id, item.shop_type);
  textBlock.appendChild(hotNameEl);

  const hotWeatherBadge = makeWeatherBadge(item.item_id);
  if (hotWeatherBadge) {
    textBlock.appendChild(hotWeatherBadge.el);
    hotCleanups.push(hotWeatherBadge.cleanup);
  }

  if (rate != null) {
    const ratePill = document.createElement('span');
    ratePill.style.cssText = `font-size:10px;padding:1px 5px;border-radius:6px;font-weight:700;color:${rateColor(rate)};background:rgba(143,130,255,0.08);white-space:nowrap;flex-shrink:0;`;
    ratePill.textContent = ratePercent(rate);
    textBlock.appendChild(ratePill);
  }
  row.appendChild(textBlock);

  // ETA
  const etaEl = document.createElement('div');
  etaEl.style.cssText = `font-size:15px;font-weight:700;color:${etaColor(ts)};font-variant-numeric:tabular-nums;white-space:nowrap;flex-shrink:0;min-width:54px;text-align:right;`;
  etaEl.textContent = ts > 0 ? formatETA(ts) : '--';
  row.appendChild(etaEl);

  // Detail button
  const detailBtn = document.createElement('button');
  detailBtn.type = 'button';
  detailBtn.textContent = '\uD83D\uDCCA';
  detailBtn.title = t('feature.shopRestock.viewHistory');
  detailBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:13px;padding:2px 3px;opacity:0.6;border-radius:4px;line-height:1;flex-shrink:0;';
  detailBtn.addEventListener('mouseenter', () => { detailBtn.style.opacity = '1'; });
  detailBtn.addEventListener('mouseleave', () => { detailBtn.style.opacity = '0.6'; });
  detailBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    opts.openDetail(item, getItemName(item.item_id, item.shop_type));
  });
  row.appendChild(detailBtn);

  row.addEventListener('click', () => { opts.onPin(key); });

  return { row, etaRef: { el: etaEl, ts }, cleanups: hotCleanups };
}
