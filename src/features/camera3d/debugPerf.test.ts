import { describe, expect, it } from 'vitest';
import type { ManualView, SweepOpts } from './debugApi';
import { WALK_PX_PER_S, offScreenRoot, runBench, statOf, walkOffset, type BenchEnv, type PerfResult } from './debugPerf';

describe('statOf', () => {
  it('averages and takes the nearest-rank p95 and the max over the first n samples', () => {
    const v = new Float64Array(64);
    for (let i = 0; i < 20; i++) v[i] = i + 1;
    expect(statOf(v, 20)).toEqual({ avg: 10.5, p95: 20, max: 20 });
  });

  it('is all zeros with no samples', () => {
    expect(statOf(new Float64Array(4), 0)).toEqual({ avg: 0, p95: 0, max: 0 });
  });
});

describe('offScreenRoot (audit PA4 rule: one tile beside, three above, two below)', () => {
  const W = 3072, H = 1594, mm = 0.25, tile = 256 * mm;
  it('keeps a root whose point is on screen or within its art band', () => {
    expect(offScreenRoot(10, 10, mm, W, H)).toBe(false);
    expect(offScreenRoot(-tile, -3 * tile, mm, W, H)).toBe(false);
    expect(offScreenRoot(W + tile, H + 2 * tile, mm, W, H)).toBe(false);
  });
  it('flags a root past the band on any side', () => {
    expect(offScreenRoot(-tile - 1, 10, mm, W, H)).toBe(true);
    expect(offScreenRoot(10, -3 * tile - 1, mm, W, H)).toBe(true);
    expect(offScreenRoot(10, H + 2 * tile + 1, mm, W, H)).toBe(true);
  });
});

describe('walkOffset', () => {
  it('walks out at 10 tiles/s for 2 s, back for 2 s, and repeats', () => {
    expect(WALK_PX_PER_S).toBe(2560);
    expect(walkOffset(0)).toBe(0);
    expect(walkOffset(1)).toBe(2560);
    expect(walkOffset(2)).toBe(5120);
    expect(walkOffset(3)).toBe(2560);
    expect(walkOffset(4)).toBeCloseTo(0, 9);
    expect(walkOffset(5)).toBeCloseTo(2560, 6);
  });
});

const result = (label: string): PerfResult => ({ mode: '3d', frames: 1, label } as unknown as PerfResult);
const rowsOf = (r: Awaited<ReturnType<typeof runBench>>): Exclude<typeof r, string> => {
  if (typeof r === 'string') throw new Error(r);
  return r;
};

function fakeEnv(o: { throwOn?: string; live?: boolean; noIntent?: boolean } = {}) {
  const manual: ManualView = { yaw: 0, pitch: 28, dist: 1600, fov: 55, lookH: 120, yOff: 0.12, target: null, hideSelf: false, s: null, lookPitch: 0 };
  const userTarget = { x: 1, y: 2 };
  manual.target = userTarget;
  const log: string[] = [];
  let intent = 60;
  let live = o.live ?? false;
  let frameFn: ((now: number) => void) | null = null;
  const clock = 0;
  const targets: Array<{ x: number; y: number }> = [];
  const env: BenchEnv = {
    cam: {
      enter(v: Partial<ManualView>) { Object.assign(manual, v); live = true; log.push(`enter ${v.s} ${v.yaw}`); return true; },
      set(v: Partial<ManualView>) { Object.assign(manual, v); return { ...manual }; },
      exit() { live = false; log.push('exit'); },
      sweep(s: SweepOpts) { Object.assign(manual, { yaw: s.from, s: null }); live = true; log.push(`sweep ${s.from}`); return Promise.resolve({ buildPct: 4 }); },
    },
    live: () => live,
    ground: () => ({ x: 5000, y: 5000 }),
    intent: o.noIntent ? null : { get: () => intent, set: (v: number) => { intent = v; log.push(`intent ${v}`); } },
    perf(ms: number) {
      const key = live ? `${manual.s ?? 'raw'} ${manual.yaw}` : '2d';
      log.push(`perf ${key} ${ms} @${intent}`);
      if (frameFn) for (const t of [0, 500, 1000]) { frameFn(clock + t); if (manual.target) targets.push({ ...manual.target }); }
      if (o.throwOn === key) return Promise.reject(new Error('boom'));
      return Promise.resolve(result(key));
    },
    beforeFrame(fn) { frameFn = fn; log.push('drive on'); return () => { frameFn = null; log.push('drive off'); }; },
    wait: () => Promise.resolve(),
    now: () => clock,
  };
  return { env, manual, log, targets, userTarget, intent: () => intent };
}

describe('runBench', () => {
  it('refuses to start in 3D and without a settable zoom intent, changing nothing', async () => {
    const a = fakeEnv({ live: true });
    expect(await runBench({}, a.env)).toBe('exit 3D first');
    const b = fakeEnv({ noIntent: true });
    expect(await runBench({}, b.env)).toBe('no zoom intent');
    expect([...a.log, ...b.log]).toEqual([]);
  });

  it('runs 2D, the still poses, the walk and the orbit at intent 384, then restores intent and manual camera', async () => {
    const f = fakeEnv();
    const before = { ...f.manual };
    const rows = rowsOf(await runBench({ poses: [{ s: 0.85, yaw: 0 }, { s: 1, yaw: 135 }] }, f.env));
    expect(Object.keys(rows)).toEqual(['2d', 's0.85 y0', 's1 y135', 'walk s0.85 y135', 'orbit']);
    expect(f.log.filter((l) => l.startsWith('perf')).every((l) => l.endsWith('@384'))).toBe(true);
    expect(f.intent()).toBe(60);
    expect(f.manual).toEqual(before);
    expect(f.manual.target).toBe(f.userTarget);
    expect(f.env.live()).toBe(false);
    expect((rows.orbit as unknown as { sweep: unknown }).sweep).toEqual({ buildPct: 4 });
  });

  it('drives the walk target diagonally from the avatar at 10 tiles/s, only during the walk', async () => {
    const f = fakeEnv();
    await runBench({ poses: [], twoD: false, orbit: false }, f.env);
    expect(f.log.filter((l) => l.startsWith('drive'))).toEqual(['drive on', 'drive off']);
    const d = (t: { x: number; y: number }): number => Math.round((t.x - 5000) / Math.SQRT1_2);
    expect(f.targets.map(d)).toEqual([0, 1280, 2560]);
    expect(f.targets.every((t) => t.x === t.y)).toBe(true);
  });

  it('records a throwing pose as an error row, finishes the rest and still restores everything', async () => {
    const f = fakeEnv({ throwOn: '1 135' });
    const before = { ...f.manual };
    const rows = rowsOf(await runBench({ poses: [{ s: 1, yaw: 135 }, { s: 0.5, yaw: 135 }], orbit: false }, f.env));
    expect(rows['s1 y135']).toMatch(/boom/);
    expect(typeof rows['s0.5 y135']).toBe('object');
    expect(f.intent()).toBe(60);
    expect(f.manual).toEqual(before);
    expect(f.env.live()).toBe(false);
  });
});
