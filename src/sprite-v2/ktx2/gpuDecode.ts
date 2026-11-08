// Game ≥1973 ships atlas pages as per-GPU-format KTX2 (bc7/astc/etc2/bc3/rgba8, picked from the
// device's caps) and no longer bundles a libktx transcoder. Those files carry no supercompression,
// so level 0 is either raw RGBA8 (copied as-is) or GPU blocks that this device can sample: upload
// them to a private WebGL2 context, draw into an RGBA8 target, read back. Live 1973: sprites-0
// fullsize bc7 (vkFormat 146, 4096×4080) decodes in ~0.5 s, DFD flags 0 (straight alpha).

import type { Ktx2DecodeResult } from './types';

const KTX2_IDENTIFIER = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];
const HEADER_BYTES = 80;

interface Level0 { vkFormat: number; width: number; height: number; data: Uint8Array }

// Vulkan formats the game's format list can produce → WebGL extension + UNORM enum. sRGB variants
// upload with the UNORM enum on purpose: the block bytes are identical, and sampling them without
// sRGB decode writes back exactly the stored (sRGB-encoded) values a 2D canvas expects.
// literal-list-justified: Vulkan/WebGL protocol enums (KTX2 spec), not game data
const GPU_FORMATS: ReadonlyMap<number, { ext: string; glFormat: number }> = new Map([
  [137, { ext: 'WEBGL_compressed_texture_s3tc', glFormat: 0x83f3 }], // BC3_UNORM → RGBA_S3TC_DXT5
  [138, { ext: 'WEBGL_compressed_texture_s3tc', glFormat: 0x83f3 }], // BC3_SRGB
  [145, { ext: 'EXT_texture_compression_bptc', glFormat: 0x8e8c }], // BC7_UNORM → RGBA_BPTC_UNORM
  [146, { ext: 'EXT_texture_compression_bptc', glFormat: 0x8e8c }], // BC7_SRGB
  [151, { ext: 'WEBGL_compressed_texture_etc', glFormat: 0x9278 }], // ETC2_R8G8B8A8_UNORM → RGBA8_ETC2_EAC
  [152, { ext: 'WEBGL_compressed_texture_etc', glFormat: 0x9278 }], // ETC2_R8G8B8A8_SRGB
  [157, { ext: 'WEBGL_compressed_texture_astc', glFormat: 0x93b0 }], // ASTC_4x4_UNORM → RGBA_ASTC_4x4
  [158, { ext: 'WEBGL_compressed_texture_astc', glFormat: 0x93b0 }], // ASTC_4x4_SRGB
]);
const RAW_RGBA8 = new Set([37, 43]); // R8G8B8A8_UNORM / _SRGB

function readLevel0(bytes: ArrayBuffer): Level0 | null {
  if (bytes.byteLength < HEADER_BYTES + 24) return null;
  const head = new Uint8Array(bytes, 0, KTX2_IDENTIFIER.length);
  if (KTX2_IDENTIFIER.some((b, i) => head[i] !== b)) return null;
  const dv = new DataView(bytes);
  const supercompression = dv.getUint32(44, true);
  if (supercompression !== 0) return null;
  const offset = Number(dv.getBigUint64(HEADER_BYTES, true));
  const length = Number(dv.getBigUint64(HEADER_BYTES + 8, true));
  if (offset <= 0 || length <= 0 || offset + length > bytes.byteLength) return null;
  return { vkFormat: dv.getUint32(12, true), width: dv.getUint32(20, true), height: dv.getUint32(24, true), data: new Uint8Array(bytes, offset, length) };
}

const VS = '#version 300 es\nvoid main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.0-1.0,0.0,1.0);}';
const FS = '#version 300 es\nprecision highp float;uniform sampler2D t;out vec4 o;void main(){o=texelFetch(t,ivec2(gl_FragCoord.xy),0);}';

export interface GpuKtx2Decoder {
  /** null: not a KTX2 this path handles (supercompressed, unknown format, or no extension) — use the worker. */
  decode(bytes: ArrayBuffer): Ktx2DecodeResult | null;
  destroy(): void;
}

export function createGpuKtx2Decoder(): GpuKtx2Decoder {
  let gl: WebGL2RenderingContext | null = null;
  let program: WebGLProgram | null = null;
  let failed = false;

  const ensureGl = (): WebGL2RenderingContext | null => {
    if (gl || failed) return gl;
    const ctx = document.createElement('canvas').getContext('webgl2', { premultipliedAlpha: false, antialias: false, depth: false, stencil: false });
    if (!ctx) { failed = true; return null; }
    const compile = (type: number, src: string): WebGLShader => {
      const sh = ctx.createShader(type);
      if (!sh) throw new Error('KTX2 gpu decode: createShader failed');
      ctx.shaderSource(sh, src);
      ctx.compileShader(sh);
      return sh;
    };
    const pr = ctx.createProgram();
    if (!pr) { failed = true; return null; }
    ctx.attachShader(pr, compile(ctx.VERTEX_SHADER, VS));
    ctx.attachShader(pr, compile(ctx.FRAGMENT_SHADER, FS));
    ctx.linkProgram(pr);
    if (!ctx.getProgramParameter(pr, ctx.LINK_STATUS)) { failed = true; return null; }
    gl = ctx;
    program = pr;
    return gl;
  };

  const drawBlocks = (ctx: WebGL2RenderingContext, level: Level0, glFormat: number): Uint8Array => {
    const { width, height } = level;
    const src = ctx.createTexture();
    const dst = ctx.createTexture();
    const fb = ctx.createFramebuffer();
    try {
      ctx.bindTexture(ctx.TEXTURE_2D, src);
      ctx.compressedTexImage2D(ctx.TEXTURE_2D, 0, glFormat, width, height, 0, level.data);
      ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MIN_FILTER, ctx.NEAREST);
      ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MAG_FILTER, ctx.NEAREST);
      ctx.bindTexture(ctx.TEXTURE_2D, dst);
      ctx.texStorage2D(ctx.TEXTURE_2D, 1, ctx.RGBA8, width, height);
      ctx.bindFramebuffer(ctx.FRAMEBUFFER, fb);
      ctx.framebufferTexture2D(ctx.FRAMEBUFFER, ctx.COLOR_ATTACHMENT0, ctx.TEXTURE_2D, dst, 0);
      if (ctx.checkFramebufferStatus(ctx.FRAMEBUFFER) !== ctx.FRAMEBUFFER_COMPLETE) throw new Error('KTX2 gpu decode: framebuffer incomplete');
      ctx.useProgram(program);
      ctx.activeTexture(ctx.TEXTURE0);
      ctx.bindTexture(ctx.TEXTURE_2D, src);
      ctx.viewport(0, 0, width, height);
      ctx.disable(ctx.BLEND);
      ctx.drawArrays(ctx.TRIANGLES, 0, 3);
      const out = new Uint8Array(width * height * 4);
      ctx.readPixels(0, 0, width, height, ctx.RGBA, ctx.UNSIGNED_BYTE, out);
      const err = ctx.getError();
      if (err !== ctx.NO_ERROR) throw new Error(`KTX2 gpu decode: GL error 0x${err.toString(16)}`);
      return out;
    } finally {
      ctx.bindFramebuffer(ctx.FRAMEBUFFER, null);
      ctx.deleteFramebuffer(fb);
      ctx.deleteTexture(src);
      ctx.deleteTexture(dst);
    }
  };

  return {
    decode(bytes) {
      const level = readLevel0(bytes);
      if (!level) return null;
      const start = performance.now();
      if (RAW_RGBA8.has(level.vkFormat)) {
        if (level.data.byteLength !== level.width * level.height * 4) return null;
        const rgba = new Uint8ClampedArray(level.data.buffer.slice(level.data.byteOffset, level.data.byteOffset + level.data.byteLength));
        return { width: level.width, height: level.height, rgba, decodeMs: performance.now() - start };
      }
      const fmt = GPU_FORMATS.get(level.vkFormat);
      if (!fmt) return null;
      const ctx = ensureGl();
      if (!ctx || !ctx.getExtension(fmt.ext)) return null;
      const px = drawBlocks(ctx, level, fmt.glFormat);
      return { width: level.width, height: level.height, rgba: new Uint8ClampedArray(px.buffer), decodeMs: performance.now() - start };
    },
    destroy() {
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
      gl = null;
      program = null;
    },
  };
}
