import { reminderDiag, warnReminderFeature } from './_diagnostics';
import { ensureJotaiStore, getAtomByLabel, readAtomValue } from '../../../core/jotaiBridge';
import { readUserSlotsInventorySnapshot } from '../../../store/userSlots';
import { CROP_INVENTORY_ATOM_LABEL } from './constants';
import { reminderState } from './state';
import { buildSlotStateFromInventorySlot, normalizePlantName } from './parsing';
import type { GlobalInventoryResult, InventoryLookups, InventoryPlantEntry } from './types';

export async function buildInventoryLookups(): Promise<InventoryLookups | null> {
  reminderState.inventoryLookupStatsLogged = false;
  reminderState.inventoryDebugSamples = 0;
  reminderState.slotMutationDebugSamples = 0;
  const items = await fetchCropInventoryItems();
  if (items.length === 0) {
    if (!reminderState.inventoryLookupStatsLogged) {
      reminderDiag.debug('Inventory lookup unavailable (no items)');
      reminderState.inventoryLookupStatsLogged = true;
    }
    return null;
  }

  const byIndex = new Map<number, InventoryPlantEntry>();
  const byId = new Map<string, InventoryPlantEntry>();
  const byName = new Map<string, InventoryPlantEntry[]>();

  items.forEach((rawItem, index) => {
    const entry = mapInventoryItem(rawItem, index);
    if (!entry) return;
    byIndex.set(entry.baseIndex, entry);
    if (entry.id) {
      byId.set(entry.id, entry);
    }
    if (entry.normalizedName) {
      const list = byName.get(entry.normalizedName) ?? [];
      list.push(entry);
      byName.set(entry.normalizedName, list);
    }
  });

  if (byIndex.size === 0) {
    if (!reminderState.inventoryLookupStatsLogged) {
      reminderDiag.debug('Inventory lookup construction produced zero entries');
      reminderState.inventoryLookupStatsLogged = true;
    }
    return null;
  }

  if (!reminderState.inventoryLookupStatsLogged) {
    reminderDiag.debug('Inventory lookup ready', {
      items: items.length,
      byIndex: byIndex.size,
      byId: byId.size,
      byName: byName.size,
    });
    reminderState.inventoryLookupStatsLogged = true;
  }

  return { byIndex, byId, byName };
}

async function fetchCropInventoryItems(): Promise<any[]> {
  const fallback = async (): Promise<any[]> => {
    const sharedAtoms = await readInventoryFromSharedAtoms();
    if (sharedAtoms) {
      if (!reminderState.inventoryLookupStatsLogged) {
        reminderDiag.debug('Using shared atoms inventory source', {
          source: sharedAtoms.source,
          items: sharedAtoms.items.length,
          hasSlotData: sharedAtoms.hasSlotData,
        });
        reminderState.inventoryLookupStatsLogged = true;
      }
      return sharedAtoms.items;
    }

    const globalInventory = readGlobalInventoryItems();
    if (globalInventory) {
      if (!reminderState.inventoryLookupStatsLogged) {
        reminderDiag.debug('Using global inventory source', {
          source: globalInventory.source,
          items: globalInventory.items.length,
          hasSlotData: globalInventory.hasSlotData,
        });
        reminderState.inventoryLookupStatsLogged = true;
      }
      return globalInventory.items;
    }

    return [];
  };

  const ensureSlotDataOrFallback = async (items: any[] | null | undefined, source: string): Promise<any[]> => {
    if (!items || items.length === 0) {
      return await fallback();
    }

    const hasSlotData = items.some((item) => extractSlotsFromInventoryItem(item).length > 0);
    if (hasSlotData) {
      if (!reminderState.inventoryLookupStatsLogged) {
        reminderDiag.debug(`Read crop inventory atom (${source})`, { count: items.length, hasSlotData: true });
        reminderState.inventoryLookupStatsLogged = true;
      }
      return items;
    }

    if (!reminderState.inventoryLookupStatsLogged) {
      const samples = items.slice(0, 3).map((item, index) => ({ index, summary: summarizeInventoryItem(item) }));
      reminderDiag.debug('Crop inventory atom lacks slot data, trying fallback', { source, count: items.length, samples });
    }

    const fallbackItems = await fallback();
    if (fallbackItems.length > 0) {
      return fallbackItems;
    }

    if (!reminderState.inventoryLookupStatsLogged) {
      reminderDiag.debug('Crop inventory atom fallback unavailable, proceeding without slot data', { source, count: items.length });
      reminderState.inventoryLookupStatsLogged = true;
    }

    return items;
  };

  try {
    await ensureJotaiStore();
  } catch (error) {
    if (!reminderState.inventoryAccessFailureLogged) {
      warnReminderFeature('QPM-FEATURE-004', { what: 'jotai:capture' }, error);
      reminderState.inventoryAccessFailureLogged = true;
    }
    return await fallback();
  }

  const userSlotsSnapshot = await readUserSlotsInventorySnapshot();
  if (userSlotsSnapshot && userSlotsSnapshot.items.length > 0) {
    if (!reminderState.inventoryLookupStatsLogged) {
      reminderDiag.debug('Using userSlotsAtom inventory source', {
        source: userSlotsSnapshot.source,
        items: userSlotsSnapshot.items.length,
        hasSlotData: userSlotsSnapshot.hasSlotData,
      });
      reminderState.inventoryLookupStatsLogged = true;
    }

    if (userSlotsSnapshot.hasSlotData) {
      return userSlotsSnapshot.items;
    }

    return await ensureSlotDataOrFallback(userSlotsSnapshot.items, userSlotsSnapshot.source);
  }

  const atom = getAtomByLabel(CROP_INVENTORY_ATOM_LABEL);
  if (!atom) {
    if (!reminderState.inventoryAccessFailureLogged) {
      warnReminderFeature('QPM-FEATURE-004', { what: 'atom:missing', atom: CROP_INVENTORY_ATOM_LABEL });
      reminderState.inventoryAccessFailureLogged = true;
    }
    return await fallback();
  }

  try {
    const value = await readAtomValue<any>(atom);
    reminderState.inventoryAccessFailureLogged = false;
    if (Array.isArray(value)) {
      return await ensureSlotDataOrFallback(value, 'array');
    }
    if (value && Array.isArray((value as Record<string, unknown>).items)) {
      return await ensureSlotDataOrFallback((value as Record<string, any>).items as any[], 'items array');
    }
    if (!reminderState.inventoryLookupStatsLogged) {
      reminderDiag.debug('Crop inventory atom value not array-like', { sample: value });
    }
    return await fallback();
  } catch (error) {
    if (!reminderState.inventoryAccessFailureLogged) {
      warnReminderFeature('QPM-FEATURE-004', { what: 'atom:read', atom: CROP_INVENTORY_ATOM_LABEL }, error);
      reminderState.inventoryAccessFailureLogged = true;
    }
    return await fallback();
  }
}

function normalizeInventoryArray(input: unknown): any[] | null {
  if (Array.isArray(input)) {
    return input;
  }
  if (input && typeof input === 'object') {
    const items = (input as Record<string, unknown>).items;
    if (Array.isArray(items)) {
      return items;
    }
  }
  return null;
}

function readGlobalInventoryItems(): GlobalInventoryResult | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const globalAny = window as unknown as Record<string, any>;
  const candidates: Array<{ source: string; value: unknown }> = [
    { source: 'UnifiedState.atoms.inventory.items', value: globalAny?.UnifiedState?.atoms?.inventory?.items },
    { source: 'UnifiedState.atoms.inventory', value: globalAny?.UnifiedState?.atoms?.inventory },
    { source: 'myData.inventory.items', value: globalAny?.myData?.inventory?.items },
    { source: '__mga_cachedInventory', value: globalAny?.__mga_cachedInventory },
    { source: 'MGTOOLS.UnifiedState.atoms.inventory.items', value: globalAny?.MGTOOLS?.UnifiedState?.atoms?.inventory?.items },
  ];

  let fallback: GlobalInventoryResult | null = null;

  for (const candidate of candidates) {
    let items = normalizeInventoryArray(candidate.value);
    let resolvedSource = candidate.source;

    if ((!items || items.length === 0) && candidate.value && typeof candidate.value === 'object') {
      const nestedPaths: Array<{ key: string; label: string }> = [
        { key: 'myCropInventory', label: `${candidate.source}.myCropInventory` },
        { key: 'cropInventory', label: `${candidate.source}.cropInventory` },
        { key: 'inventory', label: `${candidate.source}.inventory` },
        { key: 'items', label: `${candidate.source}.items` },
      ];

      for (const nested of nestedPaths) {
        const nestedValue = (candidate.value as Record<string, unknown>)[nested.key];
        const nestedItems = normalizeInventoryArray(nestedValue);
        if (nestedItems && nestedItems.length > 0) {
          items = nestedItems;
          resolvedSource = nested.label;
          break;
        }
      }
    }

    if (!items || items.length === 0) continue;
    const hasSlotData = items.some((item) => extractSlotsFromInventoryItem(item).length > 0);
    const result: GlobalInventoryResult = {
      items,
      source: resolvedSource,
      hasSlotData,
    };
    if (hasSlotData) {
      return result;
    }
    if (!fallback) {
      fallback = result;
    }
  }

  return fallback;
}

async function readInventoryFromSharedAtoms(): Promise<GlobalInventoryResult | null> {
  if (typeof window === 'undefined') {
    return null;
  }

  const globalAny = window as unknown as Record<string, any>;
  const atomCandidates: Array<{ source: string; atom: any }> = [
    { source: 'MGTools.Core.Atoms.inventory.myCropInventory', atom: globalAny?.MGTools?.Core?.Atoms?.inventory?.myCropInventory },
    { source: 'MGTOOLS.Core.Atoms.inventory.myCropInventory', atom: globalAny?.MGTOOLS?.Core?.Atoms?.inventory?.myCropInventory },
    { source: 'Atoms.inventory.myCropInventory', atom: globalAny?.Atoms?.inventory?.myCropInventory },
    { source: '__tmAtoms.inventory.myCropInventory', atom: globalAny?.__tmAtoms?.inventory?.myCropInventory },
  ];

  for (const candidate of atomCandidates) {
    const atom = candidate.atom;
    if (!atom) continue;

    const tryNormalize = (input: unknown): any[] | null => {
      const normalized = normalizeInventoryArray(input);
      if (normalized && normalized.length > 0) {
        return normalized;
      }
      if (input && typeof input === 'object') {
        const nestedCandidates = [
          (input as Record<string, unknown>).items,
          (input as Record<string, unknown>).value,
          (input as Record<string, unknown>).current,
          (input as Record<string, unknown>).state,
        ];
        for (const nested of nestedCandidates) {
          const nestedNormalized = normalizeInventoryArray(nested);
          if (nestedNormalized && nestedNormalized.length > 0) {
            return nestedNormalized;
          }
        }
      }
      return null;
    };

    try {
      if (typeof atom.get === 'function') {
        const value = await atom.get();
        const items = tryNormalize(value);
        if (items && items.length > 0) {
          return {
            items,
            source: `${candidate.source}.get()`,
            hasSlotData: items.some((item) => extractSlotsFromInventoryItem(item).length > 0),
          };
        }
      }

      const fallbackValues = tryNormalize(atom);
      if (fallbackValues && fallbackValues.length > 0) {
        return {
          items: fallbackValues,
          source: `${candidate.source}`,
          hasSlotData: fallbackValues.some((item) => extractSlotsFromInventoryItem(item).length > 0),
        };
      }
    } catch (error) {
      if (!reminderState.sharedAtomsFailureLogged) {
        reminderDiag.debug('Unable to read shared atoms inventory source', { source: candidate.source, error: String(error) });
        reminderState.sharedAtomsFailureLogged = true;
      }
    }
  }

  return null;
}

function mapInventoryItem(rawItem: any, index: number): InventoryPlantEntry | null {
  if (!rawItem || typeof rawItem !== 'object') return null;

  const itemType = readInventoryItemType(rawItem);
  if (itemType !== 'plant') {
    if (reminderState.inventoryDebugSamples < 5) {
      reminderDiag.debug('Inventory item skipped (type mismatch)', {
        index,
        itemType,
        keys: Object.keys(rawItem).slice(0, 10),
        sample: summarizeInventoryItem(rawItem),
      });
      reminderState.inventoryDebugSamples += 1;
    }
    return null;
  }
  const slots = extractSlotsFromInventoryItem(rawItem);
  const slotStates = slots.map(buildSlotStateFromInventorySlot);

  const id = typeof rawItem.id === 'string' ? rawItem.id : null;
  const species = typeof rawItem.species === 'string' ? rawItem.species : null;
  const itemName = typeof rawItem.itemName === 'string' ? rawItem.itemName : null;
  const displayName = typeof rawItem.displayName === 'string' ? rawItem.displayName : null;
  let name = typeof rawItem.name === 'string' ? rawItem.name : null;

  if (!name) name = itemName || displayName;
  if (!name && species) {
    name = species.toLowerCase().includes('plant') ? species : `${species} Plant`;
  }

  const normalizedName = name ? normalizePlantName(name) : null;

  return {
    baseIndex: index,
    id,
    slotStates,
    raw: rawItem,
    name,
    normalizedName,
    used: false,
  };
}

function readInventoryItemType(rawItem: any): 'plant' | 'other' {
  if (!rawItem || typeof rawItem !== 'object') return 'other';

  if (extractSlotsFromInventoryItem(rawItem).length > 0) {
    return 'plant';
  }

  const candidates: Array<string | undefined | null> = [
    rawItem?.itemType,
    rawItem?.type,
    rawItem?.category,
    rawItem?.kind,
    rawItem?.item?.itemType,
    rawItem?.item?.type,
    rawItem?.plant?.itemType,
    rawItem?.plant?.type,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const normalized = candidate.toLowerCase();
    if (
      normalized === 'plant' ||
      normalized === 'crop' ||
      normalized.endsWith('plant') ||
      normalized.includes('plant')
    ) {
      return 'plant';
    }
  }

  return 'other';
}

function summarizeInventoryItem(rawItem: any): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  const fields = ['id', 'name', 'species', 'itemType', 'type', 'category', 'kind'];
  for (const field of fields) {
    if (rawItem && typeof rawItem === 'object' && field in rawItem) {
      summary[field] = rawItem[field];
    }
  }

  if (rawItem?.item && typeof rawItem.item === 'object') {
    summary.item = {};
    for (const field of fields) {
      if (field in rawItem.item) {
        (summary.item as Record<string, unknown>)[field] = rawItem.item[field];
      }
    }
  }

  if (rawItem?.plant && typeof rawItem.plant === 'object') {
    summary.plant = {};
    for (const field of fields) {
      if (field in rawItem.plant) {
        (summary.plant as Record<string, unknown>)[field] = rawItem.plant[field];
      }
    }
  }

  if (rawItem?.itemName) {
    summary.itemName = rawItem.itemName;
  }

  summary.hasSlots = !!extractSlotsFromInventoryItem(rawItem).length;

  return summary;
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
