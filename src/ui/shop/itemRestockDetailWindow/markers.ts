import type { AlgorithmVersionEntry } from '../../../utils/itemEventService';
import { t } from '../../../i18n';
import type { AlgorithmMarkerSlot, MarkerPositionContext, RowData } from './types';
import { fmtAbsoluteWithZone } from './format';

export function buildAlgorithmMarkerSlots(
  rows: RowData[],
  dbUpdatedAtMs: number | null,
  history: AlgorithmVersionEntry[],
): AlgorithmMarkerSlot[] {
  // Collect unique timestamps — prefer history entries, fall back to single DB value.
  const seen = new Set<number>();
  const entries: { timestampMs: number; label: string }[] = [];

  for (const h of history) {
    if (!Number.isFinite(h.updated_at_ms) || seen.has(h.updated_at_ms)) continue;
    seen.add(h.updated_at_ms);
    entries.push({
      timestampMs: h.updated_at_ms,
      label: t('feature.itemDetail.algoUpdated', { date: fmtAbsoluteWithZone(h.updated_at_ms) }),
    });
  }

  // Fall back to single DB value if history was empty / RPC unavailable.
  if (entries.length === 0 && dbUpdatedAtMs != null && Number.isFinite(dbUpdatedAtMs)) {
    entries.push({
      timestampMs: dbUpdatedAtMs,
      label: t('feature.itemDetail.algoUpdated', { date: fmtAbsoluteWithZone(dbUpdatedAtMs) }),
    });
  }

  const slots = entries.map((e) => {
    const insertIdx = (() => {
      for (let i = 0; i < rows.length; i++) {
        if (rows[i]!.timestamp <= e.timestampMs) return i;
      }
      return rows.length;
    })();
    const context: MarkerPositionContext =
      insertIdx <= 0 ? 'after-latest' : insertIdx >= rows.length ? 'before-oldest' : 'between';
    return { ...e, insertIdx, context, inserted: false };
  });

  // Collapse entries at the same insertIdx — keep only the newest per position.
  const byIdx = new Map<number, AlgorithmMarkerSlot>();
  for (const slot of slots) {
    const existing = byIdx.get(slot.insertIdx);
    if (!existing || slot.timestampMs > existing.timestampMs) {
      byIdx.set(slot.insertIdx, slot);
    }
  }
  return Array.from(byIdx.values());
}

export function makeAlgorithmUpdateMarkerEl(slot: AlgorithmMarkerSlot): HTMLElement {
  const marker = document.createElement('div');
  marker.style.cssText = [
    'display:flex',
    'align-items:center',
    'padding:6px 10px',
    'margin:4px 0 6px',
    'border-radius:6px',
    'border:1px solid rgba(143,130,255,0.25)',
    'background:rgba(143,130,255,0.08)',
    'font-size:10px',
    'letter-spacing:0.2px',
    'color:rgba(220,210,255,0.72)',
    'text-transform:uppercase',
    'white-space:nowrap',
    'overflow:hidden',
    'text-overflow:ellipsis',
  ].join(';');
  const suffix = slot.context === 'after-latest'
    ? ` ${t('feature.itemDetail.afterLatest')}`
    : slot.context === 'before-oldest'
      ? ` ${t('feature.itemDetail.beforeOldest')}`
      : '';
  marker.textContent = `${slot.label}${suffix}`;
  marker.title = t('feature.itemDetail.updatedAt', { date: new Date(slot.timestampMs).toISOString() });
  return marker;
}
