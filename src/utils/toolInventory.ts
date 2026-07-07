import { getInventoryItems, onInventoryChange } from '../store/inventory';

/**
 * Get the current count of a tool in the player's inventory by `raw.toolId`.
 */
export function getToolCount(toolId: string): number {
  const items = getInventoryItems();
  for (const item of items) {
    const raw = item.raw as Record<string, unknown> | null;
    if (raw && raw.toolId === toolId) {
      return item.quantity ?? item.count ?? item.amount ?? 1;
    }
  }
  return 0;
}

/**
 * Subscribe to changes in a specific tool's count.
 * Calls `cb` only when the count actually differs. Returns an unsubscribe function.
 */
export function onToolCountChange(toolId: string, cb: (count: number) => void): () => void {
  let lastCount = getToolCount(toolId);

  return onInventoryChange(() => {
    const current = getToolCount(toolId);
    if (current !== lastCount) {
      lastCount = current;
      cb(current);
    }
  });
}
