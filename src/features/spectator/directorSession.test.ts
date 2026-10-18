import { beforeEach, describe, expect, it } from 'vitest';
import type { GridPosition } from '../../types/gameAtoms';
import { installDirector, type DirectorDeps, type DirectorSession } from './directorSession';
import type { SeatedPlayer } from './players';
import { createSpectatorStore, type SpectatorStore } from './state';

const S = 1000;
// The wall clock (the game's timestamps) runs this far ahead of the frame clock.
const WALL = 1_700_000_000_000;

const seat = (id: string, n: number, online = true): SeatedPlayer => ({
  id, name: id, seat: n, online, colour: null, discordAvatarUrl: null, lastAction: null,
});
interface Log { action: string; timestamp: number }
const slot = (id: string, last: { action: string; at: number } | null, logs: Log[] = []) => ({
  userId: id, lastActionEvent: last ? { action: last.action, performedAt: last.at } : null, data: { activityLogs: logs },
});

let store: SpectatorStore;
let perf: number;
let roster: SeatedPlayer[];
let slots: unknown[];
let tiles: Map<string, GridPosition>;
let follows: string[];
let refuse: boolean;
let homing: boolean;
let every: number;
const rosterSubs = new Set<(l: readonly SeatedPlayer[]) => void>();
const slotSubs = new Set<() => void>();
let tileReads = 0;
let dir: DirectorSession;

const flush = (): Promise<void> => new Promise((r) => { queueMicrotask(r); });
const patchSlots = (next: unknown[]): void => { slots = next; for (const cb of slotSubs) cb(); };

function deps(): DirectorDeps {
  return {
    store,
    roster: () => roster,
    onRoster: (cb) => { rosterSubs.add(cb); return () => { rosterSubs.delete(cb); }; },
    slots: () => slots,
    onSlots: (cb) => { slotSubs.add(cb); return () => { slotSubs.delete(cb); }; },
    tileOf: (id) => { tileReads++; const t = tiles.get(id); return t ? { x: t.x, y: t.y } : null; },
    isAbility: (a) => a === 'HungerRestoreII',
    follow: (id) => {
      follows.push(id);
      if (refuse) return false;
      store.patch({ mode: 'follow', targetId: id });
      dir.picked(id);
      return true;
    },
    homing: () => homing,
    settings: () => ({ directorEverySec: every, directorEarly: true }),
    perfNow: () => perf,
    wallNow: () => perf + WALL + skew,
  };
}
let skew = 0;

async function frame(at: number): Promise<void> {
  perf = at;
  dir.frame(at);
  await flush();
}

beforeEach(() => {
  store = createSpectatorStore();
  store.patch({ active: true });
  perf = 100 * S;
  roster = [seat('a', 1), seat('b', 2), seat('c', 3)];
  slots = [slot('me', null), slot('a', null), slot('b', null), slot('c', null)];
  tiles = new Map([['a', { x: 1, y: 1 }], ['b', { x: 5, y: 5 }], ['c', { x: 9, y: 9 }]]);
  follows = [];
  refuse = false;
  homing = false;
  every = 30;
  rosterSubs.clear();
  slotSubs.clear();
  tileReads = 0;
  skew = 0;
  dir = installDirector(deps());
});

describe('installDirector', () => {
  it('costs nothing while off: no subscriptions, no reads per frame', async () => {
    await frame(101 * S);
    expect(rosterSubs.size + slotSubs.size).toBe(0);
    expect(tileReads).toBe(0);
    expect(follows).toEqual([]);
    expect(store.get().director).toBe(false);
  });

  it('on from free cam: follows the most recently active player, timed on the game clock', async () => {
    slots = [slot('a', { action: 'harvest', at: WALL + 95 * S }), slot('b', { action: 'plantSeed', at: WALL + 99 * S }), slot('c', null)];
    dir.set(true);
    expect(store.get().director).toBe(true);
    expect(rosterSubs.size + slotSubs.size).toBe(2);
    await frame(100 * S);
    expect(follows).toEqual(['b']);
    expect(dir.scores().b).toBeCloseTo(2 ** (-0.1), 3);
  });

  it('seeds nothing older than the window', () => {
    slots = [slot('a', { action: 'harvest', at: WALL + 30 * S })];
    dir.set(true);
    expect(dir.scores().a).toBe(0);
  });

  it('counts an action once when the log repeats lastActionEvent, and skips pet ability procs', () => {
    const at = WALL + 99 * S;
    slots = [
      slot('a', { action: 'purchaseEgg', at }, [{ action: 'purchaseEgg', timestamp: at }, { action: 'HungerRestoreII', timestamp: at - 500 }]),
      slot('b', { action: 'purchaseSeed', at }),
    ];
    dir.set(true);
    expect(dir.scores().a).toBeCloseTo(2 ** (-0.1), 3);
    expect(dir.scores().b).toBeCloseTo(2 ** (-0.1), 3);
    // b's log entry for the same event lands in a later patch, a's next action lands only in the log: each counts once,
    // and what arrives after the first sight counts from its arrival.
    patchSlots([
      slot('a', { action: 'purchaseEgg', at }, [{ action: 'purchaseEgg', timestamp: at }, { action: 'harvest', timestamp: at + 200 }]),
      slot('b', { action: 'purchaseSeed', at }, [{ action: 'purchaseSeed', timestamp: at }]),
    ]);
    expect(dir.scores().a).toBeCloseTo(2 ** (-0.1) + 1, 3);
    expect(dir.scores().b).toBeCloseTo(2 ** (-0.1), 3);
  });

  it('a pet ability as lastActionEvent is the pet\'s, not the player\'s', () => {
    slots = [slot('a', { action: 'HungerRestoreII', at: WALL + 99 * S })];
    dir.set(true);
    expect(dir.scores().a).toBe(0);
  });

  it('a client clock ahead of the server changes nothing once the director is on', () => {
    skew = 45 * S;
    dir.set(true);
    patchSlots([slot('a', { action: 'harvest', at: WALL + 100 * S })]);
    expect(dir.scores().a).toBeCloseTo(1, 3);
  });

  it('a player who comes back online is not taken for one who walked', async () => {
    store.patch({ mode: 'follow', targetId: 'c' });
    dir.set(true);
    await frame(100 * S);
    for (const cb of rosterSubs) cb([seat('b', 2), seat('c', 3)]);
    tiles.set('a', { x: 30, y: 30 });
    await frame(101 * S);
    for (const cb of rosterSubs) cb(roster);
    await frame(102 * S);
    expect(dir.scores().a).toBe(0);
  });

  it('a repeated patch never counts an entry twice', () => {
    const logs: Log[] = [{ action: 'harvest', timestamp: WALL + 99 * S }];
    slots = [slot('a', null, logs)];
    dir.set(true);
    const before = dir.scores().a;
    patchSlots([slot('a', null, logs)]);
    patchSlots([slot('a', null, [...logs])]);
    expect(dir.scores().a).toBe(before);
  });

  it('a tile change between frames is movement; a new object with the same tile is not', async () => {
    store.patch({ mode: 'follow', targetId: 'c' });
    dir.set(true);
    await frame(100 * S);
    tiles.set('a', { x: 1, y: 1 });
    await frame(100 * S + 16);
    expect(dir.scores().a).toBe(0);
    tiles.set('a', { x: 2, y: 1 });
    await frame(100 * S + 32);
    expect(dir.scores().a).toBeCloseTo(0.5, 2);
    expect(follows).toEqual([]);
  });

  it('holds while flying home, while the game owns the camera or a game window is open, then picks', async () => {
    slots = [slot('a', { action: 'harvest', at: WALL + 99 * S })];
    dir.set(true);
    homing = true;
    await frame(100 * S);
    homing = false;
    store.patch({ paused: 'cutscene' });
    await frame(101 * S);
    store.patch({ paused: 'ui' });
    await frame(102 * S);
    expect(follows).toEqual([]);
    store.patch({ paused: null });
    await frame(103 * S);
    expect(follows).toEqual(['a']);
  });

  it('a manual pick restarts the dwell; the max dwell then moves on to whoever was watched least', async () => {
    dir.set(true);
    await frame(100 * S);
    expect(follows).toEqual(['a']);
    store.patch({ targetId: 'c' });
    dir.picked('c');
    await frame(129 * S);
    expect(follows).toEqual(['a']);
    await frame(130 * S);
    expect(follows).toEqual(['a', 'b']);
  });

  it('a refused follow backs off instead of retrying every frame', async () => {
    refuse = true;
    dir.set(true);
    for (let t = 100 * S; t < 101 * S; t += 16) await frame(t);
    expect(follows).toEqual(['a']);
    await frame(101 * S);
    expect(follows).toEqual(['a', 'a']);
  });

  it('only online players in seat order are candidates, and the roster updates them', async () => {
    roster = [seat('a', 1, false), seat('b', 2), seat('c', 3)];
    dir.set(true);
    await frame(100 * S);
    expect(follows).toEqual(['b']);
    for (const cb of rosterSubs) cb([seat('c', 3)]);
    await frame(101 * S);
    expect(follows).toEqual(['b', 'c']);
  });

  it('a settings change applies on the next frame', async () => {
    dir.set(true);
    await frame(100 * S);
    every = 10;
    await frame(110 * S);
    expect(follows).toEqual(['a', 'b']);
  });

  it('off unsubscribes and clears the store flag; uninstall is idempotent and leaves the store to exit', async () => {
    dir.set(true);
    dir.set(false);
    expect(store.get().director).toBe(false);
    expect(rosterSubs.size + slotSubs.size).toBe(0);
    await frame(200 * S);
    expect(follows).toEqual([]);
    dir.set(true);
    dir.uninstall();
    dir.uninstall();
    expect(rosterSubs.size + slotSubs.size).toBe(0);
    expect(dir.isOn()).toBe(false);
    dir.set(true);
    expect(rosterSubs.size).toBe(0);
  });

  it('a follow queued in the frame is dropped when the director is turned off before it runs', async () => {
    dir.set(true);
    dir.frame(100 * S);
    dir.set(false);
    await flush();
    expect(follows).toEqual([]);
  });
});
