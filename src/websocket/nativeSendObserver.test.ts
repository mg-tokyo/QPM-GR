import { afterEach, describe, expect, it, vi } from 'vitest';

const { page } = vi.hoisted(() => ({ page: {} as Record<string, unknown> }));

vi.mock('../core/pageContext', () => ({ pageWindow: page }));
vi.mock('../diagnostics/logger', () => ({
  createNamedLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('../diagnostics/gameVersionCapture', () => ({ getCapturedBuildId: () => null }));
vi.mock('../utils/storage', () => ({ storage: { get: <T>(_key: string, fallback: T): T => fallback, set: vi.fn() } }));
vi.mock('./commandSequencer', () => ({ ensureCommandSequencerAttached: vi.fn() }));
vi.mock('./roomConnectionEvents', () => ({
  notifyChainChanged: vi.fn(),
  onRoomConnectionChange: (cb: () => void) => { cb(); return () => { /* no events in tests */ }; },
}));

import { onNativeSend, stopNativeSendObserver, type NativeSendMeta } from './nativeSendObserver';
import { withQpmOrigin } from './transport';

class FakeRoom {
  sent: unknown[] = [];
  sendMessage(message: unknown): void { this.sent.push(message); }
  trySendMessageNow(message: unknown): boolean { this.sent.push(message); return true; }
}

function setup(): FakeRoom {
  const room = new FakeRoom();
  page.MagicCircle_RoomConnection = room;
  return room;
}

const envelope = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  scopePath: ['Room', 'Quinoa'],
  type: 'QuinoaCommand',
  requestId: 'r1',
  commandSequence: 8,
  command: { type: 'PlantSeed', slot: 88, species: 'Delphinium' },
  ...extra,
});

afterEach(() => {
  stopNativeSendObserver();
  delete page.MagicCircle_RoomConnection;
});

describe('onNativeSend meta', () => {
  it('carries the outer fields of an envelope beside the unwrapped command', () => {
    const room = setup();
    const calls: Array<[string, Record<string, unknown>, NativeSendMeta]> = [];
    onNativeSend((type, payload, meta) => { calls.push([type, payload, meta]); });
    const env = envelope({ successorItemId: 'DragonFruit' });
    expect(room.trySendMessageNow(env)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe('PlantSeed');
    expect(calls[0]?.[1]).toBe(env.command);
    expect(calls[0]?.[2]).toEqual({
      outerType: 'QuinoaCommand',
      requestId: 'r1',
      successorItemId: 'DragonFruit',
      scopePath: ['Room', 'Quinoa'],
      qpmOrigin: false,
    });
  });

  it('omits absent fields and reports the flat type as the outer type', () => {
    const room = setup();
    const metas: NativeSendMeta[] = [];
    onNativeSend((_type, _payload, meta) => { metas.push(meta); });
    room.sendMessage({ type: 'PlayerPosition', x: 1 });
    room.trySendMessageNow(envelope());
    expect(metas[0]).toEqual({ outerType: 'PlayerPosition', qpmOrigin: false });
    expect(metas[1]).not.toHaveProperty('successorItemId');
  });

  it('marks sends made inside withQpmOrigin', () => {
    const room = setup();
    const origins: boolean[] = [];
    onNativeSend((_type, _payload, meta) => { origins.push(meta.qpmOrigin); });
    withQpmOrigin(() => room.trySendMessageNow(envelope()));
    room.trySendMessageNow(envelope());
    expect(origins).toEqual([true, false]);
  });

  it('keeps two-argument listeners working', () => {
    const room = setup();
    const types: string[] = [];
    onNativeSend((type, payload) => { if (payload) types.push(type); });
    room.sendMessage({ type: 'Chat', message: 'hi' });
    expect(types).toEqual(['Chat']);
  });
});

describe('onNativeSend does not alter the send', () => {
  it('passes the same object, unchanged, even when a listener edits the meta or throws', () => {
    const room = setup();
    const after = vi.fn();
    onNativeSend((_type, _payload, meta) => {
      meta.scopePath?.push('edited');
      throw new Error('listener');
    });
    onNativeSend(after);
    const env = envelope({ successorItemId: 'DragonFruit' });
    const before = structuredClone(env);
    expect(room.trySendMessageNow(env)).toBe(true);
    expect(room.sent[0]).toBe(env);
    expect(env).toEqual(before);
    expect(after).toHaveBeenCalledTimes(1);
  });

  it('reads nothing from the payload once the last listener is gone', () => {
    const room = setup();
    const unsub = onNativeSend(() => { /* installs the wrapper */ });
    unsub();
    unsub();
    const typeRead = vi.fn(() => 'Chat');
    const payload = Object.defineProperty({}, 'type', { get: typeRead });
    room.sendMessage(payload);
    expect(typeRead).not.toHaveBeenCalled();
    expect(room.sent[0]).toBe(payload);
  });
});
