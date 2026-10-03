import type { Node3, PixiClasses, RendererLike, TexLike, TexSourceLike } from '../types';

export const PROBE_W = 32;
// A fence that has not signalled after this many polls (stage renders) is dropped so hover can probe again.
const MAX_POLLS = 12;

/** One texel of a texture source, in the units of a texture frame. */
export interface Texel { source: TexSourceLike; x: number; y: number }

export interface AlphaProbe {
  /** Alpha 0..1 per texel (at most PROBE_W), read back now: a GPU sync point. */
  readNow(texels: readonly Texel[]): number[];
  /** Draws now; `done` runs from a later poll() once the GPU is done. False: nothing in flight, use readNow. */
  readLater(texels: readonly Texel[], done: (alphas: number[]) => void): boolean;
  busy(): boolean;
  poll(): void;
  cancel(): void;
  destroy(): void;
}

interface ContextRunner { add(o: { contextChange(): void }): unknown; remove(o: { contextChange(): void }): unknown }
interface RenderTargets {
  getRenderTarget(t: unknown): unknown;
  getGpuRenderTarget(rt: unknown): { resolveTargetFramebuffer?: WebGLFramebuffer | null } | null | undefined;
}

// Each texel is drawn as a 1×1 sprite at its own pixel of a PROBE_W×1 render texture (the atlases are GPU-only BC7,
// there is no CPU alpha). The async path reads that row into a pixel-pack buffer behind a fence (verified live
// 2026-10-03: ready after 2 frames, bytes equal to extract.pixels).
export function createAlphaProbe(r: RendererLike, C: PixiClasses, rtClass: () => unknown): AlphaProbe {
  const root = new C.Container();
  const sprites: Node3[] = [];
  for (let i = 0; i < PROBE_W; i++) { const s = new C.Sprite(C.Texture.EMPTY); s.visible = false; root.addChild(s); sprites.push(s); }
  const bytes = new Uint8Array(PROBE_W * 4);
  let target: TexLike | null = null;
  let buf: WebGLBuffer | null = null;
  let pending: { sync: WebGLSync; n: number; polls: number; done: (alphas: number[]) => void } | null = null;

  const draw = (texels: readonly Texel[], n: number): TexLike | null => {
    const RT = rtClass() as { create?: (o: unknown) => TexLike } | null;
    if (!target && RT?.create) target = RT.create({ width: PROBE_W, height: 1 });
    if (!target) return null;
    const subs: TexLike[] = [];
    for (let i = 0; i < n; i++) {
      const s = sprites[i]!, t = texels[i]!;
      const sub = new C.Texture({ source: t.source, frame: new C.Rectangle(t.x, t.y, 1, 1) });
      subs.push(sub);
      (s as unknown as { texture: TexLike }).texture = sub;
      s.anchor?.set(0, 0);
      s.position.set(i, 0);
      s.visible = true;
    }
    r.render({ container: root, target, clear: true, clearColor: [0, 0, 0, 0] });
    for (let i = 0; i < n; i++) { const s = sprites[i]!; (s as unknown as { texture: TexLike }).texture = C.Texture.EMPTY; s.visible = false; }
    for (const t of subs) t.destroy(false);
    return target;
  };

  const alphasOf = (px: ArrayLike<number>, n: number): number[] => {
    const out = new Array<number>(n);
    for (let i = 0; i < n; i++) out[i] = px[i * 4 + 3]! / 255;
    return out;
  };

  function cancel(): void {
    if (pending) r.gl?.deleteSync(pending.sync);
    pending = null;
  }

  // GL handles die with the context. gl.isBuffer would tell, but it is a synchronous GPU-process round trip in
  // Chrome; PIXI's contextChange runner fires on restore instead.
  const runner = (r as unknown as { runners?: { contextChange?: ContextRunner } }).runners?.contextChange;
  const onContext = { contextChange(): void { pending = null; buf = null; } };
  runner?.add(onContext);

  return {
    readNow(texels) {
      const n = Math.min(texels.length, PROBE_W);
      const t = n ? draw(texels, n) : null;
      return t ? alphasOf(r.extract.pixels(t).pixels, n) : new Array<number>(n).fill(1);
    },
    readLater(texels, done) {
      const gl = r.gl;
      const rts = (r as unknown as { renderTarget?: RenderTargets }).renderTarget;
      const n = Math.min(texels.length, PROBE_W);
      if (pending || !n || !gl || typeof gl.fenceSync !== 'function' || gl.isContextLost() || !rts || !rtClass()) return false;
      const t = draw(texels, n);
      const fb = t ? rts.getGpuRenderTarget(rts.getRenderTarget(t))?.resolveTargetFramebuffer : null;
      if (!fb) return false;
      if (!buf) buf = gl.createBuffer();
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buf);
      // Fresh storage per read. Chrome never served this read from its readback shadow (live 2026-10-03), so every
      // rewrite of the old storage logged a "READ-usage buffer ... written again" warning until its 256 cap.
      gl.bufferData(gl.PIXEL_PACK_BUFFER, bytes.byteLength, gl.STREAM_READ);
      const prevFb = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.readPixels(0, 0, PROBE_W, 1, gl.RGBA, gl.UNSIGNED_BYTE, 0);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, prevFb);
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      if (!sync) return false;
      pending = { sync, n, polls: 0, done };
      return true;
    },
    busy: () => pending !== null,
    poll() {
      const gl = r.gl;
      if (!pending || !gl) return;
      if (gl.isContextLost()) { pending = null; buf = null; return; }
      if (gl.getSyncParameter(pending.sync, gl.SYNC_STATUS) !== gl.SIGNALED) {
        if (++pending.polls > MAX_POLLS) cancel();
        return;
      }
      const p = pending;
      pending = null;
      gl.deleteSync(p.sync);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buf);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, bytes);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      p.done(alphasOf(bytes, p.n));
    },
    cancel,
    destroy() {
      runner?.remove(onContext);
      cancel();
      if (buf) r.gl?.deleteBuffer(buf);
      buf = null;
      target?.destroy(true);
      target = null;
      root.destroy({ children: true });
    },
  };
}
