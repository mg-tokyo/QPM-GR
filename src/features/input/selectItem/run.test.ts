import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  held: null as string | null,
  playerId: 'p1' as string | null,
  bag: [] as unknown[],
  hasSfx: true,
  writeFails: false,
  sendOk: true,
  listeners: new Set<(v: string | null) => void>(),
}));
const sent = vi.hoisted(() => [] as Array<{ type: string; payload: Record<string, unknown> }>);
const writes = vi.hoisted(() => [] as unknown[]);
const sounds = vi.hoisted(() => [] as string[]);
const warns = vi.hoisted(() => [] as Array<{ code: string; ctx: unknown }>);
const toasts = vi.hoisted(() => [] as string[]);

vi.mock('../../../audio', () => ({
  isAudioReady: () => true,
  hasSfx: () => state.hasSfx,
  playSfx: (name: string) => { sounds.push(name); },
}));
vi.mock('../../../core/gameState', () => ({
  readSync: (key: string) => (key === 'playerId' ? state.playerId : state.held),
  write: async (_key: string, value: unknown) => {
    if (state.writeFails) throw new Error('unbound');
    writes.push(value);
  },
  subscribe: (_key: string, cb: (v: string | null) => void) => {
    state.listeners.add(cb);
    return () => { state.listeners.delete(cb); };
  },
}));
vi.mock('../../../diagnostics/featureDiagnostics', () => ({
  createFeatureDiagnostics: () => ({ warnFeature: (code: string, ctx: unknown) => { warns.push({ code, ctx }); } }),
}));
vi.mock('../../../i18n', () => ({ t: (_k: string, vars?: { item?: string }) => `No ${vars?.item} in your bag.` }));
vi.mock('../../../store/inventory', () => ({ getInventoryItems: () => state.bag.map(raw => ({ raw })) }));
vi.mock('../../../ui/components', () => ({ showToast: (m: string) => { toasts.push(m); } }));
vi.mock('../../../websocket/api', () => ({
  sendRoomAction: (type: string, payload: Record<string, unknown>) => {
    if (!state.sendOk) return { ok: false, reason: 'no_connection' };
    sent.push({ type, payload });
    return { ok: true, transport: 'envelope', awaitResult: async () => ({ ok: true }) };
  },
}));

const { selectBagItem } = await import('./run');

const SHOVEL = { toolId: 'Shovel', itemType: 'Tool', quantity: 1 };
const flush = async (): Promise<void> => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); };
const setHeld = (v: string | null): void => { state.held = v; for (const cb of [...state.listeners]) cb(v); };

beforeEach(() => {
  Object.assign(state, { held: null, playerId: 'p1', bag: [SHOVEL], hasSfx: true, writeFails: false, sendOk: true });
  state.listeners.clear();
  for (const list of [sent, writes, sounds, warns, toasts]) list.length = 0;
});

describe('selectBagItem', () => {
  it('pick: hold message, then pick up, then the game animation + sound', async () => {
    expect(selectBagItem({ kind: 'tool', id: 'Shovel' })).toEqual({ outcome: 'picked', itemId: 'Shovel' });
    expect(sent.map(s => s.type)).toEqual(['SetSelectedItem', 'PickupObject']);
    expect(sent[0]?.payload).toEqual({ itemId: 'Shovel', decorRotation: 0 });
    await flush();
    expect(writes).toEqual([{ playerId: 'p1', animation: 'pickupObject', skipSfx: true }]);
    expect(sounds).toEqual(['Object_PickUp']);
  });

  it('D4: second press while held puts it away', async () => {
    state.held = 'Shovel';
    expect(selectBagItem({ kind: 'tool', id: 'Shovel' }).outcome).toBe('putAway');
    expect(sent.map(s => s.type)).toEqual(['SetSelectedItem', 'DropObject']);
    expect(sent[0]?.payload).toEqual({ itemId: null, decorRotation: 0 });
    await flush();
    expect(sounds).toEqual(['Object_Drop']);
  });

  it('D5: not in the bag → toast, nothing sent', () => {
    state.bag = [];
    expect(selectBagItem({ kind: 'tool', id: 'Shovel' }, 'Shovel').outcome).toBe('missing');
    expect(sent).toEqual([]);
    expect(toasts).toEqual(['No Shovel in your bag.']);
  });

  it('send failure → no pick up, no cosmetics', async () => {
    state.sendOk = false;
    expect(selectBagItem({ kind: 'tool', id: 'Shovel' })).toMatchObject({ outcome: 'failed', reason: 'no_connection' });
    await flush();
    expect(writes).toEqual([]);
    expect(sounds).toEqual([]);
  });

  it('missing animation + sound → hand still changes, codes raised once each', async () => {
    state.writeFails = true;
    state.hasSfx = false;
    selectBagItem({ kind: 'tool', id: 'Shovel' });
    setHeld('Shovel');
    selectBagItem({ kind: 'tool', id: 'Shovel' });
    await flush();
    // literal-list-justified: wire message types the game sends for a pick then a put-away (spec F20, F22)
    expect(sent.map(s => s.type)).toEqual(['SetSelectedItem', 'PickupObject', 'SetSelectedItem', 'DropObject']);
    const codes = warns.map(w => w.code);
    expect(codes.filter(c => c === 'QPM-SELECTITEM-001')).toHaveLength(1);
    expect(codes.filter(c => c === 'QPM-SELECTITEM-002')).toHaveLength(2); // pick-up and drop sounds
  });

  it('hand check: no code when the hand follows the server', async () => {
    selectBagItem({ kind: 'tool', id: 'Shovel' });
    await flush();
    setHeld('Shovel');
    await flush();
    expect(warns).toEqual([]);
  });

  it('hand check: code 003 when the hand never changes', async () => {
    vi.useFakeTimers();
    try {
      selectBagItem({ kind: 'tool', id: 'Shovel' });
      await vi.advanceTimersByTimeAsync(3500);
      expect(warns.map(w => w.code)).toEqual(['QPM-SELECTITEM-003']);
      expect(warns[0]?.ctx).toMatchObject({ expected: 'Shovel', held: null, reply: 'ok' });
    } finally {
      vi.useRealTimers();
    }
  });
});
