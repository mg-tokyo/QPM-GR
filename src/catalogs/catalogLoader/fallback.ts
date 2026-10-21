import { getPetAbilitiesCatalogMap } from '../logic/petAbilitiesCatalog';
import { getDexBlueprint, holdDexBundleCache, type DexCatalogName } from '../logic/dexCatalogs';
import { checkCatalogAgreement } from './agreement';
import { enrichMutationColors, enrichPetAbilityColors, pollAttempts, startMutationColorPolling } from './enrichment';
import { publishCatalogsHealth } from './diagnostics';
import { checkAndNotifyReady, notifyPetAbilitiesCaptured } from './readyState';
import { captureSources, capturedCatalogs, catalogLog, catalogReplacements, publishCatalogs } from './state';

// QPM's own enrichment writes `color` onto mutation and ability entries.
const AGREEMENT_IGNORE_KEYS: readonly string[] = ['color'];
const MISMATCH_LOG_LIMIT = 5;

function recordReplacement(name: keyof typeof captureSources, mismatches: readonly string[]): void {
  const sample = mismatches.slice(0, MISMATCH_LOG_LIMIT).join('; ');
  catalogReplacements[name] = `captured copy disagrees with bundle text (${mismatches.length}): ${mismatches.slice(0, 2).join('; ')}`;
  captureSources[name] = 'bundle-text';
  catalogLog(`${name} replaced from bundle text — captured copy disagrees (${mismatches.length} mismatches): ${sample}`);
}

let fallbackInFlight: Promise<boolean> | null = null;

// Seeds petAbilities from bundle text when the Object.* hook never saw the blueprint. Idempotent.
export function ensurePetAbilitiesCatalog(): Promise<boolean> {
  if (capturedCatalogs.petAbilities) return Promise.resolve(true);
  if (fallbackInFlight) return fallbackInFlight;
  fallbackInFlight = (async () => {
    const map = await getPetAbilitiesCatalogMap();
    if (!map || capturedCatalogs.petAbilities) return capturedCatalogs.petAbilities !== null;
    capturedCatalogs.petAbilities = map;
    captureSources.petAbilities = 'bundle-text';
    catalogLog(`petAbilities seeded from bundle text (${Object.keys(map).length} abilities).`);
    publishCatalogs();
    void enrichPetAbilityColors();
    notifyPetAbilitiesCaptured();
    return true;
  })().finally(() => { fallbackInFlight = null; });
  return fallbackInFlight;
}

const MAX_MERGE_ATTEMPTS = 3;
let mergeAttempts = 0;
let mergeInFlight: Promise<boolean> | null = null;

/**
 * Verifies a hook-captured petAbilities catalog against the bundle text (the
 * same blueprint the game executes) and tops up missing entries, or replaces
 * it outright when its entries disagree (another mod's copy). The hook can
 * capture a partial dex-shaped object when another mod's enumeration order
 * surfaces it first — see scan.ts capture-or-upgrade. Hook entries win on key
 * collision; the captured object is never mutated (it may be the game's live dex).
 *
 * With `observedIds` (ability ids seen on real pets) the bundle fetch is skipped
 * entirely when all are present. Without them, verification is unconditional.
 * Returns true only when the catalog changed.
 */
export function mergePetAbilitiesIfIncomplete(observedIds?: readonly string[]): Promise<boolean> {
  const current = capturedCatalogs.petAbilities;
  if (!current) return ensurePetAbilitiesCatalog();
  if (observedIds && observedIds.every((id) => id in current)) return Promise.resolve(false);
  if (mergeInFlight) return mergeInFlight;
  if (mergeAttempts >= MAX_MERGE_ATTEMPTS) return Promise.resolve(false);
  mergeAttempts += 1;
  mergeInFlight = (async () => {
    const map = await getPetAbilitiesCatalogMap();
    if (!map) return false;
    const base = capturedCatalogs.petAbilities;
    if (!base) return false;
    const { agrees, mismatches } = checkCatalogAgreement(base, map, { ignoreKeys: AGREEMENT_IGNORE_KEYS });
    if (!agrees) {
      // Another mod's colour strings would pass readAbilityColorBg and never be corrected.
      capturedCatalogs.petAbilities = { ...map };
      recordReplacement('petAbilities', mismatches);
      publishCatalogs();
      publishCatalogsHealth();
      void enrichPetAbilityColors();
      notifyPetAbilitiesCaptured();
      return true;
    }
    const additions = Object.keys(map).filter((k) => !(k in base));
    if (additions.length === 0) return false;
    capturedCatalogs.petAbilities = { ...map, ...base };
    captureSources.petAbilities = 'hook+bundle-text';
    catalogLog(`petAbilities topped up from bundle text (+${additions.length}, now ${Object.keys(capturedCatalogs.petAbilities).length})`);
    publishCatalogs();
    publishCatalogsHealth();
    void enrichPetAbilityColors();
    notifyPetAbilitiesCaptured();
    return true;
  })().finally(() => { mergeInFlight = null; });
  return mergeInFlight;
}

const MAX_DEX_MERGE_ATTEMPTS = 3;
const dexMergeAttempts: Record<DexCatalogName, number> = {
  eggCatalog: 0, petCatalog: 0, mutationCatalog: 0, plantCatalog: 0, itemCatalog: 0, decorCatalog: 0,
};
const dexMergeInFlight = new Map<DexCatalogName, Promise<boolean>>();

// capturedCatalogs viewed as plain string-keyed maps; same object, looser lens.
const dexView = capturedCatalogs as unknown as Record<DexCatalogName, Record<string, unknown> | null>;

/**
 * Same contract as mergePetAbilitiesIfIncomplete, generalized: verify a
 * hook-captured dex catalog against the game's own bundle text and heal it.
 * The Object.* race can hand the capture a partial dex (missing new-content
 * keys) or, for mutationCatalog, a lookalike keyed by DISPLAY names — so
 * mutationCatalog is replaced by the bundle blueprint (enriched colors carried
 * over per key) while every other dex is topped up with hook entries winning.
 * A complete copy that disagrees with the bundle (another mod's data, see
 * agreement.ts) is replaced outright. Returns true only when the catalog changed.
 */
export function mergeCatalogIfIncomplete(name: DexCatalogName, observedIds?: readonly string[]): Promise<boolean> {
  const current = dexView[name];
  if (current && observedIds && observedIds.every((id) => id in current)) return Promise.resolve(false);
  const inFlight = dexMergeInFlight.get(name);
  if (inFlight) return inFlight;
  if (dexMergeAttempts[name] >= MAX_DEX_MERGE_ATTEMPTS) return Promise.resolve(false);
  dexMergeAttempts[name] += 1;

  const promise = (async () => {
    const blueprint = await getDexBlueprint(name);
    if (!blueprint) return false;
    const { map } = blueprint;
    const base = dexView[name];

    // Without resolved sprites the bundle map has no sprite fields to compare.
    const agreement = base && blueprint.spritesResolved
      ? checkCatalogAgreement(base, map, { ignoreKeys: AGREEMENT_IGNORE_KEYS })
      : null;

    if (agreement && !agreement.agrees) {
      // No colour carry-over: enrichMutationColors only fills colourless entries,
      // so a foreign colour carried here would never be corrected.
      dexView[name] = { ...map };
      recordReplacement(name, agreement.mismatches);
      if (name === 'mutationCatalog') {
        pollAttempts.mutationColor = 0;
        startMutationColorPolling();
        void enrichMutationColors();
      }
      publishCatalogs();
      publishCatalogsHealth();
      return true;
    }

    if (name === 'mutationCatalog' && base) {
      const missing = Object.keys(map).filter((k) => !(k in base));
      if (missing.length === 0) return false;
      const next: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(map)) {
        const baseEntry = base[key];
        const color = baseEntry && typeof baseEntry === 'object'
          ? (baseEntry as Record<string, unknown>).color
          : undefined;
        next[key] = typeof color === 'string' ? { ...entry, color } : entry;
      }
      dexView[name] = next;
      catalogLog(`mutationCatalog replaced from bundle text (captured object was missing ${missing.join(', ')})`);
      pollAttempts.mutationColor = 0;
      startMutationColorPolling();
      void enrichMutationColors();
    } else if (base) {
      const additions = Object.keys(map).filter((k) => !(k in base));
      if (additions.length === 0) return false;
      dexView[name] = { ...map, ...base };
      catalogLog(`${name} topped up from bundle text (+${additions.length}, now ${Object.keys(dexView[name] ?? {}).length})`);
    } else {
      dexView[name] = { ...map };
      catalogLog(`${name} seeded from bundle text (${Object.keys(map).length} entries).`);
    }

    captureSources[name] = base ? 'hook+bundle-text' : 'bundle-text';
    publishCatalogs();
    publishCatalogsHealth();
    return true;
  })().finally(() => { dexMergeInFlight.delete(name); });
  dexMergeInFlight.set(name, promise);
  return promise;
}

const DEX_AUDIT_ORDER: readonly DexCatalogName[] = [
  'eggCatalog', 'petCatalog', 'mutationCatalog', 'plantCatalog', 'itemCatalog', 'decorCatalog',
];
let dexAuditRan = false;

/**
 * One-shot self-heal for enumeration races nobody reported: verify every dex
 * catalog against bundle text once, shortly after catalogs-ready. Sequential
 * so all six merges share one chunk fetch (all blueprints live in the same
 * chunk); the hold keeps the shared text cache alive across the pass.
 */
export async function runDexCompletenessAudit(force = false): Promise<Record<string, boolean>> {
  if (dexAuditRan && !force) return {};
  dexAuditRan = true;
  const release = holdDexBundleCache();
  const results: Record<string, boolean> = {};
  try {
    for (const name of DEX_AUDIT_ORDER) {
      results[name] = await mergeCatalogIfIncomplete(name).catch(() => false);
    }
    // Same race, non-dex shape: petAbilities has its own verified merge.
    results.petAbilities = await mergePetAbilitiesIfIncomplete().catch(() => false);
  } finally {
    release();
  }
  const healed = Object.entries(results).filter(([, changed]) => changed).map(([n]) => n);
  if (healed.length > 0) catalogLog(`Completeness audit healed: ${healed.join(', ')}`);
  return results;
}

/**
 * Hook capture never delivered (QPM-CATALOG-001): seed every dex catalog from
 * the game's bundle text so the session is not catalog-less. Same merge as
 * the audit — a later hook capture still upgrades entries. Returns seeded names.
 */
export async function seedDexCatalogsFromBundle(): Promise<string[]> {
  const results = await runDexCompletenessAudit(true);
  const seeded = Object.entries(results).filter(([, changed]) => changed).map(([n]) => n);
  if (seeded.length > 0) {
    publishCatalogs();
    publishCatalogsHealth();
    checkAndNotifyReady();
  }
  return seeded;
}
