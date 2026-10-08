import { describe, expect, it } from 'vitest';
import type { GraphicsPreset } from '../settings';
import { SLOW_GAP_MS, SLOW_WINDOW_MS, createSlowProbe, nextPresetDown, type SlowProbe, type SlowProbeDeps } from './slowProbe';

interface Rig {
  probe: SlowProbe;
  /** Mutable inputs the deps read. */
  env: { t: number; live: boolean; visible: boolean; focused: boolean; transition: boolean; debug: boolean; capMs: number; preset: GraphicsPreset | 'custom'; suggested: boolean };
  offers: GraphicsPreset[];
  reads: { preset: number; suggested: number };
  /** `ms` of game frames `gap` apart, one onFrame each. */
  run(ms: number, gap: number): void;
}

function rig(over: Partial<Rig['env']> = {}): Rig {
  const env: Rig['env'] = {
    t: 1000, live: true, visible: true, focused: true, transition: false, debug: false, capMs: 1000 / 30, preset: 'high', suggested: false, ...over,
  };
  const offers: GraphicsPreset[] = [];
  const reads = { preset: 0, suggested: 0 };
  const deps: SlowProbeDeps = {
    clock: () => env.t,
    isLive: () => env.live,
    visible: () => env.visible,
    focused: () => env.focused,
    inTransition: () => env.transition,
    debugDriven: () => env.debug,
    capMs: () => env.capMs,
    preset: () => { reads.preset++; return env.preset; },
    suggested: () => { reads.suggested++; return env.suggested; },
    suggest: (p) => { offers.push(p); env.suggested = true; },
  };
  const probe = createSlowProbe(deps);
  return {
    probe, env, offers, reads,
    run(ms, gap) {
      for (let done = 0; done < ms; done += gap) {
        env.t += gap;
        probe.onFrame();
      }
    },
  };
}

describe('nextPresetDown (S §4.4)', () => {
  it('steps one preset down; Custom goes to Low; Low has nothing lower', () => {
    expect(nextPresetDown('ultra')).toBe('high');
    expect(nextPresetDown('high')).toBe('medium');
    expect(nextPresetDown('medium')).toBe('low');
    expect(nextPresetDown('custom')).toBe('low');
    expect(nextPresetDown('low')).toBeNull();
  });
});

describe('slow probe state machine (perf Task 11)', () => {
  it('fires once when the median gap of every second stays over 45 ms for 5 s while live, visible, focused and steady', () => {
    const r = rig();
    r.run(SLOW_WINDOW_MS - 200, 60);
    expect(r.offers).toEqual([]);
    r.run(400, 60);
    expect(r.offers).toEqual(['medium']);
    r.run(30_000, 60);
    expect(r.offers).toEqual(['medium']);
    expect(r.probe.stats().fired).toBe(true);
  });

  it('never fires at the normal 3D rate, nor at exactly 45 ms', () => {
    const a = rig();
    a.run(30_000, 1000 / 30);
    const b = rig();
    b.run(30_000, SLOW_GAP_MS);
    expect([...a.offers, ...b.offers]).toEqual([]);
  });

  it('is a median: fires when most gaps are slow, not when a minority are', () => {
    const mostly = rig();
    for (let i = 0; i < 200; i++) { mostly.run(60, 60); mostly.run(60, 60); mostly.run(33, 33); }
    expect(mostly.offers).toEqual(['medium']);
    const few = rig();
    for (let i = 0; i < 200; i++) { few.run(60, 60); few.run(66, 33); }
    expect(few.offers).toEqual([]);
  });

  it.each([
    ['not live', { live: false }, 'not-live'],
    ['hidden tab', { visible: false }, 'hidden'],
    ['unfocused window', { focused: false }, 'unfocused'],
    ['entry/exit or first-person move', { transition: true }, 'transition'],
    ['debug camera', { debug: true }, 'debug'],
    ['the game\'s own 20 FPS cap (PC15)', { capMs: 50 }, 'capped'],
  ] as const)('%s blocks it', (_name, block, reason) => {
    const r = rig(block);
    r.run(20_000, 80);
    expect(r.offers).toEqual([]);
    expect(r.probe.stats()).toMatchObject({ samples: 0, blocked: reason });
  });

  it('stats in 2D (no frames run) say not-live, not sampling', () => {
    const r = rig({ live: false });
    expect(r.probe.stats().blocked).toBe('not-live');
    r.env.live = true;
    r.run(500, 33);
    r.env.live = false;
    expect(r.probe.stats().blocked).toBe('not-live');
  });

  it('a 30 FPS cap still samples (its 33 ms gap is under the threshold)', () => {
    const r = rig({ capMs: 1000 / 30 });
    r.run(SLOW_WINDOW_MS + 200, 60);
    expect(r.offers).toEqual(['medium']);
  });

  it('a block empties the window, and the gap across it never counts', () => {
    const r = rig();
    r.run(4000, 60);
    r.env.focused = false;
    r.run(3000, 60);
    r.env.focused = true;
    r.run(4000, 60);
    expect(r.offers).toEqual([]);
    expect(r.probe.stats().median).toBe(60);
    r.run(1500, 60);
    expect(r.offers).toEqual(['medium']);
  });

  it('a hidden stretch with the clock running adds no gap', () => {
    const r = rig();
    r.run(1000, 33);
    r.env.visible = false;
    r.probe.onFrame();
    r.env.t += 3000;
    r.env.visible = true;
    r.run(1000, 33);
    expect(r.probe.stats().samples).toBeLessThan(31);
    expect(r.probe.stats().median).toBeCloseTo(33, 5);
  });

  it('recovery before 5 s: a slow burst followed by the normal rate never fires', () => {
    const r = rig();
    r.run(4000, 70);
    r.run(20_000, 1000 / 30);
    expect(r.offers).toEqual([]);
  });

  it('one normal second resets the run: slow 3 s, normal 1.5 s, slow 4 s does not fire; 2.5 s more does', () => {
    const r = rig();
    r.run(3000, 60);
    r.run(1500, 1000 / 30);
    r.run(4000, 60);
    expect(r.offers).toEqual([]);
    // The second straddling normal → slow can still close normal: five slow ones need up to ~6.1 s after the switch.
    r.run(2500, 60);
    expect(r.offers).toEqual(['medium']);
  });

  it('a lone stall in a normal stretch never fires', () => {
    const r = rig();
    r.run(3000, 1000 / 30);
    r.run(2000, 2000);
    r.run(10_000, 1000 / 30);
    expect(r.offers).toEqual([]);
  });

  it('reset() (an exit) empties the window', () => {
    const r = rig();
    r.run(4000, 60);
    r.probe.reset();
    r.run(4000, 60);
    expect(r.offers).toEqual([]);
    r.run(1500, 60);
    expect(r.offers).toEqual(['medium']);
  });

  it('the same game frame drawn twice adds nothing; a clock that runs backwards restarts the window', () => {
    const r = rig();
    r.run(1000, 60);
    const n = r.probe.stats().samples;
    r.probe.onFrame();
    expect(r.probe.stats().samples).toBe(n);
    r.env.t -= 500;
    r.probe.onFrame();
    expect(r.probe.stats().samples).toBe(0);
  });

  it('at most once ever: a hint set before install keeps it dormant, read once', () => {
    const r = rig({ suggested: true });
    r.run(20_000, 80);
    expect(r.offers).toEqual([]);
    expect(r.reads.suggested).toBe(1);
    expect(r.probe.stats()).toMatchObject({ samples: 0, blocked: 'suggested' });
  });

  it('a hint set elsewhere while sampling stops it at the next slow window', () => {
    const r = rig();
    r.run(2000, 60);
    r.env.suggested = true;
    r.run(20_000, 60);
    expect(r.offers).toEqual([]);
    expect(r.probe.stats().blocked).toBe('suggested');
  });

  it('Low never fires but keeps watching: switching to Ultra later offers High', () => {
    const r = rig({ preset: 'low' });
    r.run(20_000, 80);
    expect(r.offers).toEqual([]);
    r.env.preset = 'ultra';
    r.run(SLOW_WINDOW_MS + 600, 80);
    expect(r.offers).toEqual(['high']);
  });

  it.each([
    ['ultra', 'high'], ['high', 'medium'], ['medium', 'low'], ['custom', 'low'],
  ] as const)('offers the next preset down: %s → %s', (from, to) => {
    const r = rig({ preset: from });
    r.run(SLOW_WINDOW_MS + 200, 60);
    expect(r.offers).toEqual([to]);
  });

  it('reads storage-backed deps only when a window comes out slow, never per frame', () => {
    const r = rig();
    r.run(4000, 60);
    expect(r.reads).toEqual({ preset: 0, suggested: 1 });
  });
});
