import {
  normalizeSpeciesMatchKey,
  KNOWN_MUTATION_CANONICAL,
  KNOWN_MUTATION_ALIASES,
} from '../types';
import type { SpriteVariantInfo } from '../types';
import { normalizeSpriteKeyCandidate } from './keys';

// ---------------------------------------------------------------------------
// Variant / mutation parsing
// ---------------------------------------------------------------------------

function parseMutationsFromVariantSig(sig: string): string[] {
  const trimmed = sig.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('M:')) {
    const selected = trimmed.slice(2).split('|')[0] ?? '';
    return selected.split(',').map((value) => value.trim()).filter(Boolean);
  }
  if (trimmed.startsWith('F:')) {
    const filter = trimmed.slice(2).trim();
    return filter ? [filter] : [];
  }
  return [];
}

export function parseVariantInfoFromLabel(raw: unknown): SpriteVariantInfo | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  const split = value.indexOf('|');
  if (split <= 0) return null;
  const baseKey = normalizeSpriteKeyCandidate(value.slice(0, split));
  if (!baseKey) return null;
  const sig = value.slice(split + 1).trim();
  return {
    baseKey,
    sig,
    mutations: parseMutationsFromVariantSig(sig),
  };
}

function canonicalMutationName(raw: string): string | null {
  const key = normalizeSpeciesMatchKey(raw);
  if (!key) return null;
  return KNOWN_MUTATION_ALIASES[key] ?? null;
}

const SORTED_MUTATION_PREFIXES = [...new Set([...KNOWN_MUTATION_CANONICAL, ...Object.keys(KNOWN_MUTATION_ALIASES)])]
  .map((m) => m.toLowerCase())
  .sort((a, b) => b.length - a.length);

function parseMutationPrefixedSpecies(rawId: string): { speciesKey: string; mutations: string[] } | null {
  let rest = normalizeSpeciesMatchKey(rawId);
  if (!rest) return null;
  const mutations: string[] = [];
  const sortedPrefixes = SORTED_MUTATION_PREFIXES;

  let changed = true;
  while (changed) {
    changed = false;
    for (const prefix of sortedPrefixes) {
      if (rest.startsWith(prefix)) {
        const canonical = KNOWN_MUTATION_ALIASES[prefix] ?? prefix;
        if (!mutations.includes(canonical)) mutations.push(canonical);
        rest = rest.slice(prefix.length);
        changed = true;
        break;
      }
    }
  }
  if (!rest || mutations.length === 0) return null;
  return { speciesKey: rest, mutations };
}

export function extractMutationPrefixedPlantMatchFromKey(
  spriteKey: string,
): { speciesKey: string; mutations: string[] } | null {
  const normalized = normalizeSpriteKeyCandidate(spriteKey);
  if (!normalized) return null;
  const { id } = (() => {
    const parts = normalized.split('/').filter(Boolean);
    const start = parts[0] === 'sprite' ? 1 : 0;
    return { id: parts.slice(start + 1).join('/') };
  })();
  return parseMutationPrefixedSpecies(id);
}

export function extractMutationNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((v) => canonicalMutationName(String(v ?? '')))
    .filter((v): v is string => !!v);
}
