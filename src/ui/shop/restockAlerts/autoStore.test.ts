import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OwnershipBaseline, PendingOwnershipConfirmation } from './types';
import type { WebSocketSendResult } from '../../../websocket/api';
import type { QuinoaCommandResultMessage } from '../../../websocket/envelope';

let alertStateObj: {
  seedSiloKeyCounts: Map<string, number>;
  decorShedKeyCounts: Map<string, number>;
  toolShackKeyCounts: Map<string, number>;
  inventoryKeyItemQuantities: Map<string, Map<string, number>>;
};
let toolLimits: Map<string, number>;
let sendCalls: Array<{ itemId: string; storageId: string }>;
let nextSend: WebSocketSendResult;
let observeResult: boolean;
let finished: PendingOwnershipConfirmation[];
let pendingsMap: Map<string, PendingOwnershipConfirmation>;
let ownershipListeners: Set<() => void>;
let waitCalls: number[];
/** When set, waitForOwnershipMatch behaves like the real one (listener + timeout) instead of returning observeResult. */
let realisticWait: boolean;

function notifyOwnership(): void {
  for (const l of Array.from(ownershipListeners)) l();
}

vi.mock('./alertState', () => ({
  get alertState() { return alertStateObj; },
  get pendingOwnershipConfirmations() { return pendingsMap; },
}));

vi.mock('./ownershipTracker', () => ({
  debugLog: () => { /* no-op */ },
  finishDeferredCompletion: (p: PendingOwnershipConfirmation) => { finished.push(p); },
  resolveOwnershipKey: (key: string) => key,
  waitForOwnershipMatch: (predicate: () => boolean, timeoutMs: number): Promise<boolean> => {
    waitCalls.push(timeoutMs);
    if (!realisticWait) return Promise.resolve(observeResult);
    if (predicate()) return Promise.resolve(true);
    return new Promise((resolve) => {
      const listener = (): void => {
        if (!predicate()) return;
        ownershipListeners.delete(listener);
        clearTimeout(id);
        resolve(true);
      };
      const id = setTimeout(() => { ownershipListeners.delete(listener); resolve(false); }, timeoutMs);
      ownershipListeners.add(listener);
    });
  },
}));

vi.mock('./purchaseActions', () => ({
  getToolInventoryLimitFromKey: (key: string) => toolLimits.get(key) ?? null,
}));

vi.mock('./purchasePipeline', () => ({
  sendItemToStorage: (itemId: string, storageId: string) => {
    sendCalls.push({ itemId, storageId });
    return nextSend;
  },
}));

vi.mock('../../../types/shops', () => ({
  isWeatherShopType: (id: string) => !['seed', 'egg', 'tool', 'decor'].includes(id),
}));

import { AUTO_STORE_STACK_WAIT_MS, getStorageRoomForKey, maybeAutoStoreConfirmedDelta } from './autoStore';

function result(ok: boolean, code?: string): QuinoaCommandResultMessage {
  return { type: 'QuinoaCommandResult', requestId: 'r1', ok, ...(code ? { code } : {}) } as QuinoaCommandResultMessage;
}

function makePending(key: string, storageId: string, label: string): PendingOwnershipConfirmation {
  const baseline: OwnershipBaseline = {
    count: 0,
    includeInventory: true,
    includeSeedSilo: true,
    includeDecorShed: true,
    includeToolShack: true,
    inventoryKeyItemQuantities: new Map([[key.split(':')[1] ?? key, 98]]),
  };
  return {
    key,
    shopType: key.split(':')[0] ?? 'tool',
    itemId: key.split(':')[1] ?? key,
    stockCycleId: null,
    expectedIncrease: 1,
    sent: 1,
    baseline,
    confirmed: 1,
    staleNoticeTimerId: null,
    staleNoticeShown: false,
    maxTimeoutTimerId: null,
    autoStoreInFlight: false,
    autoStoreAwaitingStack: false,
    autoStoreFinalMoveRequested: false,
    autoStoreStorageId: storageId,
    autoStoreLabel: label,
    storedInTargetStorage: false,
    shopPurchasesBaseline: null,
    shopPurchasesArmed: false,
    cycleArmFp: null,
    cleanups: [],
    presenter: null,
    settle: null,
  };
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  alertStateObj = {
    seedSiloKeyCounts: new Map(),
    decorShedKeyCounts: new Map(),
    toolShackKeyCounts: new Map(),
    inventoryKeyItemQuantities: new Map([
      ['tool:ReplenishPotion', new Map([['ReplenishPotion', 99]])],
      ['seed:Carrot', new Map([['Carrot', 5]])],
    ]),
  };
  toolLimits = new Map([['tool:ReplenishPotion', 99]]);
  sendCalls = [];
  nextSend = { ok: true, awaitResult: async () => result(true) };
  observeResult = false;
  finished = [];
  pendingsMap = new Map();
  ownershipListeners = new Set();
  waitCalls = [];
  realisticWait = false;
});

describe('getStorageRoomForKey', () => {
  it('uses the tool cap minus what the storage already holds', () => {
    alertStateObj.toolShackKeyCounts.set('tool:ReplenishPotion', 79);
    expect(getStorageRoomForKey('ToolShack', 'tool:ReplenishPotion')).toEqual({ held: 79, limit: 99, room: 20 });
  });

  it('treats uncapped items (seeds, decor) as unlimited', () => {
    alertStateObj.seedSiloKeyCounts.set('seed:Carrot', 20651);
    expect(getStorageRoomForKey('SeedSilo', 'seed:Carrot').room).toBe(Infinity);
  });
});

describe('maybeAutoStoreConfirmedDelta', () => {
  it('sends nothing when the storage stack is already at its cap', () => {
    alertStateObj.toolShackKeyCounts.set('tool:ReplenishPotion', 99);
    const pending = makePending('tool:ReplenishPotion', 'ToolShack', 'Tool Shack');

    maybeAutoStoreConfirmedDelta(pending, 1);

    expect(sendCalls).toEqual([]);
    expect(pending.autoStoreInFlight).toBe(false);
    expect(pending.storedInTargetStorage).toBe(false);
    expect(pending.autoStoreSkipReason).toBe('Tool Shack already holds 99/99');
  });

  it('stays in flight until the server accepts, then reports stored', async () => {
    alertStateObj.toolShackKeyCounts.set('tool:ReplenishPotion', 50);
    const pending = makePending('tool:ReplenishPotion', 'ToolShack', 'Tool Shack');

    maybeAutoStoreConfirmedDelta(pending, 1);
    expect(sendCalls).toEqual([{ itemId: 'ReplenishPotion', storageId: 'ToolShack' }]);
    expect(pending.autoStoreInFlight).toBe(true);
    expect(pending.storedInTargetStorage).toBe(false);

    await flush();
    expect(pending.autoStoreInFlight).toBe(false);
    expect(pending.storedInTargetStorage).toBe(true);
    expect(finished).toEqual([pending]);
  });

  it('reports a server refusal with its code and does not claim stored', async () => {
    alertStateObj.toolShackKeyCounts.set('tool:ReplenishPotion', 50);
    nextSend = { ok: true, awaitResult: async () => result(false, 'rejected') };
    const pending = makePending('tool:ReplenishPotion', 'ToolShack', 'Tool Shack');

    maybeAutoStoreConfirmedDelta(pending, 1);
    await flush();

    expect(pending.storedInTargetStorage).toBe(false);
    expect(pending.autoStoreSkipReason).toBe('server refused (rejected)');
    expect(finished).toEqual([pending]);
  });

  it('falls back to the storage count when the result times out', async () => {
    alertStateObj.toolShackKeyCounts.set('tool:ReplenishPotion', 50);
    nextSend = { ok: true, awaitResult: () => Promise.reject(new Error('timeout')) };
    observeResult = true;
    const pending = makePending('tool:ReplenishPotion', 'ToolShack', 'Tool Shack');

    maybeAutoStoreConfirmedDelta(pending, 1);
    await flush();

    expect(pending.storedInTargetStorage).toBe(true);
  });

  it('reports not stored when the answer is unknown and storage never grows', async () => {
    alertStateObj.seedSiloKeyCounts.set('seed:Carrot', 10);
    nextSend = { ok: true, transport: 'legacy' };
    observeResult = false;
    const pending = makePending('seed:Carrot', 'SeedSilo', 'Seed Silo');

    maybeAutoStoreConfirmedDelta(pending, 1);
    await flush();

    expect(sendCalls).toHaveLength(1);
    expect(pending.storedInTargetStorage).toBe(false);
    expect(pending.autoStoreSkipReason).toBe('no storage change observed');
  });

  it('settles immediately when the send never leaves the socket', () => {
    alertStateObj.toolShackKeyCounts.set('tool:ReplenishPotion', 50);
    nextSend = { ok: false, reason: 'no_connection' };
    const pending = makePending('tool:ReplenishPotion', 'ToolShack', 'Tool Shack');

    maybeAutoStoreConfirmedDelta(pending, 1);

    expect(pending.autoStoreInFlight).toBe(false);
    expect(pending.storedInTargetStorage).toBe(false);
    expect(pending.autoStoreSkipReason).toBe('send failed (no_connection)');
  });
});

describe('maybeAutoStoreConfirmedDelta — inventory stack not delivered yet', () => {
  const KEY = 'tool:ReplenishPotion';

  function stagePendingWithoutStack(): PendingOwnershipConfirmation {
    vi.useFakeTimers();
    realisticWait = true;
    alertStateObj.inventoryKeyItemQuantities.delete(KEY);
    alertStateObj.toolShackKeyCounts.set(KEY, 50);
    const pending = makePending(KEY, 'ToolShack', 'Tool Shack');
    pendingsMap.set(KEY, pending);
    return pending;
  }

  afterEach(() => { vi.useRealTimers(); });

  it('holds the pending while it waits, then moves the stack once it appears', async () => {
    const pending = stagePendingWithoutStack();

    maybeAutoStoreConfirmedDelta(pending, 1);
    expect(sendCalls).toEqual([]);
    expect(pending.autoStoreAwaitingStack).toBe(true);
    expect(pending.autoStoreInFlight).toBe(true);
    expect(waitCalls).toEqual([AUTO_STORE_STACK_WAIT_MS]);

    await vi.advanceTimersByTimeAsync(500);
    alertStateObj.inventoryKeyItemQuantities.set(KEY, new Map([['ReplenishPotion', 99]]));
    notifyOwnership();
    await vi.advanceTimersByTimeAsync(0);

    expect(sendCalls).toEqual([{ itemId: 'ReplenishPotion', storageId: 'ToolShack' }]);
    expect(pending.autoStoreAwaitingStack).toBe(false);
    expect(pending.storedInTargetStorage).toBe(true);
    expect(pending.autoStoreInFlight).toBe(false);
    expect(finished).toEqual([pending]);
  });

  it('settles as kept-in-inventory when no stack appears within the bound', async () => {
    const pending = stagePendingWithoutStack();

    maybeAutoStoreConfirmedDelta(pending, 1);
    await vi.advanceTimersByTimeAsync(AUTO_STORE_STACK_WAIT_MS - 1);
    expect(finished).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);

    expect(sendCalls).toEqual([]);
    expect(pending.autoStoreAwaitingStack).toBe(false);
    expect(pending.autoStoreInFlight).toBe(false);
    expect(pending.storedInTargetStorage).toBe(false);
    expect(pending.autoStoreSkipReason).toBe('no inventory stack seen');
    expect(finished).toEqual([pending]);
  });

  it('ignores a second confirmation while the wait is open', async () => {
    const pending = stagePendingWithoutStack();

    maybeAutoStoreConfirmedDelta(pending, 1);
    maybeAutoStoreConfirmedDelta(pending, 1);
    expect(waitCalls).toHaveLength(1);
    expect(ownershipListeners.size).toBe(1);
    await vi.advanceTimersByTimeAsync(AUTO_STORE_STACK_WAIT_MS);
    expect(finished).toEqual([pending]);
  });

  it('sends nothing when the pending was cleared during the wait', async () => {
    const pending = stagePendingWithoutStack();

    maybeAutoStoreConfirmedDelta(pending, 1);
    pendingsMap.delete(KEY);
    alertStateObj.inventoryKeyItemQuantities.set(KEY, new Map([['ReplenishPotion', 99]]));
    notifyOwnership();
    await vi.advanceTimersByTimeAsync(0);

    expect(sendCalls).toEqual([]);
    expect(pending.autoStoreInFlight).toBe(false);
    expect(pending.autoStoreAwaitingStack).toBe(false);
  });

  it('finishes the held completion when the late stack meets a full storage stack', async () => {
    const pending = stagePendingWithoutStack();
    alertStateObj.toolShackKeyCounts.set(KEY, 99);

    maybeAutoStoreConfirmedDelta(pending, 1);
    alertStateObj.inventoryKeyItemQuantities.set(KEY, new Map([['ReplenishPotion', 99]]));
    notifyOwnership();
    await vi.advanceTimersByTimeAsync(0);

    expect(sendCalls).toEqual([]);
    expect(pending.autoStoreSkipReason).toBe('Tool Shack already holds 99/99');
    expect(finished).toEqual([pending]);
  });

  it('does not wait when there is no storage target', () => {
    const pending = stagePendingWithoutStack();
    pending.autoStoreStorageId = null;

    maybeAutoStoreConfirmedDelta(pending, 1);

    expect(waitCalls).toEqual([]);
    expect(pending.autoStoreAwaitingStack).toBe(false);
    expect(pending.autoStoreInFlight).toBe(false);
  });
});
