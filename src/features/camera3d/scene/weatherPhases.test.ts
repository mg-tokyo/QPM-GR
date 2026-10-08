import { describe, expect, it } from 'vitest';
import { LIVE_WEATHER_VS } from '../__test__/weatherShaders';
import { createPhaseCache, extractHashFn, phasePoints, phaseProgram, type PhaseRender } from './weatherPhases';

describe('extractHashFn (live 1419 source)', () => {
  it('takes the game hash function verbatim', () => {
    const h = extractHashFn(LIVE_WEATHER_VS)!;
    expect(h.name).toBe('hashCell');
    expect(h.src.startsWith('float hashCell(vec2 cell) {')).toBe(true);
    expect(h.src.endsWith('return fract(abs(n));\n}')).toBe(true);
  });
  it('returns null without a vec2 → float function', () => {
    expect(extractHashFn('void main(void) {}\n')).toBeNull();
  });
});

describe('phaseProgram', () => {
  it('evaluates the hash exactly as the game VS does, one point per cell', () => {
    const p = phaseProgram(extractHashFn(LIVE_WEATHER_VS)!);
    expect(p.vs).toContain('vPhase = floor(hashCell(aCell) * uPhaseCount);');
    expect(p.vs).toContain('precision highp float;');
    expect(p.vs).toContain('gl_PointSize = 1.0;');
    expect(p.fs).toContain('finalColor = vec4(vPhase / 255.0, 0.0, 0.0, 1.0);');
  });
});

describe('phasePoints', () => {
  it('takes one point per cell (4 vertices each) and the grid size', () => {
    const aCell = new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 2, 1, 2, 1, 2, 1, 2, 1]);
    const p = phasePoints(aCell)!;
    expect(Array.from(p.pts)).toEqual([0, 0, 2, 1]);
    expect([p.cols, p.rows]).toEqual([3, 2]);
    expect(phasePoints(new Float32Array(0))).toBeNull();
  });
});

describe('createPhaseCache', () => {
  const aCell = new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 1, 0, 1, 0]);
  const rgba = (r: number[]): Uint8Array => new Uint8Array(r.flatMap((v) => [v, 0, 0, 255]));

  it('reads the red channel per cell and keeps a success for the session', () => {
    let calls = 0;
    const render: PhaseRender = () => { calls++; return rgba([7, 42]); };
    const cache = createPhaseCache(render);
    const m = cache.get(LIVE_WEATHER_VS, aCell, 50)!;
    expect(Array.from(m.phases)).toEqual([7, 42]);
    expect(cache.get(LIVE_WEATHER_VS, aCell, 50)).toBe(m);
    expect(calls).toBe(1);
  });
  // A failure (lost context, a refused program) is retried the next time a grid is built, never cached (A W4).
  it('does not keep a failure, and treats an all-clear readback as one', () => {
    let calls = 0;
    let out: Uint8Array | null = null;
    const cache = createPhaseCache(() => { calls++; return out; });
    expect(cache.get(LIVE_WEATHER_VS, aCell, 50)).toBeNull();
    out = rgba([255, 255]);
    expect(cache.get(LIVE_WEATHER_VS, aCell, 50)).toBeNull();
    out = rgba([3, 255]);
    expect(Array.from(cache.get(LIVE_WEATHER_VS, aCell, 50)!.phases)).toEqual([3, 255]);
    expect(calls).toBe(3);
  });
  it('fails without a hash function or with a phase count the readback cannot hold', () => {
    const cache = createPhaseCache(() => rgba([1, 2]));
    expect(cache.get('void main(void) {}\n', aCell, 50)).toBeNull();
    expect(cache.get(LIVE_WEATHER_VS, aCell, 255)).toBeNull();
    expect(cache.get(LIVE_WEATHER_VS, aCell, 0)).toBeNull();
  });
});
