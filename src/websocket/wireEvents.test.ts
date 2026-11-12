import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  emitCommandResult,
  emitEnvelopeSequenced,
  emitInboundHeartbeat,
  getWireEventListenerCounts,
  onCommandResult,
  onEnvelopeSequenced,
  onInboundHeartbeat,
} from './wireEvents';

const cleanups: Array<() => void> = [];
const track = (unsub: () => void): (() => void) => { cleanups.push(unsub); return unsub; };

// Records every property read, so a test can prove an emit touched nothing.
function readSpy(target: Record<string, unknown>): { proxy: Record<string, unknown>; reads: string[] } {
  const reads: string[] = [];
  const proxy = new Proxy(target, {
    get(obj, key) { reads.push(String(key)); return obj[String(key)]; },
  });
  return { proxy, reads };
}

afterEach(() => {
  for (const unsub of cleanups.splice(0)) unsub();
  expect(getWireEventListenerCounts()).toEqual({ result: 0, sequenced: 0, heartbeat: 0 });
});

describe('wire events — no listeners', () => {
  it('reads nothing from the payload or the result', () => {
    const payload = readSpy({ requestId: 'r1' });
    const result = readSpy({ requestId: 'r1', ok: true });
    emitEnvelopeSequenced(payload.proxy, 4);
    emitCommandResult(result.proxy);
    emitInboundHeartbeat('ping:1');
    expect(payload.reads).toEqual([]);
    expect(result.reads).toEqual([]);
  });
});

describe('onCommandResult', () => {
  it('delivers requestId, ok, code and the raw message by reference', () => {
    const seen = vi.fn();
    track(onCommandResult(seen));
    const ok = { type: 'QuinoaCommandResult', requestId: 'r1', ok: true, commandType: 'FeedPet' };
    const rejected = { type: 'QuinoaCommandResult', requestId: 'r2', ok: false, code: 'invalid_sequence' };
    const before = structuredClone(rejected);
    emitCommandResult(ok);
    emitCommandResult(rejected);
    expect(seen).toHaveBeenCalledTimes(2);
    expect(seen.mock.calls[0]?.[0]).toMatchObject({ requestId: 'r1', ok: true });
    expect(seen.mock.calls[0]?.[0]).not.toHaveProperty('code');
    expect(seen.mock.calls[0]?.[1]).toBe(ok);
    expect(seen.mock.calls[1]?.[0]).toMatchObject({ requestId: 'r2', ok: false, code: 'invalid_sequence' });
    expect(typeof seen.mock.calls[1]?.[0].at).toBe('number');
    expect(rejected).toEqual(before);
  });

  it('ignores a message that is not a result shape', () => {
    const seen = vi.fn();
    track(onCommandResult(seen));
    emitCommandResult(null);
    emitCommandResult({ requestId: 'r1' });
    emitCommandResult({ requestId: 7, ok: true });
    expect(seen).not.toHaveBeenCalled();
  });
});

describe('onEnvelopeSequenced', () => {
  it('delivers the request id and number without touching the payload', () => {
    const seen = vi.fn();
    track(onEnvelopeSequenced(seen));
    const payload = { type: 'QuinoaCommand', requestId: 'r1', commandSequence: 9, command: { type: 'FeedPet' } };
    const before = structuredClone(payload);
    emitEnvelopeSequenced(payload, 9);
    expect(seen.mock.calls).toEqual([[{ requestId: 'r1', commandSequence: 9 }]]);
    expect(payload).toEqual(before);
  });

  it('ignores a payload with no request id', () => {
    const seen = vi.fn();
    track(onEnvelopeSequenced(seen));
    emitEnvelopeSequenced({ type: 'PlayerPosition' }, 1);
    emitEnvelopeSequenced('text', 1);
    expect(seen).not.toHaveBeenCalled();
  });
});

describe('onInboundHeartbeat', () => {
  it('fires for ping:<seq> and ping:<seq>:<rtt> only', () => {
    const seen = vi.fn();
    track(onInboundHeartbeat(seen));
    emitInboundHeartbeat('ping:3');
    emitInboundHeartbeat('ping:4:12');
    for (const other of ['pong:5', 'ping:', 'ping:x', 'ping:1.5', 'ping:-1', ' ping:6', '{"type":"ping:7"}', 'ping']) {
      emitInboundHeartbeat(other);
    }
    emitInboundHeartbeat(new ArrayBuffer(4));
    expect(seen.mock.calls.map((c) => c[0].seq)).toEqual([3, 4]);
    expect(typeof seen.mock.calls[0]?.[0].at).toBe('number');
  });
});

describe('listener isolation', () => {
  it('a throwing listener stops neither the emit nor the other listeners', () => {
    const boom = (): never => { throw new Error('listener'); };
    const result = vi.fn();
    const sequenced = vi.fn();
    const heartbeat = vi.fn();
    track(onCommandResult(boom));
    track(onCommandResult(result));
    track(onEnvelopeSequenced(boom));
    track(onEnvelopeSequenced(sequenced));
    track(onInboundHeartbeat(boom));
    track(onInboundHeartbeat(heartbeat));
    expect(() => emitCommandResult({ requestId: 'r1', ok: true })).not.toThrow();
    expect(() => emitEnvelopeSequenced({ requestId: 'r1' }, 2)).not.toThrow();
    expect(() => emitInboundHeartbeat('ping:1')).not.toThrow();
    expect(result).toHaveBeenCalledTimes(1);
    expect(sequenced).toHaveBeenCalledTimes(1);
    expect(heartbeat).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe stops delivery and is safe to call twice', () => {
    const seen = vi.fn();
    const unsub = onInboundHeartbeat(seen);
    emitInboundHeartbeat('ping:1');
    unsub();
    unsub();
    emitInboundHeartbeat('ping:2');
    expect(seen).toHaveBeenCalledTimes(1);
    expect(getWireEventListenerCounts().heartbeat).toBe(0);
  });

  it('a listener that unsubscribes during an emit does not skip the next one', () => {
    const second = vi.fn();
    const unsubFirst: () => void = track(onInboundHeartbeat(() => { unsubFirst(); }));
    track(onInboundHeartbeat(second));
    emitInboundHeartbeat('ping:1');
    expect(second).toHaveBeenCalledTimes(1);
  });
});
