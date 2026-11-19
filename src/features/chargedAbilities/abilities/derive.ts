import {
  getPetAbilitiesCatalog,
  getPetCatalog,
  getMutation,
  getItemCatalog,
} from '../../../catalogs/gameCatalogs';
import { getChargedAbilityRules } from '../../../catalogs/logic/chargedAbilityRulesCatalog';
import type { CaptureRule, ChargerRule } from '../../../catalogs/logic/chargedAbilityRulesCatalog';
import { getMutationApplicationResult } from '../../../utils/mutationCompatibility';
import { computeSlotSellValue } from '../projection';
import { getAbilityCooldownRemainingMs } from '../liveCooldown';
import { ABILITY_FOOTPRINT_RADIUS } from '../constants';
import type { AbilityProjection, PlantSlotMinimal } from './types';

const CHARGED_SUFFIX = 'charged';

const THEME_ACCENT_FALLBACK: Record<string, string> = {
  dawn: 'var(--qpm-dawn)',
  amber: 'var(--qpm-amber)',
  thunder: 'var(--qpm-gold)',
};

function themeOf(mutationId: string): string {
  const lower = mutationId.toLowerCase();
  if (lower.endsWith(CHARGED_SUFFIX)) return lower.slice(0, -CHARGED_SUFFIX.length);
  const stripped = lower.match(/^([a-z]+?)(lit|shine|struck|bound|glow|kiss|frost)$/);
  return stripped ? stripped[1]! : lower;
}

function readAbilityAccentBg(def: unknown): string | null {
  if (!def || typeof def !== 'object') return null;
  const color = (def as Record<string, unknown>).color;
  if (!color || typeof color !== 'object') return null;
  const bg = (color as Record<string, unknown>).bg;
  return typeof bg === 'string' && bg.length > 0 ? bg : null;
}

function accentColorFor(
  def: unknown,
  chargedMutationId: string | null,
  theme: string,
): string {
  const abilityBg = readAbilityAccentBg(def);
  if (abilityBg) return abilityBg;
  if (chargedMutationId) {
    const color = getMutation(chargedMutationId)?.color;
    if (typeof color === 'string' && color.length > 0) return color;
  }
  return THEME_ACCENT_FALLBACK[theme] ?? 'var(--qpm-gold)';
}

function capsuleSpriteKeyFor(capsuleToolId: string): string | null {
  const catalog = getItemCatalog();
  return catalog && Object.prototype.hasOwnProperty.call(catalog, capsuleToolId)
    ? `sprite/item/${capsuleToolId}`
    : null;
}

function findCarriers(abilityId: string): string[] {
  const catalog = getPetCatalog();
  if (!catalog) return [];
  const carriers: string[] = [];
  for (const [species, entry] of Object.entries(catalog)) {
    const weights = entry?.innateAbilityWeights;
    if (weights && typeof weights === 'object' && abilityId in weights) {
      carriers.push(species);
    }
  }
  return carriers;
}

function readNumber(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

type ProjectionBase = Pick<AbilityProjection, 'abilityId' | 'abilityName' | 'cooldownMs' | 'tileRadius' | 'requiredSpecies' | 'getCooldownRemainingMs'>;

function baseFor(abilityId: string, def: { name?: unknown; baseParameters?: unknown }): ProjectionBase {
  const bp = (def.baseParameters && typeof def.baseParameters === 'object'
    ? def.baseParameters
    : {}) as Record<string, unknown>;
  return {
    abilityId,
    abilityName: typeof def.name === 'string' && def.name.length > 0 ? def.name : abilityId,
    cooldownMs: readNumber(bp.cooldownSeconds, 300) * 1000,
    tileRadius: readNumber(bp.tileRadius, ABILITY_FOOTPRINT_RADIUS),
    requiredSpecies: findCarriers(abilityId),
    getCooldownRemainingMs(petSlotId) {
      return getAbilityCooldownRemainingMs(petSlotId, abilityId);
    },
  };
}

// Game rule (beta utils/chargedAbilityProjections.ts:134-144,157-163): an unpreserved crop is a target
// when the capture removes at least one of its mutations; each removed mutation yields its table count.
function captureProjection(rule: CaptureRule, def: object, base: ProjectionBase): AbilityProjection {
  const yields = rule.capsulesByMutation;
  const targetMutations = Object.keys(yields);
  let colourMutation: string | null = null;
  for (const m of targetMutations) {
    if (colourMutation === null || (yields[m] ?? 0) > (yields[colourMutation] ?? 0)) colourMutation = m;
  }
  const theme = colourMutation ? themeOf(colourMutation) : '';
  const yieldOf = (m: string): number => (Object.prototype.hasOwnProperty.call(yields, m) ? yields[m] ?? 0 : 0);
  return {
    ...base,
    targetMutations,
    replacementMutation: null,
    yieldKind: 'capsule',
    capsuleSpriteKey: capsuleSpriteKeyFor(rule.capsuleToolId),
    accentColor: accentColorFor(def, colourMutation, theme),
    applies(slot) {
      return !slot.preserved && slot.mutations.some((m) => Object.prototype.hasOwnProperty.call(yields, m));
    },
    projectGain(slot) {
      if (slot.preserved) return { coin: 0, capsule: 0 };
      let capsule = 0;
      for (const m of slot.mutations) capsule += yieldOf(m);
      return { coin: 0, capsule };
    },
  };
}

// Game rule (beta :325-330): `includes(target) ? updateMutationList(replacement, list) ?? null : null`.
function chargedMutations(rule: ChargerRule, slot: PlantSlotMinimal): string[] | null {
  if (slot.preserved || !slot.mutations.includes(rule.target)) return null;
  return getMutationApplicationResult(slot.mutations, rule.replacement);
}

function chargerProjection(rule: ChargerRule, def: object, base: ProjectionBase): AbilityProjection {
  return {
    ...base,
    targetMutations: [rule.target],
    replacementMutation: rule.replacement,
    yieldKind: 'coin',
    capsuleSpriteKey: null,
    accentColor: accentColorFor(def, rule.replacement, themeOf(rule.target)),
    applies(slot) {
      return chargedMutations(rule, slot) !== null;
    },
    projectGain(slot) {
      const after = chargedMutations(rule, slot);
      if (!after) return { coin: 0, capsule: 0 };
      const gain = computeSlotSellValue({ ...slot, mutations: after }) - computeSlotSellValue(slot);
      return { coin: Math.max(0, gain), capsule: 0 };
    },
  };
}

/** Projections for every charged ability the game's rules name (REL-8 D1, D4); none while the rules are unread. */
export function deriveAllChargedAbilityProjections(): AbilityProjection[] {
  const rules = getChargedAbilityRules();
  const abilities = getPetAbilitiesCatalog();
  if (!rules || !abilities) return [];

  const out: AbilityProjection[] = [];
  for (const rule of rules.captures) {
    const def = abilities[rule.abilityId];
    if (def) out.push(captureProjection(rule, def, baseFor(rule.abilityId, def)));
  }
  for (const rule of rules.chargers) {
    const def = abilities[rule.abilityId];
    if (def) out.push(chargerProjection(rule, def, baseFor(rule.abilityId, def)));
  }
  return out;
}
