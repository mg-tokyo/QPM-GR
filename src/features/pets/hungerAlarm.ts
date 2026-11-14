import { readSync } from '../../core/gameState';
import { t } from '../../i18n';
import { getPetSpriteDataUrlWithMutations, isSpritesReady } from '../../sprite-v2/compat';
import { onActivePetInfos, type ActivePetInfo } from '../../store/pets';
import { getPetSafe } from '../../utils/game/catalogHelpers';
import { storage } from '../../utils/storage';
import { isRecord } from '../../utils/typeGuards';
import { raiseAlert, registerAlertRow, type AlertMeter } from '../alertHub';

export const HUNGER_ALARM_ROW = 'pets.hunger';
const SETTINGS_KEY = 'qpm.hungerAlarm.v1';
const DEFAULT_PCT = 25;

export interface HungerAlarmSettings {
  defaultPct: number;
  /** petId → threshold %, overriding the team default. */
  perPet: Record<string, number>;
}

const validPct = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100;

export function getHungerAlarmSettings(): HungerAlarmSettings {
  const raw = storage.get<unknown>(SETTINGS_KEY, null);
  const r = isRecord(raw) ? raw : {};
  const perPet: Record<string, number> = {};
  if (isRecord(r.perPet)) {
    for (const [id, pct] of Object.entries(r.perPet)) if (validPct(pct)) perPet[id] = pct;
  }
  return { defaultPct: validPct(r.defaultPct) ? r.defaultPct : DEFAULT_PCT, perPet };
}

export interface HungerPetReading {
  petId: string;
  pct: number;
  threshold: number;
}

/** Per-pet: true while the pet sits below its threshold (alarm spent until it is fed back up). */
export interface HungerAlarmState {
  baselined: boolean;
  below: Map<string, boolean>;
}

/**
 * One snapshot step. The first non-empty snapshot is a baseline (a reload fires nothing); after it a pet
 * fires when it crosses below its threshold or joins the team already below. An empty team re-baselines,
 * so a room handoff does not replay alarms.
 */
export function stepHungerAlarm(state: HungerAlarmState, readings: readonly HungerPetReading[]): string[] {
  if (readings.length === 0) {
    state.baselined = false;
    state.below.clear();
    return [];
  }
  const fire: string[] = [];
  const seen = new Set<string>();
  for (const { petId, pct, threshold } of readings) {
    seen.add(petId);
    const isBelow = pct < threshold;
    const was = state.below.get(petId);
    if (isBelow && was !== true && state.baselined) fire.push(petId);
    state.below.set(petId, isBelow);
  }
  for (const id of [...state.below.keys()]) if (!seen.has(id)) state.below.delete(id);
  state.baselined = true;
  return fire;
}

const state: HungerAlarmState = { baselined: false, below: new Map() };
const counts = { raised: 0, troughSkipped: 0 };
let latest: ActivePetInfo[] = [];
let stopPets: (() => void) | null = null;

function readings(infos: readonly ActivePetInfo[], settings: HungerAlarmSettings): HungerPetReading[] {
  const out: HungerPetReading[] = [];
  for (const p of infos) {
    if (!p.petId || p.hungerPct == null) continue;
    out.push({ petId: p.petId, pct: p.hungerPct, threshold: settings.perPet[p.petId] ?? settings.defaultPct });
  }
  return out;
}

export function petName(p: ActivePetInfo): string {
  return p.name || (p.species ? getPetSafe(p.species)?.name ?? p.species : '?');
}

/** The exact pet as the floating card draws it: species sprite with its mutations. */
export function petIcon(p: ActivePetInfo): string | undefined {
  if (!p.species || !isSpritesReady()) return undefined;
  return getPetSpriteDataUrlWithMutations(p.species, p.mutations) || undefined;
}

// Same bands as the floating card bar (src/ui/pets/floatingCard/card.ts:368-372).
function hungerMeter(pct: number): AlertMeter {
  const color = pct < 30 ? 'var(--qpm-hunger-low)' : pct < 60 ? 'var(--qpm-hunger-mid)' : 'var(--qpm-hunger-full)';
  return { pct, color };
}

function onPets(infos: ActivePetInfo[]): void {
  latest = infos;
  const list = readings(infos, getHungerAlarmSettings());
  const fired = stepHungerAlarm(state, list);
  if (fired.length === 0) return;
  // The game reads its trough-fed set on demand only: subscribing rescans the garden every room frame.
  const troughFed = new Set(readSync('troughFedPetIds') ?? []);
  for (const petId of fired) {
    if (troughFed.has(petId)) { counts.troughSkipped += 1; continue; }
    const pet = infos.find((p) => p.petId === petId);
    const reading = list.find((r) => r.petId === petId);
    if (!pet || !reading) continue;
    counts.raised += 1;
    const icon = petIcon(pet);
    raiseAlert(HUNGER_ALARM_ROW, {
      title: t('feature.hungerAlarm.title', { name: petName(pet) }),
      // floor: a rounded 24.6 would read "25% (alarm below 25%)".
      body: t('feature.hungerAlarm.body', { pct: Math.floor(reading.pct), threshold: reading.threshold }),
      cardKey: `hunger:${petId}`,
      level: 'warn',
      meter: hungerMeter(reading.pct),
      ...(icon ? { iconUrl: icon } : {}),
    });
  }
}

/** A threshold change re-reads who is below without firing; the next downward crossing fires. */
function rebaseline(): void {
  const list = readings(latest, getHungerAlarmSettings());
  state.below.clear();
  for (const r of list) state.below.set(r.petId, r.pct < r.threshold);
}

export function setHungerAlarmDefault(pct: number): void {
  if (!validPct(pct)) return;
  storage.set(SETTINGS_KEY, { ...getHungerAlarmSettings(), defaultPct: pct });
  rebaseline();
}

/** `null` clears the pet's override. */
export function setPetHungerThreshold(petId: string, pct: number | null): void {
  const s = getHungerAlarmSettings();
  const perPet = { ...s.perPet };
  if (pct === null) delete perPet[petId];
  else if (validPct(pct)) perPet[petId] = pct;
  else return;
  storage.set(SETTINGS_KEY, { ...s, perPet });
  rebaseline();
}

// Lazy so the alarm core never loads window code.
function openPetAlarmsSettings(): void {
  void import('../../ui/pets/petAlarmsWindow').then((m) => { m.openPetAlarmsWindow(); });
}

export function startHungerAlarm(): void {
  if (stopPets) return;
  registerAlertRow({ id: HUNGER_ALARM_ROW, group: 'pets', labelKey: 'feature.hungerAlarm.row', defaultSound: 'alert', settingsAction: openPetAlarmsSettings });
  stopPets = onActivePetInfos(onPets, true);
}

export function stopHungerAlarm(): void {
  stopPets?.();
  stopPets = null;
  state.baselined = false;
  state.below.clear();
  latest = [];
}

export function getHungerAlarmDiagnostics(): {
  started: boolean;
  baselined: boolean;
  settings: HungerAlarmSettings;
  pets: Array<HungerPetReading & { below: boolean }>;
  raised: number;
  troughSkipped: number;
} {
  const settings = getHungerAlarmSettings();
  return {
    started: stopPets !== null,
    baselined: state.baselined,
    settings,
    pets: readings(latest, settings).map((r) => ({ ...r, below: state.below.get(r.petId) === true })),
    ...counts,
  };
}
