// Nightfall alarm (ALR-4.1): one alert `lead` minutes before each nightfall, from the ALR-3.2 day-cycle clock.
import { onDayCycleChange } from '../catalogs/logic/dayCycleCatalog';
import { getDayCycleClock, nextNightfall, onDayClockAnchorChange, type DayCycleClock } from '../catalogs/logic/dayCycleClock';
import { getServerNowMs } from '../store/serverClock';
import { t } from '../i18n';
import { formatRestockCountdown } from '../ui/core/panelHelpers';
import { storage } from '../utils/storage';
import { isRecord } from '../utils/typeGuards';
import { raiseAlert, registerAlertRow } from './alertHub';

export const NIGHTFALL_ALARM_ROW = 'garden.nightfall';
export const NIGHTFALL_ALARM_KEY = 'qpm.nightfallAlarm.v1';
const DEFAULT_LEAD_MINUTES = 1;
export const NIGHTFALL_MAX_LEAD_MINUTES = 180;
/** A wake later than this after its fire time (machine sleep) skips that night. */
export const NIGHTFALL_LATE_MS = 60_000;
const TIMER_MARGIN_MS = 50;

const validLead = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= NIGHTFALL_MAX_LEAD_MINUTES;

export function getNightfallLeadMinutes(): number {
  const raw = storage.get<unknown>(NIGHTFALL_ALARM_KEY, null);
  const lead = isRecord(raw) ? raw.leadMinutes : undefined;
  return validLead(lead) ? lead : DEFAULT_LEAD_MINUTES;
}

export interface NightfallPlan {
  nightMs: number;
  fireAtMs: number;
}

/** The next night whose fire time is not more than NIGHTFALL_LATE_MS past, skipping one already fired. */
export function planNightfall(nowMs: number, leadMs: number, clock: DayCycleClock | null, firedNightMs: number | null): NightfallPlan | null {
  let night = nextNightfall(nowMs - NIGHTFALL_LATE_MS + leadMs, clock);
  if (night !== null && night === firedNightMs) night = nextNightfall(night, clock);
  return night === null ? null : { nightMs: night, fireAtMs: night - leadMs };
}

let started = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let plan: NightfallPlan | null = null;
let firedNightMs: number | null = null;
let cleanups: Array<() => void> = [];
const counts = { fired: 0, skippedLate: 0, arms: 0 };

const nowMs = (): number => getServerNowMs() ?? Date.now();

function clearTimer(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
}

function fire(night: number, now: number): void {
  firedNightMs = night;
  counts.fired += 1;
  const left = night - now;
  raiseAlert(NIGHTFALL_ALARM_ROW, {
    title: t('feature.nightfallAlarm.title'),
    body: left > 0 ? t('feature.nightfallAlarm.bodyIn', { time: formatRestockCountdown(left) }) : t('feature.nightfallAlarm.bodyNow'),
    cardKey: `nightfall:${night}`,
  });
}

function arm(): void {
  clearTimer();
  if (!started) return;
  const now = nowMs();
  plan = planNightfall(now, getNightfallLeadMinutes() * 60_000, getDayCycleClock(), firedNightMs);
  if (!plan) return;
  counts.arms += 1;
  const { nightMs, fireAtMs } = plan;
  timer = setTimeout(() => {
    timer = null;
    const at = nowMs();
    if (at - fireAtMs > NIGHTFALL_LATE_MS) counts.skippedLate += 1;
    else fire(nightMs, at);
    arm();
  }, Math.max(0, fireAtMs - now) + TIMER_MARGIN_MS);
}

export function setNightfallLeadMinutes(minutes: number): boolean {
  if (!validLead(minutes)) return false;
  storage.set(NIGHTFALL_ALARM_KEY, { leadMinutes: minutes });
  arm();
  return true;
}

// Lazy so the alarm core never loads window code.
function openNightfallSettings(): void {
  void import('../ui/garden/nightfallAlarmWindow').then((m) => { m.openNightfallAlarmWindow(); });
}

export function startNightfallAlarm(): void {
  if (started) return;
  started = true;
  registerAlertRow({ id: NIGHTFALL_ALARM_ROW, group: 'garden', labelKey: 'feature.nightfallAlarm.row', defaultSound: 'chime', settingsAction: openNightfallSettings });
  cleanups.push(onDayCycleChange(arm), onDayClockAnchorChange(arm));
  arm();
}

export function stopNightfallAlarm(): void {
  started = false;
  clearTimer();
  for (const fn of cleanups.splice(0)) fn();
  plan = null;
}

export function getNightfallAlarmState(): {
  started: boolean;
  leadMinutes: number;
  armed: boolean;
  nextNightMs: number | null;
  nextFireAt: number | null;
  lastFiredNightMs: number | null;
  fired: number;
  skippedLate: number;
  arms: number;
} {
  return {
    started,
    leadMinutes: getNightfallLeadMinutes(),
    armed: timer !== null,
    nextNightMs: plan?.nightMs ?? null,
    nextFireAt: plan?.fireAtMs ?? null,
    lastFiredNightMs: firedNightMs,
    ...counts,
  };
}
