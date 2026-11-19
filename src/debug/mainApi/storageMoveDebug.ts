import { readSync } from '../../core/gameState';
import { isRecord } from '../../utils/typeGuards';
import { sendRoomAction } from '../../websocket/api';

type StorageId = 'SeedSilo' | 'ToolShack' | 'DecorShed';
type Counts = { bag: number; storage: number | null };

const STORAGE_KEYS = { SeedSilo: 'seedSiloItems', ToolShack: 'toolShackItems', DecorShed: 'decorShedItems' } as const;
// The state patch lands just after the command result; one short wait lets `after` show it.
const SETTLE_MS = 500;

// The game's getInventoryItemId: unique items by instance id, stacks by their dex id.
function matches(raw: unknown, itemId: string): boolean {
  if (!isRecord(raw)) return false;
  return raw.id === itemId || raw.species === itemId || raw.toolId === itemId || raw.decorId === itemId;
}

function quantityOf(items: unknown, itemId: string): number {
  if (!Array.isArray(items)) return 0;
  let total = 0;
  for (const raw of items) {
    if (!matches(raw, itemId)) continue;
    const q = isRecord(raw) ? raw.quantity : undefined;
    total += typeof q === 'number' ? q : 1;
  }
  return total;
}

function counts(itemId: string, storageId: StorageId): Counts {
  const inventory = readSync('inventory');
  const stored = readSync(STORAGE_KEYS[storageId]);
  return {
    bag: quantityOf(isRecord(inventory) ? inventory.items : undefined, itemId),
    storage: stored === null ? null : quantityOf(stored, itemId),
  };
}

async function move(direction: 'take' | 'put', itemId: string, storageId: StorageId) {
  if (!(storageId in STORAGE_KEYS)) return { error: `storageId must be one of ${Object.keys(STORAGE_KEYS).join(', ')}` };
  const before = counts(itemId, storageId);
  const type = direction === 'take' ? 'RetrieveItemFromStorage' : 'PutItemInStorage';
  const sent = sendRoomAction(type, { itemId, storageId }, { skipThrottle: true });
  if (!sent.ok) return { sent: sent.reason ?? 'refused', before };
  let reply = 'none (legacy transport, no server answer)';
  if (sent.awaitResult) {
    try {
      const r = await sent.awaitResult();
      reply = r.ok ? 'ok' : String(r.code ?? 'rejected');
    } catch {
      reply = 'timeout (outcome unknown)';
    }
  }
  await new Promise<void>((resolve) => { setTimeout(resolve, SETTLE_MS); });
  return { sent: 'ok', reply, before, after: counts(itemId, storageId) };
}

/** QPM_DEBUG_API.storageMove: the INP-5.1 hand test, one whole-stack move per call (MoveItem on the wire). */
export const storageMoveDebugApi = {
  storageMove: {
    /** Storage → bag, whole stack. itemId = seed species, toolId or decorId (charged crystal: its instance id). */
    take: (itemId: string, storageId: StorageId) => move('take', itemId, storageId),
    /** Bag → storage, whole stack. */
    put: (itemId: string, storageId: StorageId) => move('put', itemId, storageId),
  },
};
