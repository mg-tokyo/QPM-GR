import { describe, expect, it } from 'vitest';
import { patchWeatherFragment, patchWeatherVertex, stripShaderName } from './shaders';

// Live build 1381 sources (phase lines elided).
const LIVE_VS = [
  '#version 300 es', '#define SHADER_NAME weather-pattern-pass-vertex', 'precision highp float;', '',
  'in vec2 aPosition;', 'in vec2 aCell;', '', 'out vec2 vLocalPx;', 'flat out float vFrame;', '',
  'uniform mat3 uProjectionMatrix;', 'uniform mat3 uWorldTransformMatrix;', 'uniform mat3 uTransformMatrix;', 'uniform vec2 uFrameSizePx;',
  'uniform float uCycleFrame;', 'uniform float uFrameCount;', 'uniform float uPhaseCount;', 'uniform float uCycleSlots;', 'uniform float uLastFrameTransparent;', '',
  'void main(void) {', '  vLocalPx = aPosition - aCell * uFrameSizePx;', '',
  '  if (uLastFrameTransparent > 0.5 && vFrame >= uFrameCount - 1.0) {', '    gl_Position = vec4(-2.0, -2.0, 0.0, 1.0);', '    return;', '  }', '',
  '  mat3 modelViewProjectionMatrix =', '    uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;', '',
  '  gl_Position =', '    vec4((modelViewProjectionMatrix * vec3(aPosition, 1.0)).xy, 0.0, 1.0);', '}', '',
].join('\n');
const LIVE_FS = [
  '#version 300 es', '#define SHADER_NAME weather-pattern-pass-fragment', 'precision highp float;', '',
  'in vec2 vLocalPx;', 'flat in float vFrame;', '', 'out vec4 finalColor;', '', 'uniform sampler2D uWeatherTexture;', 'uniform float uOpacity;', '',
  'void main(void) {', '  vec2 uv = vLocalPx;', '  // The atlas is premultiplied, so one scale of the whole sample fades the',
  '  finalColor = textureGrad(uWeatherTexture, uv, dFdx(uv), dFdy(uv)) * uOpacity;', '}', '',
].join('\n');

describe('patchWeatherVertex', () => {
  it('swaps the 2D position line for the 3D projection and declares the stand uniforms', () => {
    const out = patchWeatherVertex(LIVE_VS)!;
    expect(out).toContain('uniform vec3 uCamPos;');
    expect(out).toContain('uniform float uStand;');
    expect(out).toContain('out float vQAlpha;');
    expect(out).toContain('void main(void) {\n  vQAlpha = uFlatAlpha;');
    expect(out).toContain('vec4(qClip.xy, qz - 2.0 * uNear, qz)');
    expect(out).not.toContain('vec3(aPosition, 1.0)).xy, 0.0, 1.0);');
  });
  // PIXI keeps an existing SHADER_NAME, so two mirrors built from the game's processed source shared one program key
  // and the second never got its attribute data (live 2026-10-03, rain: "reading 'aPosition'" in getSignature).
  it('drops the game program name so PIXI names each mirror uniquely', () => {
    const out = patchWeatherVertex(LIVE_VS)!;
    expect(out).not.toContain('SHADER_NAME');
    expect(out.startsWith('#version 300 es\nprecision highp float;\n')).toBe(true);
  });
  it('returns null when the game shader changed shape', () => {
    expect(patchWeatherVertex('void main(void) { gl_Position = vec4(0.0); }')).toBeNull();
    expect(patchWeatherVertex(LIVE_VS.replace('in vec2 aCell;\n', ''))).toBeNull();
  });
});

describe('patchWeatherFragment', () => {
  it('scales the game colour by the per-cell alpha', () => {
    const out = patchWeatherFragment(LIVE_FS)!;
    expect(out).toContain('precision highp float;\nin float vQAlpha;\n');
    expect(out).toContain('* uOpacity * vQAlpha;');
    expect(out).not.toContain('SHADER_NAME');
  });
  it('returns null when the colour line changed', () => {
    expect(patchWeatherFragment(LIVE_FS.replace(' * uOpacity;', ';'))).toBeNull();
  });
});

describe('stripShaderName', () => {
  it('removes only the SHADER_NAME define', () => {
    expect(stripShaderName('#version 300 es\n#define SHADER_NAME weather-pattern-pass-fragment\nprecision highp float;\n'))
      .toBe('#version 300 es\nprecision highp float;\n');
    expect(stripShaderName('void main(void) {}\n')).toBe('void main(void) {}\n');
  });
});
