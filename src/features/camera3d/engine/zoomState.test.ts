import { describe, expect, it } from 'vitest';
import { CURVE_KEYS, S_LAST_THIRD, S_TILT_END, type CurveKey } from '../math/zoomCurve';
import { Detent, ENTRY_MS, LookState, PUSH_MS, SState, SWITCH_NOTCHES, S_PER_NOTCH, ZoomInput, classifyZoomInput, type ZoomInputKind } from './zoomState';

const ANCHOR = { cursorScreenX: 1, cursorScreenY: 1, rendererWidth: 2, rendererHeight: 2 };

describe('Detent', () => {
  it('a fresh gesture at the clamp enters on its second notch', () => {
    const d = new Detent();
    expect(d.input(1000, 1, true, false)).toBe(false);
    expect(d.engaged()).toBe(true);
    expect(d.input(1100, 1, true, false)).toBe(true);
  });

  it('a continuous gesture that reached the clamp never enters', () => {
    const d = new Detent();
    let t = 0;
    for (let i = 0; i < 5; i++) d.input((t += 50), 1, false, true);
    for (let i = 0; i < 100; i++) expect(d.input((t += 50), 1, true, false)).toBe(false);
  });

  it('after a 250 ms break a new gesture enters', () => {
    const d = new Detent();
    d.input(0, 1, false, true);
    expect(d.input(300, 1, true, false)).toBe(false);
    expect(d.input(400, 1, true, false)).toBe(true);
  });

  it('many small trackpad deltas add up within one fresh gesture', () => {
    const d = new Detent();
    const n = new ZoomInput().notches('wheel', 1.012, 1);
    let t = 0;
    let count = 1;
    while (!d.input((t += 16), n, true, false)) count++;
    expect(count).toBe(Math.ceil(2 / n - 1e-9));
  });

  it('slow notches 300 ms apart still enter; 1.2 s apart do not', () => {
    const a = new Detent();
    a.input(0, 1, true, false);
    expect(a.input(300, 1, true, false)).toBe(true);
    const b = new Detent();
    b.input(0, 1, true, false);
    expect(b.input(1200, 1, true, false)).toBe(false);
  });

  it('a zoom-out (the game zoomed) resets and blocks the gesture', () => {
    const d = new Detent();
    d.input(0, 1, true, false);
    d.input(50, -1, false, true);
    expect(d.input(100, 1, true, false)).toBe(false);
  });
});

describe('zoom input normalising (A S2, S8)', () => {
  it('classifies the live kinds: stepped+anchor = wheel, stepped alone = keyboard, direct = pinch or gesture', () => {
    expect(classifyZoomInput('stepped', ANCHOR, false)).toBe('wheel');
    expect(classifyZoomInput('stepped', null, false)).toBe('keyboard');
    expect(classifyZoomInput('stepped', undefined, false)).toBe('keyboard');
    expect(classifyZoomInput('direct', ANCHOR, false)).toBe('pinch');
    expect(classifyZoomInput('direct', ANCHOR, true)).toBe('gesture');
    expect(classifyZoomInput('somethingNew', null, false)).toBe('keyboard');
  });

  it('one wheel notch and one keyboard step are each ±1 notch, in and out', () => {
    const z = new ZoomInput();
    expect(z.notches('wheel', 130, 100)).toBeCloseTo(1, 12);
    expect(z.notches('wheel', 70, 100)).toBeCloseTo(-1, 12);
    expect(z.notches('keyboard', 130, 100)).toBeCloseTo(1, 12);
    expect(z.notches('keyboard', 100 / 1.3, 100)).toBeCloseTo(-1, 12);
  });

  const roundTrip = (kind: ZoomInputKind, ratioIn: number, ratioOut: number): number => {
    const z = new ZoomInput();
    let sum = 0;
    for (let i = 0; i < 5; i++) sum += z.notches(kind, 100 * ratioIn, 100);
    for (let i = 0; i < 5; i++) sum += z.notches(kind, 100 * ratioOut, 100);
    return sum;
  };

  it('N in plus N out returns to the start for wheel, trackpad, keyboard and pinch', () => {
    expect(roundTrip('wheel', 1.3, 0.7)).toBeCloseTo(0, 12);
    expect(roundTrip('wheel', 1.012, 0.988)).toBeCloseTo(0, 12);
    expect(roundTrip('keyboard', 1.3, 1 / 1.3)).toBeCloseTo(0, 12);
    expect(roundTrip('pinch', 1.1, 0.9)).toBeCloseTo(0, 12);
  });

  it('a touch/Safari gesture reports scale from its start: steps are per call, and back to the start sums to 0', () => {
    const z = new ZoomInput();
    const eff = 100;
    const scales = [1.1, 1.3, 1.6, 1.6, 1.6, 1.2, 1.0];
    let sum = 0;
    const seen: number[] = [];
    for (const k of scales) { const n = z.notches('gesture', eff * k, eff); seen.push(n); sum += n; }
    expect(seen[3]).toBe(0);
    expect(seen[4]).toBe(0);
    expect(sum).toBeCloseTo(0, 12);
    expect(z.inGesture()).toBe(true);
    z.endGesture();
    expect(z.inGesture()).toBe(false);
    expect(z.notches('gesture', eff * 1.3, eff)).toBeCloseTo(1, 12);
  });

  it('a gesture spread of ×1.69 is two notches (the detent)', () => {
    const z = new ZoomInput();
    let sum = 0;
    for (let k = 1.05; k < 1.69; k += 0.05) sum += z.notches('gesture', 100 * k, 100);
    sum += z.notches('gesture', 169, 100);
    expect(sum).toBeCloseTo(2, 9);
  });
});

const run = (st: SState, ms: number, step = 1000 / 60): void => {
  for (let t = 0; t < ms - 1e-9; t += step) st.tick(Math.min(step, ms - t));
};

describe('SState spring (A S1, S7)', () => {
  it('velocity is continuous across a notch: from rest it starts at 0 (quadratic), in motion it keeps its value', () => {
    const a = new SState();
    a.target = 0.3; a.s = 0.3;
    a.input(1, true, 0);
    const s0 = a.s;
    a.tick(0.5); const d1 = a.s - s0;
    const b = new SState();
    b.target = 0.3; b.s = 0.3;
    b.input(1, true, 0);
    b.tick(1); const d2 = b.s - s0;
    expect(d1 / d2).toBeCloseTo(0.25, 2);

    const c = new SState();
    c.target = 0.3; c.s = 0.3;
    c.input(1, true, 0);
    run(c, 50);
    const v = c.v, before = c.s;
    c.input(1, true, 60);
    expect(c.v).toBe(v);
    c.tick(0.01);
    expect((c.s - before) / 1e-5).toBeCloseTo(v, 2);
  });

  it('is frame-rate independent', () => {
    const at = (fps: number): number => { const s = new SState(); s.target = 0.4; s.s = 0.2; run(s, 120, 1000 / fps); return s.s; };
    expect(at(30)).toBeCloseTo(at(144), 9);
    expect(at(60)).toBeCloseTo(at(240), 9);
  });

  it('never overshoots a single notch from rest, and stops on the target with zero velocity (no settle pop)', () => {
    const s = new SState();
    s.target = 0.3; s.s = 0.3;
    s.input(1, true, 0);
    let last = s.s;
    for (let i = 0; i < 120 && s.s !== s.target; i++) {
      s.tick(1000 / 60);
      expect(s.s).toBeLessThanOrEqual(s.target + 1e-12);
      expect(s.s).toBeGreaterThanOrEqual(last);
      last = s.s;
    }
    expect(s.s).toBe(s.target);
    expect(s.v).toBe(0);
  });

  it('the final snap is invisible: the frame that lands moves under 1e-4 of s (the old 2e-3 snap was a 0.7° pop)', () => {
    const s = new SState();
    s.target = 0.3; s.s = 0.3;
    s.input(1, true, 0);
    let prev = s.s;
    while (s.s !== s.target) { prev = s.s; s.tick(1000 / 60); }
    expect(Math.abs(s.target - prev)).toBeLessThan(1e-4);
  });

  it('time constant is tunable and shortens the settle', () => {
    const settle = (tau: number): number => {
      const s = new SState(); s.tauMs = tau; s.target = 0.3; s.s = 0.3; s.input(1, true, 0);
      let t = 0;
      while (Math.abs(s.target - s.s) > 0.02 * S_PER_NOTCH) { s.tick(4); t += 4; }
      return t;
    };
    expect(settle(20)).toBeLessThan(settle(40));
    expect(settle(30)).toBeGreaterThan(120);
    expect(settle(30)).toBeLessThan(220);
  });

  it('a long gap is clamped (one frame cannot cover a whole notch)', () => {
    const s = new SState();
    s.target = 0.3; s.s = 0.3;
    s.input(1, true, 0);
    s.tick(60_000);
    expect(s.s).toBeLessThan(s.target);
  });

  it('N notches in plus N out returns to the start', () => {
    const s = new SState();
    s.target = 0.3; s.s = 0.3;
    for (let i = 0; i < 5; i++) s.input(1, true, i * 50);
    for (let i = 0; i < 5; i++) s.input(-1, true, 300 + i * 50);
    expect(s.target).toBeCloseTo(0.3, 12);
  });
});

const entering = (): SState => { const s = new SState(); s.start(); return s; };
const at = (x: number): SState => { const s = new SState(); s.s = x; s.target = x; return s; };

describe('SState entry and exit moves (A T1, T2; P1 a)', () => {
  it('holds s = 0 until the first 3D frame has drawn, then one eased move reaches the end of the tilt in ENTRY_MS', () => {
    const s = entering();
    s.tick(37); s.tick(16);
    expect([s.s, s.v, s.phase()]).toEqual([0, 0, 'enter']);
    s.startClock();
    run(s, ENTRY_MS / 2);
    expect(s.s).toBeCloseTo(S_TILT_END / 2, 9);
    run(s, ENTRY_MS / 2);
    expect([s.s, s.v, s.phase()]).toEqual([S_TILT_END, 0, 'spring']);
  });

  it('the move starts and ends at rest, never overshoots, and is frame-rate independent', () => {
    const after300 = (fps: number): number => { const s = entering(); s.startClock(); run(s, 300, 1000 / fps); return s.s; };
    expect(after300(30)).toBeCloseTo(after300(144), 9);
    const s = entering();
    s.startClock();
    s.tick(1);
    expect(s.s).toBeLessThan(1e-6);
    let last = 0;
    for (let t = 0; t < ENTRY_MS + 50; t += 16) {
      s.tick(16);
      expect(s.s).toBeGreaterThanOrEqual(last);
      expect(s.s).toBeLessThanOrEqual(S_TILT_END);
      last = s.s;
    }
  });

  it('zoom input during the move adds on top at once and carries on after it, with no velocity dip', () => {
    const s = entering();
    s.startClock();
    run(s, 200);
    const before = s.s;
    s.input(2, true, 200);
    expect(s.s).toBe(before);
    let vAtEnd = NaN;
    for (let t = 0; t < 2000; t += 16) { const was = s.phase(); s.tick(16); if (was === 'enter' && s.phase() === 'spring') vAtEnd = s.v; }
    expect(vAtEnd).toBeGreaterThan(0);
    expect(s.target).toBeCloseTo(S_TILT_END + 2 * S_PER_NOTCH, 12);
    expect(s.s).toBe(s.target);
  });

  it('scrolling out during the move reverses into the exit with the same velocity and ends at exactly 0', () => {
    const s = entering();
    s.startClock();
    run(s, 250);
    const v0 = s.v;
    s.input(-1, true, 250);
    expect(s.phase()).toBe('exit');
    expect(s.v).toBeCloseTo(v0, 9);
    run(s, 2000);
    expect([s.s, s.v, s.done()]).toEqual([0, 0, true]);
  });

  it('one notch out at the end of the tilt plays the mirror of the entry', () => {
    const s = at(S_TILT_END);
    s.input(-1, true, 0);
    expect(s.phase()).toBe('exit');
    run(s, ENTRY_MS / 2);
    expect(s.s).toBeCloseTo(S_TILT_END / 2, 9);
    run(s, ENTRY_MS / 2);
    expect([s.s, s.v, s.done()]).toEqual([0, 0, true]);
  });

  it('a notch that lands at the end of the tilt parks there; the next one exits', () => {
    const s = at(0.25);
    s.input(-1, true, 0);
    expect([s.phase(), s.target]).toEqual(['spring', S_TILT_END]);
    s.input(-1, true, 100);
    expect(s.phase()).toBe('leaving');
    run(s, 1000);
    expect(s.done()).toBe(true);
  });

  it('trackpad jitter at the end of the tilt does not exit', () => {
    const s = at(S_TILT_END);
    s.input(-0.04, true, 0);
    s.input(0.04, true, 16);
    s.input(-0.04, true, 32);
    expect(s.phase()).toBe('spring');
  });

  it('a fast flick out from deep in the dolly springs down, then tilts back: C1, monotone, never below 0', () => {
    const s = at(0.6);
    for (let i = 0; i < 6; i++) s.input(-1, true, i * 20);
    let last = s.s, lastV = s.v, maxDv = 0, switched = false;
    for (let t = 0; t < 3000 && !s.done(); t += 1) {
      const was = s.phase();
      s.tick(1);
      if (was !== 'exit' && s.phase() === 'exit') switched = true;
      expect(s.s).toBeLessThanOrEqual(last + 1e-12);
      expect(s.s).toBeGreaterThanOrEqual(0);
      maxDv = Math.max(maxDv, Math.abs(s.v - lastV));
      last = s.s; lastV = s.v;
    }
    expect(switched).toBe(true);
    expect(s.done()).toBe(true);
    expect(maxDv).toBeLessThan(0.4);
  });

  it('scrolling in during the exit turns back to the end of the tilt', () => {
    const s = at(S_TILT_END);
    s.input(-1, true, 0);
    run(s, 200);
    s.input(1, true, 200);
    expect(s.phase()).toBe('enter');
    run(s, 2000);
    expect([s.phase(), s.s]).toEqual(['spring', S_TILT_END]);
  });

  it('in the dolly s never dips into the tilt band, even arriving fast', () => {
    const s = at(0.5);
    for (let i = 0; i < 4; i++) s.input(-1, true, i * 10);
    let min = 1;
    for (let t = 0; t < 1500; t += 1000 / 60) { s.tick(1000 / 60); min = Math.min(min, s.s); }
    expect(s.phase()).toBe('spring');
    expect(min).toBeGreaterThanOrEqual(S_TILT_END);
  });
});

describe('SState first person (A S6, S8)', () => {
  it('caps at the last third-person key when first person is off', () => {
    const s = new SState();
    s.target = 0.9;
    s.input(3, false, 0);
    expect(s.target).toBe(S_LAST_THIRD);
  });

  it('one wheel notch past the cap pushes in over PUSH_MS: s runs 0.92 → 1 from rest to rest', () => {
    const s = at(S_LAST_THIRD);
    s.input(1, true, 0);
    expect([s.phase(), s.target, s.s, s.v]).toEqual(['push', 1, S_LAST_THIRD, 0]);
    run(s, PUSH_MS / 2);
    expect(s.s).toBeCloseTo((S_LAST_THIRD + 1) / 2, 9);
    run(s, PUSH_MS / 2);
    expect([s.phase(), s.target, s.s, s.v]).toEqual(['spring', 1, 1, 0]);
  });

  it('one notch out of first person pulls back over PUSH_MS to the cap, the mirror of the push', () => {
    const s = at(1);
    s.input(-1, true, 0);
    expect(s.phase()).toBe('pull');
    run(s, PUSH_MS / 2);
    expect(s.s).toBeCloseTo((S_LAST_THIRD + 1) / 2, 9);
    run(s, PUSH_MS / 2);
    expect([s.phase(), s.target, s.s, s.v]).toEqual(['spring', S_LAST_THIRD, S_LAST_THIRD, 0]);
  });

  it('the push is frame-rate independent and never overshoots 1', () => {
    const after = (fps: number): number => { const s = at(S_LAST_THIRD); s.input(1, true, 0); run(s, 120, 1000 / fps); return s.s; };
    expect(after(30)).toBeCloseTo(after(144), 9);
    const s = at(S_LAST_THIRD);
    s.input(1, true, 0);
    let last = s.s;
    for (let t = 0; t < PUSH_MS + 50; t += 7) { s.tick(7); expect(s.s).toBeGreaterThanOrEqual(last); expect(s.s).toBeLessThanOrEqual(1); last = s.s; }
  });

  it('a fast scroll that switches before s reaches the cap carries its velocity into the push', () => {
    const s = at(0.6);
    for (let i = 0; i < 4; i++) s.input(1, true, i * 30);
    expect(s.phase()).toBe('spring');
    expect(s.target).toBeCloseTo(S_LAST_THIRD, 12);
    s.input(1, true, 120);
    expect(s.phase()).toBe('push');
    let lastV = s.v, maxDv = 0, last = s.s;
    for (let t = 0; t < 1500 && s.phase() !== 'spring'; t += 1) {
      s.tick(1);
      expect(s.s).toBeGreaterThanOrEqual(last - 1e-12);
      expect(s.s).toBeLessThanOrEqual(1);
      maxDv = Math.max(maxDv, Math.abs(s.v - lastV));
      last = s.s; lastV = s.v;
    }
    expect([s.s, s.v]).toEqual([1, 0]);
    expect(maxDv).toBeLessThan(0.05);
  });

  it('a switch out during the push turns back with the same velocity; a switch in during the pull pushes again', () => {
    const s = at(S_LAST_THIRD);
    s.input(1, true, 0);
    run(s, 150);
    const v0 = s.v, s0 = s.s;
    s.input(-1, true, 150);
    expect(s.phase()).toBe('pull');
    expect([s.s, s.v]).toEqual([s0, v0]);
    run(s, 100);
    s.input(1, true, 260);
    expect(s.phase()).toBe('push');
    run(s, 1000);
    expect([s.phase(), s.s]).toEqual(['spring', 1]);
  });

  it('more scroll-out during the pull rides on top and carries on into the dolly with no velocity dip', () => {
    const s = at(1);
    s.input(-1, true, 0);
    run(s, 100);
    s.input(-2, true, 100);
    let vAtEnd = NaN;
    for (let t = 0; t < 2000; t += 16) { const was = s.phase(); s.tick(16); if (was === 'pull' && s.phase() === 'spring') vAtEnd = s.v; }
    expect(vAtEnd).toBeLessThan(0);
    expect(s.target).toBeCloseTo(S_LAST_THIRD - 2 * S_PER_NOTCH, 12);
    expect(s.s).toBe(s.target);
  });

  it('during the pull, scroll-in first takes back the extra scroll-out, then pushes in again', () => {
    const s = at(1);
    s.input(-1, true, 0);
    s.input(-1, true, 30);
    s.input(1, true, 60);
    expect(s.phase()).toBe('pull');
    expect(s.target).toBeCloseTo(S_LAST_THIRD, 12);
    s.input(1, true, 90);
    expect(s.phase()).toBe('push');
  });

  it('turning first person off pulls out animated, once', () => {
    const s = at(1);
    s.leaveFirstPerson();
    expect(s.phase()).toBe('pull');
    let last = s.s;
    for (let t = 0; t < PUSH_MS + 50; t += 16) { s.leaveFirstPerson(); s.tick(16); expect(s.s).toBeLessThanOrEqual(last); last = s.s; }
    expect([s.phase(), s.s]).toEqual(['spring', S_LAST_THIRD]);
    const p = at(S_LAST_THIRD);
    p.input(1, true, 0);
    run(p, 100);
    p.leaveFirstPerson();
    expect(p.phase()).toBe('pull');
    p.input(1, false, 120);
    expect(p.phase()).toBe('pull');
  });

  it('a hard flick out at the start of the pull, then a quick scroll back in, never jumps (review 2026-10-04)', () => {
    const s = at(1);
    s.input(-1, true, 0);
    s.tick(16);
    for (let i = 0; i < 12; i++) s.input(-1, true, 16 + i);
    s.tick(16);
    expect(s.s).toBeGreaterThan(S_LAST_THIRD);
    s.input(1, true, 40);
    // Before the fix the spring started inside the band and the clamp parked s at the cap in one frame.
    let last = s.s;
    for (let t = 0; t < 2000; t += 16) { s.tick(16); expect(s.s).toBeLessThanOrEqual(last + 1e-12); last = s.s; }
    expect(s.s).toBeCloseTo(S_TILT_END + S_PER_NOTCH, 9);
    expect(s.phase()).toBe('spring');
  });

  it('a flick out from first person through the dolly ends in the exit to 2D', () => {
    const s = at(1);
    for (let i = 0; i < 14; i++) s.input(-1, true, i * 20);
    run(s, 4000);
    expect(s.done()).toBe(true);
  });

  it('there is no dead band: a notch from 0.85 goes to the cap and the next small push enters', () => {
    const s = new SState();
    s.target = 0.85; s.s = 0.85;
    s.input(1, true, 0);
    expect(s.target).toBe(S_LAST_THIRD);
    s.input(SWITCH_NOTCHES, true, 50);
    expect([s.phase(), s.target]).toEqual(['push', 1]);
  });

  it('trackpad jitter cannot flip first person either way', () => {
    const tick = 0.04;
    const s = new SState();
    s.target = 1; s.s = 1;
    s.input(-tick, true, 0);
    s.input(tick, true, 16);
    s.input(-tick, true, 32);
    expect(s.target).toBe(1);
    let t = 48;
    while (s.target === 1) s.input(-tick, true, (t += 16));
    expect(t - 48).toBeLessThanOrEqual(16 * Math.ceil(SWITCH_NOTCHES / tick));

    const u = new SState();
    u.target = S_LAST_THIRD; u.s = S_LAST_THIRD;
    u.input(tick, true, 0);
    u.input(-tick / 2, true, 16);
    expect(u.target).toBeLessThan(1);
  });

  it('the first-person accumulator forgets after a pause', () => {
    const s = new SState();
    s.target = 1; s.s = 1;
    s.input(-SWITCH_NOTCHES * 0.8, true, 0);
    s.input(-SWITCH_NOTCHES * 0.8, true, 2000);
    expect(s.target).toBe(1);
  });
});

describe('LookState (A I2, T7; P5 a)', () => {
  const scratch: CurveKey = { ...CURVE_KEYS[0]! };
  const tp = 0.6, fp = 1;

  it('stored pitch never leaves the current mode range, so reversing responds at once', () => {
    const l = new LookState();
    l.input(0, -500, 0.92, scratch);
    const lo = l.pitch;
    expect(12 + lo * 1).toBeCloseTo(2, 9);
    l.input(0, 1, 0.92, scratch);
    expect(l.pitch).toBeCloseTo(lo + 1, 9);
    l.input(0, 500, 0.92, scratch);
    expect(12 + l.pitch).toBeCloseTo(90, 9);
  });

  it('first person uses the spec range −60…80', () => {
    const l = new LookState();
    l.input(0, 500, fp, scratch);
    expect(2 + l.pitch).toBeCloseTo(80, 9);
    l.input(0, -500, fp, scratch);
    expect(2 + l.pitch).toBeCloseTo(-60, 9);
  });

  it('settle re-clamps when s moves the range (one shared offset across modes)', () => {
    const l = new LookState();
    l.input(0, -20, tp, scratch);
    expect(l.pitch).toBe(-20);
    l.settle(0.92, scratch);
    expect(l.pitch).toBeCloseTo(-10, 9);
    l.settle(fp, scratch);
    expect(l.pitch).toBeCloseTo(-10, 9);
  });

  it('the push-in band blends the range: an upward look in first person eases back to the horizon on the way out', () => {
    const l = new LookState();
    l.input(0, -50, fp, scratch);
    expect(l.pitch).toBe(-50);
    let last = l.pitch;
    for (let s = 1; s >= S_LAST_THIRD; s -= 0.001) {
      l.settle(s, scratch);
      expect(l.pitch).toBeGreaterThanOrEqual(last - 1e-12);
      expect(l.pitch - last).toBeLessThan(2);
      last = l.pitch;
    }
    l.settle(S_LAST_THIRD, scratch);
    expect(Math.abs(12 + l.pitch - 2)).toBeLessThan(0.05);
  });

  it('look input is ignored while orbit is near 0', () => {
    const l = new LookState();
    l.input(90, 30, 0.002, scratch);
    expect([l.yaw, l.pitch]).toEqual([0, 0]);
  });

  it('crossing ±180° while orbit < 1 does not jump, and yaw unwinds along the shortest arc as orbit → 0', () => {
    const l = new LookState();
    l.input(170, 0, 0.3, scratch);
    const s = 0.12;
    const k = (x: number): number => { l.settle(x, scratch); return scratch.orbit; };
    const orbit = k(s);
    expect(orbit).toBeGreaterThan(0.05);
    expect(orbit).toBeLessThan(1);
    const before = l.renderedYaw(orbit);
    l.input(20, 0, s, scratch);
    const after = l.renderedYaw(orbit);
    const d = ((after - before + 540) % 360) - 180;
    expect(Math.abs(d - 20 * orbit)).toBeLessThan(1e-9);

    const m = new LookState();
    m.input(-175, 0, 0.3, scratch);
    let last = Math.abs(m.renderedYaw(1));
    for (let x = 0.3; x >= 0; x -= 0.01) {
      const o = k(x);
      m.settle(x, scratch);
      const r = Math.abs(m.renderedYaw(o));
      expect(r).toBeLessThanOrEqual(last + 1e-9);
      expect(r).toBeLessThanOrEqual(180 * o + 1e-9);
      last = r;
    }
  });

  it('yaw wraps to (−180, 180] once orbit is 1 (invisible there)', () => {
    const l = new LookState();
    l.input(170, 0, 0.3, scratch);
    l.input(30, 0, 0.3, scratch);
    expect(l.yaw).toBe(-160);
  });
});
