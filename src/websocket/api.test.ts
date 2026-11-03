import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));

vi.mock('../diagnostics/logger', () => ({
  createNamedLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() }),
}));
vi.mock('./commandSequencer', () => ({
  isCommandSequencerActive: () => true,
  isEnvelopeEnabled: () => true,
  trackCommandRequest: () => new Promise(() => undefined),
  cancelCommandRequest: () => undefined,
}));

import { sendRoomAction } from './api';
import { addSendGuard, removeSendGuardByName } from './sendGuard';

type FakeRoom = {
  isCommandSessionReady: boolean;
  open: boolean;
  sent: unknown[];
  sendMessage: (p: unknown) => void;
  trySendMessageNow: (p: unknown) => boolean;
};

const host = globalThis as unknown as { MagicCircle_RoomConnection?: FakeRoom };
const greet = { position: { x: 1, y: 1 } };
const purchase = { shop: 'seed', viewMode: 'list', item: { itemType: 'Seed', species: 'X' }, quantity: 1 };
let room: FakeRoom;

function fakeRoom(): FakeRoom {
  const r: FakeRoom = {
    isCommandSessionReady: true,
    open: true,
    sent: [],
    sendMessage: (p) => { if (r.open) r.sent.push(p); },
    trySendMessageNow: (p) => { if (!r.open) return false; r.sent.push(p); return true; },
  };
  return r;
}

const ws001Calls = (): unknown[][] => warn.mock.calls.filter((c) => c[0] === 'QPM-WS-001');

beforeEach(() => {
  warn.mockClear();
  room = fakeRoom();
  host.MagicCircle_RoomConnection = room;
});

afterEach(() => {
  removeSendGuardByName('test');
  delete host.MagicCircle_RoomConnection;
});

describe('sendRoomAction with a send guard installed', () => {
  it('a guard refusal of an envelope send is not reported as a lost connection (QPM-WS-001)', () => {
    addSendGuard('test', (type) => (type === 'PurchaseShopItem' ? { allow: false, reason: 'not-allowlisted' } : { allow: true }));
    const result = sendRoomAction('PurchaseShopItem', purchase, { skipThrottle: true });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('guard_blocked');
    expect(ws001Calls()).toEqual([]);
    expect(room.sent).toEqual([]);
  });

  it('a guard refusal of a legacy send is not reported as sent', () => {
    addSendGuard('test', (type) => (type === 'RequestPetGreet' ? { allow: false, reason: 'test' } : { allow: true }));
    const result = sendRoomAction('RequestPetGreet', greet, { skipThrottle: true });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('guard_blocked');
    expect(room.sent).toEqual([]);
  });

  it('a send the guard allows on a closed socket is still no_connection', () => {
    addSendGuard('test', () => ({ allow: true }));
    room.open = false;
    const result = sendRoomAction('PurchaseShopItem', purchase, { skipThrottle: true });
    expect(result).toEqual({ ok: false, reason: 'no_connection' });
    expect(ws001Calls()).toEqual([['QPM-WS-001', { type: 'PurchaseShopItem', reason: 'no_connection' }]]);
  });

  it('a refusal does not leak into the next allowed send', () => {
    addSendGuard('test', (type) => (type === 'PurchaseShopItem' ? { allow: false, reason: 'x' } : { allow: true }));
    sendRoomAction('PurchaseShopItem', purchase, { skipThrottle: true });
    const next = sendRoomAction('RequestPetGreet', greet, { skipThrottle: true });
    expect(next).toEqual({ ok: true, transport: 'legacy' });
  });
});
