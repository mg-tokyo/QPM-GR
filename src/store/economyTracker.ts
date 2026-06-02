// src/store/economyTracker.ts
// Samples currency balances from Jotai atoms and computes earning rates.
// Hooks into WS sends (SellPet, Purchase*) for per-action transaction context.

import { subscribeAtomValue } from '../core/atomRegistry';
import { getStatsSnapshot, type ShopCategoryKey } from './stats';
import { visibleInterval } from '../utils/scheduling/timerManager';
import { onActionSent, type RoomActionType } from '../websocket/api';
import { log } from '../utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CurrencySnapshot {
  balance: number;
  rate: number;           // per hour (moving average)
}

export interface SpendingBreakdown {
  coins: number;
  credits: number;
  dust: number;
}

export type CurrencyType = 'coins' | 'credits' | 'dust';

export interface Transaction {
  currency: CurrencyType;
  amount: number;         // positive = income, negative = expense
  balanceAfter: number;
  timestamp: number;
  context?: string;       // e.g. "Sold 10 pets", "Purchased DawnEgg"
}

export interface EconomySnapshot {
  coins: CurrencySnapshot & { connected: boolean };
  credits: { balance: number; connected: boolean };
  dust: CurrencySnapshot & { connected: boolean };
  spending: {
    total: SpendingBreakdown;
    byCategory: Record<ShopCategoryKey, SpendingBreakdown>;
  };
  transactions: Transaction[];
  sessionStart: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface BalanceSample {
  value: number;
  time: number;
}

const SAMPLE_INTERVAL_MS = 30_000;
const MAX_SAMPLES = 20; // ~10 min window

let initialized = false;
const cleanups: Array<() => void> = [];
const listeners = new Set<(s: EconomySnapshot) => void>();

let coinsBalance = 0;
let creditsBalance = 0;
let dustBalance = 0;
let coinsConnected = false;
let creditsConnected = false;
let dustConnected = false;
const coinSamples: BalanceSample[] = [];
const dustSamples: BalanceSample[] = [];
const transactions: Transaction[] = [];
const MAX_TRANSACTIONS = 100;
const sessionStart = Date.now();

// ---------------------------------------------------------------------------
// Debounced transaction recording
// ---------------------------------------------------------------------------
// Rapid balance changes (e.g. batch sells at 40ms intervals) get coalesced by
// Jotai into a few atom updates. We debounce so all changes within a window
// merge into one transaction entry, then annotate it with WS action context.

const TX_DEBOUNCE_MS = 600;
const MIN_TRANSACTION_AMOUNT = 1;

interface PendingTx {
  currency: CurrencyType;
  totalDelta: number;
  latestBalance: number;
  timer: ReturnType<typeof setTimeout>;
}

const pendingTxMap: Partial<Record<CurrencyType, PendingTx>> = {};

// WS action tracking for context annotation
interface PendingAction {
  type: RoomActionType;
  payload: Record<string, unknown>;
  timestamp: number;
}

const pendingActions: PendingAction[] = [];
const PENDING_ACTION_WINDOW_MS = 3_000;

function pruneStaleActions(): void {
  const cutoff = Date.now() - PENDING_ACTION_WINDOW_MS;
  while (pendingActions.length > 0 && pendingActions[0]!.timestamp < cutoff) {
    pendingActions.shift();
  }
}

function buildTransactionContext(currency: CurrencyType, amount: number): string | undefined {
  pruneStaleActions();

  if (amount > 0) {
    // Income — check for pending SellPet actions
    const sells = pendingActions.filter(a => a.type === 'SellPet');
    if (sells.length > 0) {
      // Consume these actions
      for (const s of sells) {
        const idx = pendingActions.indexOf(s);
        if (idx >= 0) pendingActions.splice(idx, 1);
      }
      return sells.length === 1 ? 'Sold pet' : `Sold ${sells.length} pets`;
    }
  } else if (amount < 0) {
    // Expense — check for pending Purchase* actions
    const purchases = pendingActions.filter(a => a.type.startsWith('Purchase'));
    if (purchases.length > 0) {
      for (const p of purchases) {
        const idx = pendingActions.indexOf(p);
        if (idx >= 0) pendingActions.splice(idx, 1);
      }
      if (purchases.length === 1) {
        const p = purchases[0]!;
        const itemKey = (p.payload.species ?? p.payload.eggId ?? p.payload.toolId ?? p.payload.decorId) as string | undefined;
        return itemKey ? `Purchased ${itemKey}` : 'Purchase';
      }
      return `${purchases.length} purchases`;
    }
  }

  return undefined;
}

function flushTransaction(currency: CurrencyType): void {
  const pending = pendingTxMap[currency];
  if (!pending) return;
  delete pendingTxMap[currency];
  if (Math.abs(pending.totalDelta) < MIN_TRANSACTION_AMOUNT) return;

  const context = buildTransactionContext(currency, pending.totalDelta);

  transactions.unshift({
    currency,
    amount: pending.totalDelta,
    balanceAfter: pending.latestBalance,
    timestamp: Date.now(),
    ...(context != null ? { context } : {}),
  });
  if (transactions.length > MAX_TRANSACTIONS) transactions.length = MAX_TRANSACTIONS;
  notifyListeners();
}

function bufferTransaction(currency: CurrencyType, delta: number, balanceAfter: number): void {
  const existing = pendingTxMap[currency];
  if (existing) {
    clearTimeout(existing.timer);
    existing.totalDelta += delta;
    existing.latestBalance = balanceAfter;
    existing.timer = setTimeout(() => flushTransaction(currency), TX_DEBOUNCE_MS);
  } else {
    pendingTxMap[currency] = {
      currency,
      totalDelta: delta,
      latestBalance: balanceAfter,
      timer: setTimeout(() => flushTransaction(currency), TX_DEBOUNCE_MS),
    };
  }
}

// ---------------------------------------------------------------------------
// Rate calculation — linear regression over sliding window
// ---------------------------------------------------------------------------

function computeRate(samples: BalanceSample[]): number {
  if (samples.length < 2) return 0;
  const oldest = samples[0]!;
  const newest = samples[samples.length - 1]!;
  const deltaHours = (newest.time - oldest.time) / 3_600_000;
  if (deltaHours < 0.005) return 0; // < 18s — too small
  return (newest.value - oldest.value) / deltaHours;
}

function pushSample(buf: BalanceSample[], value: number): void {
  const now = Date.now();
  // Dedup: skip if last sample has same value and is within 5s
  if (buf.length > 0) {
    const last = buf[buf.length - 1]!;
    if (last.value === value && now - last.time < 5_000) return;
  }
  buf.push({ value, time: now });
  if (buf.length > MAX_SAMPLES) buf.shift();
}

// ---------------------------------------------------------------------------
// Spending breakdown from stats store
// ---------------------------------------------------------------------------

function buildSpending(): EconomySnapshot['spending'] {
  const stats = getStatsSnapshot().shop;
  const total: SpendingBreakdown = {
    coins: stats.totalSpentCoins,
    credits: stats.totalSpentCredits,
    dust: stats.totalSpentMagicDust,
  };

  const categories: ShopCategoryKey[] = ['seeds', 'eggs', 'tools', 'decor', 'dawn'];
  const byCategory = {} as Record<ShopCategoryKey, SpendingBreakdown>;

  for (const cat of categories) {
    byCategory[cat] = { coins: 0, credits: 0, dust: 0 };
  }

  // Derive per-category from history entries
  for (const entry of stats.history) {
    const cat = entry.category;
    if (byCategory[cat]) {
      byCategory[cat].coins += entry.coins;
      byCategory[cat].credits += entry.credits;
      byCategory[cat].dust += entry.magicDust;
    }
  }

  return { total, byCategory };
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

function buildSnapshot(): EconomySnapshot {
  return {
    coins: { balance: coinsBalance, rate: computeRate(coinSamples), connected: coinsConnected },
    credits: { balance: creditsBalance, connected: creditsConnected },
    dust: { balance: dustBalance, rate: computeRate(dustSamples), connected: dustConnected },
    spending: buildSpending(),
    transactions: transactions.slice(),
    sessionStart,
    updatedAt: Date.now(),
  };
}

function notifyListeners(): void {
  if (listeners.size === 0) return;
  const snapshot = buildSnapshot();
  for (const cb of listeners) {
    try { cb(snapshot); } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getEconomySnapshot(): EconomySnapshot {
  return buildSnapshot();
}

export function subscribeEconomy(cb: (s: EconomySnapshot) => void): () => void {
  listeners.add(cb);
  // Immediate call with current state
  try { cb(buildSnapshot()); } catch { /* ignore */ }
  return () => { listeners.delete(cb); };
}

export async function initEconomyTracker(): Promise<void> {
  if (initialized) return;
  initialized = true;

  // Hook into WS sends for transaction context (sell/purchase tracking)
  const unsubActions = onActionSent((type, payload) => {
    if (type === 'SellPet' || type.startsWith('Purchase')) {
      pendingActions.push({ type, payload: { ...payload }, timestamp: Date.now() });
    }
  });
  cleanups.push(unsubActions);

  // Subscribe to currency atoms — push a sample on every balance change
  // so rate calculation captures sells, purchases, and ability procs immediately.
  try {
    const unsubCoins = await subscribeAtomValue('coinsBalance', (v) => {
      coinsConnected = true;
      const prev = coinsBalance;
      coinsBalance = typeof v === 'number' ? v : 0;
      if (coinsBalance !== prev) {
        pushSample(coinSamples, coinsBalance);
        if (prev !== 0) bufferTransaction('coins', coinsBalance - prev, coinsBalance);
      }
      notifyListeners();
    });
    if (unsubCoins) cleanups.push(unsubCoins);
  } catch { log('[EconomyTracker] coinsBalance atom not found — balance unavailable'); }

  try {
    const unsubCredits = await subscribeAtomValue('creditsBalance', (v) => {
      creditsConnected = true;
      const prev = creditsBalance;
      creditsBalance = typeof v === 'number' ? v : 0;
      if (creditsBalance !== prev && prev !== 0) {
        bufferTransaction('credits', creditsBalance - prev, creditsBalance);
      }
      notifyListeners();
    });
    if (unsubCredits) cleanups.push(unsubCredits);
  } catch { log('[EconomyTracker] creditsBalance atom not found'); }

  try {
    const unsubDust = await subscribeAtomValue('magicDustBalance', (v) => {
      dustConnected = true;
      const prev = dustBalance;
      dustBalance = typeof v === 'number' ? v : 0;
      if (dustBalance !== prev) {
        pushSample(dustSamples, dustBalance);
        if (prev !== 0) bufferTransaction('dust', dustBalance - prev, dustBalance);
      }
      notifyListeners();
    });
    if (unsubDust) cleanups.push(unsubDust);
  } catch { log('[EconomyTracker] magicDustBalance atom not found'); }

  // Periodic sampling as a floor — ensures rate doesn't stall during idle periods
  const stopSampler = visibleInterval('economy-tracker-sampler', () => {
    pushSample(coinSamples, coinsBalance);
    pushSample(dustSamples, dustBalance);
    notifyListeners();
  }, SAMPLE_INTERVAL_MS);
  cleanups.push(stopSampler);

  // Initial samples taken after atom subscriptions fire (balance may already be set)
  pushSample(coinSamples, coinsBalance);
  pushSample(dustSamples, dustBalance);
}

export function destroyEconomyTracker(): void {
  // Clear any pending debounce timers
  for (const key of ['coins', 'credits', 'dust'] as CurrencyType[]) {
    const pending = pendingTxMap[key];
    if (pending) {
      clearTimeout(pending.timer);
      delete pendingTxMap[key];
    }
  }
  pendingActions.length = 0;

  for (const fn of cleanups) {
    try { fn(); } catch { /* ignore */ }
  }
  cleanups.length = 0;
  listeners.clear();
  coinSamples.length = 0;
  dustSamples.length = 0;
  transactions.length = 0;
  coinsConnected = false;
  creditsConnected = false;
  dustConnected = false;
  initialized = false;
}
