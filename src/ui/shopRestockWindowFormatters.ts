// src/ui/shopRestockWindowFormatters.ts
// Formatting and rarity helpers for the Shop Restock window.

import {
  RARITY_COLORS,
  RARITY_GLOW,
  SHOP_CYCLE_INTERVALS,
} from './shopRestockWindowConstants';
import { t } from '../i18n';

// ---------------------------------------------------------------------------
// ETA + rate formatters
// ---------------------------------------------------------------------------

export function formatETA(ts: number | null | undefined): string {
  if (!ts) return '--';
  const diff = ts - Date.now();
  if (diff <= 0) return t('feature.shopRestock.overdue');
  const min = Math.ceil(diff / 60_000);
  if (min < 60) return `~${min}m`;
  const hr = Math.ceil(min / 60);
  if (hr < 24) return `~${hr}h`;
  return `~${Math.ceil(hr / 24)}d`;
}

export function etaColor(ts: number | null | undefined): string {
  if (!ts) return 'rgba(224,224,224,0.4)';
  const diff = ts - Date.now();
  if (diff <= 0)  return '#10b981';  // overdue
  const h = diff / 3_600_000;
  if (h < 1)  return '#22c55e';
  if (h < 6)  return '#84cc16';
  if (h < 24) return '#eab308';
  const d = diff / 86_400_000;
  if (d < 7)  return '#f97316';
  if (d < 14) return '#f87171';
  return '#ef4444';
}

export function ratePercent(rate: number | null): string {
  if (rate === null || rate === undefined) return '--';
  if (rate >= 1) return '100%';
  if (rate <= 0) return '0%';
  const pct = rate * 100;
  let formatted: string;
  if (pct > 99) {
    formatted = pct.toString().slice(0, 5);
    if (parseFloat(formatted) >= 100) formatted = '99.99';
  } else if (pct < 0.01) {
    formatted = '< 0.01';
  } else {
    const decimals = pct >= 10 ? 1 : 2;
    formatted = pct.toFixed(decimals);
  }
  if (parseFloat(formatted) >= 100) formatted = '99.9';
  if (parseFloat(formatted) === 0)  formatted = '0.01';
  return `${formatted}%`;
}

export function rateColor(rate: number | null): string {
  if (rate === null || rate === undefined) return '#f87171';
  const pct = rate * 100;
  if (pct >= 80) return '#4ade80';
  if (pct >= 40) return '#fbbf24';
  return '#f87171';
}

export function formatFrequency(rate: number | null, shopType: string): string {
  if (rate === null || rate === undefined || rate <= 0) return '';
  const interval = SHOP_CYCLE_INTERVALS[shopType];
  if (!interval) return '';
  if (rate >= 0.95) return t('feature.shopRestock.everyRestock');
  const expectedMs = interval / rate;
  const min = Math.round(expectedMs / 60_000);
  if (min < 60) return t('feature.shopRestock.everyMinutes', { m: min });
  const hr = Math.round(min / 60);
  if (hr < 24) return t('feature.shopRestock.everyHours', { h: hr });
  return t('feature.shopRestock.everyDays', { d: Math.round(hr / 24) });
}

export function formatAvgQty(qty: number | null): string {
  if (!qty || qty <= 0) return '';
  if (qty >= 10) return t('feature.shopRestock.avg', { qty: Math.round(qty) });
  if (Number.isInteger(qty)) return t('feature.shopRestock.avg', { qty });
  return t('feature.shopRestock.avg', { qty: qty.toFixed(1) });
}

export function formatPrice(value: number): string {
  if (!value || value < 1000) return `${value}`;
  const units = ['K', 'M', 'B', 'T', 'Q'];
  let v = value;
  let idx = -1;
  while (v >= 1000 && idx < units.length - 1) { v /= 1000; idx++; }
  const rounded = v >= 10 ? Math.round(v) : Math.round(v * 10) / 10;
  return `${rounded}${units[idx]}`;
}

export function formatRelative(ms: number | null): string {
  if (!ms) return '--';
  const diff = Date.now() - ms;
  if (diff < 0) return t('feature.shopRestock.justNow');
  const min = Math.floor(diff / 60_000);
  if (min < 1) return t('feature.shopRestock.justNow');
  if (min < 60) return t('feature.shopRestock.minutesAgo', { m: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t('feature.shopRestock.hoursAgo', { h: hr });
  return t('feature.shopRestock.daysAgo', { d: Math.floor(hr / 24) });
}

export function formatClock(ms: number | null): string {
  if (!ms) return '--';
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
}

export function formatWindowCountdown(ms: number): string {
  const safeMs = Math.max(0, ms);
  const totalMinutes = Math.floor(safeMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}hr ${minutes}min`;
}

export function formatRelativeDay(ms: number | null): string | null {
  if (!ms) return null;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const dayMs = 86_400_000;
  const target = new Date(ms);
  target.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((startOfToday.getTime() - target.getTime()) / dayMs);
  if (!Number.isFinite(diffDays) || diffDays <= 0) return null;
  return new Intl.RelativeTimeFormat(undefined, { numeric: 'always' }).format(-diffDays, 'day');
}

// ---------------------------------------------------------------------------
// Rarity helpers
// ---------------------------------------------------------------------------

export function rarityColor(rarity: string): string {
  return RARITY_COLORS[rarity] ?? RARITY_COLORS['common']!;
}

export function rarityBorderStyle(rarity: string): string {
  const color = rarityColor(rarity);
  const glow  = RARITY_GLOW[rarity] ?? '';
  return `border:2px solid ${color};${glow ? `box-shadow:${glow};` : ''}`;
}
