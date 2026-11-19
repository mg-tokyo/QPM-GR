import { isRecord } from '../../../utils/typeGuards';

export type SelectKind = 'tool' | 'seed' | 'egg' | 'decor';

/** `id` is the catalog id: toolId, seed species, eggId or decorId. */
export interface SelectTarget {
  readonly kind: SelectKind;
  readonly id: string;
}

export type SelectPlan =
  | { readonly action: 'pickup'; readonly itemId: string }
  | { readonly action: 'putAway'; readonly itemId: string }
  | { readonly action: 'missing' };

interface Candidate {
  readonly itemId: string;
  /** Charged crystals only (beta V46_QuinoaUserJson.ts:344-356); fresh stacks have none (live 2065, spec F24). */
  readonly remaining: number | null;
}

const DEX_FIELD: Record<SelectKind, string> = { tool: 'toolId', seed: 'species', egg: 'eggId', decor: 'decorId' };

// The game's ItemType values per kind (beta common/…/utils/inventory.ts:383-402).
function matchesKind(raw: Record<string, unknown>, target: SelectTarget): boolean {
  switch (target.kind) {
    case 'tool': return raw.itemType === 'Tool' && raw.toolId === target.id;
    case 'seed': return raw.itemType === 'Seed' && raw.species === target.id;
    case 'egg': return raw.itemType === 'Egg' && raw.eggId === target.id;
    case 'decor': return raw.itemType === 'Decor' && raw.decorId === target.id;
  }
}

/** The game's getInventoryItemId: a tool with its own instance id (charged crystal) goes by it, else by its dex id. */
export function bagItemId(raw: Record<string, unknown>, kind: SelectKind): string | null {
  const id = kind === 'tool' && typeof raw.id === 'string' ? raw.id : raw[DEX_FIELD[kind]];
  return typeof id === 'string' && id.length > 0 ? id : null;
}

// The server ignores a pick of quantity ≤ 0 (beta systems/inventory/heldItem.ts:34).
function hasQuantity(raw: Record<string, unknown>): boolean {
  return typeof raw.quantity !== 'number' || raw.quantity > 0;
}

function candidates(items: readonly unknown[], target: SelectTarget): Candidate[] {
  const out: Candidate[] = [];
  for (const raw of items) {
    if (!isRecord(raw) || !matchesKind(raw, target) || !hasQuantity(raw)) continue;
    const itemId = bagItemId(raw, target.kind);
    if (!itemId) continue;
    out.push({ itemId, remaining: typeof raw.remainingActiveSeconds === 'number' ? raw.remainingActiveSeconds : null });
  }
  return out;
}

/** INP-4 D6: charged crystals with time left (least first), then the fresh stack, then spent crystals; bag order on ties. */
export function chooseItemId(items: readonly unknown[], target: SelectTarget): string | null {
  const found = candidates(items, target);
  const live = found.filter(c => c.remaining !== null && c.remaining > 0)
    .sort((a, b) => (a.remaining ?? 0) - (b.remaining ?? 0));
  const fresh = found.filter(c => c.remaining === null);
  const spent = found.filter(c => c.remaining !== null && c.remaining <= 0);
  return (live[0] ?? fresh[0] ?? spent[0])?.itemId ?? null;
}

export interface FetchPlan {
  readonly storageId: string;
  readonly itemId: string;
  readonly itemType: string;
}

// Current builds name a storage by decorId; storageId / id are older (as gameState keys/selectors.ts:56-57).
function storageIdOf(entry: Record<string, unknown>): string | null {
  const id = entry.decorId ?? entry.storageId ?? entry.id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/** INP-5 D6: the first storage holding the target, its item chosen as in the bag; the item type decides the storage. */
export function planFetch(storages: readonly unknown[], target: SelectTarget): FetchPlan | null {
  for (const entry of storages) {
    if (!isRecord(entry) || !Array.isArray(entry.items)) continue;
    const storageId = storageIdOf(entry);
    const itemId = storageId ? chooseItemId(entry.items, target) : null;
    if (!storageId || !itemId) continue;
    const raw = entry.items.find(item => isRecord(item) && matchesKind(item, target) && bagItemId(item, target.kind) === itemId);
    return { storageId, itemId, itemType: isRecord(raw) && typeof raw.itemType === 'string' ? raw.itemType : '' };
  }
  return null;
}

/** INP-4 D4: holding any item of the target already → put it away; D5: none in the bag → missing. */
export function planSelect(items: readonly unknown[], target: SelectTarget, heldItemId: string | null): SelectPlan {
  if (heldItemId !== null && candidates(items, target).some(c => c.itemId === heldItemId)) {
    return { action: 'putAway', itemId: heldItemId };
  }
  const itemId = chooseItemId(items, target);
  return itemId ? { action: 'pickup', itemId } : { action: 'missing' };
}
