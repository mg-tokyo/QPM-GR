import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { page } = vi.hoisted(() => ({ page: {} as Record<string, unknown> }));

vi.mock('../core/pageContext', () => ({ pageWindow: page }));
vi.mock('../core/gameState', () => ({ isGameStateReady: () => false, readSync: () => null }));
vi.mock('../diagnostics/logger', () => ({
  createNamedLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('../diagnostics/modDetection', () => ({
  registerForeignSignal: () => () => { /* nothing registered */ },
  registerSendChainLineSource: () => () => { /* nothing registered */ },
}));
vi.mock('../diagnostics/gameVersionCapture', () => ({ getCapturedBuildId: () => null }));
vi.mock('../utils/storage', () => ({ storage: { get: <T>(_key: string, fallback: T): T => fallback, set: vi.fn() } }));
vi.mock('./roomConnectionEvents', () => ({
  notifyChainChanged: vi.fn(),
  onRoomConnectionChange: (cb: () => void) => { cb(); return () => { /* no events in tests */ }; },
}));

import { getCommandSequencerStats, startCommandSequencer, stopCommandSequencer } from './commandSequencer';
import { QUINOA_COMMAND_RESULT_TYPE, QUINOA_COMMAND_TYPE } from './envelope';
import { onCommandResult, onEnvelopeSequenced, onInboundHeartbeat } from './wireEvents';

class FakeRoom {
  isCommandSessionReady = true;
  currentWebSocket = new EventTarget();
  sent: unknown[] = [];
  isConnected(): boolean { return true; }
  sendMessage(message: unknown): void {
    if (this.isConnected()) this.sendOpenMessage(message, false);
  }
  trySendMessageNow(message: unknown): boolean {
    if (!this.isConnected() || !this.isCommandSessionReady) return false;
    this.sendOpenMessage(message, false);
    return true;
  }
  sendOpenMessage(message: unknown, isNoisy: boolean): void { void isNoisy; this.sent.push(message); }
}

let room: FakeRoom;
const cleanups: Array<() => void> = [];
const stat = (key: string): unknown => getCommandSequencerStats()[key];

function envelope(requestId: string): Record<string, unknown> {
  return {
    scopePath: ['Room', 'Quinoa'],
    type: QUINOA_COMMAND_TYPE,
    requestId,
    commandSequence: 0,
    command: { type: 'FeedPet', petItemId: 'p', cropItemId: 'c' },
  };
}

function receive(data: unknown, socket: EventTarget = room.currentWebSocket): void {
  const event = new Event('message');
  Object.defineProperty(event, 'data', { value: data });
  socket.dispatchEvent(event);
}

const result = (requestId: string, extra: Record<string, unknown>): string =>
  JSON.stringify({ type: QUINOA_COMMAND_RESULT_TYPE, requestId, commandType: 'FeedPet', ...extra });

beforeEach(() => {
  room = new FakeRoom();
  page.MagicCircle_RoomConnection = room;
  startCommandSequencer();
});

afterEach(() => {
  for (const unsub of cleanups.splice(0)) unsub();
  stopCommandSequencer();
  delete page.MagicCircle_RoomConnection;
});

describe('command sequencer — envelope sequenced event', () => {
  it('fires after the send, with the number the sequencer wrote, and leaves the payload alone', () => {
    const rewrittenBefore = stat('rewrittenGame') as number;
    const seen: Array<{ requestId: string; commandSequence: number; sentAtCall: number; rewritten: unknown }> = [];
    cleanups.push(onEnvelopeSequenced((event) => {
      seen.push({ ...event, sentAtCall: room.sent.length, rewritten: stat('rewrittenGame') });
    }));
    const env = envelope('r1');
    const expected = structuredClone(env);
    expect(room.trySendMessageNow(env)).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ requestId: 'r1', sentAtCall: 1, rewritten: rewrittenBefore + 1 });
    expect(seen[0]?.commandSequence).toBe(env.commandSequence);
    expect(room.sent[0]).toBe(env);
    expect(env).toEqual({ ...expected, commandSequence: seen[0]?.commandSequence });
  });

  it('does not fire for a flat message or a send the game refuses', () => {
    const seen = vi.fn();
    cleanups.push(onEnvelopeSequenced(seen));
    room.sendMessage({ scopePath: ['Room', 'Quinoa'], type: 'PlayerPosition', x: 1 });
    room.isCommandSessionReady = false;
    expect(room.trySendMessageNow(envelope('r2'))).toBe(false);
    expect(seen).not.toHaveBeenCalled();
    expect(room.sent).toHaveLength(1);
  });

  it('a throwing listener does not stop the send or the next number', () => {
    cleanups.push(onEnvelopeSequenced(() => { throw new Error('listener'); }));
    const a = envelope('r3');
    const b = envelope('r4');
    expect(room.trySendMessageNow(a)).toBe(true);
    expect(room.trySendMessageNow(b)).toBe(true);
    expect(room.sent).toEqual([a, b]);
    expect(b.commandSequence).toBe((a.commandSequence as number) + 1);
  });
});

describe('command sequencer — result event', () => {
  it('fires after the result was counted, for a command QPM did not send', () => {
    const okBefore = stat('resultsOk') as number;
    const seen: Array<{ requestId: string; ok: boolean; counted: unknown; raw: unknown }> = [];
    cleanups.push(onCommandResult((event, raw) => {
      seen.push({ requestId: event.requestId, ok: event.ok, counted: stat('resultsOk'), raw });
    }));
    room.trySendMessageNow(envelope('r5'));
    receive(result('r5', { ok: true }));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ requestId: 'r5', ok: true, counted: okBefore + 1 });
    expect(seen[0]?.raw).toEqual(JSON.parse(result('r5', { ok: true })));
  });

  it('a throwing listener does not stop the result handling or the other listeners', () => {
    const after = vi.fn();
    cleanups.push(onCommandResult(() => { throw new Error('listener'); }));
    cleanups.push(onCommandResult(after));
    const rejectedBefore = (stat('resultsRejected') as Record<string, number>).invalid_payload ?? 0;
    expect(() => receive(result('r6', { ok: false, code: 'invalid_payload' }))).not.toThrow();
    expect((stat('resultsRejected') as Record<string, number>).invalid_payload).toBe(rejectedBefore + 1);
    expect(after.mock.calls[0]?.[0]).toMatchObject({ requestId: 'r6', ok: false, code: 'invalid_payload' });
  });

  it('ignores frames that are not results', () => {
    const seen = vi.fn();
    cleanups.push(onCommandResult(seen));
    receive('ping:1');
    receive(JSON.stringify({ type: 'RoomFrame' }));
    receive(new ArrayBuffer(2));
    expect(seen).not.toHaveBeenCalled();
  });
});

describe('command sequencer — inbound heartbeat event', () => {
  it('fires per ping frame on the bound socket, sends nothing, and stops with the sequencer', () => {
    const seqs: number[] = [];
    cleanups.push(onInboundHeartbeat((event) => { seqs.push(event.seq); }));
    receive('ping:1');
    receive('ping:2:14');
    receive(result('r7', { ok: true }));
    expect(seqs).toEqual([1, 2]);
    expect(room.sent).toHaveLength(0);
    stopCommandSequencer();
    receive('ping:3');
    expect(seqs).toEqual([1, 2]);
  });

  it('binds the current socket after a restart and leaves the old one unbound', () => {
    const seqs: number[] = [];
    cleanups.push(onInboundHeartbeat((event) => { seqs.push(event.seq); }));
    const old = room.currentWebSocket;
    stopCommandSequencer();
    room.currentWebSocket = new EventTarget();
    startCommandSequencer();
    receive('ping:9');
    receive('ping:10', old);
    expect(seqs).toEqual([9]);
  });
});
