import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const add = vi.fn();
  const remove = vi.fn();
  const app = { ticker: { add, remove } };
  return {
    generation: { value: 0 },
    ticker: { add, remove, app },
  };
});

vi.mock('./pixiStage', () => ({
  getPixiApp: () => mocks.ticker.app,
}));
vi.mock('../../../core/pixiCapture', () => ({
  getCaptureGeneration: () => mocks.generation.value,
}));

import {
  guardedNodes,
  guardTickerRef,
  installVisibleGuard,
  removeAllVisibleGuards,
  pruneStaleGuards,
} from './alphaGuard';

function tile(destroyed = false): { destroyed?: boolean; visible?: boolean; children?: unknown[] } {
  return { destroyed, visible: true, children: [] };
}

describe('alphaGuard', () => {
  beforeEach(() => {
    removeAllVisibleGuards();
    if (guardTickerRef.cleanup) guardTickerRef.cleanup();
    mocks.ticker.add.mockReset();
    mocks.ticker.remove.mockReset();
    mocks.generation.value = 0;
  });

  it('prunes guards for tiles absent from the live list', () => {
    const a = tile(), b = tile();
    installVisibleGuard(a);
    installVisibleGuard(b);
    expect(guardedNodes.size).toBe(2);
    pruneStaleGuards([{ node: a, x: 0, y: 0 }]);
    expect(guardedNodes.size).toBe(1);
    expect(guardedNodes.has(a)).toBe(true);
    expect(guardedNodes.has(b)).toBe(false);
  });

  it('stops the ticker when the guard set empties', () => {
    const a = tile();
    installVisibleGuard(a);
    expect(mocks.ticker.add).toHaveBeenCalledTimes(1);
    pruneStaleGuards([]);
    expect(guardedNodes.size).toBe(0);
    expect(mocks.ticker.remove).toHaveBeenCalledTimes(1);
  });

  it('prunes a destroyed:true tile even if it is in the live list', () => {
    const a = tile(true);
    installVisibleGuard(a);
    pruneStaleGuards([{ node: a, x: 0, y: 0 }]);
    expect(guardedNodes.has(a)).toBe(false);
  });

  it('re-attaches the ticker when the capture generation changes', () => {
    const a = tile();
    installVisibleGuard(a);
    expect(mocks.ticker.add).toHaveBeenCalledTimes(1);

    mocks.generation.value = 1;
    const b = tile();
    installVisibleGuard(b);
    expect(mocks.ticker.remove).toHaveBeenCalledTimes(1);
    expect(mocks.ticker.add).toHaveBeenCalledTimes(2);
  });
});
