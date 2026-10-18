import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeTicker } from '../__test__/fakeGame';
import { captureFrame, POST_PRESENT, PRE_RENDER, type CaptureIo, type CaptureSource } from './capture';

// The live 1448 order: engine onTick 0, app render −25, onPresented −26.
function scene() {
  const ticker = createFakeTicker();
  const toasts = { alpha: 1 };
  const icon = { alpha: 0.8 };
  const drawn: number[][] = [];
  // The game sets its own alphas every frame; render sees whatever is set when it runs.
  const engine = (): void => { toasts.alpha = 1; icon.alpha = 0.8; };
  const render = (): void => { drawn.push([toasts.alpha, icon.alpha]); };
  ticker.add(engine, null, 0);
  ticker.add(render, null, -25);
  let asked = 0;
  const src: CaptureSource = {
    ticker,
    canvas: () => ({}) as HTMLCanvasElement,
    hidden: () => { asked++; return [toasts, icon]; },
  };
  const copies: number[] = [];
  const blob = new Blob(['png'], { type: 'image/png' });
  const io: CaptureIo = {
    copy: () => { copies.push(drawn.length); return {} as HTMLCanvasElement; },
    encode: async () => blob,
  };
  return { ticker, toasts, icon, drawn, src, io, asked: () => asked, copies, blob };
}

afterEach(() => { vi.useRealTimers(); });

describe('captureFrame', () => {
  it('sits between the engine frame and the render, and reads the canvas after it is presented', () => {
    expect(PRE_RENDER).toBeLessThan(0);
    expect(PRE_RENDER).toBeGreaterThan(-25);
    expect(POST_PRESENT).toBeLessThan(-26);
  });

  it('hides the toasts and the camera icon for the one rendered frame, then restores the game\'s values', async () => {
    const s = scene();
    const job = captureFrame(s.src, {}, s.io);
    expect(s.ticker.priorities().sort((a, b) => b - a)).toEqual([0, PRE_RENDER, -25, POST_PRESENT]);
    s.ticker.tick();
    expect(s.drawn).toEqual([[0, 0]]);
    expect(s.copies).toEqual([1]);
    expect([s.toasts.alpha, s.icon.alpha]).toEqual([1, 0.8]);
    expect(s.ticker.priorities().sort((a, b) => b - a)).toEqual([0, -25]);
    await expect(job.result).resolves.toBe(s.blob);
    s.ticker.tick();
    expect(s.drawn[1]).toEqual([1, 0.8]);
    expect(s.asked()).toBe(1);
  });

  it('a cancel before the frame leaves nothing hidden and nothing listening', async () => {
    const s = scene();
    const job = captureFrame(s.src, {}, s.io);
    job.cancel();
    job.cancel();
    s.ticker.tick();
    expect(s.drawn).toEqual([[1, 0.8]]);
    expect(s.copies).toEqual([]);
    expect(s.ticker.priorities().sort((a, b) => b - a)).toEqual([0, -25]);
    await expect(job.result).resolves.toBeNull();
  });

  it('gives up when no frame comes (a hidden tab), with nothing left listening', async () => {
    vi.useFakeTimers();
    const s = scene();
    const job = captureFrame(s.src, { timeoutMs: 3000 }, s.io);
    vi.advanceTimersByTime(3000);
    await expect(job.result).resolves.toBeNull();
    expect(s.ticker.priorities().sort((a, b) => b - a)).toEqual([0, -25]);
    s.ticker.tick();
    expect(s.copies).toEqual([]);
  });

  it('a copy that fails still restores the alphas and resolves null', async () => {
    const s = scene();
    s.io.copy = () => { throw new Error('tainted'); };
    const job = captureFrame(s.src, {}, s.io);
    s.ticker.tick();
    expect([s.toasts.alpha, s.icon.alpha]).toEqual([1, 0.8]);
    await expect(job.result).resolves.toBeNull();
    expect(s.ticker.priorities().sort((a, b) => b - a)).toEqual([0, -25]);
  });

  it('hiding that fails part-way restores what it hid and drops the shot rather than keep what should be hidden', async () => {
    const s = scene();
    s.src.hidden = () => [s.toasts, { get alpha() { return 1; }, set alpha(_v: number) { throw new Error('destroyed'); } }];
    const job = captureFrame(s.src, {}, s.io);
    s.ticker.tick();
    expect(s.drawn).toEqual([[1, 0.8]]);
    expect(s.copies).toEqual([]);
    await expect(job.result).resolves.toBeNull();
  });

  it('a canvas gone by the frame (a re-created renderer) resolves null', async () => {
    const s = scene();
    s.src.canvas = () => null;
    const job = captureFrame(s.src, {}, s.io);
    s.ticker.tick();
    expect(s.copies).toEqual([]);
    await expect(job.result).resolves.toBeNull();
  });

  it('a cancel while encoding drops the image', async () => {
    const s = scene();
    let finish: (b: Blob | null) => void = () => {};
    s.io.encode = () => new Promise((r) => { finish = r; });
    const job = captureFrame(s.src, {}, s.io);
    s.ticker.tick();
    job.cancel();
    finish(s.blob);
    await expect(job.result).resolves.toBeNull();
  });
});
