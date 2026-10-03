export interface HashFn { name: string; src: string }
export interface PhaseMap { cols: number; rows: number; phases: Uint8Array }

// The game's per-cell hash: the first `float name(vec2 x) { … }` in its weather VS (live: hashCell).
const HASH_FN = /float\s+(\w+)\s*\(\s*vec2\s+\w+\s*\)\s*\{[\s\S]*?\n\}/;

export function extractHashFn(vs: string): HashFn | null {
  const m = HASH_FN.exec(vs);
  return m?.[1] ? { name: m[1], src: m[0] } : null;
}

/** Same function source and the same call expression as the game VS, evaluated per vertex (one point per cell). */
export function phaseProgram(hash: HashFn): { vs: string; fs: string } {
  return {
    vs: `#version 300 es\nprecision highp float;\nin vec2 aCell;\nuniform vec2 uGrid;\nuniform float uPhaseCount;\nflat out float vPhase;\n${hash.src}\nvoid main(void) {\n  vPhase = floor(${hash.name}(aCell) * uPhaseCount);\n  gl_PointSize = 1.0;\n  gl_Position = vec4((aCell + 0.5) / uGrid * 2.0 - 1.0, 0.0, 1.0);\n}\n`,
    fs: '#version 300 es\nprecision highp float;\nflat in float vPhase;\nout vec4 finalColor;\nvoid main(void) { finalColor = vec4(vPhase / 255.0, 0.0, 0.0, 1.0); }\n',
  };
}

const cache = new Map<string, PhaseMap | null>();

/** The game's GPU phase bucket per cell (index cy * cols + cx; 255 = not drawn). null when WebGL2 or the program fails;
 * the caller then falls back to the CPU twin. Live 10-03: 11–18 ms, once per grid per session. */
export function gpuPhases(vs: string, aCell: Float32Array, phaseCount: number): PhaseMap | null {
  const id = `${phaseCount}:${aCell.length}:${vs}`;
  if (cache.has(id)) return cache.get(id) ?? null;
  const map = computePhases(vs, aCell, phaseCount);
  cache.set(id, map);
  return map;
}

function computePhases(vs: string, aCell: Float32Array, phaseCount: number): PhaseMap | null {
  const hash = extractHashFn(vs);
  if (!hash || phaseCount <= 0 || phaseCount > 254) return null;
  const pts: number[] = [];
  let cols = 0, rows = 0;
  for (let i = 0; i + 1 < aCell.length; i += 8) {
    const cx = aCell[i]!, cy = aCell[i + 1]!;
    pts.push(cx, cy);
    cols = Math.max(cols, cx + 1);
    rows = Math.max(rows, cy + 1);
  }
  if (cols === 0 || rows === 0) return null;
  const canvas = document.createElement('canvas');
  canvas.width = cols;
  canvas.height = rows;
  const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
  if (!gl) return null;
  try {
    const p = phaseProgram(hash);
    const compile = (type: number, src: string): WebGLShader | null => {
      const s = gl.createShader(type);
      if (!s) return null;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return gl.getShaderParameter(s, gl.COMPILE_STATUS) === true ? s : null;
    };
    const v = compile(gl.VERTEX_SHADER, p.vs), f = compile(gl.FRAGMENT_SHADER, p.fs);
    const prog = gl.createProgram();
    if (!v || !f || !prog) return null;
    gl.attachShader(prog, v);
    gl.attachShader(prog, f);
    gl.linkProgram(prog);
    if (gl.getProgramParameter(prog, gl.LINK_STATUS) !== true) return null;
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pts), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aCell');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(gl.getUniformLocation(prog, 'uGrid'), cols, rows);
    gl.uniform1f(gl.getUniformLocation(prog, 'uPhaseCount'), phaseCount);
    gl.viewport(0, 0, cols, rows);
    gl.clearColor(1, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.POINTS, 0, pts.length / 2);
    const px = new Uint8Array(cols * rows * 4);
    gl.readPixels(0, 0, cols, rows, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const phases = new Uint8Array(cols * rows);
    for (let i = 0; i < phases.length; i++) phases[i] = px[i * 4]!;
    return { cols, rows, phases };
  } finally {
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
