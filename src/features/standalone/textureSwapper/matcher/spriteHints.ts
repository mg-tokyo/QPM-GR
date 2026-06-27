import type { SpriteVariantInfo } from '../types';
import { parseVariantInfoFromLabel } from './variants';
import { normalizeSpriteKeyCandidate } from './keys';

// ---------------------------------------------------------------------------
// Sprite node introspection
// ---------------------------------------------------------------------------

export function extractSpriteNodeSpriteKeys(sprite: any): string[] {
  const out = new Set<string>();
  const add = (candidate: unknown) => {
    const normalized = normalizeSpriteKeyCandidate(candidate);
    if (normalized) out.add(normalized.toLowerCase());
  };
  add(sprite?.label);
  add(sprite?._label);
  add(sprite?.name);
  add(sprite?.parent?.label);
  add(sprite?.parent?._label);
  return [...out];
}

export function extractSpriteHintStrings(sprite: any, maxDepth = 8): string[] {
  const out = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (!trimmed) return;
    out.add(trimmed);
  };
  let cur: any = sprite;
  let depth = 0;
  while (cur && depth <= maxDepth) {
    add(cur?.label);
    add(cur?._label);
    add(cur?.name);
    add(cur?.type);
    cur = cur.parent;
    depth++;
  }
  return [...out];
}

/**
 * Closest-identity hint strings — the labels that identify what THIS sprite
 * is, not what container hierarchy it sits in. Used by live-overlay rules
 * to prevent a parent container's rule from cascading onto sibling sprites
 * (e.g. a crop sitting inside a platform's container).
 *
 * Lookup order, returning the FIRST level that yields any hints:
 *   1. The sprite's own texture labels (e.g. "DawnCelestialCrop") — these
 *      identify the actual rendered asset and are the most reliable.
 *   2. The sprite's own sprite-level labels (label / _label / name / type).
 *   3. Walking up ancestors, returning the first ancestor with any label.
 *
 * Steps 2 and 3 use a "non-generic" filter — labels like "Crop" / "Plant" /
 * "Sprite" / "World" are container types, not entity identities, so we walk
 * past them. An ancestor's labels qualify as identity only if at least one
 * looks like a CamelCase entity name (length > 6, has a lower-then-upper
 * letter transition). This means a crop sprite inside a "Crop" container
 * inside a "DawnCelestialCrop" container resolves to the celestial label,
 * which is what we want — but stops there and doesn't reach the platform
 * container above.
 */
export function extractSpriteClosestLabelHints(sprite: any, maxDepth = 12): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (value: unknown): boolean => {
    if (typeof value !== 'string') return false;
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) return false;
    seen.add(trimmed);
    out.push(trimmed);
    return true;
  };

  // 1. Texture labels: most authoritative. A sprite displaying a
  //    "DawnCelestialCrop" texture IS a DawnCelestialCrop regardless of what
  //    container it sits in.
  const tex = sprite?.texture;
  if (tex) {
    add(tex.label);
    add(tex._label);
    const ids = tex.textureCacheIds;
    if (Array.isArray(ids)) for (const id of ids) add(id);
    add(tex?.source?.label);
    add(tex?.source?.resource?.url);
    add(tex?.source?.resource?.src);
  }
  if (out.length > 0) return out;

  // 2-3. Walk up ancestors; return the first ancestor whose labels look like
  //      an entity identity. Generic container labels are skipped.
  let cur: any = sprite;
  let depth = 0;
  while (cur && depth <= maxDepth) {
    const candidates: string[] = [];
    for (const v of [cur?.label, cur?._label, cur?.name, cur?.type]) {
      if (typeof v === 'string') {
        const trimmed = v.trim();
        if (trimmed) candidates.push(trimmed);
      }
    }
    if (candidates.some((c) => looksLikeEntityLabel(c))) {
      for (const c of candidates) add(c);
      return out;
    }
    cur = cur.parent;
    depth++;
  }
  return out;
}

/**
 * Container labels that pass the CamelCase heuristic below but don't actually
 * identify a game entity — they're wrapper classes added by the game's render
 * code. Skipping them lets the closest-label walk climb to a real species
 * label one level up.
 *
 * Verified live (2026-06-25): crop sprites sit inside a `CropVisual` container
 * whose parent is the species-bearing `${species} slot-N` container. Without
 * this skip the walk stops at `CropVisual` and no rule can identify the crop.
 */
const GENERIC_NON_ENTITY_LABELS = new Set<string>([
  'CropVisual',
]);

/**
 * True for labels that look like entity identities (e.g. "DawnCelestialCrop",
 * "MoonCelestialPlatform") rather than generic container types ("Crop",
 * "Plant", "Sprite", "World"). Heuristic: long enough to encode a
 * compound name, and contains a lower-then-upper transition (CamelCase).
 */
function looksLikeEntityLabel(label: string): boolean {
  if (label.length <= 6) return false;
  if (GENERIC_NON_ENTITY_LABELS.has(label)) return false;
  return /[a-z][A-Z]/.test(label);
}

/**
 * True when the hint contains the `${species} slot-` prefix produced by
 * GrowingCropVisual's container label. Used by live-overlay crop rules to
 * identify any crop slot of their species without species-stripping fallback
 * (which would cascade onto plant rules sharing the same species).
 */
export function hintMentionsSlotForSpecies(hint: string, speciesLower: string): boolean {
  if (!speciesLower) return false;
  return hint.toLowerCase().includes(`${speciesLower} slot-`);
}

/**
 * Parse the slot index out of a `${species} slot-N` hint. Returns null when
 * the hint doesn't contain the pattern or the species doesn't match. Used by
 * the optional per-slot-index gate on crop rules.
 */
export function parseSlotIndexFromHint(hint: string, speciesLower: string): number | null {
  if (!speciesLower) return null;
  const escaped = speciesLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|[^a-z0-9])${escaped} slot-(\\d+)`, 'i');
  const m = re.exec(hint);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Decode a GrowingCropVisual container label into its species + slot index.
 *
 * The game's `GrowingCropVisual` constructs `new Container({ label:
 * \`${species} slot-${slotIndex}\` })` where `species` is the parent flora's
 * FloraSpeciesId — i.e. the PLANT species, NOT the crop. This means any
 * sprite whose closest entity-like ancestor matches this pattern is a CROP
 * sitting in that plant's harvest container, not the plant itself.
 *
 * Returns `null` when the hint is not a slot label. The returned
 * `plantSpeciesLower` is always lowercase; callers compare against rule
 * species roots, which are themselves lowercased at registration time.
 *
 * Verified live (2026-06-25) against beta sources:
 *   scraped-data/BetaGameSourceFiles/DawnPets/.../GrowingCropVisual.ts:165
 *   scraped-data/BetaGameSourceFiles/MagicDust&PetHutchUpgradesLATEST/.../GrowingCropVisual.ts:165
 */
export function parseSlotContainerHint(hint: unknown): { plantSpeciesLower: string; slotIndex: number } | null {
  if (typeof hint !== 'string') return null;
  const m = /^(.+?)\s+slot-?(\d+)\s*$/i.exec(hint.trim());
  if (!m) return null;
  const plantSpeciesLower = m[1]!.trim().toLowerCase();
  if (!plantSpeciesLower) return null;
  const slotIndex = Number(m[2]);
  if (!Number.isFinite(slotIndex)) return null;
  return { plantSpeciesLower, slotIndex };
}

export function extractVariantInfoFromSpriteNode(sprite: any): SpriteVariantInfo | null {
  const candidates = [
    sprite?.label,
    sprite?._label,
    sprite?.name,
    sprite?.parent?.label,
    sprite?.parent?._label,
    sprite?.parent?.name,
  ];
  for (const raw of candidates) {
    const parsed = parseVariantInfoFromLabel(raw);
    if (parsed) return parsed;
  }
  return null;
}
