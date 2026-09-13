import { describe, expect, it } from 'vitest';
import { discoverSendChokepoint } from './sendChokepoint';

class GameLike {
  isCommandSessionReady = true;
  isConnected(): boolean { return true; }
  sendMessage(message: unknown): void {
    if (this.isConnected()) this.sendOpenMessage(message, false);
  }
  trySendMessageNow(message: unknown): boolean {
    if (!this.isConnected() || !this.isCommandSessionReady) return false;
    this.sendOpenMessage(message, false);
    return true;
  }
  sendOpenMessage(message: unknown, isNoisy: boolean): void { void message; void isNoisy; }
}

class TwoShared {
  sendMessage(m: unknown): void { this.log(m); this.write(m); }
  trySendMessageNow(m: unknown): boolean { this.log(m); this.write(m); return true; }
  log(m: unknown): void { void m; }
  write(m: unknown): void { void m; }
}

class NoneShared {
  sendMessage(m: unknown): void { this.writeA(m); }
  trySendMessageNow(m: unknown): boolean { this.writeB(m); return true; }
  writeA(m: unknown): void { void m; }
  writeB(m: unknown): void { void m; }
}

class LoopsBack {
  sendMessage(m: unknown): void { this.route(m); }
  trySendMessageNow(m: unknown): boolean { this.route(m); return true; }
  route(m: unknown): void { this.sendMessage(m); }
}

describe('discoverSendChokepoint', () => {
  it('finds the one argument-bearing method both slot methods call, ignoring zero-arg calls', () => {
    expect(discoverSendChokepoint(GameLike.prototype)).toBe('sendOpenMessage');
  });

  it('refuses to guess between two shared callees', () => {
    expect(discoverSendChokepoint(TwoShared.prototype)).toBeNull();
  });

  it('returns null when the slot methods share no callee', () => {
    expect(discoverSendChokepoint(NoneShared.prototype)).toBeNull();
  });

  it('rejects a candidate that calls back into a slot method', () => {
    expect(discoverSendChokepoint(LoopsBack.prototype)).toBeNull();
  });

  it('returns null when the prototype sendMessage is itself a wrapper without this-calls', () => {
    const proto = Object.create(GameLike.prototype) as Record<string, unknown>;
    const original = GameLike.prototype.sendMessage;
    proto.sendMessage = function wrap(this: unknown, message: unknown): void { original.call(this as GameLike, message); };
    expect(discoverSendChokepoint(proto)).toBeNull();
  });

  it('returns null for a missing prototype or missing slot methods', () => {
    expect(discoverSendChokepoint(null)).toBeNull();
    expect(discoverSendChokepoint({})).toBeNull();
  });

  it('caches the verdict per prototype', () => {
    class Cached extends GameLike {}
    expect(discoverSendChokepoint(Cached.prototype)).toBe('sendOpenMessage');
    Object.defineProperty(Cached.prototype, 'sendMessage', { value: function none(): void { /* no callees */ }, configurable: true });
    expect(discoverSendChokepoint(Cached.prototype)).toBe('sendOpenMessage');
  });
});
