// src/ui/panel/tileStatuses.ts
// Status helpers, version tracking, and the orchestrator.

import { getAllTileDefinitions, getMultiTileProviders } from './tileRegistry';
import { registerTileStatusesBusEntry } from './tileHealth';

// Re-export shared types from canonical location
export type { GetStatusEl, AddLiveCleanup } from './tileStatusTypes';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TileStatusTone = 'normal' | 'muted' | 'positive' | 'alert';

export type RestockTileItem = {
  item_id: string;
  shop_type: string;
  estimated_next_timestamp?: number | null;
  predicted_next_ms?: number | null;
};

// ---------------------------------------------------------------------------
// Version tracking (shared with tileStatusesCore / tileStatusesNew)
// ---------------------------------------------------------------------------

let currentVersion = 0;

export function getCurrentVersion(): number {
  return currentVersion;
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

function getStatusClasses(tone: TileStatusTone, rich = false): string {
  const classes = ['qpm-tile__status'];
  if (rich) classes.push('qpm-tile__status--rich');
  if (tone !== 'normal') classes.push(`qpm-tile__status--${tone}`);
  return classes.join(' ');
}

export function setStatusText(el: HTMLElement | null, text: string, tone: TileStatusTone = 'normal'): void {
  if (!el || !el.isConnected) return;
  el.className = getStatusClasses(tone);
  el.textContent = text;
  el.title = text;
}

export function setStatusRich(
  el: HTMLElement | null,
  nodes: Node[],
  fallbackText: string,
  tone: TileStatusTone = 'normal',
): void {
  if (!el || !el.isConnected) return;
  el.className = getStatusClasses(tone, true);
  el.textContent = '';
  for (const node of nodes) {
    el.appendChild(node);
  }
  el.title = fallbackText;
}

export function makeStatusText(text: string): HTMLElement {
  const span = document.createElement('span');
  span.className = 'qpm-tile-status-text';
  span.textContent = text;
  return span;
}

export function makeStatusSprite(src: string, title: string): HTMLImageElement {
  const img = document.createElement('img');
  img.className = 'qpm-tile-status-sprite';
  img.src = src;
  img.alt = '';
  img.title = title;
  img.draggable = false;
  return img;
}

export function plural(count: number, singular: string, pluralLabel = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralLabel}`;
}

export function formatCompactNumber(value: number): string {
  const abs = Math.abs(value);
  if (!Number.isFinite(value)) return '0';
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(abs >= 10_000_000_000 ? 0 : 1)}b`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}m`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(value));
}

export function formatDurationShort(ms: number): string {
  if (!Number.isFinite(ms)) return 'n/a';
  const abs = Math.max(0, Math.abs(ms));
  const minutes = Math.round(abs / 60_000);
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours < 24) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}

export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '0%';
  return `${Math.round(value)}%`;
}

export function truncateStatusText(value: string, max = 12): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(1, max - 1))}...`;
}

export function uniqueMapValues<T>(values: Iterable<T>): T[] {
  return Array.from(new Set(values));
}

export function formatRestockMetric(trackedCount: number, trackedItems: RestockTileItem[]): string {
  if (trackedCount === 0) return '0 tracked / 0 due';
  const now = Date.now();
  const timestamps = trackedItems
    .map((item) => item.estimated_next_timestamp ?? item.predicted_next_ms ?? null)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
  const due = timestamps.filter((timestamp) => timestamp <= now).length;
  if (due > 0) return `${trackedCount} tracked / ${due} due`;
  const next = timestamps.filter((timestamp) => timestamp > now).sort((a, b) => a - b)[0] ?? null;
  if (next) return `${trackedCount} tracked / next ${formatDurationShort(next - now)}`;
  return `${trackedCount} tracked / ETA n/a`;
}

export function renderShopRestockSprites(
  el: HTMLElement | null,
  trackedKeys: string[],
  items: RestockTileItem[],
  getSpriteUrl: (item: RestockTileItem) => string | null,
  getItemName: (itemId: string, shopType: string) => string,
): void {
  if (!trackedKeys.length) {
    setStatusText(el, 'No tracked items', 'muted');
    return;
  }

  const trackedSet = new Set(trackedKeys);
  const trackedItems = items.filter((item) => trackedSet.has(`${item.shop_type}:${item.item_id}`));
  const spriteWrap = document.createElement('span');
  spriteWrap.className = 'qpm-tile-status-sprites';

  for (const item of trackedItems.slice(0, 4)) {
    const url = getSpriteUrl(item);
    if (!url) continue;
    spriteWrap.appendChild(makeStatusSprite(url, getItemName(item.item_id, item.shop_type)));
  }

  const label = formatRestockMetric(trackedKeys.length, trackedItems);
  if (spriteWrap.childElementCount > 0) {
    setStatusRich(el, [spriteWrap, makeStatusText(label)], label);
    return;
  }

  setStatusText(el, label);
}

// ---------------------------------------------------------------------------
// Orchestrator — generic loop over registry
// ---------------------------------------------------------------------------

export function startAllLiveStatuses(
  getStatusEl: (tileId: string) => HTMLElement | null,
  addLiveCleanup: (version: number, cleanup: () => void) => void,
  version: number,
): void {
  currentVersion = version;
  registerTileStatusesBusEntry();

  // Set defaults and start per-tile providers from tile definitions
  for (const def of getAllTileDefinitions()) {
    const el = getStatusEl(def.id);
    if (def.defaultStatus) {
      setStatusText(el, def.defaultStatus, 'muted');
    }
    if (def.statusProvider && el) {
      def.statusProvider(el, addLiveCleanup, version);
    }
  }

  // Multi-tile providers (e.g. startPetDerivedStatuses)
  for (const provider of getMultiTileProviders()) {
    provider(getStatusEl, addLiveCleanup, version);
  }
}
