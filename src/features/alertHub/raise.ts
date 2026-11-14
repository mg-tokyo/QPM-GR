import { notify, type NotificationAction, type NotificationLevel } from '../../core/notifications';
import { getCustomSounds } from '../../ui/shop/restockAlerts/soundConfig';
import { isBuiltinSound, playCustomSound, playSound } from '../../ui/shop/restockAlerts/soundEngine';
import { deliverDesktopAlert } from './desktop';
import { getAlertRow } from './registry';
import { getAlertRowSettings } from './settings';

export interface AlertPayload {
  title: string;
  body?: string;
  actions?: NotificationAction[];
  /** An open card raised with the same key is updated in place instead of stacking a new one. */
  cardKey?: string;
  level?: NotificationLevel;
  /** Sprite data URL shown beside the title (card only, never History). */
  iconUrl?: string;
  /** Bar under the body; `color` is a CSS value, normally a `--qpm-*` token. */
  meter?: AlertMeter;
}

export interface AlertMeter {
  pct: number;
  color: string;
}

export interface AlertCardHandle {
  update(body: string, meter?: AlertMeter): void;
  close(): void;
}

export type AlertPresenter = (card: AlertPayload & { rowId: string; onClose: () => void }) => AlertCardHandle | null;

const NO_SOUND = 'none';

let presenter: AlertPresenter | null = null;
const openCards = new Map<string, AlertCardHandle>();
const counts = { raised: 0, rowOff: 0, unknownRow: 0 };

export function setAlertPresenter(p: AlertPresenter | null): void {
  presenter = p;
}

function playRowSound(soundId: string): void {
  if (soundId === NO_SOUND) return;
  if (isBuiltinSound(soundId)) { void playSound(soundId); return; }
  const custom = getCustomSounds()[soundId];
  if (custom) void playCustomSound(custom.dataUrl);
}

function historyText(p: AlertPayload): string {
  return p.body ? `${p.title} — ${p.body}` : p.title;
}

export interface RaiseOptions {
  /** false when the event already sits in History (the notify bridge). */
  history?: boolean;
}

/** Null when the row is unknown or switched off: nothing reaches History, the speaker or the screen. */
export function raiseAlert(rowId: string, payload: AlertPayload, opts: RaiseOptions = {}): AlertCardHandle | null {
  const def = getAlertRow(rowId);
  if (!def) { counts.unknownRow += 1; return null; }
  const row = getAlertRowSettings(rowId, def.defaultSound, def.defaultEnabled);
  if (!row.enabled) { counts.rowOff += 1; return null; }
  counts.raised += 1;

  if (opts.history !== false) notify({ feature: rowId, level: payload.level ?? 'info', message: historyText(payload), ...(payload.actions ? { actions: payload.actions } : {}) });
  playRowSound(row.soundId);
  deliverDesktopAlert(rowId, { title: payload.title, ...(payload.body ? { body: payload.body } : {}), tag: payload.cardKey ?? rowId });

  const key = payload.cardKey;
  const open = key !== undefined ? openCards.get(key) : undefined;
  if (open) {
    open.update(payload.body ?? '', payload.meter);
    return open;
  }
  if (!presenter) return null;
  let card: AlertCardHandle | null = null;
  try {
    card = presenter({ ...payload, rowId, onClose: () => { if (key !== undefined && openCards.get(key) === card) openCards.delete(key); } });
  } catch {
    card = null;
  }
  if (card && key !== undefined) openCards.set(key, card);
  return card;
}

export function closeAllAlertCards(): void {
  const cards = [...openCards.values()];
  openCards.clear();
  for (const c of cards) {
    try { c.close(); } catch { /* ignore */ }
  }
}

export function getRaiseStats(): { raised: number; rowOff: number; unknownRow: number; openCards: number; presenter: boolean } {
  return { ...counts, openCards: openCards.size, presenter: presenter !== null };
}
