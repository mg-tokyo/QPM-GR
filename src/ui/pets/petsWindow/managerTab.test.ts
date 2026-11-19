// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PetTeam, PooledPet } from '../../../types/petTeams';

vi.mock('../../../i18n', () => ({ t: (key: string) => key }));

let teams: PetTeam[] = [];
let pool: PooledPet[] = [];
let poolReads = 0;
const teamListeners = new Set<() => void>();
const sourceListeners = new Set<() => void>();
function listen(set: Set<() => void>, cb: () => void): () => void { set.add(cb); return () => { set.delete(cb); }; }
vi.mock('../../../store/petTeams', () => ({
  getTeamsConfig: () => ({ teams, keybinds: {}, activeTeamId: null, lastAppliedAt: 0 }),
  createTeam: vi.fn(),
  onTeamsChange: (cb: () => void) => listen(teamListeners, cb),
  getAllPooledPets: () => { poolReads += 1; return Promise.resolve(pool); },
  detectCurrentTeam: () => null,
  getKeybinds: () => ({}),
  reorderTeams: vi.fn(),
  deleteTeam: vi.fn(),
}));
vi.mock('../../../store/petTeamsSync', () => ({
  isSyncEnabled: () => false,
  setSyncEnabled: () => Promise.resolve(),
  onSyncStateChange: () => () => { /* sync off */ },
  getNativeTeams: () => [],
  isTeamNativeOwned: () => false,
  getActiveNativeTeamId: () => null,
  nativeTeamToDisplayPetTeam: (team: unknown) => team,
}));
vi.mock('../../../store/pets', () => ({ getActivePetInfos: () => [] }));
vi.mock('../../../store/inventory', () => ({ onInventoryChange: (cb: () => void) => listen(sourceListeners, cb) }));
vi.mock('../../../store/hutch', () => ({ onHutchChange: (cb: () => void) => listen(sourceListeners, cb) }));
vi.mock('../../../utils/storage', () => ({ storage: { get: (_key: string, fallback: unknown) => fallback, set: vi.fn() } }));
vi.mock('../../../utils/ariesTeamImport', () => ({ importAriesTeams: () => ({ available: false, imported: 0 }) }));

let spritesReady = true;
const loadedSpecies = new Set<string>();
const readyCallbacks = new Set<() => void>();
vi.mock('../../../sprite-v2/compat', () => ({
  isSpritesReady: () => spritesReady,
  onSpritesReady: (cb: () => void) => { readyCallbacks.add(cb); return () => { readyCallbacks.delete(cb); }; },
  getPetSpriteDataUrlWithMutations: (species: string) => (loadedSpecies.has(species) ? `data:${species}` : ''),
}));
vi.mock('../../../utils/rendering/petCardRenderer', () => ({ getAbilityColor: () => ({ base: '', text: '', glow: '' }) }));
vi.mock('../floatingCard', () => ({
  openFloatingCardForSlot: vi.fn(),
  closeFloatingCardForSlot: vi.fn(),
  hasFloatingCardForSlot: () => false,
}));
vi.mock('./teamSummary', () => ({ computeTeamAbilityPills: () => [] }));
vi.mock('./helpers', () => ({
  btn: (label: string) => { const el = document.createElement('button'); el.textContent = label; return el; },
  showToast: vi.fn(),
  formatKeybind: (combo: string) => combo,
  getCoinSpriteUrl: () => null,
  getAgeSpriteUrl: () => null,
  computeTeamScore: () => 0,
}));
vi.mock('./comparisonPanel', () => ({
  buildCompareTeamsPanel: () => ({ root: document.createElement('div'), setPair: vi.fn(), refresh: vi.fn() }),
}));
const renderEditor = vi.fn();
vi.mock('./teamEditor', () => ({ renderEditor: (...args: unknown[]) => { renderEditor(...args); } }));

import { buildManagerTab } from './managerTab';
import { HYDRATION_EVENT } from '../../../sprite-v2/service/constants';
import type { ManagerState } from './types';

function team(id: string, slots: PetTeam['slots']): PetTeam {
  return { id, name: id, slots, createdAt: 0, updatedAt: 0 };
}

function pet(id: string, species: string): PooledPet {
  return {
    id, petId: null, name: species, species, level: null, strength: 90, mutations: [], abilities: [],
    xp: null, targetScale: null, hunger: null, location: 'hutch',
  };
}

let root: HTMLElement;
let state: ManagerState;

const spriteAlts = (): string[] =>
  [...root.querySelectorAll<HTMLImageElement>('.qpm-team-row__sprites img')].map((img) => img.alt);
const emptyMarks = (): number => root.querySelectorAll('.qpm-team-row__sprites-empty').length;

async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(500);
}

beforeEach(() => {
  vi.useFakeTimers();
  teams = [];
  pool = [];
  poolReads = 0;
  spritesReady = true;
  loadedSpecies.clear();
  readyCallbacks.clear();
  teamListeners.clear();
  sourceListeners.clear();
  renderEditor.mockClear();
  root = document.createElement('div');
  document.body.appendChild(root);
});

afterEach(() => {
  state.cleanups.forEach((fn) => fn());
  root.remove();
  vi.useRealTimers();
});

describe('manager tab team rows', () => {
  it('redraws a saved pet whose sprite lands after the first draw', async () => {
    teams = [team('a', ['p1', 'p2', null])];
    pool = [pet('p1', 'Bat'), pet('p2', 'Goat')];
    state = buildManagerTab(root);
    await settle();
    expect(spriteAlts()).toEqual([]);
    expect(emptyMarks()).toBe(3);

    loadedSpecies.add('Bat').add('Goat');
    window.dispatchEvent(new Event(HYDRATION_EVENT));
    await settle();

    expect(spriteAlts()).toEqual(['Bat', 'Goat']);
    expect(emptyMarks()).toBe(1);
  });

  it('redraws the editor too when sprites land', async () => {
    teams = [team('a', ['p1', null, null])];
    pool = [pet('p1', 'Bat')];
    state = buildManagerTab(root);
    await settle();
    const before = renderEditor.mock.calls.length;

    loadedSpecies.add('Bat');
    window.dispatchEvent(new Event(HYDRATION_EVENT));
    await settle();

    expect(renderEditor.mock.calls.length).toBeGreaterThan(before);
  });

  it('redraws once the sprite service becomes ready', async () => {
    spritesReady = false;
    teams = [team('a', ['p1', null, null])];
    pool = [pet('p1', 'Bat')];
    loadedSpecies.add('Bat');
    state = buildManagerTab(root);
    await settle();
    expect(spriteAlts()).toEqual([]);

    spritesReady = true;
    readyCallbacks.forEach((cb) => cb());
    await settle();

    expect(spriteAlts()).toEqual(['Bat']);
  });

  it('reloads the pet pool when a missing saved pet shows up in the hutch or inventory', async () => {
    teams = [team('a', ['p1', 'p2', null])];
    pool = [pet('p1', 'Bat')];
    loadedSpecies.add('Bat').add('Goat');
    state = buildManagerTab(root);
    await settle();
    expect(spriteAlts()).toEqual(['Bat']);

    pool = [pet('p1', 'Bat'), pet('p2', 'Goat')];
    sourceListeners.forEach((cb) => cb());
    await settle();

    expect(spriteAlts()).toEqual(['Bat', 'Goat']);
  });

  it('reloads the pet pool when a team gains a pet the pool has not seen', async () => {
    teams = [team('a', ['p1', null, null])];
    pool = [pet('p1', 'Bat')];
    loadedSpecies.add('Bat').add('Goat');
    state = buildManagerTab(root);
    await settle();

    teams = [team('a', ['p1', 'p2', null])];
    pool = [pet('p1', 'Bat'), pet('p2', 'Goat')];
    teamListeners.forEach((cb) => cb());
    await settle();

    expect(spriteAlts()).toEqual(['Bat', 'Goat']);
  });

  it('leaves the pool alone while every saved pet is known', async () => {
    teams = [team('a', ['p1', null, null])];
    pool = [pet('p1', 'Bat')];
    state = buildManagerTab(root);
    await settle();
    const reads = poolReads;

    sourceListeners.forEach((cb) => cb());
    await settle();

    expect(poolReads).toBe(reads);
  });

  it('does not keep reloading the pool for a pet that is really gone', async () => {
    teams = [team('a', ['p1', 'gone', null])];
    pool = [pet('p1', 'Bat')];
    loadedSpecies.add('Bat');
    state = buildManagerTab(root);
    await settle();
    const reads = poolReads;

    root.querySelector<HTMLElement>('.qpm-team-row')!.click();
    await settle();
    root.querySelector<HTMLElement>('.qpm-team-row')!.click();
    await settle();

    expect(poolReads).toBe(reads);
  });

  it('stops listening after cleanup', async () => {
    teams = [team('a', ['p1', null, null])];
    pool = [pet('p1', 'Bat')];
    state = buildManagerTab(root);
    await settle();
    state.cleanups.forEach((fn) => fn());

    loadedSpecies.add('Bat');
    window.dispatchEvent(new Event(HYDRATION_EVENT));
    await settle();

    expect(spriteAlts()).toEqual([]);
  });
});
