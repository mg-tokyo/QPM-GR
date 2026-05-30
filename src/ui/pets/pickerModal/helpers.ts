// src/ui/petPickerModal/helpers.ts
// Shared utility functions for the pet picker modal.

import { getPetSpriteDataUrlWithMutations, isSpritesReady } from '../../../sprite-v2/compat';
import { getPetMetadata } from '../../../features/pets/data/petMetadata';
import { getAbilityDefinition } from '../../../features/pets/data/petAbilities';
import { COMMON_SPECIES, UNCOMMON_SPECIES, RARE_SPECIES, LEGENDARY_SPECIES, MYTHICAL_SPECIES } from '../../../features/pets/optimizer/constants';
import { RARITY_ORD } from './constants';
import type { MutationTier } from './types';
import type { PooledPet } from '../../../types/petTeams';

// ---------------------------------------------------------------------------
// Mutation tier helpers
// ---------------------------------------------------------------------------

export function getMutationTier(mutations: string[]): MutationTier {
  if (mutations.some(m => /rainbow/i.test(m))) return 'rainbow';
  if (mutations.some(m => /gold(?:en)?/i.test(m))) return 'gold';
  if (mutations.length > 0) return 'mutated';
  return 'none';
}

export function getTierLabel(tier: MutationTier): string {
  switch (tier) {
    case 'rainbow': return '🌈';
    case 'gold': return '⭐';
    case 'mutated': return '✨';
    default: return '';
  }
}

export function getSpeciesRarityOrd(species: string): number {
  const meta = getPetMetadata(species);
  if (meta?.rarity) return RARITY_ORD[meta.rarity.toLowerCase()] ?? 0;
  if (MYTHICAL_SPECIES.has(species)) return 5;
  if (LEGENDARY_SPECIES.has(species)) return 4;
  if (RARE_SPECIES.has(species)) return 3;
  if (UNCOMMON_SPECIES.has(species)) return 2;
  if (COMMON_SPECIES.has(species)) return 1;
  return 0;
}

export function getLocationLabel(location: PooledPet['location']): string {
  switch (location) {
    case 'active': return 'Active';
    case 'hutch': return 'Hutch';
    default: return 'Bag';
  }
}

// ---------------------------------------------------------------------------
// Sprite helpers
// ---------------------------------------------------------------------------

export function getSpriteSrc(species: string, mutations: string[]): string | null {
  if (!isSpritesReady()) return null;
  return getPetSpriteDataUrlWithMutations(species, mutations) ?? null;
}

// ---------------------------------------------------------------------------
// Ability display helpers
// ---------------------------------------------------------------------------

export function getAbilityCanonicalId(value: string): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return getAbilityDefinition(raw)?.id ?? raw;
}

export function getAbilityDisplayName(value: string): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return getAbilityDefinition(raw)?.name ?? raw;
}

export function stripTierSuffix(value: string): string {
  return value
    .trim()
    .replace(/\s+(?:IV|III|II|I)$/i, '')
    .replace(/\s+[1-4]$/i, '')
    .trim();
}

// ---------------------------------------------------------------------------
// Bar renderer helper
// ---------------------------------------------------------------------------

export function makeFilledBar(value: number, max: number, color: string): string {
  const TOTAL_BLOCKS = 10;
  const filled = Math.round((value / Math.max(max, 1)) * TOTAL_BLOCKS);
  const empty = TOTAL_BLOCKS - filled;
  return `<span style="color:${color};">${'█'.repeat(Math.max(0, filled))}${'░'.repeat(Math.max(0, empty))}</span> ${value} / ${max}`;
}
