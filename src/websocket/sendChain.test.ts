import { describe, expect, it } from 'vitest';
import { brandWrapper, describeSendSlot, formatSendChainLine, type SendChainReport } from './sendChain';

class Room { sendMessage(_p: unknown): void { /* prototype method */ } }

describe('describeSendSlot', () => {
  it('reports proto for an untouched slot', () => {
    expect(describeSendSlot(new Room(), 'sendMessage')).toEqual(['proto']);
  });

  it('walks QPM layers through their recorded inner down to a foreign wrapper', () => {
    const room = new Room();
    const rec = room as unknown as Record<string, unknown>;
    const native = Room.prototype.sendMessage;
    const foreign = function (message: unknown): void { const currentMessage = message; native.call(room, currentMessage); };
    const locker = brandWrapper((p: unknown) => foreign(p), 'lockerGuard', foreign);
    const observer = brandWrapper((p: unknown) => locker(p), 'nativeSendObserver', locker);
    rec.sendMessage = observer;
    const out = describeSendSlot(room, 'sendMessage');
    expect(out.slice(0, 2)).toEqual(['nativeSendObserver', 'lockerGuard']);
    expect(out[2]).toMatch(/^foreign "function ?\(message\)/);
    expect(out).toHaveLength(3);
  });

  it('ends a QPM chain at proto', () => {
    const room = new Room();
    (room as unknown as Record<string, unknown>).sendMessage =
      brandWrapper((p: unknown) => Room.prototype.sendMessage.call(room, p), 'commandSequencer', Room.prototype.sendMessage);
    expect(describeSendSlot(room, 'sendMessage')).toEqual(['commandSequencer', 'proto']);
  });

  it('marks a QPM layer that recorded no inner', () => {
    const room = new Room();
    (room as unknown as Record<string, unknown>).sendMessage = brandWrapper((_p: unknown) => undefined, 'lockerGuard');
    expect(describeSendSlot(room, 'sendMessage')).toEqual(['lockerGuard', '?']);
  });

  it('treats an unknown brand label as foreign', () => {
    const room = new Room();
    const fake = Object.assign(function fake(): void { /* x */ }, { __qpmWrapped: true, __qpmLabel: 'someoneElse' });
    (room as unknown as Record<string, unknown>).sendMessage = fake;
    expect(describeSendSlot(room, 'sendMessage')[0]).toMatch(/^foreign "/);
  });
});

describe('formatSendChainLine', () => {
  const healthy: SendChainReport = {
    mode: 'chokepoint',
    live: true,
    chokepointKey: 'sendOpenMessage',
    sendMessage: ['lockerGuard', 'proto'],
    trySendMessageNow: ['lockerGuard', 'proto'],
    chokepoint: ['commandSequencer', 'proto'],
  };

  it('returns null for a healthy chokepoint chain', () => {
    expect(formatSendChainLine(healthy)).toBeNull();
    expect(formatSendChainLine(null)).toBeNull();
  });

  it('prints every slot when a foreign layer is present', () => {
    const line = formatSendChainLine({
      ...healthy,
      sendMessage: ['lockerGuard', 'foreign "function(message, ...rest2) { let curren"'],
    });
    expect(line).toBe(
      'Chain: seq=chokepoint(sendOpenMessage)  send=lockerGuard>foreign "function(message, ...rest2) { let curren"  try=lockerGuard>proto  cp=commandSequencer>proto',
    );
  });

  it('prints off when the sequencer is not attached', () => {
    expect(formatSendChainLine({ ...healthy, mode: null, live: false, chokepointKey: null, chokepoint: null }))
      .toBe('Chain: seq=off  send=lockerGuard>proto  try=lockerGuard>proto');
  });
});
