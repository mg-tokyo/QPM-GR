import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeRoom {
  sendMessage?: unknown;
  trySendMessageNow?: unknown;
  currentWebSocket?: unknown;
}

class FakeRoomProto {
  sendMessage(_p: unknown): void { /* prototype method */ }
}

let fakeWindow: Record<string, unknown>;
let mockStorage: Record<string, boolean>;

vi.mock('../core/pageContext', () => ({
  get pageWindow() { return fakeWindow; },
  exportToPage: <F,>(fn: F): F => fn,
}));

vi.mock('../utils/storage', () => ({
  storage: {
    get: <T,>(key: string, fallback: T): T => (mockStorage[key] as unknown as T) ?? fallback,
  },
}));

const { criticalIntervalSpy } = vi.hoisted(() => ({
  criticalIntervalSpy: vi.fn((_id: string, _cb: () => void, _ms: number) => () => { /* noop */ }),
}));

vi.mock('../utils/scheduling/timerManager', () => ({
  criticalInterval: criticalIntervalSpy,
}));

async function loadModule(): Promise<typeof import('./roomConnectionEvents')> {
  return await import('./roomConnectionEvents');
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  fakeWindow = {};
  mockStorage = {};
  criticalIntervalSpy.mockClear();
  vi.resetModules();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('roomConnectionEvents', () => {
  it('fires initial synchronously', async () => {
    const mod = await loadModule();
    const calls: Array<{ room: unknown; reason: string }> = [];
    mod.onRoomConnectionChange((room, reason) => { calls.push({ room, reason }); });
    expect(calls).toEqual([{ room: null, reason: 'initial' }]);
  });

  it('assigning the room key fires room', async () => {
    const mod = await loadModule();
    const calls: Array<{ reason: string; room: unknown }> = [];
    mod.onRoomConnectionChange((room, reason) => { calls.push({ reason, room }); });
    fakeWindow.MagicCircle_RoomConnection = { sendMessage() {} };
    await flushMicrotasks();
    const roomCalls = calls.filter((c) => c.reason === 'room');
    expect(roomCalls).toHaveLength(1);
    expect(roomCalls[0]?.room).toBe(fakeWindow.MagicCircle_RoomConnection);
  });

  it('assigning currentWebSocket fires socket', async () => {
    const room: FakeRoom = { sendMessage() {} };
    fakeWindow.MagicCircle_RoomConnection = room;
    const mod = await loadModule();
    const reasons: string[] = [];
    mod.onRoomConnectionChange((_, reason) => { reasons.push(reason); });
    reasons.length = 0;
    room.currentWebSocket = { _fake: 'ws' };
    await flushMicrotasks();
    expect(reasons).toContain('socket');
  });

  it('assigning sendMessage twice in one tick coalesces to one slot event', async () => {
    const room: FakeRoom = Object.create(new FakeRoomProto()) as FakeRoom;
    fakeWindow.MagicCircle_RoomConnection = room;
    const mod = await loadModule();
    const reasons: string[] = [];
    mod.onRoomConnectionChange((_, reason) => { reasons.push(reason); });
    reasons.length = 0;
    room.sendMessage = () => 'a';
    room.sendMessage = () => 'b';
    await flushMicrotasks();
    const slotCount = reasons.filter((r) => r === 'slot').length;
    expect(slotCount).toBe(1);
  });

  it('slot getter returns the prototype method when the backing slot is empty', async () => {
    const room: FakeRoom = Object.create(new FakeRoomProto()) as FakeRoom;
    fakeWindow.MagicCircle_RoomConnection = room;
    const mod = await loadModule();
    mod.onRoomConnectionChange(() => { /* subscribe installs traps */ });
    expect(typeof room.sendMessage).toBe('function');
    expect(room.sendMessage).toBe(FakeRoomProto.prototype.sendMessage);
  });

  it('slot getter returns the installed value once assigned', async () => {
    const room: FakeRoom = Object.create(new FakeRoomProto()) as FakeRoom;
    fakeWindow.MagicCircle_RoomConnection = room;
    const mod = await loadModule();
    mod.onRoomConnectionChange(() => { /* installs traps */ });
    const wrapper = (): void => { /* wrapper */ };
    room.sendMessage = wrapper;
    expect(room.sendMessage).toBe(wrapper);
  });

  it('trapField leaves an existing accessor alone', async () => {
    const room: FakeRoom = {};
    let backing: unknown;
    Object.defineProperty(room, 'sendMessage', {
      configurable: true,
      get() { return backing; },
      set(v: unknown) { backing = v; },
    });
    fakeWindow.MagicCircle_RoomConnection = room;
    const mod = await loadModule();
    mod.onRoomConnectionChange(() => { /* installs traps */ });
    const reasons: string[] = [];
    mod.onRoomConnectionChange((_, reason) => { reasons.push(reason); });
    reasons.length = 0;
    room.sendMessage = () => 'x';
    await flushMicrotasks();
    expect(reasons).not.toContain('slot');
    expect(backing).toBeInstanceOf(Function);
    expect(mod.isChainTrapInstalled().slots).toBe(false);
  });

  it('isChainTrapInstalled reports what actually installed', async () => {
    const mod = await loadModule();
    mod.onRoomConnectionChange(() => { /* installs window trap on empty win */ });
    const room: FakeRoom = Object.create(new FakeRoomProto()) as FakeRoom;
    fakeWindow.MagicCircle_RoomConnection = room;
    await flushMicrotasks();
    const state = mod.isChainTrapInstalled();
    expect(state.room).toBe(true);
    expect(state.socket).toBe(true);
    expect(state.slots).toBe(true);
    expect(state.safety).toBe(false);
  });

  it('notifyChainChanged fires qpm-wrap', async () => {
    const mod = await loadModule();
    const reasons: string[] = [];
    mod.onRoomConnectionChange((_, reason) => { reasons.push(reason); });
    reasons.length = 0;
    mod.notifyChainChanged();
    await flushMicrotasks();
    expect(reasons).toEqual(['qpm-wrap']);
  });

  it('(f) window key pre-defined non-configurable → trapField fails → safety poll starts even with flag off', async () => {
    Object.defineProperty(fakeWindow, 'MagicCircle_RoomConnection', {
      configurable: false,
      writable: true,
      value: null,
    });
    mockStorage['qpm.ws.chainSafetyPoll.enabled'] = false;
    const mod = await loadModule();
    mod.onRoomConnectionChange(() => { /* triggers trapWindow → trapFailed */ });
    expect(criticalIntervalSpy).toHaveBeenCalledTimes(1);
    expect(criticalIntervalSpy.mock.calls[0]?.[0]).toBe('qpm-chain-safety');
    expect(mod.isChainTrapInstalled().safety).toBe(true);
  });

  it('(g) delete a trapped slot; next onRoomConnectionChange re-traps and assignment fires slot', async () => {
    const room: FakeRoom = Object.create(new FakeRoomProto()) as FakeRoom;
    fakeWindow.MagicCircle_RoomConnection = room;
    const mod = await loadModule();
    mod.onRoomConnectionChange(() => { /* installs initial traps */ });
    expect(mod.isChainTrapInstalled().slots).toBe(true);

    // Foreign restore: delete the accessor. Bookkeeping still thinks it is trapped.
    Reflect.deleteProperty(room as object, 'sendMessage');
    expect(mod.isChainTrapInstalled().slots).toBe(false);

    const reasons: string[] = [];
    mod.onRoomConnectionChange((_, reason) => { reasons.push(reason); });
    reasons.length = 0;
    expect(mod.isChainTrapInstalled().slots).toBe(true);

    room.sendMessage = () => 'x';
    await flushMicrotasks();
    expect(reasons).toContain('slot');
  });

  it('(h) all traps install cleanly with flag off → criticalInterval is never called', async () => {
    const room: FakeRoom = Object.create(new FakeRoomProto()) as FakeRoom;
    fakeWindow.MagicCircle_RoomConnection = room;
    mockStorage['qpm.ws.chainSafetyPoll.enabled'] = false;
    const mod = await loadModule();
    mod.onRoomConnectionChange(() => { /* installs traps */ });
    expect(mod.isChainTrapInstalled().socket).toBe(true);
    expect(mod.isChainTrapInstalled().slots).toBe(true);
    expect(criticalIntervalSpy).not.toHaveBeenCalled();
    expect(mod.isChainTrapInstalled().safety).toBe(false);
  });

  it('(i) a trap event after the last listener left does not re-arm the safety timer', async () => {
    const room: FakeRoom = Object.create(new FakeRoomProto()) as FakeRoom;
    fakeWindow.MagicCircle_RoomConnection = room;
    mockStorage['qpm.ws.chainSafetyPoll.enabled'] = true;
    const mod = await loadModule();
    const off = mod.onRoomConnectionChange(() => { /* installs traps + safety */ });
    expect(criticalIntervalSpy).toHaveBeenCalledTimes(1);
    off();
    expect(mod.isChainTrapInstalled().safety).toBe(false);
    room.currentWebSocket = { _fake: 'ws2' };
    await flushMicrotasks();
    expect(criticalIntervalSpy).toHaveBeenCalledTimes(1);
    expect(mod.isChainTrapInstalled().safety).toBe(false);
  });

  it('(j) slot accessors are non-enumerable like the prototype methods they shadow', async () => {
    const room: FakeRoom = Object.create(new FakeRoomProto()) as FakeRoom;
    fakeWindow.MagicCircle_RoomConnection = room;
    const mod = await loadModule();
    mod.onRoomConnectionChange(() => { /* installs traps */ });
    expect(Object.keys(room)).toEqual([]);
  });

  describe('socket liveness', () => {
    class FakeSocket {
      private handlers = new Map<string, Array<() => void>>();
      addEventListener(type: string, cb: () => void): void {
        const list = this.handlers.get(type) ?? [];
        list.push(cb);
        this.handlers.set(type, list);
      }
      close(): void { for (const cb of this.handlers.get('close') ?? []) cb(); }
    }

    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('(k) close followed by a socket event keeps the traps and never starts safety', async () => {
      const room: FakeRoom = Object.create(new FakeRoomProto()) as FakeRoom;
      const ws1 = new FakeSocket();
      room.currentWebSocket = ws1;
      fakeWindow.MagicCircle_RoomConnection = room;
      const mod = await loadModule();
      mod.onRoomConnectionChange(() => { /* traps + watches ws1 */ });
      ws1.close();
      room.currentWebSocket = new FakeSocket();
      await flushMicrotasks();
      await vi.advanceTimersByTimeAsync(31_000);
      expect(mod.isChainTrapInstalled().socket).toBe(true);
      expect(criticalIntervalSpy).not.toHaveBeenCalled();
    });

    it('(l) close with no socket event within 30 s → traps removed, safety armed, one safety emit', async () => {
      const room: FakeRoom = Object.create(new FakeRoomProto()) as FakeRoom;
      const ws1 = new FakeSocket();
      room.currentWebSocket = ws1;
      fakeWindow.MagicCircle_RoomConnection = room;
      const mod = await loadModule();
      const reasons: string[] = [];
      mod.onRoomConnectionChange((_, reason) => { reasons.push(reason); });
      reasons.length = 0;
      ws1.close();
      await vi.advanceTimersByTimeAsync(31_000);
      await flushMicrotasks();
      expect(criticalIntervalSpy).toHaveBeenCalledTimes(1);
      expect(mod.isChainTrapInstalled()).toMatchObject({ socket: false, slots: false, safety: true });
      expect(reasons).toEqual(['safety']);
      // Reads reach the real property again and the accessor is not reinstalled.
      expect(Object.getOwnPropertyDescriptor(room, 'currentWebSocket')?.get).toBeUndefined();
      mod.notifyChainChanged();
      await flushMicrotasks();
      expect(Object.getOwnPropertyDescriptor(room, 'currentWebSocket')?.get).toBeUndefined();
    });
  });
});

describe('classifySendSlot verdicts are identical with and without the trap', () => {
  it('clean verdict on empty slot with trap installed', async () => {
    const { classifySendSlot } = await import('./sendChain');
    const roomBare: FakeRoom = Object.create(new FakeRoomProto()) as FakeRoom;
    expect(classifySendSlot(roomBare as object, 'sendMessage')).toBe('clean');

    const roomTrapped: FakeRoom = Object.create(new FakeRoomProto()) as FakeRoom;
    fakeWindow.MagicCircle_RoomConnection = roomTrapped;
    const mod = await loadModule();
    mod.onRoomConnectionChange(() => { /* installs trap */ });
    expect(classifySendSlot(roomTrapped as object, 'sendMessage')).toBe('clean');
  });

  it('qpm verdict when a branded wrapper is installed under the trap', async () => {
    const { brandWrapper, classifySendSlot } = await import('./sendChain');
    const roomBare: FakeRoom = Object.create(new FakeRoomProto()) as FakeRoom;
    roomBare.sendMessage = brandWrapper(() => 1, 'commandSequencer');
    expect(classifySendSlot(roomBare as object, 'sendMessage')).toBe('qpm');

    const roomTrapped: FakeRoom = Object.create(new FakeRoomProto()) as FakeRoom;
    fakeWindow.MagicCircle_RoomConnection = roomTrapped;
    const mod = await loadModule();
    mod.onRoomConnectionChange(() => { /* installs trap */ });
    roomTrapped.sendMessage = brandWrapper(() => 1, 'commandSequencer');
    expect(classifySendSlot(roomTrapped as object, 'sendMessage')).toBe('qpm');
  });

  it('foreign verdict when an unbranded wrapper is installed under the trap', async () => {
    const { classifySendSlot } = await import('./sendChain');
    const roomBare: FakeRoom = Object.create(new FakeRoomProto()) as FakeRoom;
    roomBare.sendMessage = () => 1;
    expect(classifySendSlot(roomBare as object, 'sendMessage')).toBe('foreign');

    const roomTrapped: FakeRoom = Object.create(new FakeRoomProto()) as FakeRoom;
    fakeWindow.MagicCircle_RoomConnection = roomTrapped;
    const mod = await loadModule();
    mod.onRoomConnectionChange(() => { /* installs trap */ });
    roomTrapped.sendMessage = () => 1;
    expect(classifySendSlot(roomTrapped as object, 'sendMessage')).toBe('foreign');
  });

  it('captureSendSlot + restoreSendSlot round-trips through the trap', async () => {
    const { captureSendSlot, classifySendSlot, restoreSendSlot } = await import('./sendChain');
    const room: FakeRoom = Object.create(new FakeRoomProto()) as FakeRoom;
    fakeWindow.MagicCircle_RoomConnection = room;
    const mod = await loadModule();
    mod.onRoomConnectionChange(() => { /* installs trap */ });

    const captured = captureSendSlot(room as object, 'sendMessage');
    expect(captured).not.toBeNull();
    const wrapper = (): void => { /* wrapper */ };
    room.sendMessage = wrapper;
    expect(restoreSendSlot(room as object, 'sendMessage', captured!, wrapper)).toBe(true);
    expect(classifySendSlot(room as object, 'sendMessage')).toBe('clean');
  });
});
