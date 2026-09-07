import { subscribeAtomValue } from '../core/atomRegistry';
import { InventoryItem, readInventoryDirect } from './inventory';
import { createStoreDiagnostics } from './_storeDiagnostics';

const diag = createStoreDiagnostics('storeSellSnapshot', 'sellSnapshot');

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
        diag.warn('QPM-STORE-003', { phase: 'notify' }, error);
      }
    });
    diag.log.debug(`Captured produce snapshot before ${SELL_ALL_ACTION}`, { entries: lastProduceSnapshot.length });
  } catch (error) {
    diag.warn('QPM-STORE-003', { phase: 'captureSnapshot' }, error);
  }
}

export async function startSellSnapshotWatcher(): Promise<void> {
  if (unsubscribe || initializing) return;

  initializing = true;
  diag.register('Starting sell snapshot watcher');
  try {
    // The `action` key carries tier: 'composite' — actionAtom composes state + client-local input.
    unsubscribe = await subscribeAtomValue('action', (value) => {
      if (value === SELL_ALL_ACTION) {
        void captureProduceSnapshot();
      }
    });

    diag.log.debug('Sell snapshot watcher initialized');
    diag.publishOk('Sell snapshot watcher ready');
  } catch (error) {
    diag.warn('QPM-STORE-001', { phase: 'init' }, error);
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
