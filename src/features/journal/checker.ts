import { readAtomValue } from '../../core/atomRegistry';
import { getPlayerId } from '../../core/playerContext';
import { log } from '../../utils/logger';
import { getAllPlantSpecies, getAllPetSpecies, getMutationCatalog } from '../../catalogs/gameCatalogs';

const JOURNAL_DEBUG_LOGS = false;
const jdbg = (...args: unknown[]): void => {
  if (!JOURNAL_DEBUG_LOGS) return;
  log(...(args as [any, ...any[]]));
};

const normalizeKey = (value: string): string => (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Alias mappings for produce keys that may differ between in-game journal and catalog
const PRODUCE_KEY_ALIASES: Record<string, string[]> = {
  cacaobean: ['cacao', 'cacao bean', 'cacao fruit', 'cacaofruit', 'cocoa', 'cocoabean'],
  favabean: ['fava bean', 'fava bean pod', 'favabeanpod', 'fava pod', 'favapod'],
  passionfruit: ['passion fruit'],
  dragonfruit: ['dragon fruit'],
  burrostail: ["burro's tail", 'burros tail'],
};

const resolveProduceKey = (raw: string): string => {
  const key = normalizeKey(raw);
  for (const [canonical, aliases] of Object.entries(PRODUCE_KEY_ALIASES)) {
    if (key === canonical) return canonical;
    if (aliases.some((alias) => normalizeKey(alias) === key)) return canonical;
  }
  return key;
};

let cachedVariantAliases: Record<string, string> | null = null;

function getVariantKeyAliases(): Record<string, string> {
  if (cachedVariantAliases) return cachedVariantAliases;
  const aliases: Record<string, string> = {};
  const mutCatalog = getMutationCatalog();
  if (!mutCatalog) return aliases;
  for (const [key, entry] of Object.entries(mutCatalog)) {
    const name = entry.name || key;
    const nKey = normalizeKey(key);
    const nName = normalizeKey(name);
    aliases[nKey] = nName;
    aliases[nName] = nName;
  }
  cachedVariantAliases = aliases;
  return aliases;
}

const resolveVariantKey = (raw: string): string => {
  const key = normalizeKey(raw);
  const aliases = getVariantKeyAliases();
  return aliases[key] ?? key;
};

export type ProduceVariantLog = { variant: string; createdAt?: number };
export type PetVariantLog = { variant: string; createdAt?: number };
export type PetAbilityLog = { ability: string; createdAt?: number };

export type SpeciesProduceLog = { variantsLogged?: ProduceVariantLog[] };
export type SpeciesPetLog = {
  variantsLogged?: PetVariantLog[];
  abilitiesLogged?: PetAbilityLog[];
};

export type Journal = {
  produce?: Record<string, SpeciesProduceLog>;
  pets?: Record<string, SpeciesPetLog>;
};

export type JournalSummary = {
  produce: {
    species: string;
    variants: {
      variant: string;
      collected: boolean;
      collectedAt?: number | undefined;
    }[];
  }[];
  pets: {
    species: string;
    variants: {
      variant: string;
      collected: boolean;
      collectedAt?: number | undefined;
    }[];
  }[];
};

function getProduceCatalog(): Record<string, string[]> {
  const catalog: Record<string, string[]> = {};

  const mutCatalog = getMutationCatalog();
  const species = getAllPlantSpecies(); // returns [] if plantCatalog is null
  if (!mutCatalog || species.length === 0) return catalog;

  const variants: string[] = ['Normal'];

  for (const [key, entry] of Object.entries(mutCatalog)) {
    if (key.toLowerCase().includes('maxweight')) continue;
    const displayName = entry.name || key;
    variants.push(displayName);
  }

  // Add max weight (always present in journal system)
  variants.push('Max Weight');

  for (const speciesName of species) {
    catalog[speciesName] = variants.slice();
  }

  return catalog;
}

// Pet journal only tracks these four. Unlike produce, plant mutations don't apply to pets.
const PET_JOURNAL_VARIANTS = ['Normal', 'Gold', 'Rainbow', 'Max Weight'] as const;

function getPetCatalog(): Record<string, string[]> {
  const catalog: Record<string, string[]> = {};
  const species = getAllPetSpecies(); // returns [] if petCatalog is null
  if (species.length === 0) return catalog;
  for (const speciesName of species) {
    catalog[speciesName] = [...PET_JOURNAL_VARIANTS];
  }
  return catalog;
}

let cachedJournal: Journal | null = null;
let lastFetchTime = 0;
const CACHE_DURATION_MS = 5000;

async function fetchJournalFromState(): Promise<Journal | null> {
  try {
    const state = await readAtomValue('state') as any;
    if (!state) {
      log('⚠️ State is null');
      return null;
    }

    const playerId = await getPlayerId();
    if (!playerId) {
      log('⚠️ Player ID not found');
      return null;
    }

    jdbg(`[JOURNAL-DEBUG] Current player ID: ${playerId}`);

    const slots = state?.child?.data?.userSlots || [];
    jdbg(`[JOURNAL-DEBUG] Found ${Array.isArray(slots) ? slots.length : Object.keys(slots || {}).length} slots (isArray: ${Array.isArray(slots)})`);

    let playerSlot: any = null;

    if (Array.isArray(slots)) {
      playerSlot = slots.find((s: any) => String(s?.playerId) === String(playerId));
      jdbg(`[JOURNAL-DEBUG] Searched array slots, found match: ${!!playerSlot}`);
    } else if (slots && typeof slots === 'object') {
      // userSlots might be an object with numeric keys
      for (const slot of Object.values(slots)) {
        if (String((slot as any)?.playerId) === String(playerId)) {
          playerSlot = slot;
          break;
        }
      }
      jdbg(`[JOURNAL-DEBUG] Searched object slots, found match: ${!!playerSlot}`);
    }

    if (!playerSlot) {
      log('⚠️ Player slot not found');
      jdbg(`[JOURNAL-DEBUG] Available slot player IDs: ${Array.isArray(slots) ? slots.map((s: any) => s?.playerId).join(', ') : Object.values(slots || {}).map((s: any) => (s as any)?.playerId).join(', ')}`);
      return null;
    }

    const journal = playerSlot?.data?.journal || playerSlot?.journal;
    if (!journal || typeof journal !== 'object') {
      log('ℹ️ No journal data found for player');
      jdbg(`[JOURNAL-DEBUG] Player slot structure: ${JSON.stringify(Object.keys(playerSlot || {}))}`);
      jdbg(`[JOURNAL-DEBUG] Player slot.data structure: ${JSON.stringify(Object.keys(playerSlot?.data || {}))}`);
      return { produce: {}, pets: {} };
    }

    jdbg(`[JOURNAL-DEBUG] Found journal with keys: ${JSON.stringify(Object.keys(journal))}`);
    if (journal.produce) {
      jdbg(`[JOURNAL-DEBUG] Produce species: ${JSON.stringify(Object.keys(journal.produce))}`);
    }
    if (journal.pets) {
      jdbg(`[JOURNAL-DEBUG] Pet species: ${JSON.stringify(Object.keys(journal.pets))}`);
    }

    return normalizeJournal(journal);
  } catch (error) {
    log('❌ Error fetching journal:', error);
    return null;
  }
}

function normalizeJournal(raw: any): Journal {
  const journal: Journal = {};

  if (raw.produce && typeof raw.produce === 'object') {
    journal.produce = Object.fromEntries(
      Object.entries(raw.produce).map(([species, data]) => [
        species,
        {
          variantsLogged: (() => {
            const entry = data as any;
            if (Array.isArray(entry?.variantsLogged)) return entry.variantsLogged;
            if (Array.isArray(entry?.variants)) {
              // Some payloads store variants as plain strings
              return entry.variants.map((v: any) => (typeof v === 'string' ? { variant: v } : v));
            }
            return [] as ProduceVariantLog[];
          })(),
        },
      ])
    );
  }

  if (raw.pets && typeof raw.pets === 'object') {
    journal.pets = Object.fromEntries(
      Object.entries(raw.pets).map(([species, data]) => [
        species,
        {
          variantsLogged: (() => {
            const entry = data as any;
            if (Array.isArray(entry?.variantsLogged)) return entry.variantsLogged;
            if (Array.isArray(entry?.variants)) {
              return entry.variants.map((v: any) => (typeof v === 'string' ? { variant: v } : v));
            }
            return [] as PetVariantLog[];
          })(),
          abilitiesLogged: (() => {
            const entry = data as any;
            if (Array.isArray(entry?.abilitiesLogged)) return entry.abilitiesLogged;
            if (Array.isArray(entry?.abilities)) {
              return entry.abilities.map((a: any) => (typeof a === 'string' ? { ability: a } : a));
            }
            return [] as PetAbilityLog[];
          })(),
        },
      ])
    );
  }

  return journal;
}

export async function getJournal(): Promise<Journal | null> {
  const now = Date.now();
  if (cachedJournal && now - lastFetchTime < CACHE_DURATION_MS) {
    return cachedJournal;
  }

  const journal = await fetchJournalFromState();
  if (journal) {
    cachedJournal = journal;
    lastFetchTime = now;
  }

  return journal;
}

export async function getJournalSummary(): Promise<JournalSummary | null> {
  const journal = await getJournal();
  if (!journal) return null;

  const summary: JournalSummary = {
    produce: [],
    pets: [],
  };

  const produceLogByKey = new Map<string, SpeciesProduceLog>();
  Object.entries(journal.produce ?? {}).forEach(([species, data]) => {
    produceLogByKey.set(resolveProduceKey(species), data);
  });

  const petLogByKey = new Map<string, SpeciesPetLog>();
  Object.entries(journal.pets ?? {}).forEach(([species, data]) => {
    petLogByKey.set(normalizeKey(species), data);
  });

  const produceCatalog = getProduceCatalog();
  for (const [species, possibleVariants] of Object.entries(produceCatalog)) {
    const speciesLog = produceLogByKey.get(resolveProduceKey(species));
    const loggedVariants = new Map<string, number>();

    if (speciesLog?.variantsLogged) {
      for (const log of speciesLog.variantsLogged) {
        loggedVariants.set(resolveVariantKey(log.variant), log.createdAt || 0);
      }
    }

    if (!Array.isArray(possibleVariants)) {
      continue;
    }

    summary.produce.push({
      species,
      variants: possibleVariants.map((variant) => ({
        variant: String(variant), // Ensure it's a string
        collected: loggedVariants.has(resolveVariantKey(String(variant))),
        collectedAt: loggedVariants.get(resolveVariantKey(String(variant))),
      })),
    });
  }

  // Process pets (variants only, no abilities)
  const petCatalog = getPetCatalog();
  for (const [species, possibleVariants] of Object.entries(petCatalog)) {
    const speciesLog = petLogByKey.get(normalizeKey(species));
    const loggedVariants = new Map<string, number>();

    if (speciesLog?.variantsLogged) {
      for (const log of speciesLog.variantsLogged) {
        loggedVariants.set(resolveVariantKey(log.variant), log.createdAt || 0);
      }
    }

    if (!Array.isArray(possibleVariants)) {
      continue;
    }

    summary.pets.push({
      species,
      variants: possibleVariants.map((variant) => ({
        variant: String(variant), // Ensure it's a string
        collected: loggedVariants.has(resolveVariantKey(String(variant))),
        collectedAt: loggedVariants.get(resolveVariantKey(String(variant))),
      })),
    });
  }

  return summary;
}

export async function getJournalStats(): Promise<{
  produce: { collected: number; total: number; percentage: number; typesCollected: number; typesTotal: number };
  petVariants: { collected: number; total: number; percentage: number };
  overall: { collected: number; total: number; percentage: number };
} | null> {
  const summary = await getJournalSummary();
  if (!summary) return null;

  let produceCollected = 0;
  let produceTotal = 0;
  let petVariantsCollected = 0;
  let petVariantsTotal = 0;
  let cropTypesCollected = 0;
  const cropTypesTotal = summary.produce.length;

  for (const species of summary.produce) {
    let speciesHasVariant = false;
    for (const variant of species.variants) {
      produceTotal++;
      if (variant.collected) {
        produceCollected++;
        speciesHasVariant = true;
      }
    }
    // Count crop type as collected if at least one variant is collected
    if (speciesHasVariant) cropTypesCollected++;
  }

  // Count pet variants only (no abilities)
  for (const species of summary.pets) {
    for (const variant of species.variants) {
      petVariantsTotal++;
      if (variant.collected) petVariantsCollected++;
    }
  }

  const overallCollected = produceCollected + petVariantsCollected;
  const overallTotal = produceTotal + petVariantsTotal;

  return {
    produce: {
      collected: produceCollected,
      total: produceTotal,
      percentage: produceTotal > 0 ? (produceCollected / produceTotal) * 100 : 0,
      typesCollected: cropTypesCollected,
      typesTotal: cropTypesTotal,
    },
    petVariants: {
      collected: petVariantsCollected,
      total: petVariantsTotal,
      percentage: petVariantsTotal > 0 ? (petVariantsCollected / petVariantsTotal) * 100 : 0,
    },
    overall: {
      collected: overallCollected,
      total: overallTotal,
      percentage: overallTotal > 0 ? (overallCollected / overallTotal) * 100 : 0,
    },
  };
}

export function refreshJournalCache(): void {
  cachedJournal = null;
  lastFetchTime = 0;
}
