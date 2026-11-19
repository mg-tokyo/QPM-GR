// Which storages the player owns, and which of them the key opens.
import { readSync, subscribe } from '../../core/gameState';
import type { QuinoaInventory } from '../../types/gameAtoms';

/** Building ids of the owned storages, in the game's order. */
export function ownedStorageIds(inventory: QuinoaInventory | null | undefined): string[] {
  const storages = inventory?.storages;
  if (!Array.isArray(storages)) return [];
  const ids = new Set<string>();
  for (const entry of storages) {
    const id: unknown = entry?.decorId;
    if (typeof id === 'string' && id) ids.add(id);
  }
  return [...ids];
}

/** The pick limited to what is owned, in pick order; everything owned when nothing picked is owned. */
export function chooseStorageIds(owned: readonly string[], pick: readonly string[] | null): string[] {
  if (!pick) return [...owned];
  const chosen = [...new Set(pick.filter(id => owned.includes(id)))];
  return chosen.length > 0 ? chosen : [...owned];
}

/** The pick after pressing `id`: null = every owned storage; 'refused' when it would leave none picked. */
export function nextPick(owned: readonly string[], pick: readonly string[] | null, id: string): string[] | null | 'refused' {
  if (!owned.includes(id)) return 'refused';
  const chosen = chooseStorageIds(owned, pick);
  const picked = chosen.includes(id);
  if (picked && chosen.length === 1) return 'refused';
  const next = owned.filter(o => (o === id ? !picked : chosen.includes(o)));
  return next.length === owned.length ? null : next;
}

export function readOwnedStorageIds(): string[] {
  return ownedStorageIds(readSync('inventory'));
}

/** Fires only when the owned list itself changes, not on every inventory write. */
export function onOwnedStorageIdsChange(cb: (ids: string[]) => void): () => void {
  let last = readOwnedStorageIds().join('|');
  return subscribe('inventory', (inventory) => {
    const ids = ownedStorageIds(inventory);
    const key = ids.join('|');
    if (key === last) return;
    last = key;
    cb(ids);
  });
}
