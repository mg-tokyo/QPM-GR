import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerScopedLayout, PlayerScopedSpec } from './playerScoped';

const captured: { spec: PlayerScopedSpec<string[]> | null; layout: PlayerScopedLayout<string[]> | null } = { spec: null, layout: null };
let ready = false;
const handle = {
  start: vi.fn(),
  stop: vi.fn(),
  write: vi.fn((_value: string[]) => true),
  read: vi.fn(),
  isReady: vi.fn(() => ready),
  scopedKey: vi.fn(() => (ready ? 'qpm.petHatchingTracker.knownPetIds.v1.p1' : null)),
};
const createPlayerScoped = vi.fn((spec: PlayerScopedSpec<string[]>, layout: PlayerScopedLayout<string[]>) => {
  captured.spec = spec;
  captured.layout = layout;
  return handle;
});
let inventoryCb: ((value: unknown) => void) | null = null;
const unsubInventory = vi.fn();
const subscribeAtomValue = vi.fn(async (_key: string, cb: (value: unknown) => void) => { inventoryCb = cb; return unsubInventory; });
const recordPetHatch = vi.fn();
const recordDetailedHatch = vi.fn();

vi.mock('./playerScoped', () => ({ createPlayerScoped }));
vi.mock('../core/atomRegistry', () => ({ subscribeAtomValue }));
vi.mock('./stats', () => ({ recordPetHatch }));
vi.mock('./hatchStatsStore', () => ({ recordDetailedHatch }));

const tracker = await import('./petHatchingTracker');

const pet = (id: string): Record<string, unknown> => ({ id, species: 'Bee' });

async function bind(value: string[]): Promise<void> {
  ready = true;
  captured.spec?.onReady(value, 'p1');
  await vi.waitFor(() => { expect(inventoryCb).not.toBeNull(); });
}

beforeEach(() => {
  tracker.stopPetHatchingTracker();
  tracker.resetPetHatchingTracker();
  ready = false;
  inventoryCb = null;
  captured.spec = null;
  vi.clearAllMocks();
});

describe('mergeKnownPetIds', () => {
  it('unions in order, b extras last, and returns a itself when b adds nothing', () => {
    const a = ['x', 'y'];
    expect(tracker.mergeKnownPetIds(a, ['y', 'z', 'z'])).toEqual(['x', 'y', 'z']);
    expect(tracker.mergeKnownPetIds(a, ['y', 'x'])).toBe(a);
  });

  it('drops the oldest past the cap', () => {
    expect(tracker.mergeKnownPetIds(['a', 'b'], ['c'], 2)).toEqual(['b', 'c']);
  });
});

describe('petHatchingTracker on the player-scoped helper', () => {
  it('reads the inventory only after the player copy loads', async () => {
    await tracker.startPetHatchingTracker();
    expect(handle.start).toHaveBeenCalledTimes(1);
    expect(subscribeAtomValue).not.toHaveBeenCalled();
    expect(captured.layout?.join([['a', 3, 'b']])).toEqual(['a', 'b']);
    expect(captured.layout?.join([{ nope: 1 }])).toBeUndefined();
    await bind(['old']);
    expect(subscribeAtomValue).toHaveBeenCalledTimes(1);
  });

  it('a stored pet returning to the inventory is not a hatch; a new one is', async () => {
    await tracker.startPetHatchingTracker();
    await bind(['returning']);
    inventoryCb?.([pet('seed')]);
    expect(recordPetHatch).not.toHaveBeenCalled();
    inventoryCb?.([pet('seed'), pet('returning'), pet('fresh')]);
    expect(recordPetHatch).toHaveBeenCalledTimes(1);
    expect(handle.write).toHaveBeenLastCalledWith(['returning', 'seed', 'fresh']);
  });

  it('writes nothing before the bind; stop releases the handle and the subscription', async () => {
    await tracker.startPetHatchingTracker();
    tracker.resetPetHatchingTracker();
    expect(handle.write).not.toHaveBeenCalled();
    await bind([]);
    tracker.stopPetHatchingTracker();
    expect(handle.stop).toHaveBeenCalledTimes(1);
    expect(unsubInventory).toHaveBeenCalledTimes(1);
  });
});
