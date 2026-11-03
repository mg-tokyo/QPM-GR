import { describe, it, expect, vi, beforeEach } from 'vitest';

const sprite = vi.hoisted(() => ({
  reachable: false,
  initSpriteSystem: vi.fn(),
  resetSpriteBootStateForRetry: vi.fn(),
  reportSpriteV2InitFailed: vi.fn(),
  reportSpriteV2InitRecovered: vi.fn(),
}));
vi.mock('../sprite-v2/index', () => ({
  initSpriteSystem: sprite.initSpriteSystem,
  probePixiPresence: () => sprite.reachable,
  resetSpriteBootStateForRetry: sprite.resetSpriteBootStateForRetry,
  reportSpriteV2InitFailed: sprite.reportSpriteV2InitFailed,
  reportSpriteV2InitRecovered: sprite.reportSpriteV2InitRecovered,
}));

const gs = vi.hoisted(() => ({ ready: true, listeners: new Set<() => void>(), subscribe: vi.fn() }));
vi.mock('../core/gameState', () => ({
  isGameStateReady: () => gs.ready,
  subscribe: gs.subscribe,
}));

const cap = vi.hoisted(() => ({ listeners: new Set<() => void>() }));
vi.mock('../core/pixiCapture', () => ({
  onPixiCaptureChange: (cb: () => void) => { cap.listeners.add(cb); return () => { cap.listeners.delete(cb); }; },
}));

import { startLateSpriteBoot } from './lateSpriteBoot';

const fireEngine = (): void => { for (const cb of [...gs.listeners]) cb(); };
const fireCapture = (): void => { for (const cb of [...cap.listeners]) cb(); };
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const service = { tag: 'service' };

beforeEach(() => {
  vi.clearAllMocks();
  sprite.reachable = false;
  gs.ready = true;
  gs.listeners.clear();
  cap.listeners.clear();
  gs.subscribe.mockImplementation((key: string, cb: () => void) => {
    if (key !== 'quinoaEngine') throw new Error(`unexpected key ${key}`);
    gs.listeners.add(cb);
    return () => { gs.listeners.delete(cb); };
  });
});

describe('startLateSpriteBoot', () => {
  it('waits until PIXI is reachable, retries once on an engine event, then disposes', async () => {
    sprite.initSpriteSystem.mockResolvedValue(service);
    const apply = vi.fn();
    startLateSpriteBoot(apply);
    expect(sprite.initSpriteSystem).not.toHaveBeenCalled();

    fireEngine();
    expect(sprite.initSpriteSystem).not.toHaveBeenCalled();

    sprite.reachable = true;
    fireEngine();
    await flush();

    expect(sprite.resetSpriteBootStateForRetry).toHaveBeenCalledTimes(1);
    expect(sprite.initSpriteSystem).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(service);
    expect(sprite.reportSpriteV2InitRecovered).toHaveBeenCalledTimes(1);
    expect(gs.listeners.size).toBe(0);
    expect(cap.listeners.size).toBe(0);
  });

  it('retries again on the next capture change after a failed retry', async () => {
    const boom = new Error('No PIXI constructors found');
    sprite.initSpriteSystem.mockRejectedValueOnce(boom).mockResolvedValueOnce(service);
    sprite.reachable = true;
    const apply = vi.fn();
    startLateSpriteBoot(apply);
    await flush();

    expect(sprite.reportSpriteV2InitFailed).toHaveBeenCalledWith(boom);
    expect(apply).not.toHaveBeenCalled();

    fireCapture();
    await flush();

    expect(sprite.initSpriteSystem).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenCalledWith(service);
  });

  it('ignores events while a retry is in flight', async () => {
    let resolveInit: (v: unknown) => void = () => {};
    sprite.initSpriteSystem.mockReturnValue(new Promise((r) => { resolveInit = r; }));
    sprite.reachable = true;
    const apply = vi.fn();
    startLateSpriteBoot(apply);
    fireEngine();
    fireCapture();
    fireEngine();

    expect(sprite.initSpriteSystem).toHaveBeenCalledTimes(1);
    resolveInit(service);
    await flush();
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('skips the engine subscription when gameState is not ready', async () => {
    gs.ready = false;
    sprite.initSpriteSystem.mockResolvedValue(service);
    const apply = vi.fn();
    startLateSpriteBoot(apply);

    expect(gs.subscribe).not.toHaveBeenCalled();
    sprite.reachable = true;
    fireCapture();
    await flush();
    expect(apply).toHaveBeenCalledWith(service);
  });

  it('dispose is idempotent and stops further retries', () => {
    const dispose = startLateSpriteBoot(vi.fn());
    dispose();
    dispose();

    expect(gs.listeners.size).toBe(0);
    expect(cap.listeners.size).toBe(0);
    sprite.reachable = true;
    fireCapture();
    expect(sprite.initSpriteSystem).not.toHaveBeenCalled();
  });
});
