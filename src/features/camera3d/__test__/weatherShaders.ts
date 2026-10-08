// The game's weather pattern program, verbatim from live build 1419 (2026-10-05, WeatherPatternMesh.shader.glProgram).
export const LIVE_WEATHER_VS = `#version 300 es
#define SHADER_NAME weather-pattern-pass-vertex
precision highp float;

in vec2 aPosition;
in vec2 aCell;

out vec2 vLocalPx;
flat out float vFrame;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform vec2 uFrameSizePx;
uniform float uCycleFrame;
uniform float uFrameCount;
uniform float uPhaseCount;
uniform float uCycleSlots;
uniform float uLastFrameTransparent;

float hashCell(vec2 cell) {
  float n =
    sin(dot(cell, vec2(12.9898, 78.233))) *
    43758.5453;

  return fract(abs(n));
}

void main(void) {
  vLocalPx = aPosition - aCell * uFrameSizePx;

  float phase = floor(hashCell(aCell) * uPhaseCount);
  float offset = phase * uCycleSlots / uPhaseCount;
  float cyclePosition = mod(floor(uCycleFrame + offset), uCycleSlots);
  vFrame = min(cyclePosition, uFrameCount - 1.0);

  if (uLastFrameTransparent > 0.5 && vFrame >= uFrameCount - 1.0) {
    gl_Position = vec4(-2.0, -2.0, 0.0, 1.0);
    return;
  }

  mat3 modelViewProjectionMatrix =
    uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;

  gl_Position =
    vec4((modelViewProjectionMatrix * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
}
`;

export const LIVE_WEATHER_FS = `#version 300 es
#define SHADER_NAME weather-pattern-pass-fragment
precision lowp sampler2D;
precision highp float;

in vec2 vLocalPx;
flat in float vFrame;

out vec4 finalColor;

uniform sampler2D uWeatherTexture;

uniform vec2 uFrameOriginPx;
uniform vec2 uFrameSizePx;
uniform vec2 uAtlasSizePx;
uniform float uEdgeInsetPx;
uniform float uOpacity;

void main(void) {
  vec2 samplePx =
    uFrameOriginPx +
    vec2(vFrame * uFrameSizePx.x, 0.0) +
    clamp(
      vLocalPx,
      vec2(uEdgeInsetPx),
      uFrameSizePx - vec2(uEdgeInsetPx)
    );

  vec2 uv = samplePx / uAtlasSizePx;

  // Derive LOD from vLocalPx rather than the sampled UV: clamping UVs to
  // frame edges can flatten their derivative. vLocalPx stays linear within
  // each cell quad, where one world pixel maps to one atlas texel.
  vec2 ddx = dFdx(vLocalPx) / uAtlasSizePx;
  vec2 ddy = dFdy(vLocalPx) / uAtlasSizePx;
  // The atlas is premultiplied, so one scale of the whole sample fades the
  // pattern without lightening what it sits over.
  finalColor = textureGrad(uWeatherTexture, uv, ddx, ddy) * uOpacity;
}
`;
