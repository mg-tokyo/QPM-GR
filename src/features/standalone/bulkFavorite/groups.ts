import { getInventoryItems, getFavoritedItemIds, type InventoryItem } from '../../../store/inventory';
import { getAllPlantSpecies, areCatalogsReady } from '../../../catalogs/gameCatalogs';
import { log } from './state';
import type { ProduceGroup } from './types';

export function getItemUUID(item: InventoryItem): string | null {
  const raw = item.raw as Record<string, unknown> | undefined;
  const uuid = raw?.id ?? item.itemId ?? null;
  return typeof uuid === 'string' && uuid.length > 0 ? uuid : null;
}

function isValidSpecies(species: string): boolean {
  if (!areCatalogsReady()) return true;
  const knownSpecies = getAllPlantSpecies();
  return knownSpecies.includes(species);
}

export function getProduceGroups(): ProduceGroup[] {
  const items = getInventoryItems();
  const favoritedIds = getFavoritedItemIds();
  const groupMap = new Map<string, string[]>();

  for (const item of items) {
    const raw = item.raw as Record<string, unknown> | undefined;
    const itemType = raw?.itemType ?? item.itemType;
    const species = (raw?.species ?? item.species) as string | undefined;
    const uuid = getItemUUID(item);

    if (itemType !== 'Produce' || !species || !uuid) continue;

    if (!isValidSpecies(species)) {
      log.debug(`Unknown species: ${species}`);
    }

    const existing = groupMap.get(species);
    if (existing) {
      existing.push(uuid);
    } else {
      groupMap.set(species, [uuid]);
    }
  }

  const groups: ProduceGroup[] = [];
  for (const [species, itemIds] of groupMap) {
    const allLocked = itemIds.length > 0 && itemIds.every((uuid) => favoritedIds.has(uuid));
    groups.push({ species, itemIds, allLocked });
  }
  groups.sort((a, b) => a.species.localeCompare(b.species));
  return groups;
}

export function getGroupsSignature(groups: ProduceGroup[]): string {
  return groups
    .map((group) => `${group.species}:${group.itemIds.length}:${group.allLocked ? 1 : 0}`)
    .join('|');
}
