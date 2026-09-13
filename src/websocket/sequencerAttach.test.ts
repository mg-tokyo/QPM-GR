import { beforeEach, describe, expect, it, vi } from 'vitest';

const { warnSpy } = vi.hoisted(() => ({ warnSpy: vi.fn() }));

vi.mock('../diagnostics/logger', () => ({
  createNamedLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: warnSpy, error: vi.fn() }),
}));
vi.mock('./roomConnectionEvents', () => ({ notifyChainChanged: vi.fn() }));

import { brandWrapper, createForeignEpisodeGate } from './sendChain';
import { createSequencerAttach, type SequencerAttachHooks, type SequencerConnection } from './sequencerAttach';

interface Env { type: string; commandSequence: number }
const envelope = (): Env => ({ type: 'QuinoaCommand', commandSequence: 0 });
const isEnvelope = (p: unknown): p is Env =>
  !!p && typeof p === 'object' && (p as { type?: unknown }).type === 'QuinoaCommand';
const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

class FakeRoom {
  isCommandSessionReady = true;
  sent: unknown[][] = [];
  isConnected(): boolean { return true; }
  sendMessage(message: unknown): void {
    if (this.isConnected()) this.sendOpenMessage(message, false);
  }
  trySendMessageNow(message: unknown): boolean {
    if (!this.isConnected() || !this.isCommandSessionReady) return false;
    this.sendOpenMessage(message, false);
    return true;
  }
  sendOpenMessage(message: unknown, isNoisy: boolean): void { this.sent.push([message, isNoisy]); }
}

class NoChokepointRoom {
  sendMessage(message: unknown): void { this.writeA(message); }
  trySendMessageNow(message: unknown): boolean { this.writeB(message); return true; }
  writeA(message: unknown): void { void message; }
  writeB(message: unknown): void { void message; }
}

function makeHooks(room: object | null): { hooks: SequencerAttachHooks; rewritten: Env[]; observed: unknown[] } {
  const rewritten: Env[] = [];
  const observed: unknown[] = [];
  let wire = 0;
  const hooks: SequencerAttachHooks = {
    getRoom: () => room as unknown as SequencerConnection | null,
    observeOutbound: (p) => { observed.push(p); },
    skipPreSession: (r, p) => isEnvelope(p) && r.isCommandSessionReady === false,
    rewrite: (p) => {
      if (!isEnvelope(p)) return null;
      wire += 1;
      p.commandSequence = wire;
      rewritten.push(p);
      return wire;
    },
    rollback: (seq) => { if (wire === seq) wire -= 1; },
    onFrame: () => { /* counters live in commandSequencer */ },
    onWelcome: () => { /* counters live in commandSequencer */ },
    seedIfUnseeded: () => { /* counters live in commandSequencer */ },
    refresh: () => { /* result binder lives in commandSequencer */ },
    counters: () => ({ wire, frontier: 0 }),
    stats: { layeringRefusals: 0, rearms: 0, defusedDetaches: 0, chokepointCovered: 0, chokepointReinstalls: 0, chokepointBypassed: 0 },
    gate: createForeignEpisodeGate(3, 0),
  };
  return { hooks, rewritten, observed };
}

beforeEach(() => { warnSpy.mockClear(); });

describe('createSequencerAttach — chokepoint mode', () => {
  it('installs on the discovered chokepoint and numbers envelopes on both send paths', () => {
    const room = new FakeRoom();
    const { hooks } = makeHooks(room);
    const attach = createSequencerAttach(hooks);
    attach.ensureAttached();
    expect(hasOwn(room, 'sendOpenMessage')).toBe(true);
    expect(hasOwn(room, 'sendMessage')).toBe(false);
    expect(attach.describe()).toEqual({ mode: 'chokepoint', chokepointKey: 'sendOpenMessage' });
    expect(attach.isLive()).toBe(true);
    const a = envelope();
    const b = envelope();
    room.sendMessage(a);
    expect(room.trySendMessageNow(b)).toBe(true);
    expect([a.commandSequence, b.commandSequence]).toEqual([1, 2]);
    expect(room.sent).toEqual([[a, false], [b, false]]);
  });

  it('allocates nothing for a send the game refuses before the chokepoint', () => {
    const room = new FakeRoom();
    const { hooks, rewritten } = makeHooks(room);
    createSequencerAttach(hooks).ensureAttached();
    room.isCommandSessionReady = false;
    expect(room.trySendMessageNow(envelope())).toBe(false);
    expect(rewritten).toHaveLength(0);
    expect(room.sent).toHaveLength(0);
  });

  it('skips the rewrite for the pre-Welcome sendMessage flush (CS-3)', () => {
    const room = new FakeRoom();
    const { hooks, rewritten, observed } = makeHooks(room);
    createSequencerAttach(hooks).ensureAttached();
    room.isCommandSessionReady = false;
    const env = envelope();
    room.sendMessage(env);
    expect(env.commandSequence).toBe(0);
    expect(rewritten).toHaveLength(0);
    expect(observed).toEqual([env]);
    expect(room.sent).toHaveLength(1);
  });

  it('sits below a foreign sendMessage wrapper installed first', () => {
    const room = new FakeRoom();
    const rec = room as unknown as Record<string, unknown>;
    const inner = FakeRoom.prototype.sendMessage;
    rec.sendMessage = function foreignWrap(message: unknown): void { inner.call(room, message); };
    const { hooks } = makeHooks(room);
    const attach = createSequencerAttach(hooks);
    attach.ensureAttached();
    expect(attach.describe().mode).toBe('chokepoint');
    expect(hooks.stats.layeringRefusals).toBe(0);
    const env = envelope();
    room.sendMessage(env);
    expect(env.commandSequence).toBe(1);
  });

  it('detach removes the own property when nothing covers it', () => {
    const room = new FakeRoom();
    const { hooks } = makeHooks(room);
    const attach = createSequencerAttach(hooks);
    attach.ensureAttached();
    attach.detach();
    expect(hasOwn(room, 'sendOpenMessage')).toBe(false);
    expect(attach.isLive()).toBe(false);
    expect(attach.describe()).toEqual({ mode: null, chokepointKey: null });
  });

  it('detach defuses under a cover and a later attach re-arms in place', () => {
    const room = new FakeRoom();
    const rec = room as unknown as Record<string, unknown>;
    const { hooks, rewritten } = makeHooks(room);
    const attach = createSequencerAttach(hooks);
    attach.ensureAttached();
    const ours = rec.sendOpenMessage as (m: unknown, n: unknown) => unknown;
    const cover = function cover(m: unknown, n: unknown): unknown { return ours(m, n); };
    rec.sendOpenMessage = cover;
    attach.detach();
    expect(rec.sendOpenMessage).toBe(cover);
    expect(hooks.stats.defusedDetaches).toBe(1);
    room.sendMessage(envelope());
    expect(rewritten).toHaveLength(0);
    expect(room.sent).toHaveLength(1);
    attach.ensureAttached();
    expect(hooks.stats.rearms).toBe(1);
    expect(rec.sendOpenMessage).toBe(cover);
    room.sendMessage(envelope());
    expect(rewritten).toHaveLength(1);
  });

  it('refuses a foreign wrapper already on the chokepoint and warns QPM-WS-013 once', () => {
    const room = new FakeRoom();
    const rec = room as unknown as Record<string, unknown>;
    rec.sendOpenMessage = function preexisting(m: unknown, n: unknown): void {
      FakeRoom.prototype.sendOpenMessage.call(room, m, n === true);
    };
    const { hooks } = makeHooks(room);
    const attach = createSequencerAttach(hooks);
    attach.ensureAttached();
    attach.ensureAttached();
    expect(attach.isLive()).toBe(false);
    expect(hooks.stats.layeringRefusals).toBe(2);
    expect(hooks.gate.active()).toBe(true);
    expect(warnSpy.mock.calls.map((c) => c[0])).toEqual(['QPM-WS-013']);
    expect(warnSpy.mock.calls[0]?.[1]).toMatchObject({ phase: 'chokepoint', key: 'sendOpenMessage', slotClass: 'foreign' });
  });

  it('falls back to slot mode when discovery finds no chokepoint', () => {
    const room = new NoChokepointRoom();
    const { hooks } = makeHooks(room);
    const attach = createSequencerAttach(hooks);
    attach.ensureAttached();
    expect(attach.describe()).toEqual({ mode: 'slot', chokepointKey: null });
    expect((room.sendMessage as unknown as { __qpmLabel?: string }).__qpmLabel).toBe('commandSequencer');
  });
});

describe('createSequencerAttach — chokepoint loss', () => {
  it('reinstalls when the own property is deleted', () => {
    const room = new FakeRoom();
    const rec = room as unknown as Record<string, unknown>;
    const { hooks } = makeHooks(room);
    const attach = createSequencerAttach(hooks);
    attach.ensureAttached();
    const ours = rec.sendOpenMessage;
    Reflect.deleteProperty(rec, 'sendOpenMessage');
    attach.ensureAttached();
    expect(hasOwn(room, 'sendOpenMessage')).toBe(true);
    expect(rec.sendOpenMessage).toBe(ours);
    expect(hooks.stats.chokepointReinstalls).toBe(1);
  });

  it('counts a cover once per covering function and keeps numbering through it', () => {
    const room = new FakeRoom();
    const rec = room as unknown as Record<string, unknown>;
    const { hooks } = makeHooks(room);
    const attach = createSequencerAttach(hooks);
    attach.ensureAttached();
    const ours = rec.sendOpenMessage as (m: unknown, n: unknown) => unknown;
    rec.sendOpenMessage = function cover(m: unknown, n: unknown): unknown { return ours(m, n); };
    attach.ensureAttached();
    attach.ensureAttached();
    expect(hooks.stats.chokepointCovered).toBe(1);
    const env = envelope();
    expect(room.trySendMessageNow(env)).toBe(true);
    expect(env.commandSequence).toBe(1);
  });

  it('reportBypass moves the room to slot mode for the rest of the session', () => {
    const room = new FakeRoom();
    const { hooks } = makeHooks(room);
    const attach = createSequencerAttach(hooks);
    attach.ensureAttached();
    expect(attach.reportBypass({ type: 'ToggleLockItem', requestId: 'r1' })).toBe(true);
    expect(hooks.stats.chokepointBypassed).toBe(1);
    expect(warnSpy.mock.calls.map((c) => c[0])).toEqual(['QPM-WS-015']);
    expect(hasOwn(room, 'sendOpenMessage')).toBe(false);
    expect(attach.describe().mode).toBe('slot');
    attach.detach();
    attach.ensureAttached();
    expect(attach.describe().mode).toBe('slot');
  });

  it('reportBypass is a no-op outside chokepoint mode', () => {
    const room = new NoChokepointRoom();
    const { hooks } = makeHooks(room);
    const attach = createSequencerAttach(hooks);
    attach.ensureAttached();
    expect(attach.reportBypass({ type: 'ToggleLockItem', requestId: 'r1' })).toBe(false);
    expect(hooks.stats.chokepointBypassed).toBe(0);
  });
});

describe('createSequencerAttach — slot-mode diagnostics', () => {
  it('logs QPM-WS-013 buried, not QPM-WS-008, when QPM outers cover a refused foreign slot', () => {
    const room = new NoChokepointRoom();
    const rec = room as unknown as Record<string, unknown>;
    const native = NoChokepointRoom.prototype.sendMessage;
    const foreign = function foreignWrap(m: unknown): void { native.call(room, m); };
    rec.sendMessage = foreign;
    const { hooks } = makeHooks(room);
    const attach = createSequencerAttach(hooks);
    attach.ensureAttached();
    rec.sendMessage = brandWrapper((m: unknown) => foreign(m), 'lockerGuard', foreign);
    attach.ensureAttached();
    attach.ensureAttached();
    expect(warnSpy.mock.calls.map((c) => c[0])).toEqual(['QPM-WS-013']);
    expect(warnSpy.mock.calls[0]?.[1]).toMatchObject({ phase: 'buried', sendClass: 'qpm', tryClass: 'clean' });
    expect(hooks.gate.active()).toBe(true);
    expect(hooks.stats.layeringRefusals).toBe(3);
    expect(attach.isLive()).toBe(false);
  });

  it('still logs QPM-WS-008 when QPM outers sit over a slot that was never refused', () => {
    const room = new NoChokepointRoom();
    const native = NoChokepointRoom.prototype.sendMessage;
    (room as unknown as Record<string, unknown>).sendMessage =
      brandWrapper((m: unknown) => native.call(room, m), 'lockerGuard', native);
    const { hooks } = makeHooks(room);
    const attach = createSequencerAttach(hooks);
    attach.ensureAttached();
    expect(warnSpy.mock.calls.map((c) => c[0])).toEqual(['QPM-WS-008']);
  });
});

describe('createSequencerAttach — chain report', () => {
  it('reports the chokepoint and every QPM layer down to the prototype', () => {
    const room = new FakeRoom();
    (room as unknown as Record<string, unknown>).sendMessage = brandWrapper(
      (m: unknown) => FakeRoom.prototype.sendMessage.call(room, m),
      'lockerGuard',
      FakeRoom.prototype.sendMessage,
    );
    const { hooks } = makeHooks(room);
    const attach = createSequencerAttach(hooks);
    attach.ensureAttached();
    expect(attach.chain()).toEqual({
      mode: 'chokepoint',
      live: true,
      chokepointKey: 'sendOpenMessage',
      sendMessage: ['lockerGuard', 'proto'],
      trySendMessageNow: ['proto'],
      chokepoint: ['commandSequencer', 'proto'],
    });
  });
});
