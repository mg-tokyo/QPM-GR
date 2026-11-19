import { storage } from '../../../utils/storage';
import { isRecord } from '../../../utils/typeGuards';
import type { MinPlayersSetting } from './core';

export const ROOM_FULL_ALERT_KEY = 'qpm.roomFullAlert.v1';

const validMinPlayers = (v: unknown): v is MinPlayersSetting =>
  v === 'full' || (typeof v === 'number' && Number.isInteger(v) && v >= 2 && v <= 99);

export function getRoomFullMinPlayers(): MinPlayersSetting {
  const raw = storage.get<unknown>(ROOM_FULL_ALERT_KEY, null);
  const v = isRecord(raw) ? raw.minPlayers : undefined;
  return validMinPlayers(v) ? v : 'full';
}

export function writeRoomFullMinPlayers(v: unknown): boolean {
  if (!validMinPlayers(v)) return false;
  storage.set(ROOM_FULL_ALERT_KEY, { minPlayers: v });
  return true;
}
