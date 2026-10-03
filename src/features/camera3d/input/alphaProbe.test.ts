import { describe, expect, it } from 'vitest';
import { FakeNode } from '../__test__/fakeNode';
import type { PixiClasses, RendererLike } from '../types';
import { createAlphaProbe, PROBE_W, type Texel } from './alphaProbe';

interface Src { style: null; alpha: (x: number, y: number) => number }
class FakeTex {
  source: Src;
  frame: { x: number; y: number; width: number; height: number };
  constructor(o?: { source: Src; frame: FakeTex['frame'] }) {
    this.source = o?.source ?? { style: null, alpha: () => 0 };
    this.frame = o?.frame ?? { x: 0, y: 0, width: 0, height: 0 };
  }
  destroy(): void { /* fake */ }
}
const EMPTY = new FakeTex();
class FakeSprite extends FakeNode {
  constructor(t: FakeTex) { super(); this.texture = t as never; this.anchor = new FakeNode().position; }
}
// literal-list-justified: test fake of the PIXI class table (same shape as the tagged table in capabilities.ts)
const classes = {
  Container: FakeNode, Sprite: FakeSprite, Texture: Object.assign(FakeTex, { EMPTY, WHITE: EMPTY }),
  Rectangle: class { constructor(public x: number, public y: number, public width: number, public height: number) {} },
} as unknown as PixiClasses;

const SIGNALED = 0x9119, PACK = 0x88eb;
function fakeRenderer(opts: { webgl2?: boolean; signalAfter?: number } = {}) {
  const px = new Uint8Array(PROBE_W * 4);
  const log = { deletedSyncs: 0, buffers: 0, pack: null as object | null, fb: 'game' as unknown, packed: new Uint8Array(PROBE_W * 4), root: null as FakeNode | null, staleWrites: 0 };
  const ctxListeners = new Set<{ contextChange(): void }>();
  let polls = 0;
  let fresh = false;
  const gl = {
    PIXEL_PACK_BUFFER: PACK, FRAMEBUFFER: 0x8d40, FRAMEBUFFER_BINDING: 0x8ca6, STREAM_READ: 0x88e1, RGBA: 0x1908, UNSIGNED_BYTE: 0x1401,
    SYNC_GPU_COMMANDS_COMPLETE: 0x9117, SYNC_STATUS: 0x9114, SIGNALED,
    isContextLost: () => false, createBuffer: () => { log.buffers++; return {}; }, deleteBuffer: () => undefined,
    bindBuffer: (t: number, b: object | null) => { if (t === PACK) log.pack = b; },
    bufferData: () => { if (log.pack) fresh = true; },
    getParameter: () => log.fb,
    bindFramebuffer: (_t: number, f: unknown) => { log.fb = f; },
    readPixels: () => { if (!log.pack) return; log.packed.set(px); if (!fresh) log.staleWrites++; fresh = false; },
    fenceSync: () => ({ fence: true }),
    getSyncParameter: () => (++polls > (opts.signalAfter ?? 2) ? SIGNALED : 0),
    deleteSync: () => { log.deletedSyncs++; },
    getBufferSubData: (_t: number, _o: number, dst: Uint8Array) => { dst.set(log.packed); },
  };
  const r = {
    gl: opts.webgl2 === false ? { ...gl, fenceSync: undefined } : gl,
    render: (o: { container: FakeNode }) => {
      log.root = o.container;
      px.fill(0);
      o.container.children.forEach((s, i) => {
        const t = s.texture as unknown as FakeTex;
        if (s.visible) px[i * 4 + 3] = Math.round(255 * t.source.alpha(t.frame.x, t.frame.y));
      });
    },
    extract: { pixels: () => ({ pixels: px, width: PROBE_W, height: 1 }) },
    renderTarget: { getRenderTarget: (t: unknown) => t, getGpuRenderTarget: () => ({ resolveTargetFramebuffer: 'probe-fb' }) },
    runners: { contextChange: { add: (o: { contextChange(): void }) => ctxListeners.add(o), remove: (o: { contextChange(): void }) => ctxListeners.delete(o) } },
  } as unknown as RendererLike;
  const RT = { create: () => new FakeTex() };
  const restoreContext = (): void => { for (const o of ctxListeners) o.contextChange(); };
  return { r, log, RT, restoreContext, ctxListeners };
}

const src: Src = { style: null, alpha: (x, y) => (x === 3 && y === 4 ? 1 : x === 7 ? 0.5 : 0) };
const texels: Texel[] = [{ source: src as never, x: 0, y: 0 }, { source: src as never, x: 3, y: 4 }, { source: src as never, x: 7, y: 1 }];
const round = (a: number[]): number[] => a.map((v) => +v.toFixed(2));

describe('alpha probe', () => {
  it('reads each texel back in request order and parks every probe sprite', () => {
    const { r, log, RT } = fakeRenderer();
    const p = createAlphaProbe(r, classes, () => RT);
    expect(round(p.readNow(texels))).toEqual([0, 1, 0.5]);
    expect(log.root!.children.every((s) => !s.visible && s.texture === (EMPTY as never))).toBe(true);
  });

  it('async: the result arrives from a later poll once the fence signals, with the pack and framebuffer bindings restored', () => {
    const { r, log, RT } = fakeRenderer({ signalAfter: 2 });
    const p = createAlphaProbe(r, classes, () => RT);
    let got: number[] | null = null;
    expect(p.readLater(texels, (a) => { got = a; })).toBe(true);
    expect([log.pack, log.fb, p.busy()]).toEqual([null, 'game', true]);
    expect(p.readLater(texels, () => undefined)).toBe(false);
    p.poll(); p.poll();
    expect(got).toBeNull();
    p.poll();
    expect(round(got!)).toEqual([0, 1, 0.5]);
    expect([p.busy(), log.pack, log.deletedSyncs]).toEqual([false, null, 1]);
  });

  it('async: every read lands in fresh buffer storage, so Chrome never warns about a rewritten READ buffer', () => {
    const { r, log, RT } = fakeRenderer({ signalAfter: 0 });
    const p = createAlphaProbe(r, classes, () => RT);
    for (let i = 0; i < 3; i++) { expect(p.readLater(texels, () => undefined)).toBe(true); p.poll(); }
    expect([log.buffers, log.staleWrites]).toEqual([1, 0]);
  });

  it('declines async without WebGL2 fences; the sync read still works', () => {
    const { r, RT } = fakeRenderer({ webgl2: false });
    const p = createAlphaProbe(r, classes, () => RT);
    expect(p.readLater(texels, () => undefined)).toBe(false);
    expect(p.busy()).toBe(false);
    expect(p.readNow(texels)[1]).toBe(1);
  });

  it('drops a fence that never signals; destroy deletes a pending sync', () => {
    const { r, log, RT } = fakeRenderer({ signalAfter: 1e9 });
    const p = createAlphaProbe(r, classes, () => RT);
    p.readLater(texels, () => { throw new Error('must not resolve'); });
    for (let i = 0; i < 40; i++) p.poll();
    expect([p.busy(), log.deletedSyncs]).toEqual([false, 1]);
    p.readLater(texels, () => undefined);
    p.destroy();
    expect(log.deletedSyncs).toBe(2);
  });

  it('a context restore forgets the in-flight read and the dead buffer; destroy unregisters', () => {
    const { r, log, RT, restoreContext, ctxListeners } = fakeRenderer();
    const p = createAlphaProbe(r, classes, () => RT);
    p.readLater(texels, () => { throw new Error('must not resolve'); });
    restoreContext();
    expect(p.busy()).toBe(false);
    expect(p.readLater(texels, () => undefined)).toBe(true);
    expect(log.buffers).toBe(2);
    p.destroy();
    expect(ctxListeners.size).toBe(0);
  });

  it('treats every texel as opaque while no render-texture class is known', () => {
    const { r } = fakeRenderer();
    const p = createAlphaProbe(r, classes, () => null);
    expect(p.readNow(texels)).toEqual([1, 1, 1]);
    expect(p.readLater(texels, () => undefined)).toBe(false);
  });
});
