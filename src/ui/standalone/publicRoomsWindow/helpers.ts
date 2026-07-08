import type { Room, PlayerView } from '../../../types/publicRooms';
import { escapeHtml } from '../../core/panelHelpers';
import { storage } from '../../../utils/storage';
import { getState } from '../../../features/standalone/publicRooms';
import { createEmptyState } from '../../components/emptyState';

export function sanitizeImageUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value) return null;

  if (value.startsWith('data:image/')) {
    // Allow image-only data URLs for rendered sprite/avatar content.
    if (/[<>\s]/.test(value)) return null;
    return value;
  }

  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
  } catch {
    return null;
  }

  return null;
}

export function clearNode(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function setPanePlaceholder(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) {
    clearNode(el);
    el.appendChild(createEmptyState(text));
  }
}

export function setPaneContent(id: string, html: string): void {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

export function setAllPanes(text: string): void {
  setPanePlaceholder('pr-overview-content', text);
  setPanePlaceholder('pr-pets-content', text);
  setPanePlaceholder('pr-inventory-content', text);
  setPanePlaceholder('pr-activity-content', text);
}

export function formatLargeNumber(value: unknown, decimals: number = 1): string {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '—';

  const abs = Math.abs(n);
  if (abs >= 1e15) return `${(n / 1e15).toFixed(decimals)}Q`;
  if (abs >= 1e12) return `${(n / 1e12).toFixed(decimals)}T`;
  if (abs >= 1e9) return `${(n / 1e9).toFixed(decimals)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(decimals)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(decimals)}K`;
  return n.toLocaleString();
}

export function formatCoins(value: unknown): string {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '—';
  return formatLargeNumber(n, 1);
}

export function safeArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function normalizeMillis(value: unknown): number | null {
  if (value == null) return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  // Convert seconds to ms if it looks like seconds
  return num < 1e11 ? num * 1000 : num;
}

export function formatDuration(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return 'done';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${Math.max(totalSeconds, 0)}s`;
}

export function formatUpdatedAgo(iso?: string | null): string {
  if (!iso) return 'n/a';
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return 'n/a';
  const diffMs = Date.now() - ts;
  const diffMin = Math.max(0, Math.floor(diffMs / 60000));
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

export function formatRoomLabel(roomId: string): string {
  const trimmed = roomId.trim();
  if (trimmed.length <= 16) return trimmed;
  const start = trimmed.slice(0, 10);
  const end = trimmed.slice(-4);
  return `${start}…${end}`;
}

export function renderProgressBar(percent: number, label: string): string {
  const pct = Math.max(0, Math.min(100, Math.round(percent)));
  return `
    <div class="pr-progress">
      <div class="pr-progress-track">
        <div class="pr-progress-fill" style="width:${pct}%;"></div>
      </div>
      <div class="pr-progress-label">${label}</div>
    </div>
  `;
}

export function renderAvatarBlock(view: PlayerView, name: string): string {
  const safeAvatar = sanitizeImageUrl(view.avatarUrl);
  const safeAvatarUrl = safeAvatar ? `url("${safeAvatar}")` : '';
  const avatar = safeAvatarUrl
    ? `<div class="pr-avatar-block-img" style="background-image:${safeAvatarUrl}"></div>`
    : `<div class="pr-avatar-block-fallback">${escapeHtml(avatarInitials(name))}</div>`;
  return `<div class="pr-avatar-block">${avatar}<div><div class="pr-avatar-name">${escapeHtml(name)}</div><div class="pr-avatar-id">${escapeHtml(view.playerId ?? '')}</div></div></div>`;
}

export function avatarInitials(name?: string | null): string {
  if (!name) return '👤';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return '👤';
  const first = (parts[0] ?? '').charAt(0) || '';
  const last = parts.length > 1 ? (parts[parts.length - 1] ?? '').charAt(0) : '';
  const letters = `${first}${last}`.trim().toUpperCase();
  return letters || '👤';
}

export function friendlyName(raw: unknown): string {
  if (!raw) return 'Unknown';
  const str = String(raw).replace(/[_-]+/g, ' ');
  return str.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function previewData(data: unknown): string {
  try {
    const str = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    return str.length > 320 ? `${str.slice(0, 320)}…` : str;
  } catch {
    return 'Data available';
  }
}

export function showToast(message: string, level: 'info' | 'success' | 'error' = 'info'): void {
  console.log(`[PublicRooms:${level}]`, message);
}

export function roomOriginLabel(roomId: string): 'Discord' | 'Web' {
  const trimmed = roomId.trim();
  return trimmed.startsWith('I-') ? 'Discord' : 'Web';
}

export function inferSelfPlayerId(): string | null {
  const state = getState?.();
  const maybeSelf = (state as any)?.selfPlayerId || storage.get<string>('quinoa:selfPlayerId', '');
  if (maybeSelf) return maybeSelf as string;
  try {
    const rooms = (state?.allRooms || {}) as Record<string, Room>;
    for (const room of Object.values(rooms)) {
      const hit = room.userSlots?.find(u => u.playerId && u.name && u.name.toLowerCase().includes('you'));
      if (hit?.playerId) return hit.playerId;
    }
  } catch { /* ignore */ }
  return null;
}
