// src/features/journalGuard.ts
// Pre-sell journal variant detection: auto-sends LogItems for unlogged pet variants.

import { getJournal, type Journal } from './checker';
import { getPetMaxScale } from '../../catalogs/gameCatalogs';
import { sendRoomAction } from '../../websocket/api';
import { notify } from '../../core/notifications';
import { log } from '../../utils/logger';

export interface PetVariantInfo {
  species: string | null;
  mutations: string[];
  targetScale: number | null;
}

const THROTTLE_MS = 1000;
let lastLogItemsAt = 0;

function getLoggedVariants(journal: Journal, species: string): Set<string> {
  const entry = journal.pets?.[species];
  if (!entry?.variantsLogged) return new Set();
  return new Set(entry.variantsLogged.map((v) => v.variant));
}

function petHasUnloggedVariants(pet: PetVariantInfo, journal: Journal): boolean {
  if (!pet.species) return false;
  const logged = getLoggedVariants(journal, pet.species);

  // 1. Mutation variant: pet has a mutation not yet logged
  for (const mutation of pet.mutations) {
    if (!logged.has(mutation)) return true;
  }

  // 2. Normal: pet has NO mutations and 'Normal' not logged
  if (pet.mutations.length === 0 && !logged.has('Normal')) return true;

  // 3. Max Weight: targetScale >= maxScale and 'Max Weight' not logged
  if (pet.targetScale != null && !logged.has('Max Weight')) {
    const maxScale = getPetMaxScale(pet.species);
    if (maxScale != null && pet.targetScale >= maxScale) return true;
  }

  return false;
}

/**
 * Check pets for unlogged journal variants and send LogItems if any found.
 * Returns true if LogItems was sent; false otherwise. Never throws.
 */
export async function ensureJournalLogged(pets: PetVariantInfo[]): Promise<boolean> {
  try {
    if (!pets.length) return false;

    const journal = await getJournal();
    if (!journal) return false;

    const unlogged: PetVariantInfo[] = [];
    for (const pet of pets) {
      if (petHasUnloggedVariants(pet, journal)) unlogged.push(pet);
    }
    if (!unlogged.length) return false;

    // Throttle to prevent duplicate LogItems during rapid sells
    const now = Date.now();
    if (now - lastLogItemsAt < THROTTLE_MS) return false;
    lastLogItemsAt = now;

    const result = sendRoomAction('LogItems', {}, { throttleMs: 0, skipThrottle: true });
    if (!result.ok) {
      log('[journalGuard] LogItems send failed', result.reason);
      return false;
    }

    const speciesNames = [...new Set(
      unlogged.map((p) => p.species).filter((s): s is string => s != null),
    )];
    const label = speciesNames.length > 0
      ? ` (${speciesNames.join(', ')})`
      : '';
    notify({
      feature: 'journalGuard',
      level: 'info',
      message: `Auto-logged ${unlogged.length} pet variant(s) before sell${label}`,
    });

    return true;
  } catch (error) {
    log('[journalGuard] ensureJournalLogged failed', error);
    return false;
  }
}
