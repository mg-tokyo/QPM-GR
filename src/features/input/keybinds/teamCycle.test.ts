import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PetTeam } from '../../../types/petTeams';

const state = vi.hoisted(() => ({
  teams: [] as PetTeam[],
  detected: null as string | null,
  active: null as string | null,
  applies: [] as Array<{ id: string; resolve: () => void }>,
}));

vi.mock('../../../store/petTeams', () => ({
  getTeamsConfig: () => ({ teams: state.teams, keybinds: {}, activeTeamId: state.active, lastAppliedAt: 0 }),
  detectCurrentTeam: () => state.detected,
  applyTeam: (id: string) => new Promise((resolve) => {
    state.applies.push({ id, resolve: () => resolve({ applied: 3, errors: [] }) });
  }),
}));
vi.mock('../../../ui/pets/petsWindow/helpers', () => ({ showToast: vi.fn() }));

const { pickCycleTeam, buildTeamCycleActions } = await import('./teamCycle');
const { getPendingKeyApplyTeamId } = await import('../../../ui/pets/petsWindow/teamApplyToast');

const team = (id: string, filled = true): PetTeam => ({
  id, name: id.toUpperCase(), slots: [filled ? `${id}-pet` : null, null, null], createdAt: 0, updatedAt: 0,
});
const ids = (t: PetTeam | null): string | null => t?.id ?? null;

describe('pickCycleTeam', () => {
  const teams = [team('a'), team('b'), team('c')];
  it('steps forward and back in saved order', () => {
    expect(ids(pickCycleTeam(teams, 'a', 1))).toBe('b');
    expect(ids(pickCycleTeam(teams, 'b', -1))).toBe('a');
  });
  it('wraps at both ends', () => {
    expect(ids(pickCycleTeam(teams, 'c', 1))).toBe('a');
    expect(ids(pickCycleTeam(teams, 'a', -1))).toBe('c');
  });
  it('no current team (or an unknown id): Next = first, Previous = last', () => {
    expect(ids(pickCycleTeam(teams, null, 1))).toBe('a');
    expect(ids(pickCycleTeam(teams, null, -1))).toBe('c');
    expect(ids(pickCycleTeam(teams, 'gone', 1))).toBe('a');
  });
  it('skips teams with no pets, from an empty current team too', () => {
    const mixed = [team('a'), team('x', false), team('c'), team('y', false)];
    expect(ids(pickCycleTeam(mixed, 'a', 1))).toBe('c');
    expect(ids(pickCycleTeam(mixed, 'c', 1))).toBe('a');
    expect(ids(pickCycleTeam(mixed, 'x', -1))).toBe('a');
    expect(ids(pickCycleTeam([team('x', false), team('a')], null, 1))).toBe('a');
  });
  it('nothing to pick: empty list or only empty teams', () => {
    expect(pickCycleTeam([], null, 1)).toBeNull();
    expect(pickCycleTeam([team('x', false)], 'x', 1)).toBeNull();
  });
  it('a single team with pets is picked again', () => {
    expect(ids(pickCycleTeam([team('a')], 'a', 1))).toBe('a');
  });
});

describe('Next / Previous team actions', () => {
  beforeEach(() => {
    state.teams = [team('a'), team('b'), team('c')];
    state.detected = null;
    state.active = null;
    state.applies = [];
  });
  const action = (id: string) => buildTeamCycleActions().find(a => a.id === id)!;

  it('lists both actions in the pets section', () => {
    expect(buildTeamCycleActions().map(a => [a.id, a.section])).toEqual([['teamNext', 'pets'], ['teamPrev', 'pets']]);
  });
  it('starts from the detected team, else the last applied one', async () => {
    state.detected = 'a';
    state.active = 'c';
    const first = action('teamNext').run();
    state.applies[0]?.resolve();
    await first;
    state.detected = null;
    const second = action('teamPrev').run();
    state.applies[1]?.resolve();
    await second;
    expect(state.applies.map(a => a.id)).toEqual(['b', 'b']);
  });
  it('a press during a pending apply steps on from the team being applied', async () => {
    state.detected = 'a';
    const first = action('teamNext').run();
    const second = action('teamNext').run();
    expect(state.applies.map(a => a.id)).toEqual(['b', 'c']);
    expect(getPendingKeyApplyTeamId()).toBe('c');
    state.applies[0]?.resolve();
    await first;
    expect(getPendingKeyApplyTeamId()).toBe('c');
    state.applies[1]?.resolve();
    await second;
    expect(getPendingKeyApplyTeamId()).toBeNull();
  });
});
