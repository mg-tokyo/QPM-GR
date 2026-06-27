// Garden Painter — gating diagnostic.
// Compares the asset catalogs (plant / pet / egg) against the player's QPM
// journal, reporting which catalog species the gating system can resolve
// and which it can't. Used to tune the NORMALIZE / fuzzyMatch / alias
// rules in gating.ts when family matching misses entries.
//
// Run from console after enabling debug globals:
//   QPM_GARDEN_PAINTER_GATING_DIAG()
// Output is grouped by catalog and printed via console.table.

import { shareGlobal } from '../../../core/pageContext';
import { getCatalogs } from '../../../catalogs/gameCatalogs';
import { getJournal } from '../../../features/journal/checker';
import { getSvc, parseAtlasKey } from '../../../features/standalone/textureSwapper';
import type { SpriteCategory } from '../../../sprite-v2/types';
import { isSpeciesUnlocked, getSpeciesRoot } from './gating';

type Row = {
  catalogKey: string;
  spriteKeyRoot: string;
  journalMatch: string | null;
  unlocked: boolean | 'fail-open';
  variants: number;
};

function makeSpriteKey(category: string, id: string): string {
  return `sprite/${category}/${id}`;
}

const NORMALIZE = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]/g, '')
    .replace(/(tallplant|plant|crop|seed|baby|sprout|egg|pet)$/g, '');

function findJournalKey(
  journalMap: Record<string, unknown>,
  speciesRoot: string,
): string | null {
  const target = NORMALIZE(speciesRoot);
  for (const key of Object.keys(journalMap)) {
    if (NORMALIZE(key) === target) return key;
  }
  // fuzzy
  for (const key of Object.keys(journalMap)) {
    const k = NORMALIZE(key);
    if (k.length >= 6 && target.length >= 6 && (k.includes(target) || target.includes(k))) return key;
  }
  return null;
}

export async function gardenPainterGatingDiag(): Promise<void> {
  const catalogs = getCatalogs();
  const journal = await getJournal();

  console.group('🌱 Garden Painter — Gating Diagnostic');

  if (!journal) {
    console.warn('Journal is null — gating fails open (everything unlocks). No diagnostic possible until journal loads.');
    console.groupEnd();
    return;
  }

  const produceKeys = Object.keys(journal.produce ?? {});
  const petKeys = Object.keys(journal.pets ?? {});
  console.log('Journal produce keys:', produceKeys);
  console.log('Journal pet keys:', petKeys);

  // ── Plants ─────────────────────────────────────────────────────────────
  console.group(`🌿 Plant catalog (${Object.keys(catalogs.plantCatalog ?? {}).length} species)`);
  const plantRows: Row[] = [];
  for (const species of Object.keys(catalogs.plantCatalog ?? {})) {
    const spriteKey = makeSpriteKey('plant', `${species}Plant`);
    const { speciesRoot } = getSpeciesRoot(spriteKey);
    const journalMatch = findJournalKey(journal.produce ?? {} as Record<string, unknown>, speciesRoot);
    const unlocked = await isSpeciesUnlocked(spriteKey);
    const variants = journalMatch
      ? (journal.produce?.[journalMatch]?.variantsLogged?.length ?? 0)
      : 0;
    plantRows.push({ catalogKey: species, spriteKeyRoot: speciesRoot, journalMatch, unlocked, variants });
  }
  console.table(plantRows);
  const missing = plantRows.filter(r => !r.unlocked && !r.journalMatch);
  const wrongMatch = plantRows.filter(r => r.unlocked && !r.journalMatch);
  console.log(`✅ ${plantRows.filter(r => r.unlocked).length} unlocked, ❌ ${plantRows.filter(r => !r.unlocked).length} locked`);
  if (missing.length) console.warn(`${missing.length} plant species have NO journal match. Likely never logged.`);
  if (wrongMatch.length) console.warn(`${wrongMatch.length} unlocked via fail-open with no match — investigate.`);
  console.groupEnd();

  // ── Pets ───────────────────────────────────────────────────────────────
  console.group(`🐾 Pet catalog (${Object.keys(catalogs.petCatalog ?? {}).length} species)`);
  const petRows: Row[] = [];
  for (const species of Object.keys(catalogs.petCatalog ?? {})) {
    const spriteKey = makeSpriteKey('pet', species);
    const { speciesRoot } = getSpeciesRoot(spriteKey);
    const journalMatch = findJournalKey(journal.pets ?? {} as Record<string, unknown>, speciesRoot);
    const unlocked = await isSpeciesUnlocked(spriteKey);
    const variants = journalMatch
      ? (journal.pets?.[journalMatch]?.variantsLogged?.length ?? 0)
      : 0;
    petRows.push({ catalogKey: species, spriteKeyRoot: speciesRoot, journalMatch, unlocked, variants });
  }
  console.table(petRows);
  const petMissing = petRows.filter(r => !r.unlocked && !r.journalMatch);
  console.log(`✅ ${petRows.filter(r => r.unlocked).length} unlocked, ❌ ${petRows.filter(r => !r.unlocked).length} locked`);
  if (petMissing.length) console.warn(`${petMissing.length} pet species have NO journal match.`);
  console.groupEnd();

  // ── Eggs (inherit from pets) ───────────────────────────────────────────
  console.group(`🥚 Egg catalog (${Object.keys(catalogs.eggCatalog ?? {}).length} entries)`);
  type EggRow = { eggId: string; hatchesInto: string; unlocked: boolean };
  const eggRows: EggRow[] = [];
  for (const eggId of Object.keys(catalogs.eggCatalog ?? {})) {
    const spriteKey = makeSpriteKey('egg', eggId);
    const unlocked = await isSpeciesUnlocked(spriteKey);
    const entry = catalogs.eggCatalog?.[eggId] as { faunaSpawnWeights?: unknown } | undefined;
    const weights = entry?.faunaSpawnWeights;
    let pets: string[] = [];
    if (Array.isArray(weights)) {
      pets = weights
        .filter(w => w && typeof w === 'object' && typeof (w as { species?: unknown }).species === 'string')
        .map(w => (w as { species: string }).species);
    } else if (weights && typeof weights === 'object') {
      pets = Object.keys(weights as Record<string, unknown>);
    }
    eggRows.push({ eggId, hatchesInto: pets.join(', ') || '(none)', unlocked });
  }
  console.table(eggRows);
  console.log(`✅ ${eggRows.filter(r => r.unlocked).length} unlocked, ❌ ${eggRows.filter(r => !r.unlocked).length} locked`);
  console.groupEnd();

  // ── Real sprite atlas keys (what the user actually clicks) ────────────
  // Collect every atlas key from svc.list(...) per category, evaluate
  // gating, and emit a single flat copyable block of locked atlas rows
  // at the end so the user can paste it in one shot.
  const lockedAll: Array<{ category: string; id: string; stripped: string; spriteKey: string }> = [];

  const svc = getSvc();
  if (svc) {
    const ATLAS_CATEGORIES: SpriteCategory[] = ['plant', 'tallplant', 'crop', 'pet', 'decor'];
    console.group('🧩 Live sprite atlas (svc.list per category)');
    for (const cat of ATLAS_CATEGORIES) {
      const items = svc.list(cat);
      type AtlasRow = { spriteKey: string; id: string; stripped: string; unlocked: boolean };
      const rows: AtlasRow[] = [];
      for (const it of items) {
        const { id } = parseAtlasKey(it.key);
        const { speciesRoot } = getSpeciesRoot(it.key);
        const unlocked = await isSpeciesUnlocked(it.key);
        rows.push({ spriteKey: it.key, id, stripped: speciesRoot, unlocked });
        if (!unlocked) lockedAll.push({ category: cat, id, stripped: speciesRoot, spriteKey: it.key });
        if (rows.length >= 300) break;
      }
      console.log(`${cat} (${rows.length} entries — ${rows.filter(r => r.unlocked).length} unlocked, ${rows.filter(r => !r.unlocked).length} LOCKED)`);
      console.table(rows);
    }
    console.groupEnd();
  }

  // ── Single copyable block of every locked atlas row ────────────────────
  console.group('📋 ALL LOCKED ATLAS ROWS (copy this whole block)');
  if (lockedAll.length === 0) {
    console.log('No locked atlas rows.');
  } else {
    // Bare text block — easy to drag-select and copy.
    const text = lockedAll.map(r => `${r.category}/${r.id}  →  stripped="${r.stripped}"`).join('\n');
    console.log(text);
    // Also expose as a global so the user can run `copy(QPM_GP_LOCKED)` in console.
    try {
      (window as { QPM_GP_LOCKED?: unknown }).QPM_GP_LOCKED = lockedAll;
      console.log('(also available as window.QPM_GP_LOCKED — run `copy(QPM_GP_LOCKED)` to copy as JSON)');
    } catch { /* sandbox isolation */ }
  }
  console.groupEnd();

  console.groupEnd();
  console.log(`Tip: paste the ALL LOCKED ATLAS ROWS block. I'll see which sprite-key shapes need a new strip rule. Total locked: ${lockedAll.length}`);
}

export function exposeGatingDiagnosticGlobal(): void {
  try {
    shareGlobal('QPM_GARDEN_PAINTER_GATING_DIAG', gardenPainterGatingDiag);
  } catch {
    // shareGlobal swallows its own errors; this is defence-in-depth.
  }
}
