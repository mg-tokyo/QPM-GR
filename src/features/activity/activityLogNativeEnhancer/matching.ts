import {
  getAllEggTypes,
  getAllPetSpecies,
  getAllPlantSpecies,
  getEggType,
  getPetSpecies,
  getPlantSpecies,
} from '../../../catalogs/gameCatalogs';
import {
  getAnySpriteDataUrl,
  getCropSpriteDataUrlWithMutations,
  getPetSpriteDataUrlWithMutations,
  getProduceSpriteDataUrlWithMutations,
} from '../../../sprite-v2/compat';
import type {
  ActivityLogEntry,
  SpeciesLookupEntry,
  SpeciesDropdownOption,
  HistorySpeciesContext,
  StringField,
  ActionKey,
  TypeFilter,
  OrderFilter,
} from './types';
import { S } from './state';
import {
  isRecord,
  readString,
  normalizeSpeciesKey,
  normalizeWhitespace,
  normalizeToken,
  formatDisplayLabel,
  toPascalCase,
  toNumberOr,
  getRarityRank,
  compareSpeciesLookupEntry,
  readEntryMessage,
  normalizePetNameKey,
  extractFeedPetAlias,
  collectStringFields,
  entryKey,
  classifyEntry,
  classifyType,
  getEntryElements,
  getRowMessageText,
  normalizeAction,
  actionToType,
  isReplaySafeEntry,
  deepClone,
  buildMatchKeys,
  detectSpeciesKeyFromText,
  inferActionFromMessage,
} from './parsing';

export function resolvePetIcon(species: string): string | null {
  const key = normalizeSpeciesKey(species);
  if (!key) return null;
  if (S.petIconCache.has(key)) return S.petIconCache.get(key) ?? null;

  const label = readString(species) ?? '';
  const compact = label.replace(/\s+/g, '');
  const url = getPetSpriteDataUrlWithMutations(label, [])
    || getPetSpriteDataUrlWithMutations(compact, [])
    || null;
  S.petIconCache.set(key, url);
  return url;
}

export function resolvePlantIcon(species: string): string | null {
  const key = normalizeSpeciesKey(species);
  if (!key) return null;
  if (S.plantIconCache.has(key)) return S.plantIconCache.get(key) ?? null;

  const label = readString(species) ?? '';
  const compact = label.replace(/\s+/g, '');
  const url = getCropSpriteDataUrlWithMutations(label, [])
    || getCropSpriteDataUrlWithMutations(compact, [])
    || getProduceSpriteDataUrlWithMutations(label, [])
    || getProduceSpriteDataUrlWithMutations(compact, [])
    || null;
  S.plantIconCache.set(key, url);
  return url;
}

export function resolveEggIcon(eggIdOrLabel: string): string | null {
  const key = normalizeSpeciesKey(eggIdOrLabel);
  if (!key) return null;
  if (S.eggIconCache.has(key)) return S.eggIconCache.get(key) ?? null;

  const raw = readString(eggIdOrLabel) ?? '';
  const formatted = formatDisplayLabel(raw);
  const pascalRaw = toPascalCase(raw);
  const pascalFormatted = toPascalCase(formatted);
  const noSpaceRaw = raw.replace(/\s+/g, '');
  const noSpaceFormatted = formatted.replace(/\s+/g, '');

  const candidates = [
    raw,
    formatted,
    pascalRaw,
    pascalFormatted,
    noSpaceRaw,
    noSpaceFormatted,
    raw.endsWith('Egg') ? raw : `${raw}Egg`,
    formatted.endsWith('Egg') ? formatted : `${formatted}Egg`,
    `egg/${pascalRaw}`,
    `egg/${pascalFormatted}`,
    `egg/${noSpaceRaw}`,
    `egg/${noSpaceFormatted}`,
    `sprite/egg/${pascalRaw}`,
    `sprite/egg/${pascalFormatted}`,
    `sprite/egg/${noSpaceRaw}`,
    `sprite/egg/${noSpaceFormatted}`,
  ];

  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    const fromPet = getPetSpriteDataUrlWithMutations(candidate, []);
    if (fromPet) {
      S.eggIconCache.set(key, fromPet);
      return fromPet;
    }
    const url = getAnySpriteDataUrl(candidate);
    if (url) {
      S.eggIconCache.set(key, url);
      return url;
    }
  }

  S.eggIconCache.set(key, null);
  return null;
}

export function buildPetLookupEntries(): SpeciesLookupEntry[] {
  const map = new Map<string, SpeciesLookupEntry>();
  let petIndex = 0;
  let eggIndex = 0;

  for (const speciesRaw of getAllPetSpecies()) {
    const species = readString(speciesRaw);
    if (!species) continue;
    const petDef = getPetSpecies(species);
    const normalized = normalizeSpeciesKey(species);
    if (!normalized) continue;
    const value = `pet:${normalized}`;
    if (map.has(value)) continue;
    const fallbackShopRank = 100000 + petIndex;
    petIndex += 1;
    const label = readString(petDef?.name) ?? formatDisplayLabel(species);
    const matchKeys = buildMatchKeys(species, label);
    map.set(value, {
      value,
      label,
      matchKey: matchKeys[0] ?? normalized,
      matchKeys,
      iconUrl: resolvePetIcon(species),
      categoryRank: 1,
      rarityRank: getRarityRank(petDef?.rarity),
      priceRank: toNumberOr((petDef as Record<string, unknown> | null)?.coinPrice, Number.POSITIVE_INFINITY),
      shopRank: toNumberOr(
        (petDef as Record<string, unknown> | null)?.shopIndex
        ?? (petDef as Record<string, unknown> | null)?.sortOrder
        ?? (petDef as Record<string, unknown> | null)?.order,
        fallbackShopRank,
      ),
    });
  }

  for (const eggIdRaw of getAllEggTypes()) {
    const eggId = readString(eggIdRaw);
    if (!eggId) continue;
    const eggDef = getEggType(eggId);
    const label = readString(eggDef?.name) ?? formatDisplayLabel(eggId);
    const normalized = normalizeSpeciesKey(label || eggId);
    if (!normalized) continue;
    const value = `egg:${normalized}`;
    if (map.has(value)) continue;
    const fallbackShopRank = eggIndex;
    eggIndex += 1;
    const matchKeys = buildMatchKeys(eggId, label, readString(eggDef?.name));
    map.set(value, {
      value,
      label,
      matchKey: matchKeys[0] ?? normalized,
      matchKeys,
      iconUrl: resolveEggIcon(readString(eggDef?.name) ?? eggId),
      categoryRank: 0,
      rarityRank: getRarityRank((eggDef as Record<string, unknown> | null)?.rarity),
      priceRank: toNumberOr(eggDef?.coinPrice, Number.POSITIVE_INFINITY),
      shopRank: toNumberOr(
        (eggDef as Record<string, unknown> | null)?.shopIndex
        ?? (eggDef as Record<string, unknown> | null)?.sortOrder
        ?? (eggDef as Record<string, unknown> | null)?.order,
        fallbackShopRank,
      ),
    });
  }

  return Array.from(map.values()).sort(compareSpeciesLookupEntry);
}

export function buildPlantLookupEntries(): SpeciesLookupEntry[] {
  const map = new Map<string, SpeciesLookupEntry>();
  let plantIndex = 0;
  for (const speciesRaw of getAllPlantSpecies()) {
    const species = readString(speciesRaw);
    if (!species) continue;
    const plantDef = getPlantSpecies(species);
    const seedDef = isRecord(plantDef?.seed) ? plantDef.seed : null;
    const normalized = normalizeSpeciesKey(species);
    if (!normalized) continue;
    const value = `plant:${normalized}`;
    if (map.has(value)) continue;
    const fallbackShopRank = plantIndex;
    plantIndex += 1;
    const label = readString(seedDef?.name) ?? readString(plantDef?.name) ?? formatDisplayLabel(species);
    const matchKeys = buildMatchKeys(species, label, readString(plantDef?.name), readString(seedDef?.name));
    map.set(value, {
      value,
      label,
      matchKey: matchKeys[0] ?? normalized,
      matchKeys,
      iconUrl: resolvePlantIcon(species),
      categoryRank: 0,
      rarityRank: getRarityRank(seedDef?.rarity ?? (plantDef as Record<string, unknown> | null)?.rarity),
      priceRank: toNumberOr(seedDef?.coinPrice, Number.POSITIVE_INFINITY),
      shopRank: toNumberOr(
        seedDef?.shopIndex
        ?? seedDef?.sortOrder
        ?? seedDef?.order
        ?? (plantDef as Record<string, unknown> | null)?.shopIndex
        ?? (plantDef as Record<string, unknown> | null)?.sortOrder
        ?? (plantDef as Record<string, unknown> | null)?.order,
        fallbackShopRank,
      ),
    });
  }
  return Array.from(map.values()).sort(compareSpeciesLookupEntry);
}

export function getPetLookupEntriesCached(): SpeciesLookupEntry[] {
  if (S.petLookupEntriesCache && S.petLookupEntriesCache.length > 0) return S.petLookupEntriesCache;
  S.petLookupEntriesCache = buildPetLookupEntries();
  return S.petLookupEntriesCache;
}

export function getPlantLookupEntriesCached(): SpeciesLookupEntry[] {
  if (S.plantLookupEntriesCache && S.plantLookupEntriesCache.length > 0) return S.plantLookupEntriesCache;
  S.plantLookupEntriesCache = buildPlantLookupEntries();
  return S.plantLookupEntriesCache;
}

export function buildHistorySpeciesContext(
  pets: SpeciesLookupEntry[],
  plants: SpeciesLookupEntry[],
): HistorySpeciesContext {
  const key = `${S.history.length}|${S.history[0]?.timestamp ?? 0}|${S.history[S.history.length - 1]?.timestamp ?? 0}|${pets.length}|${plants.length}`;
  if (S.historySpeciesContextCache && S.historySpeciesContextCacheKey === key) {
    return S.historySpeciesContextCache;
  }

  const petByMatch = new Map<string, string>();
  for (const pet of pets) {
    const keys = pet.matchKeys?.length ? pet.matchKeys : [pet.matchKey];
    for (const key of keys) {
      if (!key) continue;
      petByMatch.set(key, pet.value);
    }
  }

  const plantByMatch = new Map<string, string>();
  for (const plant of plants) {
    const keys = plant.matchKeys?.length ? plant.matchKeys : [plant.matchKey];
    for (const key of keys) {
      if (!key) continue;
      plantByMatch.set(key, plant.value);
    }
  }

  const messageToPet = new Map<string, string>();
  const messageToPlant = new Map<string, string>();
  const petNameToSpecies = new Map<string, string>();

  for (const entry of S.history) {
    const message = normalizeWhitespace(readEntryMessage(entry));
    const messageKey = normalizeToken(message);
    const strings: StringField[] = [];
    const seen = new WeakSet<object>();
    collectStringFields(entry, '', strings, seen);

    let petSpeciesKey: string | null = null;
    let plantSpeciesKey: string | null = null;
    const petNameHints = new Set<string>();

    for (const field of strings) {
      const fieldKey = normalizeToken(field.path);
      const normalizedSpecies = normalizeSpeciesKey(field.value);
      const petFromField = petByMatch.get(normalizedSpecies) ?? null;
      const plantFromField = plantByMatch.get(normalizedSpecies) ?? null;
      const isPetField = /(pet|fauna|animal|egg)/.test(fieldKey);
      const isPlantField = /(plant|crop|seed|produce|flora)/.test(fieldKey);
      const isPetNameField = /(pet|fauna|animal|nickname|alias|display).*(name)|name.*(pet|fauna|animal|nickname|alias|display)/.test(fieldKey);

      if (petFromField) {
        if (!petSpeciesKey || isPetField || !petSpeciesKey) {
          petSpeciesKey = petFromField;
        }
      }
      if (plantFromField) {
        if (!plantSpeciesKey || isPlantField || !plantSpeciesKey) {
          plantSpeciesKey = plantFromField;
        }
      }

      if (isPetNameField || fieldKey.endsWith('.pet.name') || fieldKey.endsWith('.petname') || fieldKey.endsWith('.nickname')) {
        const aliasKey = normalizePetNameKey(field.value);
        if (aliasKey) petNameHints.add(aliasKey);
      }
    }

    if (!petSpeciesKey && message) {
      petSpeciesKey = detectSpeciesKeyFromText(message, pets);
    }
    if (!plantSpeciesKey && message) {
      plantSpeciesKey = detectSpeciesKeyFromText(message, plants);
    }

    if (petSpeciesKey && message) {
      const aliasFromFeed = extractFeedPetAlias(message);
      if (aliasFromFeed) {
        petNameHints.add(aliasFromFeed);
      }
    }

    if (petSpeciesKey && messageKey && !messageToPet.has(messageKey)) {
      messageToPet.set(messageKey, petSpeciesKey);
    }
    if (plantSpeciesKey && messageKey && !messageToPlant.has(messageKey)) {
      messageToPlant.set(messageKey, plantSpeciesKey);
    }
    if (petSpeciesKey) {
      for (const aliasKey of petNameHints) {
        if (!petNameToSpecies.has(aliasKey)) {
          petNameToSpecies.set(aliasKey, petSpeciesKey);
        }
      }
    }
  }

  const petNameAliases = Array.from(petNameToSpecies.entries())
    .map(([aliasKey, speciesKey]) => ({ aliasKey, speciesKey }))
    .sort((a, b) => b.aliasKey.length - a.aliasKey.length);

  S.historySpeciesContextCache = {
    messageToPet,
    messageToPlant,
    petNameAliases,
  };
  S.historySpeciesContextCacheKey = key;
  return S.historySpeciesContextCache;
}

export function buildRowMetadata(list: HTMLElement): import('./types').RowMetadata[] {
  const rows = getEntryElements(list);
  const needsSpeciesFilters = Boolean(S.filters.petSpecies || S.filters.plantSpecies);
  if (!needsSpeciesFilters) {
    return rows.map((row) => ({
      row,
      action: classifyEntry(row),
      type: classifyType(row),
      petFilterKey: null,
      plantFilterKey: null,
    }));
  }

  const pets = getPetLookupEntriesCached();
  const plants = getPlantLookupEntriesCached();
  const context = buildHistorySpeciesContext(pets, plants);
  return rows.map((row) => {
    const rowMessage = getRowMessageText(row);
    const fullText = normalizeWhitespace(row.textContent || '');
    const baseText = rowMessage || fullText;
    const action = classifyEntry(row);
    const type = classifyType(row);
    const messageKey = normalizeToken(baseText);
    let petFilterKey = detectSpeciesKeyFromText(baseText, pets);
    let plantFilterKey = detectSpeciesKeyFromText(baseText, plants);

    if (!petFilterKey && messageKey) {
      petFilterKey = context.messageToPet.get(messageKey) ?? null;
    }
    if (!plantFilterKey && messageKey) {
      plantFilterKey = context.messageToPlant.get(messageKey) ?? null;
    }

    if (!petFilterKey) {
      const normalizedNameText = normalizePetNameKey(baseText);
      for (const alias of context.petNameAliases) {
        if (!alias.aliasKey) continue;
        if (!normalizedNameText.includes(alias.aliasKey)) continue;
        petFilterKey = alias.speciesKey;
        break;
      }
    }

    return {
      row,
      action,
      type,
      petFilterKey,
      plantFilterKey,
    };
  });
}

export function buildSpeciesOptions(kind: 'pet' | 'plant'): SpeciesDropdownOption[] {
  if (kind === 'pet' && S.petSpeciesOptionsCache && S.petSpeciesOptionsCache.length > 1) return S.petSpeciesOptionsCache;
  if (kind === 'plant' && S.plantSpeciesOptionsCache && S.plantSpeciesOptionsCache.length > 1) return S.plantSpeciesOptionsCache;

  const source = kind === 'pet'
    ? getPetLookupEntriesCached()
    : getPlantLookupEntriesCached();

  const options: SpeciesDropdownOption[] = [];
  options.push({
    value: '',
    label: kind === 'pet' ? 'Pet: All' : 'Plant: All',
    iconUrl: null,
  });

  for (const entry of source) {
    options.push({
      value: entry.value,
      label: entry.label,
      iconUrl: entry.iconUrl,
    });
  }

  if (kind === 'pet') {
    S.petSpeciesOptionsCache = options.length > 1 ? options : null;
  } else {
    S.plantSpeciesOptionsCache = options.length > 1 ? options : null;
  }

  return options;
}

export function getHistoryEntryFilterMetadata(
  entry: ActivityLogEntry,
  context: HistorySpeciesContext | null,
  pets: SpeciesLookupEntry[] | null,
  plants: SpeciesLookupEntry[] | null,
): {
  action: ActionKey;
  type: TypeFilter;
  petFilterKey: string | null;
  plantFilterKey: string | null;
} {
  if (S.historyFilterMetaCacheRevision !== S.historyRevision) {
    S.historyFilterMetaCacheRevision = S.historyRevision;
    S.historyFilterMetaCache.clear();
  }

  const key = entryKey(entry);
  const cached = S.historyFilterMetaCache.get(key);
  if (cached) return cached;

  const message = normalizeWhitespace(readEntryMessage(entry));
  const actionValue = readString(entry.action);
  const action = actionValue ? normalizeAction(actionValue) : inferActionFromMessage(message);
  const type = actionToType(action, message);
  const messageKey = normalizeToken(message);

  let petFilterKey = pets ? detectSpeciesKeyFromText(message, pets) : null;
  let plantFilterKey = plants ? detectSpeciesKeyFromText(message, plants) : null;

  if (context && messageKey) {
    if (!petFilterKey) {
      petFilterKey = context.messageToPet.get(messageKey) ?? null;
    }
    if (!plantFilterKey) {
      plantFilterKey = context.messageToPlant.get(messageKey) ?? null;
    }
    if (!petFilterKey) {
      const normalizedNameText = normalizePetNameKey(message);
      for (const alias of context.petNameAliases) {
        if (!alias.aliasKey) continue;
        if (!normalizedNameText.includes(alias.aliasKey)) continue;
        petFilterKey = alias.speciesKey;
        break;
      }
    }
  }

  const meta = {
    action,
    type,
    petFilterKey,
    plantFilterKey,
  };
  S.historyFilterMetaCache.set(key, meta);
  return meta;
}
