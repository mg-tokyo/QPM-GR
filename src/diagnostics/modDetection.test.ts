import { describe, expect, it } from 'vitest';
import { collectWrapperFingerprints, detectOtherMods, formatModsLine, sweepModGlobals } from './modDetection';

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
