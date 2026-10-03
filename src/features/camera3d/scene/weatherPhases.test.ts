import { describe, expect, it } from 'vitest';
import { extractHashFn, phaseProgram } from './weatherPhases';

// Live game VS excerpt (build 1381, weather-pattern-pass-vertex).
const LIVE_VS = 'uniform float uLastFrameTransparent;\n\nfloat hashCell(vec2 cell) {\n  float n =\n    sin(dot(cell, vec2(12.9898, 78.233))) *\n    43758.5453;\n\n  return fract(abs(n));\n}\n\nvoid main(void) {\n  vLocalPx = aPosition - aCell * uFrameSizePx;\n}\n';

describe('extractHashFn', () => {
  it('takes the game hash function verbatim', () => {
    const h = extractHashFn(LIVE_VS)!;
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
    const p = phaseProgram(extractHashFn(LIVE_VS)!);
    expect(p.vs).toContain('vPhase = floor(hashCell(aCell) * uPhaseCount);');
    expect(p.vs).toContain('precision highp float;');
    expect(p.vs).toContain('gl_PointSize = 1.0;');
    expect(p.fs).toContain('finalColor = vec4(vPhase / 255.0, 0.0, 0.0, 1.0);');
  });
});
