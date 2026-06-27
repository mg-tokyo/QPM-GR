import { normalizeSpeciesMatchKey } from '../types';
import type { PlantSpriteContext } from '../types';
import { extractMutationNames } from './variants';

// ---------------------------------------------------------------------------
// Plant context extraction
// ---------------------------------------------------------------------------

function collectSpeciesNamesFromObject(obj: any, out: Set<string>): void {
  if (!obj || typeof obj !== 'object') return;
  const add = (value: unknown) => {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (!trimmed) return;
    out.add(trimmed.toLowerCase());
  };

  add(obj.species);
  add(obj.speciesId);
  add(obj.speciesName);
  add(obj.petSpecies);
  add(obj.cropSpecies);
  add(obj.floraSpecies);

  const nested = [
    obj.tileObject,
    obj.data,
    obj.model,
    obj.state,
    obj.props,
    obj.entity,
  ];
  for (const child of nested) {
    if (!child || typeof child !== 'object') continue;
    add((child as any).species);
    add((child as any).speciesId);
    add((child as any).speciesName);
  }
}

export function extractAncestorSpeciesHints(sprite: any, maxDepth = 7): string[] {
  const out = new Set<string>();
  let cur: any = sprite;
  let depth = 0;
  while (cur && depth <= maxDepth) {
    collectSpeciesNamesFromObject(cur, out);
    cur = cur.parent;
    depth++;
  }
  return [...out];
}

function parsePlantContextFromCandidate(obj: any): PlantSpriteContext | null {
  if (!obj || typeof obj !== 'object') return null;

  const directSpecies = normalizeSpeciesMatchKey(
    obj.species ?? obj.speciesId ?? obj.speciesName ?? obj.seedSpecies ?? obj.plantSpecies,
  );
  const directMutations = extractMutationNames(obj.mutations);
  const directObjectType = typeof obj.objectType === 'string' ? obj.objectType.toLowerCase() : '';
  const looksLikeSlot =
    Array.isArray(obj.mutations)
    || Number.isFinite(Number(obj.startTime))
    || Number.isFinite(Number(obj.endTime))
    || Number.isFinite(Number(obj.targetScale));
  if (directSpecies && (directMutations.length > 0 || directObjectType.includes('plant') || looksLikeSlot)) {
    return {
      speciesKey: directSpecies,
      mutations: directMutations,
    };
  }

  const slotsRaw = Array.isArray(obj.slots) ? obj.slots : [];
  const slotSpecies: string[] = [];
  const slotMutations: string[][] = [];
  for (const slot of slotsRaw) {
    if (!slot || typeof slot !== 'object') continue;
    const species = normalizeSpeciesMatchKey(
      (slot as any).species
      ?? (slot as any).speciesId
      ?? (slot as any).speciesName
      ?? (slot as any).seedSpecies
      ?? (slot as any).plantSpecies,
    );
    if (!species) continue;
    slotSpecies.push(species);
    slotMutations.push(extractMutationNames((slot as any).mutations));
  }

  const tileSpecies = directSpecies || slotSpecies[0] || '';
  if (!tileSpecies) return null;
  const mutations = slotMutations.find((list) => list.length > 0) ?? slotMutations[0] ?? [];
  return {
    speciesKey: tileSpecies,
    mutations,
  };
}

export function extractPlantContextFromSprite(
  sprite: any,
  memo: WeakMap<object, PlantSpriteContext | null>,
  maxDepth = 18,
): PlantSpriteContext | null {
  if (!sprite || typeof sprite !== 'object') return null;
  const cached = memo.get(sprite as object);
  if (cached !== undefined) return cached;

  let cur: any = sprite;
  let depth = 0;
  let found: PlantSpriteContext | null = null;
  while (cur && depth <= maxDepth) {
    const candidates = [
      cur,
      cur.tileObject,
      cur.data,
      cur.model,
      cur.state,
      cur.props,
      cur.entity,
      cur.slot,
      cur.viewModel,
      cur.userData,
    ];
    for (const candidate of candidates) {
      const parsed = parsePlantContextFromCandidate(candidate);
      if (parsed) {
        found = parsed;
        break;
      }
    }
    if (found) break;
    cur = cur.parent;
    depth++;
  }

  memo.set(sprite as object, found);
  return found;
}
