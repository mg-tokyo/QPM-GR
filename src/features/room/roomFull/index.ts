import { readSync, subscribe } from '../../../core/gameState';
import { t } from '../../../i18n';
import { serviceReady } from '../../../sprite-v2/compat';
import type { SpriteService } from '../../../sprite-v2/types';
import { canvasToDataUrl } from '../../../utils/dom/canvasHelpers';
import { getFriendBonusMultiplier, getRoomOccupancy, onFriendBonusChange, onRoomOccupancyChange } from '../../../store/friendBonus';
import { isAlertCardOpen, raiseAlert, registerAlertRow, type AlertCardHandle, type AlertPayload } from '../../alertHub';
import { createRoomFullState, friendBonusBadgeIndex, resetRoomFullState, resolveMinPlayers, stepRoomFull } from './core';
import { getRoomFullMinPlayers, writeRoomFullMinPlayers } from './settings';

export { ROOM_FULL_REARM_MS, resolveMinPlayers, stepRoomFull } from './core';
export type { MinPlayersSetting } from './core';
export { getRoomFullMinPlayers, ROOM_FULL_ALERT_KEY } from './settings';

export const ROOM_FULL_ROW = 'room.roomFull';
const ACCENT = 'var(--qpm-positive)';

const state = createRoomFullState();
const counts = { raised: 0, closedOnDrop: 0, resets: 0 };
let cleanups: Array<() => void> = [];
let scopeId: string | null = null;
let handle: AlertCardHandle | null = null;
let cardKey: string | null = null;

// The sprite service files FriendBonus_1…_6 as one animation, so a single frame key renders nothing;
// the frames come from the service (precedent: publicRoomsWindow/spriteHelpers.ts:37).
const BADGE_KEY = 'sprite/ui/FriendBonus';
let spriteService: SpriteService | null = null;
let badgeUrls: string[] | null = null;

function badgeUrl(filled: number): string | undefined {
  if (!spriteService) return undefined;
  if (!badgeUrls?.length) {
    try {
      badgeUrls = spriteService.renderAnimToCanvases({ category: 'any', id: BADGE_KEY, mutations: [] }).map((c) => canvasToDataUrl(c));
    } catch {
      badgeUrls = null;
    }
  }
  if (!badgeUrls?.length) return undefined;
  return badgeUrls[friendBonusBadgeIndex(filled, badgeUrls.length)] || undefined;
}

function multiplierText(): string {
  return t('feature.roomFull.multiplier', { value: Number(getFriendBonusMultiplier().toFixed(2)) });
}

export function buildRoomFullPayload(filled: number, seats: number, minPlayers: number, key: string): AlertPayload {
  const icon = badgeUrl(filled);
  return {
    title: minPlayers >= seats ? t('feature.roomFull.title') : t('feature.roomFull.titleCount', { count: filled }),
    body: t('feature.roomFull.body', { filled, seats }),
    cardKey: key,
    accent: ACCENT,
    figure: { value: multiplierText(), label: t('feature.roomFull.figure') },
    ...(icon ? { iconUrl: icon } : {}),
  };
}

function closeCard(): void {
  const h = handle;
  handle = null;
  cardKey = null;
  try { h?.close(); } catch { /* the card may already be gone */ }
}

function liveHandle(): AlertCardHandle | null {
  if (handle && cardKey && isAlertCardOpen(cardKey)) return handle;
  handle = null;
  cardKey = null;
  return null;
}

function reset(): void {
  if (state.baselined) counts.resets += 1;
  resetRoomFullState(state);
  closeCard();
}

function evaluate(): void {
  if (cleanups.length === 0) return;
  const { filled, seats } = getRoomOccupancy();
  // A spectator has no garden to sell from; leaving the spectator view starts a fresh baseline.
  if (seats === 0 || readSync('isSpectating') === true) { reset(); return; }
  const minPlayers = resolveMinPlayers(getRoomFullMinPlayers(), seats);
  const step = stepRoomFull(state, filled, minPlayers, Date.now());
  if (step.close) {
    if (liveHandle()) counts.closedOnDrop += 1;
    closeCard();
    return;
  }
  if (step.fire) {
    const key = `roomFull:${scopeId ?? 'room'}`;
    counts.raised += 1;
    const card = raiseAlert(ROOM_FULL_ROW, buildRoomFullPayload(filled, seats, minPlayers, key));
    handle = card;
    cardKey = card ? key : null;
    return;
  }
  liveHandle()?.update({ body: t('feature.roomFull.body', { filled, seats }), figure: { value: multiplierText(), label: t('feature.roomFull.figure') } });
}

function onScope(next: string | null): void {
  if (next === scopeId) return;
  scopeId = next;
  reset();
  evaluate();
}

export function roomFullSummary(): string {
  const setting = getRoomFullMinPlayers();
  const seats = getRoomOccupancy().seats;
  if (setting === 'full') return seats > 0 ? t('feature.roomFull.summaryFull', { seats }) : t('feature.roomFull.summaryFullNoRoom');
  return t('feature.roomFull.summaryCount', { count: setting });
}

/** Debug and the ALR-12.3 window: a new trigger re-baselines silently, like a lowered trough threshold. */
export function setRoomFullMinPlayers(v: unknown): boolean {
  if (!writeRoomFullMinPlayers(v)) return false;
  resetRoomFullState(state);
  evaluate();
  return true;
}

// Lazy so the alarm core never loads window code.
function openRoomFullSettings(): void {
  void import('../../../ui/room/roomFullWindow').then((m) => { m.openRoomFullWindow(); });
}

/** Debug: the card for the current room, without History. Null when the row is off. */
export function previewRoomFullCard(): AlertCardHandle | null {
  const { filled, seats } = getRoomOccupancy();
  if (seats === 0) return null;
  const minPlayers = resolveMinPlayers(getRoomFullMinPlayers(), seats);
  return raiseAlert(ROOM_FULL_ROW, buildRoomFullPayload(filled, seats, minPlayers, 'roomFull:preview'), { history: false });
}

export function startRoomFullAlarm(): void {
  if (cleanups.length > 0) return;
  registerAlertRow({
    id: ROOM_FULL_ROW,
    group: 'room',
    labelKey: 'feature.roomFull.row',
    defaultSound: 'chime',
    settingsAction: openRoomFullSettings,
    icon: () => badgeUrl(getRoomOccupancy().filled) ?? null,
    summary: roomFullSummary,
    accent: ACCENT,
  });
  cleanups = [
    onRoomOccupancyChange(evaluate),
    onFriendBonusChange(evaluate),
    subscribe('isSpectating', evaluate),
  ];
  cleanups.push(subscribe('roomScopeId', onScope));
  void serviceReady.then((svc) => { if (cleanups.length > 0) spriteService = svc; });
  evaluate();
}

export function stopRoomFullAlarm(): void {
  for (const fn of cleanups) {
    try { fn(); } catch { /* teardown best-effort */ }
  }
  cleanups = [];
  scopeId = null;
  spriteService = null;
  badgeUrls = null;
  resetRoomFullState(state);
  closeCard();
}

export function getRoomFullAlarmState(): {
  started: boolean;
  minPlayers: ReturnType<typeof getRoomFullMinPlayers>;
  filled: number;
  seats: number;
  scopeId: string | null;
  cardOpen: boolean;
  baselined: boolean;
  above: boolean;
  armed: boolean;
  belowSince: number | null;
  raised: number;
  closedOnDrop: number;
  resets: number;
} {
  return {
    started: cleanups.length > 0,
    minPlayers: getRoomFullMinPlayers(),
    ...getRoomOccupancy(),
    scopeId,
    cardOpen: cardKey !== null && isAlertCardOpen(cardKey),
    ...state,
    ...counts,
  };
}
