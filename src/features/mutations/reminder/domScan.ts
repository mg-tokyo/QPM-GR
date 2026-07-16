import { $, isVisible } from '../../../utils/dom/dom';
import { reminderDiag, warnReminderFeature } from './_diagnostics';
import {
  INVENTORY_BASE_INDEX_ATTRS,
  INVENTORY_CONTAINER,
  INVENTORY_ID_ATTRS,
  INVENTORY_ITEM,
  MUTATION_LETTERS,
} from './constants';
import { updateStatus } from './state';
import { buildInventoryLookups } from './inventorySource';
import { cloneSlotState, normalizePlantName } from './parsing';
import type { InventoryLookups, MutationBadge, MutationLetter, PlantData, PlantSlotState } from './types';

export async function scanInventoryForPlants(): Promise<PlantData[]> {
  const inventory = $(INVENTORY_CONTAINER);
  if (!inventory || !isVisible(inventory)) {
    reminderDiag.debug('Inventory not open');
    updateStatus('⚠️ Please open your inventory (press E)');
    return [];
  }

  const items = Array.from(inventory.querySelectorAll(INVENTORY_ITEM));
  const inventoryLookups = await buildInventoryLookups();
  const plants: PlantData[] = [];

  items.forEach((item, index) => {
    const plantData = extractPlantData(item, inventoryLookups, index);
    if (plantData) {
      plants.push(plantData);
    }
  });

  reminderDiag.debug(`Scanned ${plants.length} plants from inventory`);
  return plants;
}

function extractPlantData(
  element: Element,
  inventoryLookups: InventoryLookups | null,
  fallbackIndex: number
): PlantData | null {
  try {
    const nameSelectors = [
      'p.chakra-text.css-8xfasz',
      '.McFlex.css-1gd1uup p.chakra-text',
      'p.chakra-text.css-rbbzu5',
      'p.chakra-text',
    ];

    const candidates: string[] = [];
    let name = '';
    for (const selector of nameSelectors) {
      const elements = Array.from(element.querySelectorAll(selector));
      for (const nameEl of elements) {
        const text = nameEl.textContent?.trim();
        if (!text) continue;
        candidates.push(text);
        if (!name && /plant/i.test(text)) {
          name = text;
        }
      }
      if (name) break;
    }

    if (!name && candidates.length) {
      const fallback = candidates.find((text) => /[a-z]/i.test(text)) ?? '';
      name = fallback;
    }

    if (!name || !isPlantCrop(name)) {
      return null;
    }

    // Mutations appear as small letter badges overlaid on the plant icon
    const mutationBadges = extractMutationBadges(element);
    const domMutationCounts = countMutationBadges(mutationBadges);
    const domBoldCounts = countBoldMutationBadges(mutationBadges);

    // Parse fruit count from name (e.g., "Pepper Plant+9" has 9 fruits)
    const fruitCountMatch = name.match(/\+(\d+)/);
    const parsedFruitCount = fruitCountMatch ? parseInt(fruitCountMatch[1] || '1', 10) : 0;

    let slotStates: PlantSlotState[] = [];
    let slotSource: PlantData['slotSource'] = 'fallback';

    if (inventoryLookups) {
      const baseIndex = readInventoryBaseIndex(element, fallbackIndex);
      let entry = inventoryLookups.byIndex.get(baseIndex) ?? null;

      if (!entry || entry.used) {
        const inventoryId = readInventoryId(element);
        if (inventoryId) {
          const byIdEntry = inventoryLookups.byId.get(inventoryId) ?? null;
          if (byIdEntry && !byIdEntry.used) {
            entry = byIdEntry;
          }
        }
      }

      if (!entry || entry.used) {
        const normalizedName = normalizePlantName(name);
        const candidates = inventoryLookups.byName.get(normalizedName);
        if (candidates) {
          while (candidates.length > 0 && candidates[0] && candidates[0].used) {
            candidates.shift();
          }
          if (candidates.length > 0) {
            const candidate = candidates.shift();
            if (candidate) {
              entry = candidate;
            }
          }
        }
      }

      if (entry && !entry.used) {
        entry.used = true;
        slotStates = entry.slotStates.map(cloneSlotState);
        slotSource = 'inventory';
      }
    }

    const combinedMutations = combineMutationSources(slotStates, domMutationCounts, domBoldCounts);

    const fruitCount = parsedFruitCount > 0 ? parsedFruitCount : slotStates.length;
    if (fruitCount === 0) {
      reminderDiag.debug(`Skipping ungrown plant: ${name} (${slotSource === 'inventory' ? 'no slots yet' : 'no fruit count'})`);
      return null;
    }

    return {
      name,
      mutations: combinedMutations,
      element,
      fruitCount,
      slotStates,
      slotSource,
      domMutationCounts,
      domBoldCounts,
    };
  } catch (error) {
    warnReminderFeature('QPM-FEATURE-004', { what: 'extractPlantData' }, error);
    return null;
  }
}

function extractMutationBadges(element: Element): MutationBadge[] {
  const badges: MutationBadge[] = [];
  const textElements = element.querySelectorAll('span, div, p');

  for (const el of textElements) {
    const rawText = el.textContent?.trim();
    if (!rawText || rawText.length !== 1) continue;
    const letter = rawText.toUpperCase();
    if (!isMutationLetter(letter)) continue;

    let isBold = false;
    if (el instanceof HTMLElement) {
      const computed = window.getComputedStyle(el);
      const weight = computed.fontWeight;
      const numericWeight = Number.parseInt(weight, 10);
      isBold = weight === 'bold' || Number.isFinite(numericWeight) && numericWeight >= 700;
    }

    badges.push({ letter: letter as MutationLetter, isBold });
  }

  return badges;
}

export function createMutationCountMap(initial = 0): Record<MutationLetter, number> {
  return {
    F: initial,
    W: initial,
    C: initial,
    D: initial,
    A: initial,
    R: initial,
    G: initial,
  };
}

function countMutationBadges(badges: MutationBadge[]): Record<MutationLetter, number> {
  const counts = createMutationCountMap();
  for (const badge of badges) {
    counts[badge.letter] += 1;
  }
  return counts;
}

function countBoldMutationBadges(badges: MutationBadge[]): Record<'D' | 'A', number> {
  return {
    D: badges.filter((badge) => badge.letter === 'D' && badge.isBold).length,
    A: badges.filter((badge) => badge.letter === 'A' && badge.isBold).length,
  };
}

export function combineMutationSources(
  slotStates: PlantSlotState[],
  domCounts: Record<MutationLetter, number>,
  domBoldCounts: Record<'D' | 'A', number>
): string {
  const combined = new Set<MutationLetter>();

  for (const slot of slotStates) {
    slot.letters.forEach((letter) => combined.add(letter));
    if (slot.hasDawnbound) combined.add('D');
    if (slot.hasAmberbound) combined.add('A');
  }

  for (const letter of MUTATION_LETTERS) {
    if (domCounts[letter] > 0) {
      combined.add(letter);
    }
  }

  if (domBoldCounts.D > 0) combined.add('D');
  if (domBoldCounts.A > 0) combined.add('A');

  return Array.from(combined).sort().join('');
}

function isMutationLetter(char: string): char is MutationLetter {
  return char === 'F' || char === 'W' || char === 'C' || char === 'D' || char === 'A' || char === 'R' || char === 'G';
}

function readInventoryBaseIndex(element: Element, fallbackIndex: number): number {
  const directAttr = readAttributeValue(element, INVENTORY_BASE_INDEX_ATTRS);
  const parsedDirect = parseIndex(directAttr);
  if (parsedDirect != null) {
    return parsedDirect;
  }

  const datasetValue = readDatasetValue(element, (key) => key.toLowerCase().includes('inventorybaseindex'));
  const parsedDataset = parseIndex(datasetValue);
  if (parsedDataset != null) {
    return parsedDataset;
  }

  const nested = element.querySelector('[data-tm-inventory-base-index]');
  if (nested) {
    const nestedAttr = readAttributeValue(nested, INVENTORY_BASE_INDEX_ATTRS);
    const parsedNested = parseIndex(nestedAttr);
    if (parsedNested != null) {
      return parsedNested;
    }

    const nestedDataset = readDatasetValue(nested, (key) => key.toLowerCase().includes('inventorybaseindex'));
    const parsedNestedDataset = parseIndex(nestedDataset);
    if (parsedNestedDataset != null) {
      return parsedNestedDataset;
    }
  }

  return fallbackIndex;
}

function readInventoryId(element: Element): string | null {
  const candidateSelectors = [
    '[data-tm-inventory-id]',
    '[data-inventory-id]',
    '[data-item-id]',
    '[data-itemid]',
    '[data-item-uuid]',
    '[data-uuid]',
    '[data-guid]',
    '[data-entity-id]',
    '[data-record-id]',
    '[data-row-id]'
  ];

  const datasetPredicate = (key: string) => {
    const lower = key.toLowerCase();
    return lower.includes('inventoryid') || lower.includes('itemid') || /(?:uuid|guid)$/.test(lower);
  };

  const searchNodes: Element[] = [];
  let current: Element | null = element;
  for (let depth = 0; current && depth < 5; depth++) {
    searchNodes.push(current);
    current = current.parentElement;
  }

  for (const node of searchNodes) {
    const direct = readAttributeValue(node, INVENTORY_ID_ATTRS);
    if (direct) {
      return direct;
    }

    const datasetValue = readDatasetValue(node, datasetPredicate);
    if (datasetValue) {
      return datasetValue;
    }
  }

  for (const node of searchNodes) {
    for (const selector of candidateSelectors) {
      const nested = node.querySelector(selector);
      if (!nested) {
        continue;
      }

      const nestedAttr = readAttributeValue(nested, INVENTORY_ID_ATTRS);
      if (nestedAttr) {
        return nestedAttr;
      }

      const nestedDataset = readDatasetValue(nested, datasetPredicate);
      if (nestedDataset) {
        return nestedDataset;
      }
    }
  }

  return null;
}

function readAttributeValue(element: Element, names: string[]): string | null {
  for (const name of names) {
    const value = element.getAttribute(name);
    if (value != null) {
      return value;
    }
  }

  const lowerNames = names.map((name) => name.toLowerCase());
  for (const { name, value } of Array.from(element.attributes)) {
    if (lowerNames.includes(name.toLowerCase()) && value != null) {
      return value;
    }
  }

  return null;
}

function readDatasetValue(element: Element, predicate: (key: string) => boolean): string | null {
  const htmlElement = element as HTMLElement;
  const dataset = htmlElement.dataset;
  if (!dataset) return null;

  for (const [key, value] of Object.entries(dataset)) {
    if (predicate(key) && value != null && value !== '') {
      return value;
    }
  }

  return null;
}

function parseIndex(value: string | null | undefined): number | null {
  if (value == null) return null;
  const numeric = Number.parseInt(value, 10);
  return Number.isFinite(numeric) ? numeric : null;
}

/** Distinguishes growing plants ("Lily Plant", "Pepper Plant+9") from harvested crops/other items. */
function isPlantCrop(name: string): boolean {
  const lowerName = name.toLowerCase().trim();

  // e.g., "Pepper Plant+9" -> "Pepper Plant"
  const hasFruitCount = /\+\d+$/.test(name);
  const baseNameMatch = name.match(/^(.+?)(?:\+\d+)?$/);
  const baseName = (baseNameMatch?.[1] || name).toLowerCase().trim();

  const exclusions = ['seed', 'spore', 'cutting', 'pod', 'kernel', 'pit', 'shovel', 'pot', 'watering can', 'tool', 'fertilizer', 'egg', 'decor', 'furniture', 'planter'];
  for (const exclusion of exclusions) {
    if (baseName.includes(exclusion)) return false;
  }

  if (baseName.includes('plant')) {
    return true;
  }

  // Fruit count suffix without the word "Plant" (e.g., "Lily+1") still counts
  if (hasFruitCount) {
    return true;
  }

  return false;
}
