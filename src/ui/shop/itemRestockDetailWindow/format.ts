import { t } from '../../../i18n';

export function fmtTimestamp(ts: number): string {
  const d    = new Date(ts);
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
  return `${date}  ${time}`;
}

export function fmtAbsoluteWithZone(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  });
}

export function fmtDuration(ms: number): string {
  const abs = Math.abs(ms);
  const d   = Math.floor(abs / 86_400_000);
  const h   = Math.floor((abs % 86_400_000) / 3_600_000);
  const m   = Math.floor((abs % 3_600_000)  / 60_000);
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (!d && !h) parts.push(`${m}m`);
  else if (m && !d) parts.push(`${m}m`);
  return parts.join(' ') || '0m';
}

export function fmtRelative(ts: number | null): string {
  if (!ts) return t('feature.itemDetail.neverSeen');
  const diff = Date.now() - ts;
  if (diff < 60_000) return t('feature.shopRestock.justNow');
  if (diff < 3_600_000) return t('feature.shopRestock.minutesAgo', { m: Math.floor(diff / 60_000) });
  if (diff < 86_400_000) return t('feature.shopRestock.hoursAgo', { h: Math.floor(diff / 3_600_000) });
  return t('feature.shopRestock.daysAgo', { d: Math.floor(diff / 86_400_000) });
}

export function fmtPercent(rate: number | null): string {
  if (rate == null) return '—';
  const pct = rate * 100;
  if (!Number.isFinite(pct)) return '—';
  const formatted = pct.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
  return `${formatted}%`;
}

export function fmtCountdown(ts: number | null): string {
  if (!ts) return '—';
  const diff = ts - Date.now();
  if (diff <= 0) return t('feature.shopRestock.overdue');
  return `~${fmtDuration(diff)}`;
}

export function normalizeEpochMs(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  // Guard mixed epoch units from backend/rpc: convert unix-seconds to ms.
  if (value < 1_000_000_000_000) return Math.round(value * 1000);
  return Math.round(value);
}

export function sortEventsNewestFirst<T extends { timestamp: number }>(events: readonly T[]): T[] {
  return events
    .filter((event) => Number.isFinite(event.timestamp) && event.timestamp > 0)
    .slice()
    .sort((a, b) => b.timestamp - a.timestamp);
}
