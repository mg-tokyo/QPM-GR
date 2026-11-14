import { readSync, subscribe } from '../../core/gameState';
import { getItemCatalogSpriteKey } from '../../catalogs/shopEligibility';
import { t } from '../../i18n';
import { getAnySpriteDataUrl, isSpritesReady } from '../../sprite-v2/compat';
import { storage } from '../../utils/storage';
import { isRecord } from '../../utils/typeGuards';
import { raiseAlert, registerAlertRow, type AlertMeter } from '../alertHub';

export const TROUGH_ALARM_ROW = 'pets.troughLow';
const SETTINGS_KEY = 'qpm.troughAlarm.v1';
const DEFAULT_LOW_AT = 1;
const TROUGH_ITEM_ID = 'FeedingTrough';

export interface TroughAlarmSettings {
  /** Alarm and amber chip at this many crops or fewer. */
  lowAt: number;
}

export interface TroughSnapshot {
  count: number;
  /** null while the player has no trough. */
  capacity: number | null;
  lowAt: number;
  low: boolean;
}

const validLowAt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 99;

export function getTroughAlarmSettings(): TroughAlarmSettings {
  const raw = storage.get<unknown>(SETTINGS_KEY, null);
  const lowAt = isRecord(raw) ? raw.lowAt : undefined;
  return { lowAt: validLowAt(lowAt) ? lowAt : DEFAULT_LOW_AT };
}

export interface TroughAlarmState {
  baselined: boolean;
  low: boolean;
}

/**
 * The first reading with a trough is a baseline (a reload fires nothing); after it the alarm fires when the
 * count drops to `lowAt` or below and re-arms once it is refilled above. No trough re-baselines.
 */
export function stepTroughAlarm(state: TroughAlarmState, count: number, capacity: number | null, lowAt: number): boolean {
  if (capacity === null) {
    state.baselined = false;
    state.low = false;
    return false;
  }
  const isLow = count <= lowAt;
  const fire = state.baselined && isLow && !state.low;
  state.low = isLow;
  state.baselined = true;
  return fire;
}

const state: TroughAlarmState = { baselined: false, low: false };
const counts = { raised: 0 };
const listeners = new Set<(snap: TroughSnapshot) => void>();
let count = 0;
let capacity: number | null = null;
let stops: Array<() => void> = [];

export function getTroughSnapshot(): TroughSnapshot {
  const { lowAt } = getTroughAlarmSettings();
  return { count, capacity, lowAt, low: capacity !== null && count <= lowAt };
}

/** Fires with the current snapshot when the alarm is running, then on every change. */
export function onTroughChange(cb: (snap: TroughSnapshot) => void): () => void {
  listeners.add(cb);
  if (stops.length > 0) cb(getTroughSnapshot());
  return () => { listeners.delete(cb); };
}

function emit(): void {
  const snap = getTroughSnapshot();
  for (const cb of [...listeners]) {
    try { cb(snap); } catch { /* one listener must not stop the rest */ }
  }
}

export function getTroughIconUrl(): string | undefined {
  if (!isSpritesReady()) return undefined;
  return getAnySpriteDataUrl(getItemCatalogSpriteKey(TROUGH_ITEM_ID)) || undefined;
}

function troughMeter(c: number, cap: number): AlertMeter {
  return { pct: cap > 0 ? (c / cap) * 100 : 0, color: 'var(--qpm-warning)' };
}

function update(nextCount: number, nextCapacity: number | null): void {
  if (nextCount === count && nextCapacity === capacity && state.baselined) return;
  count = nextCount;
  capacity = nextCapacity;
  const { lowAt } = getTroughAlarmSettings();
  if (stepTroughAlarm(state, count, capacity, lowAt) && capacity !== null) {
    counts.raised += 1;
    const icon = getTroughIconUrl();
    raiseAlert(TROUGH_ALARM_ROW, {
      title: t('feature.troughAlarm.title'),
      body: t('feature.troughAlarm.body', { count, capacity }),
      cardKey: 'trough:low',
      level: 'warn',
      meter: troughMeter(count, capacity),
      ...(icon ? { iconUrl: icon } : {}),
    });
  }
  emit();
}

export function setTroughLowAt(lowAt: number): void {
  if (!validLowAt(lowAt)) return;
  storage.set(SETTINGS_KEY, { ...getTroughAlarmSettings(), lowAt });
  // Re-read low without firing; the next drop fires.
  state.low = capacity !== null && count <= lowAt;
  emit();
}

// Lazy so the alarm core never loads window code; the window also holds the hunger settings.
function openPetAlarmsSettings(): void {
  void import('../../ui/pets/petAlarmsWindow').then((m) => { m.openPetAlarmsWindow(); });
}

export function startTroughAlarm(): void {
  if (stops.length > 0) return;
  registerAlertRow({ id: TROUGH_ALARM_ROW, group: 'pets', labelKey: 'feature.troughAlarm.row', defaultSound: 'alert', settingsAction: openPetAlarmsSettings });
  stops = [
    subscribe('feedingTroughItems', (items) => { update(items?.length ?? 0, capacity); }),
    subscribe('feedingTroughCapacity', (cap) => { update(count, cap ?? null); }),
  ];
  update(readSync('feedingTroughItems')?.length ?? 0, readSync('feedingTroughCapacity') ?? null);
}

export function stopTroughAlarm(): void {
  for (const stop of stops) stop();
  stops = [];
  state.baselined = false;
  state.low = false;
  count = 0;
  capacity = null;
  emit();
}

export function getTroughAlarmDiagnostics(): TroughSnapshot & { started: boolean; baselined: boolean; raised: number; listeners: number } {
  return { ...getTroughSnapshot(), started: stops.length > 0, baselined: state.baselined, raised: counts.raised, listeners: listeners.size };
}
