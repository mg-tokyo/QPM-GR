// ALR-12.2 firing rule: once per upward crossing of N players, silent on the first reading in a
// room (PD2), and re-armed only after the room stays below N for a grace period, so a player's
// quick reload does not raise a second card.

export const ROOM_FULL_REARM_MS = 30_000;

export type MinPlayersSetting = 'full' | number;

export interface RoomFullState {
  baselined: boolean;
  above: boolean;
  armed: boolean;
  belowSince: number | null;
}

export interface RoomFullStep {
  fire: boolean;
  /** The count fell below N: the open card closes. */
  close: boolean;
}

export function createRoomFullState(): RoomFullState {
  return { baselined: false, above: false, armed: false, belowSince: null };
}

export function resetRoomFullState(state: RoomFullState): void {
  Object.assign(state, createRoomFullState());
}

/** 'full' is every seat; a number is clamped to the seat count. */
export function resolveMinPlayers(setting: MinPlayersSetting, seats: number): number {
  return setting === 'full' ? seats : Math.min(setting, seats);
}

export function stepRoomFull(state: RoomFullState, filled: number, minPlayers: number, now: number, rearmMs = ROOM_FULL_REARM_MS): RoomFullStep {
  const isAbove = filled >= minPlayers;
  if (!state.baselined) {
    state.baselined = true;
    state.above = isAbove;
    state.armed = !isAbove;
    state.belowSince = null;
    return { fire: false, close: false };
  }
  if (isAbove && !state.above) {
    const settled = state.belowSince !== null && now - state.belowSince >= rearmMs;
    const fire = state.armed || settled;
    state.above = true;
    state.armed = false;
    state.belowSince = null;
    return { fire, close: false };
  }
  if (!isAbove && state.above) {
    state.above = false;
    state.belowSince = now;
    return { fire: false, close: true };
  }
  return { fire: false, close: false };
}

/** The game's friend-bonus badge frame: others in the room, capped at the last frame (beta friendBonusSpriteFor.ts:12-15). */
export function friendBonusBadgeIndex(filled: number, frames: number): number {
  return Math.max(0, Math.min(filled - 1, frames - 1));
}
