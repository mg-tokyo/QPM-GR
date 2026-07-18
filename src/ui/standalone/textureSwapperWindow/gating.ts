import { parseAtlasKey } from '../../../features/standalone/textureSwapper';
import { getJournal } from '../../../features/journal/checker';
import { getCatalogs } from '../../../catalogs/gameCatalogs';
import { storage } from '../../../utils/storage';
import { stripFamilySuffix } from './displayName';

export type GatingOptions = { bypassJournal?: boolean };

// Suffixes stripped after NORMALIZE (lowercase + alphanumeric-only).
// Kept conservative — only family/variant tokens that show up at the END
// of catalog-tracked species. Avoids over-stripping integral name parts
// (e.g. "Tree" in "PineTree", "Fruit" in "DragonFruit") which were stripped
// in an earlier pass and caused false negatives.
const VARIANT_SUFFIXES = [
  'tallplant', 'plant', 'crop', 'seed', 'egg',
  'active', 'sideways', 'backwards', 'lit',
  'sprout', 'baby',
] as const;

// Word tokens that are family / state / life-stage modifiers, NOT
// part of a species' identity. When sets of words on both sides are
// compared, these are dropped from BOTH sides. Keeps e.g. "Baby" prefix
// from BabyBeet, "Active" from FireHorseActive.
const MODIFIER_WORDS = new Set([
  'plant', 'tallplant', 'crop', 'seed', 'egg',
  'baby', 'sprout',
  'active', 'lit', 'sideways', 'backwards',
]);

const GATING_DISABLE_KEY = 'qpm.gardenPainter.disableGating.v1';
const GATING_DEBUG_KEY = 'qpm.gardenPainter.gatingDebug.v1';

function isGatingDisabled(): boolean {
  return storage.get<boolean>(GATING_DISABLE_KEY, false) ?? false;
}
function isGatingDebug(): boolean {
  return storage.get<boolean>(GATING_DEBUG_KEY, false) ?? false;
}

function gatingLog(...args: unknown[]): void {
  if (isGatingDebug()) console.log('[GardenPainter:gating]', ...args);
}

function stripVariantSfx(key: string): string {
  // Iterate until stable — handles compound suffixes like "PlantActive".
  let cur = key;
  for (let i = 0; i < 3; i++) {
    let next = cur;
    for (const sfx of VARIANT_SUFFIXES) {
      if (next.endsWith(sfx) && next.length > sfx.length) {
        next = next.slice(0, next.length - sfx.length);
        break;
      }
    }
    if (next === cur) break;
    cur = next;
  }
  return cur;
}

// Strip non-alphanumeric, lowercase, then strip variant suffixes.
const NORMALIZE = (s: string): string =>
  stripVariantSfx(s.toLowerCase().replace(/[^a-z0-9]/g, ''));

// Split a key on camelCase boundaries to a word list (lowercase, modifier
// words dropped). "DaisyPurple" → ["daisy", "purple"]; "BabyBeet" → ["beet"].
function wordTokens(s: string): string[] {
  return s
    .split(/(?=[A-Z])|[\s_-]+/)
    .map(w => w.toLowerCase())
    .filter(w => w.length > 0 && !MODIFIER_WORDS.has(w));
}

// Multi-strategy match: exact, word-set (catches "DaisyPurple" ↔ "PurpleDaisy"),
// fuzzy substring (catches "RoseRed" ↔ "Rose", "Tulip" ↔ "OrangeTulip"). Used
// on both species-root and journal-key inputs.
function matchKeys(a: string, b: string): boolean {
  if (!a || !b) return false;
  const na = NORMALIZE(a);
  const nb = NORMALIZE(b);
  if (na === nb) return true;

  // Word-set sort match: handles reversed word order.
  const wa = wordTokens(a).sort().join('');
  const wb = wordTokens(b).sort().join('');
  if (wa && wb && wa === wb) return true;

  // Fuzzy substring: one normalized form contains the other. Threshold 4 to
  // avoid runaway collisions on 3-char species (Bee, Cow, Pig, Ube). 3-char
  // species are caught by the word-set strategy above when the modifier is
  // a known one (BabyUbe → drop Baby → [ube] matches [ube]).
  if (na.length >= 4 && nb.length >= 4 && (na.includes(nb) || nb.includes(na))) {
    return true;
  }

  return false;
}

export function getSpeciesRoot(spriteKey: string): { category: string; speciesRoot: string } {
  const { category, id } = parseAtlasKey(spriteKey);
  return { category, speciesRoot: stripFamilySuffix(id).speciesRoot };
}

function isProduceCategory(category: string): boolean {
  return category === 'plant' || category === 'tallplant' || category === 'crop';
}

function findJournalLog<T extends { variantsLogged?: Array<{ variant: string }> }>(
  map: Record<string, T>,
  speciesRoot: string,
): T | null {
  for (const [species, log] of Object.entries(map)) {
    if (matchKeys(species, speciesRoot)) return log;
  }
  return null;
}

function isPetSpeciesUnlocked(petSpecies: string, journal: { pets?: Record<string, { variantsLogged?: Array<{ variant: string }> }> }): boolean {
  const pets = journal.pets ?? {};
  const log = findJournalLog(pets, petSpecies);
  return log !== null && (log.variantsLogged?.length ?? 0) > 0;
}

// Eggs the atlas exposes under `sprite/pet/CommonEgg` etc. Looks them up
// by id in the egg catalog (or fuzzy-matched key) and returns the list of
// pet species the egg can hatch.
function eggHatchesPets(eggId: string): string[] {
  const eggCatalog = getCatalogs().eggCatalog;
  if (!eggCatalog) return [];
  let entry = eggCatalog[eggId] as { faunaSpawnWeights?: unknown } | undefined;
  if (!entry) {
    for (const [id, e] of Object.entries(eggCatalog)) {
      if (matchKeys(id, eggId)) {
        entry = e as { faunaSpawnWeights?: unknown };
        break;
      }
    }
  }
  if (!entry) return [];
  const weights = entry.faunaSpawnWeights;
  if (!weights) return [];
  const out: string[] = [];
  if (Array.isArray(weights)) {
    for (const w of weights) {
      if (w && typeof w === 'object' && typeof (w as { species?: unknown }).species === 'string') {
        out.push((w as { species: string }).species);
      }
    }
  } else if (typeof weights === 'object') {
    for (const sp of Object.keys(weights as Record<string, unknown>)) {
      out.push(sp);
    }
  }
  return out;
}

// Detect egg sprites by id suffix — atlas lists them under `sprite/pet/`.
function isEggId(id: string): boolean {
  return /Egg$/.test(id);
}

// Check whether a plant catalog species exists for this root. Used as a
// fail-open fallback for sprites that aren't real catalog species (decor
// fillers like Tree, Hedge, Shrub, DirtPatch — none of these are journal-
// tracked, so we shouldn't gate on them).
function plantCatalogHas(speciesRoot: string): boolean {
  const cat = getCatalogs().plantCatalog;
  if (!cat) return false;
  if (cat[speciesRoot]) return true;
  for (const k of Object.keys(cat)) {
    if (matchKeys(k, speciesRoot)) return true;
  }
  return false;
}

function petCatalogHas(speciesRoot: string): boolean {
  const cat = getCatalogs().petCatalog;
  if (!cat) return false;
  if (cat[speciesRoot]) return true;
  for (const k of Object.keys(cat)) {
    if (matchKeys(k, speciesRoot)) return true;
  }
  return false;
}

export async function isSpeciesUnlocked(spriteKey: string, opts?: GatingOptions): Promise<boolean> {
  if (isGatingDisabled()) return true;
  if (opts?.bypassJournal) return true;

  const { category, id } = parseAtlasKey(spriteKey);
  const { speciesRoot } = getSpeciesRoot(spriteKey);

  // Items, decor, seeds: never gated.
  if (category === 'item' || category === 'decor' || category === 'seed') return true;

  // Eggs (atlas exposes them under sprite/pet/CommonEgg etc.) — inherit
  // unlock from the pets the egg can hatch.
  if (category === 'pet' && isEggId(id)) {
    const journal = await getJournal();
    if (!journal) return true;
    const eggId = id; // raw atlas id, no suffix-strip
    const pets = eggHatchesPets(eggId);
    if (pets.length === 0) {
      gatingLog('isSpeciesUnlocked egg: no hatch list → unlocked (fail-open)', { spriteKey });
      return true;
    }
    for (const pet of pets) {
      if (isPetSpeciesUnlocked(pet, journal)) {
        gatingLog('isSpeciesUnlocked egg unlocked via pet', { spriteKey, pet });
        return true;
      }
    }
    gatingLog('isSpeciesUnlocked egg: no hatch-pets unlocked', { spriteKey, pets });
    return false;
  }

  const journal = await getJournal();
  if (!journal) {
    gatingLog('isSpeciesUnlocked: journal not ready → unlocked (fail-open)', spriteKey);
    return true;
  }

  if (isProduceCategory(category)) {
    // Fail-open for non-species sprites (decor placeholders like Tree, Hedge,
    // Shrub, DirtPatch — the journal doesn't track these so blocking them
    // is wrong).
    if (!plantCatalogHas(speciesRoot)) {
      gatingLog('isSpeciesUnlocked produce: no catalog entry → unlocked (decor/cosmetic)', { spriteKey, speciesRoot });
      return true;
    }
    const log = findJournalLog(journal.produce ?? {}, speciesRoot);
    const unlocked = log !== null && (log.variantsLogged?.length ?? 0) > 0;
    gatingLog('isSpeciesUnlocked produce', { spriteKey, speciesRoot, unlocked });
    return unlocked;
  }

  if (category === 'pet') {
    // Fail-open if no catalog entry — handles atlas keys that don't correspond
    // to a real pet species.
    if (!petCatalogHas(speciesRoot)) {
      gatingLog('isSpeciesUnlocked pet: no catalog entry → unlocked', { spriteKey, speciesRoot });
      return true;
    }
    const unlocked = isPetSpeciesUnlocked(speciesRoot, journal);
    gatingLog('isSpeciesUnlocked pet', { spriteKey, speciesRoot, unlocked });
    return unlocked;
  }

  return true;
}

export async function isMutationUnlocked(spriteKey: string, mutationName: string, opts?: GatingOptions): Promise<boolean> {
  if (isGatingDisabled()) return true;
  if (opts?.bypassJournal) return true;

  const { category } = parseAtlasKey(spriteKey);
  const { speciesRoot } = getSpeciesRoot(spriteKey);
  if (mutationName === 'None') return isSpeciesUnlocked(spriteKey, opts);

  const journal = await getJournal();
  if (!journal) return true;

  const normalizedMutation = NORMALIZE(mutationName);

  if (isProduceCategory(category)) {
    if (!plantCatalogHas(speciesRoot)) return true;
    const log = findJournalLog(journal.produce ?? {}, speciesRoot);
    if (!log) return false;
    return (log.variantsLogged ?? []).some(v => NORMALIZE(v.variant) === normalizedMutation);
  }

  if (category === 'pet') {
    if (!petCatalogHas(speciesRoot)) return true;
    const log = findJournalLog(journal.pets ?? {}, speciesRoot);
    if (!log) return false;
    return (log.variantsLogged ?? []).some(v => NORMALIZE(v.variant) === normalizedMutation);
  }

  return true;
}
