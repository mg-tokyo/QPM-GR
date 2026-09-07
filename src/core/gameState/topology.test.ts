import { beforeEach, describe, expect, it } from 'vitest';
import { flushTopologyNow, getTopologyStats, onTopologyChange, resetTopology, signalTopology } from './topology';

beforeEach(() => resetTopology());

describe('topology bus', () => {
  it('coalesces multiple signals in one turn into one flush with all reasons', async () => {
    const seen: string[][] = [];
    onTopologyChange((r) => seen.push([...r].sort()));
    signalTopology('stateTree:ready');
    signalTopology('identity:changed');
    signalTopology('stateTree:ready');
    expect(seen).toEqual([]);
    await Promise.resolve();
    expect(seen).toEqual([['identity:changed', 'stateTree:ready']]);
    expect(getTopologyStats()).toMatchObject({ signals: 3, flushes: 1 });
  });
  it('flushTopologyNow delivers synchronously and unsubscribe stops delivery', () => {
    let n = 0;
    const off = onTopologyChange(() => { n++; });
    signalTopology('init');
    flushTopologyNow();
    expect(n).toBe(1);
    off();
    signalTopology('init');
    flushTopologyNow();
    expect(n).toBe(1);
  });
  it('isolates a throwing listener', async () => {
    let n = 0;
    onTopologyChange(() => { throw new Error('boom'); });
    onTopologyChange(() => { n++; });
    signalTopology('init');
    await Promise.resolve();
    expect(n).toBe(1);
  });
});
