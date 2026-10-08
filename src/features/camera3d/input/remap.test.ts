import { describe, expect, it } from 'vitest';
import { TapMemo, pickMode } from './remap';

describe('pickMode (which pick a mapped DOM event gets)', () => {
  it('a press picks and memoises, a release reuses it', () => {
    expect(pickMode('pointerdown')).toBe('down');
    expect(pickMode('pointerup')).toBe('up');
  });

  it('moves, over/out, wheel and unknown types only hover (never a synchronous GPU read)', () => {
    for (const t of ['pointermove', 'pointerover', 'pointerleave', 'pointerout', 'wheel', '']) expect(pickMode(t)).toBe('hover');
  });
});

describe('TapMemo (A PF5: one pick per click)', () => {
  it('the pointerup at the pointerdown pixel reuses its pick, once', () => {
    const m = new TapMemo<string>();
    m.down(10, 20, 'tree');
    expect(m.up(10, 20)).toBe('tree');
    expect(m.up(10, 20)).toBeNull();
  });

  it('an up elsewhere (a drag) picks again', () => {
    const m = new TapMemo<string>();
    m.down(10, 20, 'tree');
    expect(m.up(11, 20)).toBeNull();
  });

  it('a cleared memo (a press over the HUD, a 3D exit) never answers a later up', () => {
    const m = new TapMemo<string>();
    m.down(10, 20, 'tree');
    m.clear();
    expect(m.up(10, 20)).toBeNull();
  });
});
