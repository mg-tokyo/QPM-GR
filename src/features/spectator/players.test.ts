import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ mem: new Map<string, unknown>(), subs: new Map<string, Set<(v: unknown) => void>>() }));
vi.mock('../../core/gameState', () => ({
  readSync: (k: string) => (h.mem.has(k) ? h.mem.get(k) : null),
  subscribe: (k: string, cb: (v: unknown) => void) => {
    const set = h.subs.get(k) ?? new Set();
    h.subs.set(k, set);
    set.add(cb);
    return () => { set.delete(cb); };
  },
}));

import { listSeatedPlayers, nextFollowId, onPlayersChange, seatedPlayersFrom } from './players';

const slot = (userId: string, last: unknown = null) => ({ userId, lastActionEvent: last, data: {} });
const player = (id: string, name: string, isConnected = true, color = 'Black') =>
  ({ id, name, isConnected, cosmetic: { color }, discordAvatarUrl: `https://cdn/${id}.png` });
const emit = (k: string): void => { for (const cb of [...(h.subs.get(k) ?? [])]) cb(h.mem.get(k)); };
const subCount = (): number => [...h.subs.values()].reduce((n, s) => n + s.size, 0);

beforeEach(() => {
  h.mem.clear();
  h.subs.clear();
  h.mem.set('playerId', 'me');
  h.mem.set('userSlots', [slot('me'), slot('b', { action: 'harvest', performedAt: 5 }), null, slot('c'), null, null]);
  h.mem.set('players', [player('me', 'Me'), player('c', 'Cee', false, 'Red'), player('b', 'Bee')]);
});

describe('seatedPlayersFrom', () => {
  it('lists the other seated players in seat order, seat = slot index + 1', () => {
    expect(seatedPlayersFrom(h.mem.get('userSlots') as unknown[], h.mem.get('players') as never, 'me')).toEqual([
      { id: 'b', name: 'Bee', seat: 2, online: true, colour: 'Black', discordAvatarUrl: 'https://cdn/b.png', lastAction: { action: 'harvest', at: 5 } },
      { id: 'c', name: 'Cee', seat: 4, online: false, colour: 'Red', discordAvatarUrl: 'https://cdn/c.png', lastAction: null },
    ]);
  });

  it('a seat whose player record is gone is offline and named by its id; junk is skipped', () => {
    const list = seatedPlayersFrom([slot('x'), { userId: '' }, 7, slot('me')], [], 'me');
    expect(list).toEqual([{ id: 'x', name: 'x', seat: 1, online: false, colour: null, discordAvatarUrl: null, lastAction: null }]);
    expect(seatedPlayersFrom(null, null, null)).toEqual([]);
  });

  it('listSeatedPlayers reads the game state', () => {
    expect(listSeatedPlayers().map((p) => p.id)).toEqual(['b', 'c']);
  });
});

describe('nextFollowId ([ and ])', () => {
  const list = [{ id: 'b' }, { id: 'c' }, { id: 'd' }];

  it('steps through seats and wraps both ways', () => {
    expect(nextFollowId(list, 'b', 1)).toBe('c');
    expect(nextFollowId(list, 'd', 1)).toBe('b');
    expect(nextFollowId(list, 'b', -1)).toBe('d');
  });

  it('from free cam (or a player who left) ] starts at the first seat and [ at the last; nobody is null', () => {
    expect(nextFollowId(list, null, 1)).toBe('b');
    expect(nextFollowId(list, 'gone', -1)).toBe('d');
    expect(nextFollowId([], null, 1)).toBeNull();
  });
});

describe('onPlayersChange', () => {
  it('subscribes only while someone listens and reports only real changes', () => {
    expect(subCount()).toBe(0);
    const seen: string[][] = [];
    const off = onPlayersChange((l) => { seen.push(l.map((p) => `${p.id}:${p.online}`)); });
    expect(subCount()).toBe(3);
    emit('userSlots');
    expect(seen).toEqual([]);
    h.mem.set('players', [player('me', 'Me'), player('c', 'Cee', true), player('b', 'Bee')]);
    emit('players');
    expect(seen).toEqual([['b:true', 'c:true']]);
    h.mem.set('userSlots', [slot('me'), null, null, slot('c'), null, null]);
    emit('userSlots');
    expect(seen[1]).toEqual(['c:true']);
    off();
    off();
    expect(subCount()).toBe(0);
  });

  it('a throwing listener does not stop the others', () => {
    const got: number[] = [];
    const a = onPlayersChange(() => { throw new Error('x'); });
    const b = onPlayersChange((l) => { got.push(l.length); });
    h.mem.set('userSlots', [slot('me')]);
    emit('userSlots');
    expect(got).toEqual([0]);
    a();
    b();
  });
});
