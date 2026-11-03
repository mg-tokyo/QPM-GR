import { beforeEach, describe, expect, it, vi } from 'vitest';

const { roomRef } = vi.hoisted(() => ({ roomRef: { current: null as unknown } }));

vi.mock('./api', () => ({ getRoomConnection: () => roomRef.current }));
vi.mock('../diagnostics/logger', () => ({
  createNamedLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import {
  addSendGuard,
  getSendGuardStats,
  installSendGuard,
  isSendGuardActive,
  reinstallSendGuard,
  removeSendGuard,
  removeSendGuardByName,
  type GuardPredicate,
} from './sendGuard';
import { withQpmOrigin } from './transport';

type Conn = {
  sendMessage: (p: unknown) => void;
  trySendMessageNow: (p: unknown) => boolean;
  sent: unknown[];
};

function fakeConnection(): { conn: Conn; send: Conn['sendMessage']; trySend: Conn['trySendMessageNow'] } {
  const sent: unknown[] = [];
  const send = (p: unknown): void => { sent.push(p); };
  const trySend = (p: unknown): boolean => { sent.push(p); return true; };
  return { conn: { sendMessage: send, trySendMessageNow: trySend, sent }, send, trySend };
}

const refuse = (blocked: string): GuardPredicate => (type) =>
  (type === blocked ? { allow: false, reason: `no-${blocked}` } : { allow: true });

let env: ReturnType<typeof fakeConnection>;

beforeEach(() => {
  removeSendGuardByName('a');
  removeSendGuardByName('b');
  removeSendGuard();
  env = fakeConnection();
  roomRef.current = env.conn;
});

describe('sendGuard registry', () => {
  it('two guards: either refusing drops the send', () => {
    expect(addSendGuard('a', refuse('SellPet'))).toBe(true);
    expect(addSendGuard('b', refuse('PlantSeed'))).toBe(true);
    env.conn.sendMessage({ type: 'SellPet' });
    env.conn.sendMessage({ type: 'PlantSeed' });
    env.conn.sendMessage({ type: 'PlayerPosition' });
    expect(env.conn.sent).toEqual([{ type: 'PlayerPosition' }]);
  });

  it('trySendMessageNow returns false on refusal', () => {
    addSendGuard('a', refuse('SellPet'));
    expect(env.conn.trySendMessageNow({ type: 'SellPet' })).toBe(false);
    expect(env.conn.trySendMessageNow({ type: 'PlayerPosition' })).toBe(true);
    expect(env.conn.sent).toEqual([{ type: 'PlayerPosition' }]);
  });

  it('judges the unwrapped envelope', () => {
    const predicate = vi.fn(refuse('SellPet'));
    const onBlocked = vi.fn();
    addSendGuard('a', predicate, onBlocked);
    const envelope = { type: 'QuinoaCommand', command: { type: 'SellPet', itemId: 'p1' } };
    expect(env.conn.trySendMessageNow(envelope)).toBe(false);
    expect(predicate).toHaveBeenCalledWith('SellPet', { type: 'SellPet', itemId: 'p1' }, 'native');
    expect(onBlocked).toHaveBeenCalledWith('SellPet', { type: 'SellPet', itemId: 'p1' }, 'no-SellPet');
    expect(env.conn.sent).toEqual([]);
  });

  it('origin is qpm inside withQpmOrigin', () => {
    const origins: string[] = [];
    addSendGuard('a', (_t, _p, origin) => { origins.push(origin); return { allow: true }; });
    withQpmOrigin(() => env.conn.sendMessage({ type: 'PlayerPosition' }));
    env.conn.sendMessage({ type: 'PlayerPosition' });
    expect(origins).toEqual(['qpm', 'native']);
  });

  it('a throwing predicate refuses (fail closed)', () => {
    addSendGuard('a', () => { throw new Error('boom'); });
    expect(env.conn.trySendMessageNow({ type: 'PlayerPosition' })).toBe(false);
    expect(env.conn.sent).toEqual([]);
  });

  it('battleship adapter unchanged', () => {
    const cb = vi.fn();
    expect(installSendGuard(new Set(['HarvestCrop']), cb)).toBe(true);
    env.conn.trySendMessageNow({ type: 'QuinoaCommand', command: { type: 'HarvestCrop', slot: 1 } });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0]?.[0]).toBe('HarvestCrop');
    expect(getSendGuardStats()).toEqual({ active: true, blockedCount: 1 });
    expect(isSendGuardActive()).toBe(true);
    removeSendGuard();
    expect(env.conn.sendMessage).toBe(env.send);
    expect(env.conn.trySendMessageNow).toBe(env.trySend);
    expect(getSendGuardStats()).toEqual({ active: false, blockedCount: 0 });
    expect(isSendGuardActive()).toBe(false);
  });

  it('battleship blockedCount ignores other guards\' refusals', () => {
    installSendGuard(new Set(['HarvestCrop']), () => undefined);
    addSendGuard('a', refuse('SellPet'));
    env.conn.sendMessage({ type: 'SellPet' });
    expect(getSendGuardStats()).toEqual({ active: true, blockedCount: 0 });
  });

  it('removing the last guard restores slots by identity; removing one of two keeps the wrap', () => {
    addSendGuard('a', refuse('SellPet'));
    addSendGuard('b', refuse('PlantSeed'));
    const wrapped = env.conn.sendMessage;
    expect(wrapped).not.toBe(env.send);
    removeSendGuardByName('a');
    expect(env.conn.sendMessage).toBe(wrapped);
    env.conn.sendMessage({ type: 'SellPet' });
    env.conn.sendMessage({ type: 'PlantSeed' });
    expect(env.conn.sent).toEqual([{ type: 'SellPet' }]);
    removeSendGuardByName('b');
    expect(env.conn.sendMessage).toBe(env.send);
    expect(env.conn.trySendMessageNow).toBe(env.trySend);
  });

  it('connection swap: registry survives and reinstallSendGuard wraps the new connection', () => {
    addSendGuard('a', refuse('SellPet'));
    const next = fakeConnection();
    roomRef.current = next.conn;
    expect(isSendGuardActive()).toBe(false);
    expect(reinstallSendGuard()).toBe(true);
    expect(isSendGuardActive()).toBe(true);
    next.conn.sendMessage({ type: 'SellPet' });
    expect(next.conn.sent).toEqual([]);
    expect(env.conn.sendMessage).toBe(env.send);
  });

  it('reinstallSendGuard is false with an empty registry', () => {
    expect(reinstallSendGuard()).toBe(false);
    expect(env.conn.sendMessage).toBe(env.send);
  });

  it('addSendGuard returns false without a connection', () => {
    roomRef.current = null;
    expect(addSendGuard('a', refuse('SellPet'))).toBe(false);
  });
});
