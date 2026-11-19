import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  held: null as string | null,
  bag: [] as unknown[],
  storages: [] as unknown[],
  limit: 100 as number | null,
  sendOk: true,
  reply: 'ok' as string,
  pending: null as Promise<string> | null,
  saved: new Map<string, unknown>(),
}));
const moves = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const moveTypes = vi.hoisted(() => [] as string[]);
const picks = vi.hoisted(() => [] as Array<{ itemId: string; pickup: boolean }>);
const bagPresses = vi.hoisted(() => [] as string[]);
const toasts = vi.hoisted(() => [] as string[]);

vi.mock('../../../catalogs/logic/bagLimitCatalog', () => ({ getBagLimit: () => state.limit }));
vi.mock('../../../catalogs/shopEligibility', () => ({ getShopFacingCatalogEntry: () => null }));
vi.mock('../../../core/gameState', () => ({
  readSync: (key: string) => (key === 'inventory' ? { items: state.bag, storages: state.storages } : state.held),
}));
vi.mock('../../../i18n', () => ({
  t: (key: string, vars?: Record<string, string>) => `${key.split('.').pop()}:${Object.values(vars ?? {}).join('|')}`,
}));
vi.mock('../../../store/inventory', () => ({ getInventoryItems: () => state.bag.map(raw => ({ raw })) }));
vi.mock('../../../ui/components', () => ({ showToast: (m: string) => { toasts.push(m); } }));
vi.mock('../../../utils/storage', () => ({
  storage: {
    get: (key: string, fallback: unknown) => (state.saved.has(key) ? state.saved.get(key) : fallback),
    set: (key: string, value: unknown) => { state.saved.set(key, value); },
  },
}));
vi.mock('../../../websocket/api', () => ({
  sendRoomAction: (type: string, payload: Record<string, unknown>) => {
    if (!state.sendOk) return { ok: false, reason: 'no_connection' };
    moves.push(payload);
    moveTypes.push(type);
    return { ok: true, awaitResult: async () => ({ ok: true }) };
  },
}));
vi.mock('./run', () => ({
  readReply: async () => state.pending ?? state.reply,
  selectBagItem: (target: { id: string }) => { bagPresses.push(target.id); return { outcome: 'picked', itemId: target.id }; },
  sendSelect: (itemId: string, pickup: boolean) => {
    picks.push({ itemId, pickup });
    return { outcome: pickup ? 'picked' : 'putAway', itemId };
  },
}));

const { getFetchedStorage, pressSelectItem, setFetchFromStorageEnabled } = await import('./fetch');

const LYCHEE = { species: 'Lychee', itemType: 'Seed', quantity: 68 };
const SHARDS = { toolId: 'SnowWardShard', itemType: 'Tool', quantity: 8 };
const charged = (id: string, remainingActiveSeconds: number) =>
  ({ id, toolId: 'SnowWardShard', itemType: 'Tool', quantity: 1, remainingActiveSeconds });
const silo = (items: unknown[]) => ({ decorId: 'SeedSilo', items });
const labels = { item: 'Lychee Seed', storage: (id: string) => (id === 'SeedSilo' ? 'Seed Silo' : id) };
const LYCHEE_KEY = { kind: 'seed', id: 'Lychee' } as const;
const fill = (n: number): unknown[] => Array.from({ length: n }, (_, i) => ({ species: `S${i}`, itemType: 'Seed', quantity: 1 }));

beforeEach(() => {
  Object.assign(state, { held: null, bag: [], storages: [silo([LYCHEE])], limit: 100, sendOk: true, reply: 'ok', pending: null });
  state.saved.clear();
  for (const list of [moves, moveTypes, picks, bagPresses, toasts]) list.length = 0;
});

// Fetches the Lychee stack (remembered from the silo), then holds it, ready for a second press.
async function fetchAndHold(): Promise<void> {
  await pressSelectItem(LYCHEE_KEY, labels);
  state.bag = [LYCHEE];
  state.storages = [silo([])];
  state.held = 'Lychee';
  for (const list of [moves, moveTypes, picks, toasts]) list.length = 0;
}

describe('pressSelectItem (INP-5.2)', () => {
  it('in the bag → the INP-4 path, no move', async () => {
    state.bag = [LYCHEE];
    await pressSelectItem(LYCHEE_KEY, labels);
    expect(bagPresses).toEqual(['Lychee']);
    expect(moves).toEqual([]);
  });

  it('switch off → the INP-4 path (its own not-in-bag toast), no move', async () => {
    setFetchFromStorageEnabled(false);
    await pressSelectItem(LYCHEE_KEY, labels);
    expect(bagPresses).toEqual(['Lychee']);
    expect(moves).toEqual([]);
  });

  it('D1/D4: whole stack from the silo, then picked, and remembered', async () => {
    const result = await pressSelectItem(LYCHEE_KEY, labels);
    expect(moves).toEqual([{ itemId: 'Lychee', storageId: 'SeedSilo' }]);
    expect(picks).toEqual([{ itemId: 'Lychee', pickup: true }]);
    expect(result).toEqual({ outcome: 'picked', itemId: 'Lychee' });
    expect(getFetchedStorage('Lychee')).toBe('SeedSilo');
    expect(toasts).toEqual([]);
  });

  it('nowhere → bag-or-storage toast, nothing sent', async () => {
    state.storages = [silo([])];
    expect((await pressSelectItem(LYCHEE_KEY, labels)).outcome).toBe('missing');
    expect(toasts).toEqual(['notInBagOrStorage:Lychee Seed']);
    expect(moves).toEqual([]);
  });

  it('D5: bag full → toast, nothing sent', async () => {
    state.bag = fill(100);
    expect((await pressSelectItem(LYCHEE_KEY, labels)).outcome).toBe('bagFull');
    expect(toasts).toEqual(['bagFull:Lychee Seed']);
    expect(moves).toEqual([]);
  });

  it('D4: refused move → toast with the storage name, no pick, not remembered', async () => {
    state.reply = 'invalid_item';
    state.storages = [silo([{ species: 'Leek', itemType: 'Seed', quantity: 3 }])];
    expect(await pressSelectItem({ kind: 'seed', id: 'Leek' }, labels)).toMatchObject({ outcome: 'refused', reason: 'invalid_item' });
    expect(toasts).toEqual(['takeRefused:Lychee Seed|Seed Silo']);
    expect(picks).toEqual([]);
    expect(getFetchedStorage('Leek')).toBeNull();
  });

  it('send failure → refused toast', async () => {
    state.sendOk = false;
    expect(await pressSelectItem(LYCHEE_KEY, labels)).toMatchObject({ outcome: 'refused', reason: 'no_connection' });
    expect(toasts).toEqual(['takeRefused:Lychee Seed|Seed Silo']);
  });

  it('unknown outcome: picks when the stack is in the bag by then, else refused', async () => {
    state.reply = 'none';
    state.pending = Promise.resolve().then(() => { state.bag = [LYCHEE]; return 'none'; });
    expect((await pressSelectItem(LYCHEE_KEY, labels)).outcome).toBe('picked');
    state.pending = null;
    state.bag = [];
    expect((await pressSelectItem(LYCHEE_KEY, labels)).outcome).toBe('refused');
  });

  it('D6: a crystal in the bag wins over the shack; else the shack one with the least time', async () => {
    const key = { kind: 'tool', id: 'SnowWardShard' } as const;
    state.storages = [{ decorId: 'ToolShack', items: [SHARDS, charged('s-long', 900), charged('s-short', 60)] }];
    state.bag = [charged('b-1', 3000)];
    await pressSelectItem(key, labels);
    expect(bagPresses).toEqual(['SnowWardShard']);
    expect(moves).toEqual([]);
    state.bag = [];
    await pressSelectItem(key, labels);
    expect(moves).toEqual([{ itemId: 's-short', storageId: 'ToolShack' }]);
    expect(picks).toEqual([{ itemId: 's-short', pickup: true }]);
  });

  it('a newer press while the move waits: the stack arrives, the old press does not pick', async () => {
    let release: (v: string) => void = () => {};
    state.pending = new Promise<string>((resolve) => { release = resolve; });
    const first = pressSelectItem(LYCHEE_KEY, labels);
    state.pending = null;
    state.bag = [{ toolId: 'Shovel', itemType: 'Tool', quantity: 1 }];
    await pressSelectItem({ kind: 'tool', id: 'Shovel' }, labels);
    release('ok');
    expect(await first).toEqual({ outcome: 'superseded', itemId: 'Lychee' });
    expect(picks).toEqual([]);
    expect(getFetchedStorage('Lychee')).toBe('SeedSilo');
  });
});

describe('second press on a fetched stack (INP-5.3)', () => {
  it('D2: puts away, then sends the stack back to its storage and forgets it', async () => {
    await fetchAndHold();
    expect(await pressSelectItem(LYCHEE_KEY, labels)).toEqual({ outcome: 'returned', itemId: 'Lychee' });
    expect(picks).toEqual([{ itemId: 'Lychee', pickup: false }]);
    expect(moveTypes).toEqual(['PutItemInStorage']);
    expect(moves).toEqual([{ itemId: 'Lychee', storageId: 'SeedSilo' }]);
    expect(getFetchedStorage('Lychee')).toBeNull();
    expect(toasts).toEqual([]);
  });

  it('a held stack the key did not fetch is only put away', async () => {
    state.bag = [LYCHEE];
    state.held = 'Lychee';
    await pressSelectItem(LYCHEE_KEY, labels);
    expect(bagPresses).toEqual(['Lychee']);
    expect(moves).toEqual([]);
  });

  it('refused return → toast with the storage name, stack stays remembered', async () => {
    await fetchAndHold();
    state.reply = 'storage_full';
    expect(await pressSelectItem(LYCHEE_KEY, labels)).toMatchObject({ outcome: 'returnRefused', reason: 'storage_full' });
    expect(picks).toEqual([{ itemId: 'Lychee', pickup: false }]);
    expect(toasts).toEqual(['returnRefused:Lychee Seed|Seed Silo']);
    expect(getFetchedStorage('Lychee')).toBe('SeedSilo');
  });

  it('send failure on the return → refused toast; unknown outcome counts once the stack left the bag', async () => {
    await fetchAndHold();
    state.sendOk = false;
    expect(await pressSelectItem(LYCHEE_KEY, labels)).toMatchObject({ outcome: 'returnRefused', reason: 'no_connection' });
    state.sendOk = true;
    state.reply = 'none';
    state.pending = Promise.resolve().then(() => { state.bag = []; return 'none'; });
    expect((await pressSelectItem(LYCHEE_KEY, labels)).outcome).toBe('returned');
  });

  it('unknown outcome with the stack still in the bag → refused, kept', async () => {
    await fetchAndHold();
    state.reply = 'none';
    expect((await pressSelectItem(LYCHEE_KEY, labels)).outcome).toBe('returnRefused');
    expect(getFetchedStorage('Lychee')).toBe('SeedSilo');
  });

  it('holding something else → the fetched stack is picked again, nothing returned', async () => {
    await fetchAndHold();
    state.held = 'Shovel';
    await pressSelectItem(LYCHEE_KEY, labels);
    expect(bagPresses).toEqual(['Lychee']);
    expect(moves).toEqual([]);
    expect(getFetchedStorage('Lychee')).toBe('SeedSilo');
  });

  it('switch off → only put away, the stack stays remembered', async () => {
    await fetchAndHold();
    setFetchFromStorageEnabled(false);
    await pressSelectItem(LYCHEE_KEY, labels);
    expect(bagPresses).toEqual(['Lychee']);
    expect(moves).toEqual([]);
    expect(getFetchedStorage('Lychee')).toBe('SeedSilo');
  });
});
