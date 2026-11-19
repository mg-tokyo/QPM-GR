// ALR-10.3: "Repeat until used" per charged ability, one shared repeat interval (PD2).

import { storage } from '../../utils/storage';
import { isRecord } from '../../utils/typeGuards';

export const CHARGED_READY_ALERT_KEY = 'qpm.chargedReadyAlert.v1';
export const CHARGED_READY_MIN_INTERVAL_SEC = 2;
export const CHARGED_READY_MAX_INTERVAL_SEC = 60;
// soundEngine startLoop's own default gap.
export const CHARGED_READY_DEFAULT_INTERVAL_SEC = 3;

interface ChargedReadySettings {
  repeat: string[];
  intervalSec: number;
}

const validInterval = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= CHARGED_READY_MIN_INTERVAL_SEC && v <= CHARGED_READY_MAX_INTERVAL_SEC;

function read(): ChargedReadySettings {
  const raw = storage.get<unknown>(CHARGED_READY_ALERT_KEY, null);
  const repeat = isRecord(raw) && Array.isArray(raw.repeat) ? raw.repeat.filter((id): id is string => typeof id === 'string') : [];
  const interval = isRecord(raw) ? raw.intervalSec : undefined;
  return { repeat, intervalSec: validInterval(interval) ? interval : CHARGED_READY_DEFAULT_INTERVAL_SEC };
}

export function isChargedReadyRepeatOn(abilityId: string): boolean {
  return read().repeat.includes(abilityId);
}

export function setChargedReadyRepeat(abilityId: string, on: boolean): void {
  const current = read();
  const others = current.repeat.filter((id) => id !== abilityId);
  storage.set(CHARGED_READY_ALERT_KEY, { ...current, repeat: on ? [...others, abilityId] : others });
}

export function getChargedReadyIntervalSec(): number {
  return read().intervalSec;
}

export function setChargedReadyIntervalSec(sec: number): boolean {
  if (!validInterval(sec)) return false;
  storage.set(CHARGED_READY_ALERT_KEY, { ...read(), intervalSec: sec });
  return true;
}
