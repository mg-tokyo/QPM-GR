import { describe, expect, it } from 'vitest';
import { createRoomFullState, friendBonusBadgeIndex, resetRoomFullState, resolveMinPlayers, ROOM_FULL_REARM_MS, stepRoomFull } from './core';

const N = 6;

function run(counts: Array<[number, number]>, minPlayers = N) {
  const state = createRoomFullState();
  return counts.map(([filled, at]) => stepRoomFull(state, filled, minPlayers, at));
}

describe('stepRoomFull', () => {
  it('fires once on the upward crossing', () => {
    const steps = run([[4, 0], [5, 1], [6, 2], [6, 3]]);
    expect(steps.map((s) => s.fire)).toEqual([false, false, true, false]);
  });

  it('is silent when the room is already full on arrival (PD2)', () => {
    const steps = run([[6, 0], [6, 1]]);
    expect(steps.some((s) => s.fire)).toBe(false);
  });

  it('closes on a drop and fires again after the room stayed below N for the grace period', () => {
    const steps = run([[5, 0], [6, 1], [5, 2], [6, 2 + ROOM_FULL_REARM_MS]]);
    expect(steps.map((s) => s.fire)).toEqual([false, true, false, true]);
    expect(steps[2]?.close).toBe(true);
  });

  it('does not double-fire on a quick leave and rejoin at N', () => {
    const steps = run([[5, 0], [6, 1], [5, 2], [6, 3], [5, 4], [6, 5]]);
    expect(steps.filter((s) => s.fire)).toHaveLength(1);
  });

  it('a full arrival re-arms only after a settled drop', () => {
    const steps = run([[6, 0], [5, 1], [6, 2], [5, 3], [6, 3 + ROOM_FULL_REARM_MS]]);
    expect(steps.map((s) => s.fire)).toEqual([false, false, false, false, true]);
  });

  it('starts over after a reset (room switch)', () => {
    const state = createRoomFullState();
    stepRoomFull(state, 5, N, 0);
    resetRoomFullState(state);
    expect(stepRoomFull(state, 6, N, 1).fire).toBe(false);
  });

  it('honours a lower threshold', () => {
    const steps = run([[1, 0], [2, 1], [3, 2]], 2);
    expect(steps.map((s) => s.fire)).toEqual([false, true, false]);
  });
});

describe('resolveMinPlayers', () => {
  it('maps full to the seat count and clamps numbers to it', () => {
    expect(resolveMinPlayers('full', 6)).toBe(6);
    expect(resolveMinPlayers(3, 6)).toBe(3);
    expect(resolveMinPlayers(9, 6)).toBe(6);
  });
});

describe('friendBonusBadgeIndex', () => {
  it('is the number of other players, capped at the last frame', () => {
    expect(friendBonusBadgeIndex(1, 6)).toBe(0);
    expect(friendBonusBadgeIndex(6, 6)).toBe(5);
    expect(friendBonusBadgeIndex(9, 6)).toBe(5);
    expect(friendBonusBadgeIndex(0, 6)).toBe(0);
  });
});
