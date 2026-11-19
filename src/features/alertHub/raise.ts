import { notify, type NotificationAction, type NotificationLevel } from '../../core/notifications';
import { getCustomSounds } from '../../ui/shop/restockAlerts/soundConfig';
import { isBuiltinSound, isLooping, playCustomSound, playSound, startLoop, stopLoop } from '../../ui/shop/restockAlerts/soundEngine';
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
  /** The entity's colour (catalog value or `--qpm-*` token, never a literal). */
  accent?: string;
  /** Extra sprites beside the icon; capped at MAX_SPRITES. */
  sprites?: AlertSprite[];
  /** Capped at MAX_CHIPS. */
  chips?: AlertChip[];
  figure?: AlertFigure;
}

export interface AlertMeter {
  pct: number;
  color: string;
}

export interface AlertSprite {
  url: string;
  count?: number;
}

export interface AlertChip {
  text: string;
  color?: string;
  iconUrl?: string;
}

/** A big value over a caps label, or a countdown (epoch ms) the card ticks itself. */
export type AlertFigure = { value: string; label: string } | { countdownTo: number; label: string };

/** Fields an open card changes in place; absent fields stay as they are. */
export interface AlertCardPatch {
  body?: string;
  meter?: AlertMeter;
  chips?: AlertChip[];
  figure?: AlertFigure;
}

export interface AlertCardHandle {
  update(patch: AlertCardPatch): void;
  close(): void;
}

export const MAX_SPRITES = 4;
export const MAX_CHIPS = 3;

export type AlertPresenter = (card: AlertPayload & { rowId: string; onClose: () => void }) => AlertCardHandle | null;

const NO_SOUND = 'none';

let presenter: AlertPresenter | null = null;
const openCards = new Map<string, AlertCardHandle>();
const loopingKeys = new Set<string>();
const counts = { raised: 0, rowOff: 0, unknownRow: 0 };

const loopId = (cardKey: string): string => `alert:${cardKey}`;

// startLoop is behind the master gate (sounds off → no loop) and stopAllLoops can end a loop
// behind this module's back, so the engine's isLooping is the truth, not loopingKeys.
function startCardLoop(cardKey: string, soundId: string, intervalMs: number | undefined): void {
  const id = loopId(cardKey);
  if (soundId === NO_SOUND || isLooping(id)) return;
  if (isBuiltinSound(soundId)) {
    startLoop(id, soundId, undefined, false, undefined, intervalMs);
  } else {
    const custom = getCustomSounds()[soundId];
    if (!custom) return;
    startLoop(id, soundId, undefined, true, custom.dataUrl, intervalMs);
  }
  if (isLooping(id)) loopingKeys.add(cardKey);
}

function stopCardLoop(cardKey: string): void {
  if (!loopingKeys.delete(cardKey)) return;
  stopLoop(loopId(cardKey));
}

function countCardLoops(): number {
  let n = 0;
  for (const k of loopingKeys) if (isLooping(loopId(k))) n += 1;
  return n;
}

export function setAlertPresenter(p: AlertPresenter | null): void {
  presenter = p;
}

function playRowSound(soundId: string): void {
  if (soundId === NO_SOUND) return;
  if (isBuiltinSound(soundId)) { void playSound(soundId); return; }
  const custom = getCustomSounds()[soundId];
  if (custom) void playCustomSound(custom.dataUrl);
}

/** The row's chosen sound once, for cards a feature shows itself (journal seed restock cards). */
export function playAlertRowSound(rowId: string): void {
  const def = getAlertRow(rowId);
  if (!def) return;
  playRowSound(getAlertRowSettings(rowId, def.defaultSound, def.defaultEnabled).soundId);
}

function historyText(p: AlertPayload): string {
  return p.body ? `${p.title} — ${p.body}` : p.title;
}

function capPayload(p: AlertPayload): AlertPayload {
  return {
    ...p,
    ...(p.sprites ? { sprites: p.sprites.slice(0, MAX_SPRITES) } : {}),
    ...(p.chips ? { chips: p.chips.slice(0, MAX_CHIPS) } : {}),
  };
}

function patchOf(p: AlertPayload): AlertCardPatch {
  return {
    body: p.body ?? '',
    ...(p.meter ? { meter: p.meter } : {}),
    ...(p.chips ? { chips: p.chips } : {}),
    ...(p.figure ? { figure: p.figure } : {}),
  };
}

export interface RaiseOptions {
  /** false when the event already sits in History (the notify bridge). */
  history?: boolean;
  /** Replays the row's sound until the card closes; needs a `cardKey` and a shown card. */
  repeat?: { intervalMs?: number };
  /** Runs once when the card this raise created closes, by any path. */
  onClose?: () => void;
}

/** Null when the row is unknown or switched off: nothing reaches History, the speaker or the screen. */
export function raiseAlert(rowId: string, raw: AlertPayload, opts: RaiseOptions = {}): AlertCardHandle | null {
  const def = getAlertRow(rowId);
  if (!def) { counts.unknownRow += 1; return null; }
  const row = getAlertRowSettings(rowId, def.defaultSound, def.defaultEnabled);
  if (!row.enabled) { counts.rowOff += 1; return null; }
  counts.raised += 1;
  const payload = capPayload(raw);

  if (opts.history !== false) {
    notify({
      feature: rowId,
      level: payload.level ?? 'info',
      message: historyText(payload),
      title: payload.title,
      ...(payload.body ? { body: payload.body } : {}),
      ...(payload.iconUrl ? { iconUrl: payload.iconUrl } : {}),
      ...(payload.actions ? { actions: payload.actions } : {}),
    });
  }
  playRowSound(row.soundId);
  deliverDesktopAlert(rowId, { title: payload.title, ...(payload.body ? { body: payload.body } : {}), tag: payload.cardKey ?? rowId });

  const key = payload.cardKey;
  const open = key !== undefined ? openCards.get(key) : undefined;
  if (open) {
    open.update(patchOf(payload));
    if (opts.repeat && key !== undefined) startCardLoop(key, row.soundId, opts.repeat.intervalMs);
    return open;
  }
  if (!presenter) return null;
  let card: AlertCardHandle | null = null;
  let closeReported = false;
  try {
    card = presenter({
      ...payload,
      rowId,
      onClose: () => {
        if (!closeReported) {
          closeReported = true;
          try { opts.onClose?.(); } catch { /* the hub's own cleanup still runs */ }
        }
        if (key === undefined || openCards.get(key) !== card) return;
        openCards.delete(key);
        stopCardLoop(key);
      },
    });
  } catch {
    card = null;
  }
  if (card && key !== undefined) {
    openCards.set(key, card);
    if (opts.repeat) startCardLoop(key, row.soundId, opts.repeat.intervalMs);
  }
  return card;
}

/** False once the player closed the card, so a feature can start the next card's contents afresh. */
export function isAlertCardOpen(cardKey: string): boolean {
  return openCards.has(cardKey);
}

export function closeAllAlertCards(): void {
  const cards = [...openCards.values()];
  openCards.clear();
  for (const k of [...loopingKeys]) stopCardLoop(k);
  for (const c of cards) {
    try { c.close(); } catch { /* ignore */ }
  }
}

export function getRaiseStats(): { raised: number; rowOff: number; unknownRow: number; openCards: number; loops: number; presenter: boolean } {
  return { ...counts, openCards: openCards.size, loops: countCardLoops(), presenter: presenter !== null };
}
