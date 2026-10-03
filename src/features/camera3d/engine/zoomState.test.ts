import { describe, expect, it } from 'vitest';
import { Detent, K_S, L_NOTCH, SState } from './zoomState';

const L = L_NOTCH;

describe('Detent', () => {
  it('a fresh gesture at the clamp enters on its second notch', () => {
    const d = new Detent();
    expect(d.input(1000, L, true, false)).toBe(false);
    expect(d.engaged()).toBe(true);
    expect(d.input(1100, L, true, false)).toBe(true);
  });

  it('a continuous gesture that reached the clamp never enters', () => {
    const d = new Detent();
    let t = 0;
    for (let i = 0; i < 5; i++) d.input((t += 50), L, false, true);
    for (let i = 0; i < 100; i++) expect(d.input((t += 50), L, true, false)).toBe(false);
  });

  it('after a 250 ms break a new gesture enters', () => {
    const d = new Detent();
    d.input(0, L, false, true);
    expect(d.input(300, L, true, false)).toBe(false);
    expect(d.input(400, L, true, false)).toBe(true);
  });

  it('many small trackpad deltas add up within one fresh gesture', () => {
    const d = new Detent();
    const l = Math.log(1.012);
    let t = 0;
    let n = 1;
    while (!d.input((t += 16), l, true, false)) n++;
    expect(n).toBe(Math.ceil((2 * L) / l));
  });

  it('slow notches 300 ms apart still enter; 1.2 s apart do not', () => {
    const a = new Detent();
    a.input(0, L, true, false);
    expect(a.input(300, L, true, false)).toBe(true);
    const b = new Detent();
    b.input(0, L, true, false);
    expect(b.input(1200, L, true, false)).toBe(false);
  });

  it('a zoom-out (the game zoomed) resets and blocks the gesture', () => {
    const d = new Detent();
    d.input(0, L, true, false);
    d.input(50, -L, false, true);
    expect(d.input(100, L, true, false)).toBe(false);
  });
});

describe('SState', () => {
  it('start puts the entering notch on the curve', () => {
    const s = new SState();
    s.start(L);
    expect(s.target).toBeCloseTo(0.08, 9);
    expect(K_S * L).toBeCloseTo(0.08, 9);
  });

  it('snaps into first person past 0.97 and back to 0.92 on the next zoom-out', () => {
    const s = new SState();
    s.target = 0.95;
    s.input(L, true);
    expect([s.target, s.s]).toEqual([1, 1]);
    s.input(-L, true);
    expect([s.target, s.s]).toEqual([0.92, 0.92]);
  });

  it('caps at the last third-person key when first person is off', () => {
    const s = new SState();
    s.target = 0.9;
    s.input(L, false);
    expect(s.target).toBe(0.92);
  });

  it('dt is clamped so a long gap cannot jump the whole way', () => {
    const s = new SState();
    s.target = 1;
    s.tick(60_000);
    expect(s.s).toBeCloseTo(1 - Math.exp(-100 / 90), 6);
  });

  it('done after scrolling back to 0', () => {
    const s = new SState();
    s.start(L);
    s.input(-L, true);
    for (let i = 0; i < 50; i++) s.tick(16);
    expect(s.done()).toBe(true);
  });
});
