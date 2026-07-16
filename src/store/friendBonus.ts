// Friend bonus formula (from game source): min(2.0, 1.0 + max(0, floor(filledSlots-1)) * 0.1)

import { readAtomValue, subscribeAtomValue } from '../core/atomRegistry';
import { criticalInterval, timerManager } from '../utils/scheduling/timerManager';
import { createStoreDiagnostics } from './_storeDiagnostics';

const diag = createStoreDiagnostics('storeFriendBonus', 'friendBonus');

const RETRY_TIMER_ID = 'friendBonus:atomRetry';
const RETRY_MAX = 30;

let started = false;
let multiplier = 1.0;
let atomUnsub: (() => void) | null = null;
let stopRetryTimer: (() => void) | null = null;
let retryCount = 0;

const listeners = new Set<(multiplier: number) => void>();

function countFilledSlots(userSlots: unknown): number {
  if (!Array.isArray(userSlots)) return 0;
  return userSlots.filter((slot) => slot != null).length;
}

function computeMultiplier(filledSlots: number): number {
  return Math.min(2.0, 1.0 + Math.max(0, Math.floor(filledSlots - 1)) * 0.1);
}

function applySlotData(value: unknown): void {
  // userSlotsAtom shape varies: direct array, or { child: { data: { userSlots: [...] } } }
  let slots: unknown = value;
  if (!Array.isArray(slots) && slots && typeof slots === 'object') {
    const rec = slots as Record<string, unknown>;
    const nested =
      (rec.userSlots as unknown) ??
      ((rec.child as Record<string, unknown> | undefined)?.data as Record<string, unknown> | undefined)?.userSlots;
    if (Array.isArray(nested)) {
      slots = nested;
    }
  }

  const filled = countFilledSlots(slots);
  const next = computeMultiplier(filled);
  if (next !== multiplier) {
    multiplier = next;
    for (const cb of listeners) {
      try { cb(multiplier); } catch (error) { diag.warn('QPM-STORE-003', { phase: 'notify' }, error); }
    }
  }
}

async function trySubscribe(): Promise<boolean> {
  if (atomUnsub) return true;

  try {
    const unsub = await subscribeAtomValue('userSlots', applySlotData);
    if (!unsub) return false;

    atomUnsub = unsub;

    const initial = await readAtomValue('userSlots');
    applySlotData(initial);

    timerManager.unregister(RETRY_TIMER_ID);
    stopRetryTimer = null;

    diag.log.debug('Subscribed to userSlotsAtom', { multiplier });
    diag.publishOk('Friend bonus subscribed', { multiplier });
    return true;
  } catch (err) {
    diag.warn('QPM-STORE-002', { atom: 'userSlots', phase: 'subscribe' }, err);
    return false;
  }
}

/** Current friend bonus multiplier (1.0 – 2.0). */
export function getFriendBonusMultiplier(): number {
  return multiplier;
}

/** Register a callback for when the multiplier changes. Returns unsubscribe fn. */
export function onFriendBonusChange(cb: (multiplier: number) => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function startFriendBonusStore(): void {
  if (started) return;
  started = true;
  diag.register('Starting friend bonus store');

  void trySubscribe();

  stopRetryTimer = criticalInterval(RETRY_TIMER_ID, () => {
    if (atomUnsub) {
      timerManager.unregister(RETRY_TIMER_ID);
      stopRetryTimer = null;
      return;
    }
    retryCount++;
    if (retryCount >= RETRY_MAX) {
      timerManager.unregister(RETRY_TIMER_ID);
      stopRetryTimer = null;
      diag.warn('QPM-STORE-002', { atom: 'userSlots', gaveUp: true, retries: retryCount });
      return;
    }
    void trySubscribe();
  }, 1000);

  diag.log.debug('Friend bonus store started');
}

export function stopFriendBonusStore(): void {
  if (!started) return;
  started = false;

  timerManager.unregister(RETRY_TIMER_ID);
  stopRetryTimer = null;

  atomUnsub?.();
  atomUnsub = null;

  listeners.clear();
  multiplier = 1.0;
  retryCount = 0;

  diag.log.debug('Friend bonus store stopped');
}
