import { storage } from '../../../utils/storage';
import { isRecord } from '../../../utils/typeGuards';

export const MAX_STR_ALERT_KEY = 'qpm.maxStrAlert.v1';
// 0 would never fire: at max the card is replaced by the game's own "Fully grown!" toast.
export const MAX_STR_MIN_LEAD_MINUTES = 1;
export const MAX_STR_MAX_LEAD_MINUTES = 24 * 60;
const DEFAULT_LEAD_MINUTES = 10;

const validLead = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= MAX_STR_MIN_LEAD_MINUTES && v <= MAX_STR_MAX_LEAD_MINUTES;

export function getMaxStrLeadMinutes(): number {
  const raw = storage.get<unknown>(MAX_STR_ALERT_KEY, null);
  const lead = isRecord(raw) ? raw.leadMinutes : undefined;
  return validLead(lead) ? lead : DEFAULT_LEAD_MINUTES;
}

export function writeMaxStrLeadMinutes(minutes: number): boolean {
  if (!validLead(minutes)) return false;
  storage.set(MAX_STR_ALERT_KEY, { leadMinutes: minutes });
  return true;
}
