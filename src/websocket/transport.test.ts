import { beforeEach, describe, expect, it, vi } from 'vitest';

const KEY = 'qpm.ws.transport.v1';
let mockStorage: Map<string, unknown>;
let build: string | null;

vi.mock('../utils/storage', () => ({
  storage: {
    get: <T,>(key: string, fallback: T): T => (mockStorage.has(key) ? (mockStorage.get(key) as T) : fallback),
    set: (key: string, value: unknown): void => { mockStorage.set(key, value); },
    remove: (key: string): void => { mockStorage.delete(key); },
  },
}));

vi.mock('../diagnostics/gameVersionCapture', () => ({
  getCapturedBuildId: (): string | null => build,
}));

vi.mock('../diagnostics/logger', () => ({
  createNamedLogger: () => ({ warn: () => undefined, debug: () => undefined, info: () => undefined, error: () => undefined }),
}));

async function load(): Promise<typeof import('./transport')> {
  return await import('./transport');
}

beforeEach(() => {
  vi.resetModules();
  mockStorage = new Map();
  build = '1361';
});

describe('persisted transport observations', () => {
  it('keeps observations stamped with the current build', async () => {
    mockStorage.set(KEY, { v: '1361', types: { SellPet: 'legacy' } });
    const t = await load();
    expect(t.resolveTransport('SellPet')).toEqual({ transport: 'legacy', source: 'persisted' });
    expect(mockStorage.get(KEY)).toEqual({ v: '1361', types: { SellPet: 'legacy' } });
  });

  it('drops observations stamped with another build', async () => {
    mockStorage.set(KEY, { v: '1202', types: { SellPet: 'legacy' } });
    const t = await load();
    expect(t.resolveTransport('SellPet')).toEqual({ transport: 'envelope', source: 'allowlist' });
    expect(mockStorage.get(KEY)).toEqual({ v: '1361', types: {} });
  });

  it('drops the unstamped pre-1361 flat map', async () => {
    mockStorage.set(KEY, { SellPet: 'legacy', NpcVisitFarewellSeen: 'legacy' });
    const t = await load();
    expect(t.resolveTransport('SellPet')).toEqual({ transport: 'envelope', source: 'allowlist' });
    expect(t.resolveTransport('NpcVisitFarewellSeen')).toEqual({ transport: 'legacy', source: 'allowlist' });
    expect(mockStorage.get(KEY)).toEqual({ v: '1361', types: {} });
  });

  it('stamps new observations with the build', async () => {
    const t = await load();
    t.recordGameTransport('HarvestCrop', 'envelope');
    expect(mockStorage.get(KEY)).toEqual({ v: '1361', types: { HarvestCrop: 'envelope' } });
  });

  it('defers the load and persistence until the build id resolves', async () => {
    build = null;
    mockStorage.set(KEY, { v: '1361', types: { SellPet: 'legacy', TramArrival: 'envelope' } });
    const t = await load();

    expect(t.resolveTransport('SellPet')).toEqual({ transport: 'envelope', source: 'allowlist' });
    t.recordGameTransport('TramArrival', 'legacy');
    expect(mockStorage.get(KEY)).toEqual({ v: '1361', types: { SellPet: 'legacy', TramArrival: 'envelope' } });

    build = '1361';
    expect(t.resolveTransport('SellPet')).toEqual({ transport: 'legacy', source: 'persisted' });
    // This session's observation outranks the persisted one and is saved with the stamp.
    expect(t.resolveTransport('TramArrival')).toEqual({ transport: 'legacy', source: 'observed' });
    expect(mockStorage.get(KEY)).toEqual({ v: '1361', types: { TramArrival: 'legacy', SellPet: 'legacy' } });
  });
});

describe('v1361 flat allowlist', () => {
  it.each(['NpcVisitFarewellSeen', 'NpcVisitFarewellReady', 'SkipNpcVisitArrival', 'TramArrival', 'TramBoarding'])(
    '%s resolves legacy on cold start',
    async (type) => {
      const t = await load();
      expect(t.resolveTransport(type)).toEqual({ transport: 'legacy', source: 'allowlist' });
    },
  );

  it('reports no mismatch when the game sends them flat', async () => {
    const t = await load();
    t.recordGameTransport('SkipNpcVisitArrival', 'legacy');
    t.recordGameTransport('SellPet', 'envelope');
    expect(t.transportAudit().mismatches).toEqual([]);
  });
});
