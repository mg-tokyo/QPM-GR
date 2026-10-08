import { describe, expect, it } from 'vitest';
import { LIVE_WEATHER_FS as LIVE_FS, LIVE_WEATHER_VS as LIVE_VS } from '../__test__/weatherShaders';
import { patchWeatherFragment, patchWeatherTall, patchWeatherVertex, stripShaderName } from './shaders';
import { weatherPatchIssues } from './weatherCells';
import { extractHashFn } from './weatherPhases';

describe('patchWeatherVertex (live 1419 source)', () => {
  it('swaps the 2D position line for the 3D projection and declares the stand and slab uniforms', () => {
    const out = patchWeatherVertex(LIVE_VS)!;
    expect(out).toContain('uniform vec3 uCamPos;');
    expect(out).toContain('uniform float uStand;');
    expect(out).toContain('uniform vec2 uSortDir;');
    expect(out).toContain('uniform vec2 uSlab;');
    expect(out).toContain('out float vQAlpha;');
    expect(out).toContain('void main(void) {\n  vQAlpha = uFlatAlpha;');
    expect(out).toContain('vec4(qClip.xy, qz - 2.0 * uNear, qz)');
    expect(out).not.toContain('vec3(aPosition, 1.0)).xy, 0.0, 1.0);');
  });
  // P9 depth slabs: a cell outside the mesh's slab gets zero alpha, which the projection already moves off-screen.
  it('keeps only the cells whose foot lies in the slab', () => {
    const out = patchWeatherVertex(LIVE_VS)!;
    expect(out).toMatch(/float qAlong = dot\(qFoot, uSortDir\);/);
    expect(out).toMatch(/vQAlpha = uFlatAlpha \* qKeep \* mix\(1\.0, qFar, uStand\) \* step\(uSlab\.x, qAlong\) \* \(1\.0 - step\(uSlab\.y, qAlong\)\);/);
  });
  // PIXI keeps an existing SHADER_NAME, so two mirrors built from the game's processed source shared one program key
  // and the second never got its attribute data (live 2026-10-03, rain: "reading 'aPosition'" in getSignature).
  it('drops the game program name so PIXI names each mirror uniquely', () => {
    const out = patchWeatherVertex(LIVE_VS)!;
    expect(out).not.toContain('SHADER_NAME');
    expect(out.startsWith('#version 300 es\nprecision highp float;\n')).toBe(true);
  });
  // Tall standing weather: the card stretches about its foot and its local px with it, so the art repeats up the column.
  it('stretches a standing card to the eye height, taller only near a first-person camera', () => {
    const out = patchWeatherVertex(LIVE_VS)!;
    for (const d of ['uniform float uStandTiles;', 'uniform float uNearTall;', 'uniform float uNearPx;', 'flat out vec2 vQCell;', 'out float vQH;']) {
      expect(out).toContain(d);
    }
    expect(out.match(/float qD = length\(qFoot - uCamPos\.xz\);/g)).toHaveLength(1);
    // The top sits on the horizon line (the eye height), so no drop draws over the sky; first person lifts the near ones.
    expect(out).toContain('float qTop = min(max(uCamPos.y, 1.0), qMax);');
    expect(out).toContain('qTop = mix(qTop, mix(qMax, qTop, smoothstep(uNearPx, 2.0 * uNearPx, qD)), uNearTall);');
    // uStandTiles 1 (no tall fragment) keeps the one-frame card exactly.
    expect(out).toContain('float qK = uStandTiles > 1.0 ? mix(1.0, qTop / qF, uStand) : 1.0;');
    expect(out).toContain('vLocalPx.y = uFootPx - (uFootPx - vLocalPx.y) * qK;');
    expect(out).toContain('vec3 qStand = vec3(qFoot.x + qLocal.x * uCamR.x, -qLocal.y * qK, qFoot.y + qLocal.x * uCamR.z);');
    expect(out).toContain('vQH = uStandTiles > 1.0 ? uStand * (qFoot.y - aPosition.y) / max(uFootPx, 1.0) : 0.0;');
    expect(out.indexOf('float qD =')).toBeLessThan(out.indexOf('float qTop ='));
  });
  it('returns null on each drifted anchor', () => {
    expect(patchWeatherVertex('void main(void) { gl_Position = vec4(0.0); }')).toBeNull();
    expect(patchWeatherVertex(LIVE_VS.replace('in vec2 aCell;\n', ''))).toBeNull();
    expect(patchWeatherVertex(LIVE_VS.replace('uniform vec2 uFrameSizePx;', 'uniform vec2 uCellSizePx;'))).toBeNull();
    expect(patchWeatherVertex(LIVE_VS.replace('vec3(aPosition, 1.0)).xy, 0.0, 1.0);', 'vec3(aPosition, 1.0)).xy, 0.5, 1.0);'))).toBeNull();
    expect(patchWeatherVertex(LIVE_VS.replace('precision highp float;\n', 'precision mediump float;\n'))).toBeNull();
    expect(patchWeatherVertex(LIVE_VS.replace('void main(void) {', 'void main() {'))).toBeNull();
  });
});

describe('patchWeatherFragment (live 1419 source)', () => {
  it('scales the game colour by the per-cell alpha', () => {
    const out = patchWeatherFragment(LIVE_FS)!;
    expect(out).toContain('precision highp float;\nin float vQAlpha;\n');
    expect(out).toContain('* uOpacity * vQAlpha;');
    expect(out).not.toContain('SHADER_NAME');
  });
  it('returns null when the colour line or the precision line changed', () => {
    expect(patchWeatherFragment(LIVE_FS.replace(' * uOpacity;', ';'))).toBeNull();
    expect(patchWeatherFragment(LIVE_FS.replace('precision highp float;\n', 'precision mediump float;\n'))).toBeNull();
  });
});

describe('patchWeatherTall (live 1419 source)', () => {
  const faded = patchWeatherFragment(LIVE_FS)!;
  const hash = extractHashFn(LIVE_VS)!;
  it('wraps the sample up the column and keeps the LOD on the unwrapped local px', () => {
    const out = patchWeatherTall(faded, hash)!;
    expect(out).toContain('clamp(vec2(vLocalPx.x, mod(vLocalPx.y, uFrameSizePx.y)),');
    expect(out).toContain('vec2 ddx = dFdx(vLocalPx) / uAtlasSizePx;');
    expect(out).toContain('vec2 ddy = dFdy(vLocalPx) / uAtlasSizePx;');
  });
  // Each repeat above the foot plays the phase of the 2D cell that many rows up, through the game's own hash.
  it('gives each layer above the foot its own phase from the game hash', () => {
    const out = patchWeatherTall(faded, hash)!;
    expect(out).toContain('flat in vec2 vQCell;');
    expect(out).toContain('in float vQH;');
    expect(out).toContain(hash.src);
    for (const u of ['uCycleFrame', 'uFrameCount', 'uPhaseCount', 'uCycleSlots', 'uLastFrameTransparent']) {
      expect(out.match(new RegExp(`uniform float ${u};`, 'g'))).toHaveLength(1);
    }
    expect(out).toContain('void main(void) {\n  float qL = floor((uFrameSizePx.y - vLocalPx.y) / uFrameSizePx.y);\n'
      + '  float vFrame = qL < 0.5 ? vFrame : qFrameAt(vQCell - vec2(0.0, qL));');
    expect(out).toContain('if (qL > 0.5 && uLastFrameTransparent > 0.5 && vFrame >= uFrameCount - 1.0) discard;');
  });
  it('fades the top of the column', () => {
    expect(patchWeatherTall(faded, hash)!).toMatch(/\* uOpacity \* vQAlpha \* \(1\.0 - smoothstep\([\d.]+, 1\.0, vQH\)\);/);
  });
  it('never redeclares a cycle uniform the fragment already has', () => {
    const own = faded.replace('uniform float uOpacity;', 'uniform float uOpacity;\nuniform float uFrameCount;');
    expect(patchWeatherTall(own, hash)!.match(/uniform float uFrameCount;/g)).toHaveLength(1);
  });
  it('returns null on each drifted anchor', () => {
    expect(patchWeatherTall(stripShaderName(LIVE_FS), hash)).toBeNull();
    expect(patchWeatherTall(faded.replace(/clamp\(\s*vLocalPx\s*,/, 'clamp(vLocalPx.xy,'), hash)).toBeNull();
    expect(patchWeatherTall(faded.replace('flat in float vFrame;', 'flat in int vFrame;'), hash)).toBeNull();
    expect(patchWeatherTall(faded.replace('uniform vec2 uFrameSizePx;', 'uniform vec2 uCellSizePx;'), hash)).toBeNull();
    expect(patchWeatherTall(faded.replace('void main(void) {', `${hash.src}\nvoid main(void) {`), hash)).toBeNull();
  });
});

describe('weatherPatchIssues', () => {
  it('reports nothing for the live source', () => {
    expect(weatherPatchIssues(LIVE_VS, LIVE_FS)).toEqual([]);
  });
  it('names each patch a drifted source breaks', () => {
    expect(weatherPatchIssues(LIVE_VS.replace('in vec2 aCell;\n', ''), LIVE_FS)).toContain('vertex');
    expect(weatherPatchIssues(LIVE_VS, LIVE_FS.replace(' * uOpacity;', ';'))).toEqual(['fragment', 'tall']);
    // A renamed hash parameter breaks only the CPU twin; the GPU phase path still reads the function.
    expect(weatherPatchIssues(LIVE_VS.replace('hashCell(vec2 cell)', 'hashCell(vec2 c)').replace('dot(cell,', 'dot(c,'), LIVE_FS)).toEqual(['cellHash']);
    // No vec2 → float function at all: neither phase path works, and the layers have no phases.
    expect(weatherPatchIssues(LIVE_VS.replace('float hashCell(vec2 cell) {', 'float hashCell(float cell) {'), LIVE_FS)).toEqual(['hashFn', 'tall']);
    expect(weatherPatchIssues(LIVE_VS, LIVE_FS.replace(/clamp\(\s*vLocalPx\s*,/, 'clamp(vLocalPx.xy,'))).toEqual(['tall']);
  });
});

describe('stripShaderName', () => {
  it('removes only the SHADER_NAME define', () => {
    expect(stripShaderName('#version 300 es\n#define SHADER_NAME weather-pattern-pass-fragment\nprecision highp float;\n'))
      .toBe('#version 300 es\nprecision highp float;\n');
    expect(stripShaderName('void main(void) {}\n')).toBe('void main(void) {}\n');
  });
});
