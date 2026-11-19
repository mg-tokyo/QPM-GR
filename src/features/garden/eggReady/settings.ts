import { storage } from '../../../utils/storage';
import { isRecord } from '../../../utils/typeGuards';

export const EGG_READY_ALERT_KEY = 'qpm.eggReadyAlert.v1';
export const EGG_READY_MAX_LEAD_MINUTES = 180;

const validLead = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= EGG_READY_MAX_LEAD_MINUTES;

export function getEggReadyLeadMinutes(): number {
  const raw = storage.get<unknown>(EGG_READY_ALERT_KEY, null);
  const lead = isRecord(raw) ? raw.leadMinutes : undefined;
  return validLead(lead) ? lead : 0;
}

export function writeEggReadyLeadMinutes(minutes: number): boolean {
  if (!validLead(minutes)) return false;
  storage.set(EGG_READY_ALERT_KEY, { leadMinutes: minutes });
  return true;
}
