// INP-4.4 (D3): the seeds, eggs and decor a player chose to bind; INP-4.5 turns each into a key row.

import { getAllDecor, getAllEggTypes, getAllPlantSpecies, getDecor, getEggType, getPlantSpecies } from '../../../catalogs/gameCatalogs';
import { getInventoryItems } from '../../../store/inventory';
import { storage } from '../../../utils/storage';
import { chooseItemId, type SelectKind } from './core';

const STORAGE_KEY = 'qpm.keybinds.myItems.v1';

export type MyItemKind = Exclude<SelectKind, 'tool'>;
export const MY_ITEM_KINDS: readonly MyItemKind[] = ['seed', 'egg', 'decor'];

export interface MyItem {
  readonly kind: MyItemKind;
  /** Catalog id: seed species, eggId or decorId. */
  readonly id: string;
}

export interface PickableItem extends MyItem {
  readonly name: string;
  readonly spriteKey: string | null;
}

interface MyItemsState {
  items: MyItem[];
}

const listeners = new Set<() => void>();

const isKind = (v: unknown): v is MyItemKind => MY_ITEM_KINDS.includes(v as MyItemKind);

export function myItemKey(item: MyItem): string {
  return `${item.kind}:${item.id}`;
}

export function getMyItems(): MyItem[] {
  const raw = storage.get<MyItemsState | null>(STORAGE_KEY, null);
  const list: unknown[] = raw && typeof raw === 'object' && Array.isArray(raw.items) ? raw.items : [];
  const seen = new Set<string>();
  const out: MyItem[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const { kind, id } = entry as Record<string, unknown>;
    if (!isKind(kind) || typeof id !== 'string' || !id) continue;
    const item: MyItem = { kind, id };
    if (seen.has(myItemKey(item))) continue;
    seen.add(myItemKey(item));
    out.push(item);
  }
  return out;
}

export function setMyItemChosen(item: MyItem, chosen: boolean): void {
  const key = myItemKey(item);
  const current = getMyItems();
  if (current.some(i => myItemKey(i) === key) === chosen) return;
  const next = chosen ? [...current, { kind: item.kind, id: item.id }] : current.filter(i => myItemKey(i) !== key);
  storage.set(STORAGE_KEY, { items: next } satisfies MyItemsState);
  for (const cb of [...listeners]) {
    try { cb(); } catch { /* one listener must not break the others */ }
  }
}

export function onMyItemsChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

// Flora keeps the seed's name/sprite on `.seed`; decor keeps its atlas key on `art` (as shopEligibility.ts:56-61).
function lookOf(kind: MyItemKind, id: string): { name: string | null; spriteKey: string | null } {
  switch (kind) {
    case 'seed': {
      const seed = getPlantSpecies(id)?.seed;
      return { name: str(seed?.name), spriteKey: str(seed?.sprite) };
    }
    case 'egg': {
      const egg = getEggType(id);
      return { name: str(egg?.name), spriteKey: str(egg?.sprite) };
    }
    case 'decor': {
      const decor = getDecor(id);
      return { name: str(decor?.name), spriteKey: str(decor?.art) };
    }
  }
}

function idsOf(kind: MyItemKind): string[] {
  switch (kind) {
    case 'seed': return getAllPlantSpecies();
    case 'egg': return getAllEggTypes();
    case 'decor': return getAllDecor();
  }
}

/** Every catalog entry of the kind that has a name, sorted by name; empty until the catalogs load. */
export function listPickableItems(kind: MyItemKind): PickableItem[] {
  const out: PickableItem[] = [];
  for (const id of idsOf(kind)) {
    const look = lookOf(kind, id);
    if (look.name) out.push({ kind, id, name: look.name, spriteKey: look.spriteKey });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function myItemLook(item: MyItem): { name: string; spriteKey: string | null } {
  const look = lookOf(item.kind, item.id);
  return { name: look.name ?? item.id, spriteKey: look.spriteKey };
}

/** `myItemKey`s with at least one pickable item in the bag (same rule as the select engine). */
export function myItemsInBag(items: readonly MyItem[], bag: readonly unknown[] = getInventoryItems().map(i => i.raw)): Set<string> {
  return new Set(items.filter(item => chooseItemId(bag, item) !== null).map(myItemKey));
}
