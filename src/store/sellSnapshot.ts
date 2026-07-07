// src/store/sellSnapshot.ts
// Capture produce inventory just before a Sell All Crops action executes

import { getAtomByLabel, subscribeAtom } from '../core/jotaiBridge';
import { InventoryItem, readInventoryDirect } from './inventory';
import { log } from '../utils/logger';

const ACTION_ATOM_LABEL = 'actionAtom';
const SELL_ALL_ACTION = 'sellAllCrops';

let unsubscribe: (() => void) | null = null;
let initializing = false;
let lastProduceSnapshot: InventoryItem[] = [];
let lastCapturedAt: number | null = null;
const listeners = new Set<(payload: { items: InventoryItem[]; timestamp: number }) => void>();

function isProduce(item: InventoryItem): boolean {
  const type = (item.itemType ?? (item as any)?.raw?.itemType ?? '').toString().toLowerCase();
  return type === 'produce';
}

async function captureProduceSnapshot(): Promise<void> {
  try {
    const data = await readInventoryDirect();
    if (!data || !Array.isArray(data.items)) {
      lastProduceSnapshot = [];
      lastCapturedAt = Date.now();
      return;
    }

    lastProduceSnapshot = data.items
      .filter(isProduce)
      .map((item) => ({ ...item }));
    lastCapturedAt = Date.now();
    listeners.forEach((fn) => {
      try {
        fn({ items: [...lastProduceSnapshot], timestamp: lastCapturedAt! });
      } catch (error) {
        log('⚠️ Sell snapshot listener error', error);
      }
    });
    log(`🧾 Captured produce snapshot before ${SELL_ALL_ACTION} (${lastProduceSnapshot.length} entries)`);
  } catch (error) {
    log('⚠️ Failed to capture produce snapshot', error);
  }
}

export async function startSellSnapshotWatcher(): Promise<void> {
  if (unsubscribe || initializing) return;

  initializing = true;
  try {
    const actionAtom = getAtomByLabel(ACTION_ATOM_LABEL);
    if (!actionAtom) {
      log('⚠️ Sell snapshot watcher: actionAtom not found');
      initializing = false;
      return;
    }

    // 'composite' tier: actionAtom composes state (weather, garden tile) +
    // client-local input (activeActionIndex). Reactive manager subscribes to
    // both trigger sources; refs-check dedups redundant fires.
    unsubscribe = await subscribeAtom<string>(actionAtom, (value) => {
      if (value === SELL_ALL_ACTION) {
        void captureProduceSnapshot();
      }
    }, 'composite');

    log('✅ Sell snapshot watcher initialized');
  } catch (error) {
    log('⚠️ Failed to initialize sell snapshot watcher', error);
  } finally {
    initializing = false;
  }
}

export function stopSellSnapshotWatcher(): void {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
}

export function subscribeSellSnapshot(
  listener: (payload: { items: InventoryItem[]; timestamp: number }) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getLastProduceSnapshot(): InventoryItem[] {
  return [...lastProduceSnapshot];
}

export function getLastProduceSnapshotTimestamp(): number | null {
  return lastCapturedAt;
}
