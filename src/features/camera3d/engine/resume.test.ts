import { describe, expect, it } from 'vitest';
import { S_LAST_THIRD, S_TILT_END } from '../math/zoomCurve';
import { RESUME_WINDOW_MS, ResumeWindow, gameTakesCamera, resumeTarget } from './resume';
import { ENTRY_MS, FORCED_EXIT_MS, SState, S_PER_NOTCH } from './zoomState';

const POSE = { s: 0.6, yaw: 120, pitch: -8 };
const run = (st: SState, ms: number, step = 1000 / 60): void => {
  for (let t = 0; t < ms - 1e-9; t += step) st.tick(Math.min(step, ms - t));
};
const at = (x: number): SState => { const s = new SState(); s.s = x; s.target = x; return s; };

describe('SState forced exit (P4 a)', () => {
  it('from anywhere, one eased move reaches 0 within FORCED_EXIT_MS, monotone, then done', () => {
    for (const from of [S_TILT_END, 0.6, S_LAST_THIRD, 1]) {
      const s = at(from);
      s.forceOut();
      expect(s.phase()).toBe('exit');
      let last = s.s;
      for (let t = 0; t < FORCED_EXIT_MS; t += 8) { s.tick(8); expect(s.s).toBeLessThanOrEqual(last + 1e-12); last = s.s; }
      expect([s.s, s.v, s.done()]).toEqual([0, 0, true]);
    }
  });

  it('picks up the velocity of a zoom in progress, and runs even before the first 3D frame drew', () => {
    const s = at(0.5);
    s.input(-2, true, 0);
    run(s, 50);
    const v0 = s.v;
    s.forceOut();
    expect(s.v).toBe(v0);
    run(s, FORCED_EXIT_MS);
    expect(s.done()).toBe(true);
    const e = new SState();
    e.start();
    e.forceOut();
    run(e, FORCED_EXIT_MS);
    expect(e.done()).toBe(true);
  });
});

describe('SState resume (P4 a)', () => {
  it('from 2D: holds at 0 until the first 3D frame, then one move lands on the remembered pose at rest', () => {
    for (const to of [S_TILT_END, 0.6, S_LAST_THIRD]) {
      const s = new SState();
      s.resume(to);
      s.tick(40);
      expect([s.s, s.phase()]).toEqual([0, 'resume']);
      s.startClock();
      let last = 0;
      for (let t = 0; t < 1500 && s.phase() === 'resume'; t += 8) { s.tick(8); expect(s.s).toBeGreaterThanOrEqual(last - 1e-12); expect(s.s).toBeLessThanOrEqual(to + 1e-12); last = s.s; }
      expect([s.phase(), s.s, s.v, s.target]).toEqual(['spring', to, 0, to]);
    }
  });

  it('a first-person pose resumes through the push-in and parks in first person', () => {
    const s = new SState();
    s.resume(1);
    s.startClock();
    run(s, 2000);
    expect([s.phase(), s.s, s.target]).toEqual(['spring', 1, 1]);
  });

  it("takes Task 4's entry time for the tilt and a little more per unit of dolly", () => {
    const tilt = new SState(); tilt.resume(S_TILT_END); tilt.startClock();
    let t1 = 0; while (tilt.phase() === 'resume') { tilt.tick(1); t1++; }
    expect(Math.abs(t1 - ENTRY_MS)).toBeLessThanOrEqual(2);
    const far = new SState(); far.resume(S_LAST_THIRD); far.startClock();
    let t2 = 0; while (far.phase() === 'resume') { far.tick(1); t2++; }
    expect(t2).toBeGreaterThan(ENTRY_MS);
    expect(t2).toBeLessThan(2 * ENTRY_MS);
  });

  it('a block that clears mid-exit turns back toward the pose with the same velocity', () => {
    const s = at(0.6);
    s.forceOut();
    run(s, 100);
    const s0 = s.s, v0 = s.v;
    s.resume(0.6);
    expect([s.s, s.v, s.phase()]).toEqual([s0, v0, 'resume']);
    run(s, 2000);
    expect([s.phase(), s.s]).toEqual(['spring', 0.6]);
  });

  it('a block that clears late in a fast exit turns back without parking on the 2D image (review 2026-10-04)', () => {
    const s = at(0.6);
    s.forceOut();
    while (s.s > 0.1) s.tick(4);
    expect(s.v).toBeLessThan(-1.5);
    s.resume(0.6);
    s.tick(4);
    expect(s.v).toBeLessThan(0);
    for (let t = 0; t < 2000 && s.phase() === 'resume'; t += 4) { s.tick(4); expect(s.s).toBeGreaterThan(0); }
    expect([s.phase(), s.s]).toEqual(['spring', 0.6]);
  });

  it('scroll-out during a resume into first person goes to the cap, however small (review 2026-10-04)', () => {
    const s = new SState(); s.resume(1); s.startClock();
    while (s.s <= S_LAST_THIRD + 0.01) s.tick(4);
    s.input(-0.05, true, 0);
    expect(s.phase()).toBe('pull');
    for (let t = 0; t < 2000; t += 4) { s.tick(4); expect(s.s).toBeLessThan(1); }
    expect(s.s).toBeCloseTo(S_LAST_THIRD, 9);
  });

  it('scroll-in above the cap during a resume never pushes in with first person off (review 2026-10-04)', () => {
    const s = at(1);
    s.forceOut();
    run(s, 30);
    s.resume(S_LAST_THIRD);
    expect(s.s).toBeGreaterThan(S_LAST_THIRD);
    s.input(1, false, 0);
    expect(s.phase()).toBe('pull');
    for (let t = 0; t < 2000; t += 4) { s.tick(4); expect(s.s).toBeLessThan(1); }
    expect(s.s).toBeCloseTo(S_LAST_THIRD, 9);
  });

  it('zoom input during the resume hands over from where the camera is, in each band', () => {
    const tilt = new SState(); tilt.resume(S_LAST_THIRD); tilt.startClock(); run(tilt, 60);
    expect(tilt.s).toBeLessThan(S_TILT_END);
    tilt.input(1, true, 60);
    expect(tilt.phase()).toBe('enter');
    run(tilt, 2000);
    expect(tilt.s).toBeCloseTo(S_TILT_END + S_PER_NOTCH, 9);

    const dolly = new SState(); dolly.resume(S_LAST_THIRD); dolly.startClock();
    while (dolly.s < 0.5) dolly.tick(4);
    const s0 = dolly.s;
    dolly.input(-1, true, 0);
    expect(dolly.phase()).toBe('spring');
    run(dolly, 2000);
    expect(dolly.s).toBeCloseTo(Math.max(S_TILT_END, s0 - S_PER_NOTCH), 9);

    const band = new SState(); band.resume(1); band.startClock();
    while (band.s <= S_LAST_THIRD + 0.01) band.tick(4);
    band.input(-1, true, 0);
    expect(band.phase()).toBe('pull');
  });
});

describe('resumeTarget (P4 a)', () => {
  it('remembers the pose being zoomed to, and nothing when the user was already leaving 3D', () => {
    expect(resumeTarget('spring', 0.6, true)).toBe(0.6);
    expect(resumeTarget('enter', S_TILT_END + 0.16, true)).toBeCloseTo(S_TILT_END + 0.16, 12);
    expect(resumeTarget('exit', 0, true)).toBeNull();
    expect(resumeTarget('leaving', 0, true)).toBeNull();
  });

  it('a leave asked for during the pull-out counts as leaving (review 2026-10-04)', () => {
    const s = at(1);
    s.input(-1, true, 0);
    s.tick(16);
    for (let i = 0; i < 12; i++) s.input(-1, true, 16 + i);
    expect(s.s).toBeGreaterThan(S_LAST_THIRD);
    expect(s.phase()).toBe('leaving');
    expect(resumeTarget(s.phase(), s.target, true)).toBeNull();
    s.input(1, true, 40);
    expect(s.phase()).toBe('pull');
  });

  it('first person resolves to the eye, or to the last third-person key when first person is off', () => {
    expect(resumeTarget('push', 1, true)).toBe(1);
    expect(resumeTarget('spring', 1, false)).toBe(S_LAST_THIRD);
    expect(resumeTarget('pull', S_LAST_THIRD - 0.08, true)).toBeCloseTo(S_LAST_THIRD - 0.08, 12);
  });
});

describe('gameTakesCamera', () => {
  const sys = (block: boolean) => ({ shouldBlockZoom: () => block });

  it('a dialog, the inventory or a confirmation (UI owns input, live v1419) never forces 3D out', () => {
    expect(gameTakesCamera({ inputBlocked: false }, sys(true))).toBe(false);
  });

  it('a cutscene camera or the tram focus zoom (zoom.inputBlocked) does', () => {
    expect(gameTakesCamera({ inputBlocked: true }, sys(true))).toBe(true);
  });

  it('without the inputBlocked getter, falls back to the whole zoom block', () => {
    expect(gameTakesCamera({}, sys(true))).toBe(true);
    expect(gameTakesCamera({}, sys(false))).toBe(false);
  });
});

describe('ResumeWindow (P4 a)', () => {
  it('waits while blocked, then hands the pose out exactly once', () => {
    const w = new ResumeWindow();
    w.arm(POSE, 1000, 384);
    expect(w.take(2000, false, 384)).toBeNull();
    expect(w.pending()).toBe(true);
    expect(w.take(3000, true, 384)).toEqual(POSE);
    expect(w.pending()).toBe(false);
    expect(w.take(3100, true, 384)).toBeNull();
  });

  it('a block that outlasts the window ends in plain 2D', () => {
    const w = new ResumeWindow();
    w.arm(POSE, 1000, 384);
    expect(w.take(1000 + RESUME_WINDOW_MS + 1, true, 384)).toBeNull();
    expect(w.pending()).toBe(false);
  });

  it('zooming the 2D game while out (the intent changed) forgets the pose', () => {
    const w = new ResumeWindow();
    w.arm(POSE, 1000, 384);
    expect(w.take(1500, false, 295)).toBeNull();
    expect(w.pending()).toBe(false);
  });

  it('keeps its own copy of the pose, and clear() forgets it', () => {
    const w = new ResumeWindow();
    const p = { ...POSE };
    w.arm(p, 0, 384);
    p.s = 0.9;
    expect(w.take(1, true, 384)?.s).toBe(0.6);
    w.arm(POSE, 0, 384);
    w.clear();
    expect(w.take(1, true, 384)).toBeNull();
  });
});
