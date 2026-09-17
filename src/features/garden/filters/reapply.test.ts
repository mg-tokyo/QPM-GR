import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const applyFilters = vi.fn();
  const isFilteringActive = vi.fn(() => true);
  const warnFeature = vi.fn();
  const state = {
    capturedSnapshotCb: null as ((v: unknown) => void) | null,
    getSnapshot: (() => null) as () => { tileObjects?: Record<string, unknown> } | null,
    tileCache: { nodes: [] as unknown[] | null },
  };
  return { applyFilters, isFilteringActive, warnFeature, state };
});

vi.mock('../bridge', () => ({
  getGardenSnapshot: () => mocks.state.getSnapshot(),
  onGardenSnapshot: (cb: (v: unknown) => void) => {
    mocks.state.capturedSnapshotCb = cb;
    return () => { mocks.state.capturedSnapshotCb = null; };
  },
}));
vi.mock('../../../core/pixiSceneEvents', () => ({
  onAnyPixiNodeAdded: () => () => {},
}));
vi.mock('./controller', () => ({
  applyFilters: mocks.applyFilters,
  isFilteringActive: mocks.isFilteringActive,
}));
vi.mock('./pixiStage', () => ({
  tileCache: mocks.state.tileCache,
}));
vi.mock('./_diagnostics', () => ({
  warnFeature: mocks.warnFeature,
}));

import { shouldReapplyForAddedNode, startFilterReapplyTriggers, stopFilterReapplyTriggers } from './reapply';

describe('shouldReapplyForAddedNode', () => {
  it('accepts a child whose parent is a Tile container', () => {
    const child = { label: 'Carrot Plant View', parent: { label: 'Tile (3, 7)' } };
    expect(shouldReapplyForAddedNode(child)).toBe(true);
  });
  it('rejects a child under a non-tile parent', () => {
    const child = { label: 'Carrot Plant View', parent: { label: 'World' } };
    expect(shouldReapplyForAddedNode(child)).toBe(false);
  });
  it('rejects an orphan child', () => {
    const child = { label: 'Egg' } as { parent?: { label?: unknown } | null };
    expect(shouldReapplyForAddedNode(child)).toBe(false);
  });
});

describe('checkSceneShape (via snapshot callback)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.applyFilters.mockReset();
    mocks.warnFeature.mockReset();
    mocks.isFilteringActive.mockReset().mockImplementation(() => true);
    mocks.state.tileCache.nodes = [];
    mocks.state.getSnapshot = () => ({ tileObjects: { '0:0': {} } });
    startFilterReapplyTriggers();
  });
  afterEach(() => {
    stopFilterReapplyTriggers();
    vi.useRealTimers();
  });

  it('warns once when the cache built by applyFilters is empty but snapshot has tiles', () => {
    mocks.state.capturedSnapshotCb?.({});
    vi.advanceTimersByTime(100);
    expect(mocks.applyFilters).toHaveBeenCalledTimes(1);
    expect(mocks.warnFeature).toHaveBeenCalledTimes(1);
    expect(mocks.warnFeature.mock.calls[0]![1]).toMatchObject({ what: 'shape:no-tile-nodes', tiles: 1 });

    mocks.state.capturedSnapshotCb?.({});
    vi.advanceTimersByTime(100);
    expect(mocks.warnFeature).toHaveBeenCalledTimes(1);
  });

  it('does not warn when tileCache.nodes is null (no stage this pass)', () => {
    mocks.state.tileCache.nodes = null;
    mocks.state.capturedSnapshotCb?.({});
    vi.advanceTimersByTime(100);
    expect(mocks.warnFeature).not.toHaveBeenCalled();
  });

  it('does not warn when the cache has tile nodes', () => {
    mocks.state.tileCache.nodes = [{}];
    mocks.state.capturedSnapshotCb?.({});
    vi.advanceTimersByTime(100);
    expect(mocks.warnFeature).not.toHaveBeenCalled();
  });
});
