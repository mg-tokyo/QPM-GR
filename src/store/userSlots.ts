import { ensureJotaiStore, findAtomsByLabel, getAtomByLabel, readAtomValue } from '../core/jotaiBridge';
import { log } from '../utils/logger';

export interface UserSlotsInventorySnapshot {
  items: any[];
  favoritedItemIds: string[];
  source: string;
  hasSlotData: boolean;
}

const USER_SLOTS_ATOM_LABEL = 'userSlotsAtom';

let jotaiStoreFailureLogged = false;
let userSlotsAtomNotFoundLogged = false;
let userSlotsAccessFailureLogged = false;

function normalizeInventoryArray(input: unknown): any[] | null {
  if (!Array.isArray(input) || input.length === 0) {
    return null;
  }

  const firstObject = input.find((entry) => entry && typeof entry === 'object');
  if (!firstObject) {
    return null;
  }

  const candidate = firstObject as Record<string, unknown>;
  const hasInventoryKeys =
    'itemType' in candidate ||
    'species' in candidate ||
    'slots' in candidate ||
    'plant' in candidate ||
    'item' in candidate;

  return hasInventoryKeys ? input : null;
}

function extractSlotsFromInventoryItem(rawItem: any): any[] {
  if (!rawItem || typeof rawItem !== 'object') return [];

  const candidatePaths = [
    (rawItem as Record<string, unknown>).slots,
    (rawItem as Record<string, any>).plant?.slots,
    (rawItem as Record<string, any>).item?.slots,
    (rawItem as Record<string, any>).data?.slots,
    (rawItem as Record<string, any>).slots?.slots,
    (rawItem as Record<string, any>).growSlots,
  ];

  for (const candidate of candidatePaths) {
    if (Array.isArray(candidate) && candidate.length > 0) {
      return candidate;
    }
  }

  return [];
}

function toStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input.filter((value): value is string => typeof value === 'string');
}

function createSnapshot(items: any[] | null, label: string, node: unknown): UserSlotsInventorySnapshot | null {
  if (!items || items.length === 0) {
    return null;
  }

  const favorited = node && typeof node === 'object' ? toStringArray((node as Record<string, unknown>).favoritedItemIds) : [];
  const hasSlotData = items.some((item) => extractSlotsFromInventoryItem(item).length > 0);

  return {
    items,
    favoritedItemIds: favorited,
    source: label,
    hasSlotData,
  };
}

function scanForInventoryPayload(root: unknown, label: string): UserSlotsInventorySnapshot | null {
  const fromDirect = createSnapshot(normalizeInventoryArray(root), label, root);
  if (fromDirect) {
    return fromDirect;
  }

  if (!root || typeof root !== 'object') {
    return null;
  }

  const record = root as Record<string, unknown>;
  if ('inventory' in record) {
    const inventoryNode = record.inventory;
    const snapshot = createSnapshot(normalizeInventoryArray((inventoryNode as any)?.items ?? inventoryNode), `${label}.inventory`, inventoryNode);
    if (snapshot) {
      return snapshot;
    }
  }

  if ('data' in record) {
    const dataNode = record.data as Record<string, unknown> | undefined;
    if (dataNode && 'inventory' in dataNode) {
      const inventoryNode = dataNode.inventory;
      const snapshot = createSnapshot(normalizeInventoryArray((inventoryNode as any)?.items ?? inventoryNode), `${label}.data.inventory`, inventoryNode);
      if (snapshot) {
        return snapshot;
      }
    }
  }

  return null;
}

async function getUserSlotsAtom(): Promise<any | null> {
  let atom = getAtomByLabel(USER_SLOTS_ATOM_LABEL);
  if (!atom) {
    const matches = findAtomsByLabel(/userSlotsAtom/i);
    atom = matches[0] ?? null;
  }

  if (!atom && !userSlotsAtomNotFoundLogged) {
    log('⚠️ Could not locate userSlotsAtom in jotai cache');
    userSlotsAtomNotFoundLogged = true;
  }

  if (atom) {
    userSlotsAtomNotFoundLogged = false;
  }

  return atom;
}

export async function readUserSlotsInventorySnapshot(): Promise<UserSlotsInventorySnapshot | null> {
  try {
    await ensureJotaiStore();
    jotaiStoreFailureLogged = false;
  } catch (error) {
    if (!jotaiStoreFailureLogged) {
      log('⚠️ Unable to capture jotai store for userSlotsAtom', error);
      jotaiStoreFailureLogged = true;
    }
    return null;
  }

  const atom = await getUserSlotsAtom();
  if (!atom) {
    return null;
  }

  let value: unknown;
  try {
    value = await readAtomValue<any>(atom);
    userSlotsAccessFailureLogged = false;
  } catch (error) {
    if (!userSlotsAccessFailureLogged) {
      log('⚠️ Failed reading userSlotsAtom', error);
      userSlotsAccessFailureLogged = true;
    }
    return null;
  }

  const visited = new WeakSet<object>();
  const queue: Array<{ node: unknown; label: string }> = [{ node: value, label: USER_SLOTS_ATOM_LABEL }];

  while (queue.length > 0) {
    const { node, label } = queue.shift()!;

    const snapshot = scanForInventoryPayload(node, label);
    if (snapshot) {
      return snapshot;
    }

    if (!node || typeof node !== 'object') {
      continue;
    }

    const isArray = Array.isArray(node);
    if (!isArray && visited.has(node as object)) {
      continue;
    }

    if (!isArray) {
      visited.add(node as object);
    }

    if (Array.isArray(node)) {
      node.forEach((entry, index) => {
        queue.push({ node: entry, label: `${label}[${index}]` });
      });
    } else {
      Object.entries(node as Record<string, unknown>).forEach(([key, child]) => {
        queue.push({ node: child, label: `${label}.${key}` });
      });
    }
  }

  return null;
}
