/* eslint-disable no-restricted-properties -- fixtures set up room slots to test collectWrapperFingerprints; not a real WS send. */
import { describe, expect, it } from 'vitest';
import {
  collectWrapperFingerprints,
  detectOtherMods,
  formatModsLine,
  readSendChainLine,
  registerSendChainLineSource,
  sweepModGlobals,
} from './modDetection';

const nativeLike = (): (() => void) => (function () { /* stub */ }).bind(null);

describe('collectWrapperFingerprints', () => {
  it('reports a non-native WS.send with hash and collapsed excerpt', () => {
    const send = function (data: unknown) { return data; };
    const win = { WebSocket: Object.assign(nativeLike(), { prototype: { send } }) };
    const out = collectWrapperFingerprints(win as unknown as Record<string, unknown>);
    expect(out).toHaveLength(1);
    expect(out[0]?.target).toBe('WS.send');
    expect(out[0]?.hash).toMatch(/^[0-9a-f]{8}$/);
    expect(out[0]?.excerpt).toMatch(/function ?\(data\)/);
    expect(out[0]?.excerpt.length).toBeLessThanOrEqual(72);
    expect(out[0]?.label).toBeNull();
  });

  it('reports the constructor itself when WebSocket is wrapped, and skips prototype.send', () => {
    const win = {
      WebSocket: Object.assign(function FakeWS() { /* wrap */ }, { prototype: { send: () => 0 } }),
    };
    const out = collectWrapperFingerprints(win as unknown as Record<string, unknown>);
    expect(out.map((w) => w.target)).toEqual(['WebSocket']);
  });

  it('skips native functions and QPM-branded wrappers', () => {
    const branded = Object.assign(function w() { /* qpm */ }, { __qpmWrapped: true });
    const win = {
      WebSocket: Object.assign(nativeLike(), { prototype: { send: branded } }),
      XMLHttpRequest: Object.assign(nativeLike(), { prototype: { open: nativeLike() } }),
    };
    expect(collectWrapperFingerprints(win as unknown as Record<string, unknown>)).toEqual([]);
  });

  it('produces a stable hash for identical source', () => {
    const mk = () => ({ WebSocket: Object.assign(nativeLike(), { prototype: { send: function s(a: unknown) { return a; } } }) });
    const a = collectWrapperFingerprints(mk() as unknown as Record<string, unknown>);
    const b = collectWrapperFingerprints(mk() as unknown as Record<string, unknown>);
    expect(a[0]?.hash).toBe(b[0]?.hash);
  });
});

describe('sweepModGlobals', () => {
  it('reports version-bearing globals, excludes QPM/game/library globals and primitives', () => {
    const win = {
      SuperGardenTool: { version: '1.3' },
      PIXI: { VERSION: '7.4.0' },
      QPM_DEBUG_API: { version: '9.9' },
      __MG_SPRITE_STATE__: { version: '1' },
      MagicCircle_RoomConnection: { version: '2' },
      AriesMod: { version: '2.4' },
      plainNumber: 42,
      noVersion: {},
    };
    expect(sweepModGlobals(win as unknown as Record<string, unknown>)).toEqual(['SuperGardenTool 1.3?']);
  });

  it('reports mod-hinted object names without version, but not functions', () => {
    const win = { gardenHackz: { on: true }, ModLoaderFn: function () { /* ctor-like */ } };
    expect(sweepModGlobals(win as unknown as Record<string, unknown>)).toEqual(['gardenHackz?']);
  });

  it('caps results at 6', () => {
    const win: Record<string, unknown> = {};
    for (let i = 0; i < 9; i++) win[`Tool${i}`] = { version: `1.${i}` };
    expect(sweepModGlobals(win)).toHaveLength(6);
  });
});

describe('formatModsLine', () => {
  it('joins known, discovered, wrappers, and signals in order', () => {
    const line = formatModsLine({
      known: ['AriesMod 2.4'],
      discovered: ['SuperGardenTool 1.3?'],
      wrappers: [{ target: 'WS.send', hash: 'a1b2c3d4', excerpt: 'function (e) { x(e) }', label: null }],
      signals: ['room.send'],
    });
    expect(line).toBe(
      'Mods: AriesMod 2.4  SuperGardenTool 1.3?  +wrapped(WS.send#a1b2c3d4 "function (e) { x(e) }")  +unknown(room.send)',
    );
  });

  it('returns null when everything is empty', () => {
    expect(formatModsLine({ known: [], discovered: [], wrappers: [], signals: [] })).toBeNull();
  });
});

describe('detectOtherMods', () => {
  it('runs against the real pageWindow stub without throwing', () => {
    const r = detectOtherMods();
    expect(Array.isArray(r.known)).toBe(true);
    expect(Array.isArray(r.discovered)).toBe(true);
  });
});

function WrappedWebSocket(url: string, protocols?: string | string[]): unknown {
  const ws = protocols !== void 0 ? [url, protocols] : [url];
  return ws;
}

describe("Arie's Mod identification", () => {
  it('labels the WebSocket constructor excerpt from the 2026-09-11 field report', () => {
    const win = { WebSocket: Object.assign(WrappedWebSocket, { prototype: { send: nativeLike() } }) };
    const out = collectWrapperFingerprints(win as unknown as Record<string, unknown>);
    expect(out[0]?.excerpt).toBe('function WrappedWebSocket(url, protocols) { const ws = protocols !== voi');
    expect(out[0]?.label).toBe('AriesMod');
  });

  it('fingerprints a foreign room.sendMessage beneath QPM wrappers', () => {
    class Room {
      sendMessage(_m: unknown): void { /* proto */ }
      trySendMessageNow(_m: unknown): boolean { return true; }
    }
    const room = new Room();
    const aries = function (message: unknown, ...rest2: unknown[]): unknown {
      let currentMessage = message;
      currentMessage = currentMessage ?? rest2;
      return currentMessage;
    };
    const locker = Object.assign(function locker(p: unknown): unknown { return aries(p); }, {
      __qpmWrapped: true, __qpmLabel: 'lockerGuard', __qpmInner: aries,
    });
    (room as unknown as Record<string, unknown>).sendMessage = locker;
    const win = { WebSocket: Object.assign(nativeLike(), { prototype: { send: nativeLike() } }), MagicCircle_RoomConnection: room };
    const out = collectWrapperFingerprints(win as unknown as Record<string, unknown>);
    expect(out.map((w) => [w.target, w.label])).toEqual([['room.sendMessage', 'AriesMod']]);
  });

  it('ignores room slots whose QPM chain bottoms out at the prototype', () => {
    class Room { sendMessage(_m: unknown): void { /* proto */ } }
    const room = new Room();
    (room as unknown as Record<string, unknown>).sendMessage = Object.assign(function locker(): void { /* x */ }, {
      __qpmWrapped: true, __qpmLabel: 'lockerGuard', __qpmInner: Room.prototype.sendMessage,
    });
    const win = { MagicCircle_RoomConnection: room };
    expect(collectWrapperFingerprints(win as unknown as Record<string, unknown>)).toEqual([]);
  });

  it('adds AriesMod from the hook marker once, and not when a signature already named it', () => {
    expect(detectOtherMods({ __tmMessageHookInstalled: true }).known).toEqual(['AriesMod']);
    const win = {
      __tmMessageHookInstalled: true,
      WebSocket: Object.assign(WrappedWebSocket, { prototype: { send: nativeLike() } }),
    };
    expect(detectOtherMods(win).known).toEqual(['AriesMod (WebSocket)']);
  });
});

describe('send chain line source', () => {
  it('reads the latest source and ignores a stale unregister', () => {
    const stopA = registerSendChainLineSource(() => 'Chain: A');
    const stopB = registerSendChainLineSource(() => 'Chain: B');
    stopA();
    expect(readSendChainLine()).toBe('Chain: B');
    stopB();
    expect(readSendChainLine()).toBeNull();
  });

  it('treats a throwing source as no line', () => {
    const stop = registerSendChainLineSource(() => { throw new Error('boom'); });
    expect(readSendChainLine()).toBeNull();
    stop();
  });
});
