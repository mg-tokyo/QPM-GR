// ALR-14.2: pre-alarm before an active pet reaches max STR. At max the game's own "Fully grown!" toast
// shows, so QPM closes the card and only writes History.

import { notify } from '../../../core/notifications';
import { t } from '../../../i18n';
import { onActivePetInfos, type ActivePetInfo } from '../../../store/pets';
import { getWeatherSnapshot } from '../../../store/weatherHub';
import { computeTeamXpRates, minutesToMaxStr } from '../../../store/xpEta';
import { calculateMaxStrength, getSpeciesXpPerLevel } from '../../../store/xpTracker';
import {
  getAlertRowSettings,
  isAlertCardOpen,
  raiseAlert,
  registerAlertRow,
  type AlertCardHandle,
  type AlertCardPatch,
} from '../../alertHub';
import { petIcon, petName } from '../hungerAlarm';
import { stepMaxStr, type MaxStrPetState, type MaxStrReading } from './core';
import { getMaxStrLeadMinutes, writeMaxStrLeadMinutes } from './settings';

export { stepMaxStr } from './core';
export type { MaxStrEdge, MaxStrPetState, MaxStrReading } from './core';
export { getMaxStrLeadMinutes, MAX_STR_MAX_LEAD_MINUTES, MAX_STR_MIN_LEAD_MINUTES } from './settings';

export const MAX_STR_ROW = 'pets.maxStr';
const DEFAULT_SOUND = 'chime';
const ACCENT = 'var(--qpm-warning)';
// The card ticks its own countdown; a recomputed ETA moves it only when it drifts this far.
const COUNTDOWN_SLACK_MS = 30_000;

interface OpenCard {
  handle: AlertCardHandle;
  countdownTo: number;
}

const state = new Map<string, MaxStrPetState>();
const cards = new Map<string, OpenCard>();
let latest: ActivePetInfo[] = [];
let lastReadings: MaxStrReading[] = [];
let stopPets: (() => void) | null = null;
const counts = { fired: 0, reachedMax: 0, history: 0, left: 0 };

const cardKey = (petId: string): string => `maxStr:${petId}`;

function readMaxStrPets(infos: readonly ActivePetInfo[]): MaxStrReading[] {
  const rate = computeTeamXpRates([...infos], getWeatherSnapshot().kind).planningTeamXpPerHour;
  const out: MaxStrReading[] = [];
  for (const p of infos) {
    if (!p.petId || !p.species || p.strength == null || p.xp == null) continue;
    const maxStr = calculateMaxStrength(p.targetScale, p.species);
    const xpPerLevel = getSpeciesXpPerLevel(p.species);
    if (maxStr == null || xpPerLevel == null) continue;
    const minutes = minutesToMaxStr({ xp: p.xp, strength: p.strength, maxStr, xpPerLevel }, rate);
    out.push({ petId: p.petId, strength: p.strength, maxStr, minutes });
  }
  return out;
}

function cardPatch(r: MaxStrReading, countdownTo: number): AlertCardPatch {
  return {
    body: t('feature.maxStrAlarm.body', { str: r.strength, max: r.maxStr }),
    meter: { pct: Math.min(100, (r.strength / r.maxStr) * 100), color: ACCENT },
    figure: { countdownTo, label: t('feature.maxStrAlarm.figure') },
  };
}

function fire(pet: ActivePetInfo, r: MaxStrReading, now: number): void {
  const countdownTo = now + (r.minutes ?? 0) * 60_000;
  const icon = petIcon(pet);
  const handle = raiseAlert(MAX_STR_ROW, {
    title: t('feature.maxStrAlarm.title', { name: petName(pet), max: r.maxStr }),
    ...cardPatch(r, countdownTo),
    cardKey: cardKey(r.petId),
    accent: ACCENT,
    ...(icon ? { iconUrl: icon } : {}),
  });
  if (!handle) return;
  counts.fired += 1;
  cards.set(r.petId, { handle, countdownTo });
}

function closeCard(petId: string): void {
  const open = cards.get(petId);
  cards.delete(petId);
  if (open && isAlertCardOpen(cardKey(petId))) open.handle.close();
}

function writeMaxHistory(pet: ActivePetInfo | undefined, r: MaxStrReading | undefined): void {
  if (!pet || !r || !getAlertRowSettings(MAX_STR_ROW, DEFAULT_SOUND).enabled) return;
  counts.history += 1;
  const title = t('feature.maxStrAlarm.reached', { name: petName(pet), max: r.maxStr });
  const icon = petIcon(pet);
  notify({ feature: MAX_STR_ROW, level: 'success', message: title, title, ...(icon ? { iconUrl: icon } : {}) });
}

function refreshOpenCards(readings: readonly MaxStrReading[], now: number): void {
  for (const r of readings) {
    const open = cards.get(r.petId);
    if (!open) continue;
    if (!isAlertCardOpen(cardKey(r.petId))) { cards.delete(r.petId); continue; }
    if (r.minutes === null) continue;
    const target = now + r.minutes * 60_000;
    if (Math.abs(target - open.countdownTo) >= COUNTDOWN_SLACK_MS) open.countdownTo = target;
    open.handle.update(cardPatch(r, open.countdownTo));
  }
}

function evaluate(infos: ActivePetInfo[]): void {
  latest = infos;
  const readings = readMaxStrPets(infos);
  lastReadings = readings;
  const now = Date.now();
  for (const edge of stepMaxStr(state, readings, getMaxStrLeadMinutes())) {
    const r = readings.find((x) => x.petId === edge.petId);
    const pet = infos.find((p) => p.petId === edge.petId);
    if (edge.kind === 'fire') {
      if (pet && r) fire(pet, r, now);
    } else if (edge.kind === 'max') {
      counts.reachedMax += 1;
      closeCard(edge.petId);
      writeMaxHistory(pet, r);
    } else {
      counts.left += 1;
      closeCard(edge.petId);
    }
  }
  refreshOpenCards(readings, now);
}

function rowIcon(): string | null {
  const below = lastReadings.find((r) => r.strength < r.maxStr);
  const pet = below ? latest.find((p) => p.petId === below.petId) : latest.find((p) => p.species);
  return pet ? petIcon(pet) ?? null : null;
}

// Lazy so the alarm core never loads window code.
function openMaxStrSettings(): void {
  void import('../../../ui/pets/maxStrAlarmWindow').then((m) => { m.openMaxStrAlarmWindow(); });
}

export function startMaxStrAlarm(): void {
  if (stopPets) return;
  registerAlertRow({
    id: MAX_STR_ROW,
    group: 'pets',
    labelKey: 'feature.maxStrAlarm.row',
    defaultSound: DEFAULT_SOUND,
    settingsAction: openMaxStrSettings,
    icon: rowIcon,
    summary: () => t('feature.maxStrAlarm.summary', { lead: getMaxStrLeadMinutes() }),
    accent: ACCENT,
  });
  stopPets = onActivePetInfos(evaluate, true);
}

export function stopMaxStrAlarm(): void {
  stopPets?.();
  stopPets = null;
  for (const id of [...cards.keys()]) closeCard(id);
  state.clear();
  latest = [];
  lastReadings = [];
}

/** A raised lead fires a pet already inside the new window; pets already fired this stay are not re-fired. */
export function setMaxStrLeadMinutes(minutes: number): boolean {
  if (!writeMaxStrLeadMinutes(minutes)) return false;
  if (stopPets) evaluate(latest);
  return true;
}

export function getMaxStrAlarmState(): {
  started: boolean;
  leadMinutes: number;
  pets: Array<MaxStrReading & MaxStrPetState & { cardOpen: boolean }>;
  counts: typeof counts;
} {
  return {
    started: stopPets !== null,
    leadMinutes: getMaxStrLeadMinutes(),
    pets: lastReadings.map((r) => ({
      ...r,
      fired: state.get(r.petId)?.fired ?? false,
      atMax: state.get(r.petId)?.atMax ?? false,
      cardOpen: isAlertCardOpen(cardKey(r.petId)),
    })),
    counts: { ...counts },
  };
}
