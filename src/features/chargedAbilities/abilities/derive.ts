import {
  getPetAbilitiesCatalog,
  getPetCatalog,
  getMutation,
  getAllMutations,
  getItemCatalog,
} from '../../../catalogs/gameCatalogs';
import { computeSlotSellValue, valueIfMutationReplaced } from '../projection';
import { getAbilityCooldownRemainingMs } from '../liveCooldown';
import type { AbilityProjection } from './types';

const CHARGED_SUFFIX = 'charged';

const THEME_ACCENT_FALLBACK: Record<string, string> = {
  dawn: 'var(--qpm-dawn)',
  amber: 'var(--qpm-amber)',
  thunder: 'var(--qpm-gold)',
};

function isChargedVariant(mutationId: string): boolean {
  return mutationId.toLowerCase().endsWith(CHARGED_SUFFIX);
}

function themeOf(mutationId: string): string {
  const lower = mutationId.toLowerCase();
  if (lower.endsWith(CHARGED_SUFFIX)) return lower.slice(0, -CHARGED_SUFFIX.length);
  const stripped = lower.match(/^([a-z]+?)(lit|shine|struck|bound|glow|kiss|frost)$/);
  return stripped ? stripped[1]! : lower;
}

function findChargedVariantFor(baseMutation: string): string | null {
  const target = `${themeOf(baseMutation)}${CHARGED_SUFFIX}`;
  for (const id of getAllMutations()) {
    if (id.toLowerCase() === target) return id;
  }
  return null;
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

function findCapsuleSpriteKey(theme: string): string | null {
  const catalog = getItemCatalog();
  if (!catalog) return null;
  const target = `${theme}capsule`;
  for (const key of Object.keys(catalog)) {
    if (key.toLowerCase() === target) return `sprite/item/${key}`;
  }
  return null;
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

function readTargetMutations(bp: Record<string, unknown>): string[] {
  const raw = bp.targetMutations;
  if (!Array.isArray(raw)) return [];
  return raw.filter((m): m is string => typeof m === 'string');
}

export function deriveAllChargedAbilityProjections(): AbilityProjection[] {
  const abilities = getPetAbilitiesCatalog();
  if (!abilities) return [];

  const out: AbilityProjection[] = [];
  for (const [abilityId, def] of Object.entries(abilities)) {
    if (!def || def.trigger !== 'playerActivated') continue;

    const bp = (def.baseParameters && typeof def.baseParameters === 'object'
      ? def.baseParameters
      : {}) as Record<string, unknown>;
    const cooldownMs = readNumber(bp.cooldownSeconds, 300) * 1000;
    const targetMutations = readTargetMutations(bp);
    const abilityName = typeof def.name === 'string' && def.name.length > 0 ? def.name : abilityId;

    const chargedTargets = targetMutations.filter(isChargedVariant);
    const baseTargets = targetMutations.filter((m) => !isChargedVariant(m));
    const requiredSpecies = findCarriers(abilityId);

    const isCapture = chargedTargets.length > 0 && baseTargets.length > 0;
    const isCharger = baseTargets.length === 1 && chargedTargets.length === 0;
    if (!isCapture && !isCharger) continue;

    if (isCapture) {
      const targetSet = new Set(targetMutations.map((m) => m.toLowerCase()));
      const chargedSet = new Set(chargedTargets.map((m) => m.toLowerCase()));
      const theme = themeOf(chargedTargets[0]!);
      out.push({
        abilityId,
        abilityName,
        cooldownMs,
        targetMutations,
        requiredSpecies,
        replacementMutation: null,
        yieldKind: 'capsule',
        capsuleSpriteKey: findCapsuleSpriteKey(theme),
        accentColor: accentColorFor(def, chargedTargets[0] ?? null, theme),
        applies(slot) {
          return slot.mutations.some((m) => targetSet.has(m.toLowerCase()));
        },
        projectGain(slot) {
          let capsule = 0;
          for (const m of slot.mutations) {
            const lower = m.toLowerCase();
            if (!targetSet.has(lower)) continue;
            capsule += chargedSet.has(lower) ? 2 : 1;
          }
          return { coin: 0, capsule };
        },
        getCooldownRemainingMs(petSlotId) {
          return getAbilityCooldownRemainingMs(petSlotId, abilityId);
        },
      });
      continue;
    }

    const target = baseTargets[0]!;
    const targetLower = target.toLowerCase();
    const replacementMutation = findChargedVariantFor(target);
    const theme = themeOf(target);
    out.push({
      abilityId,
      abilityName,
      cooldownMs,
      targetMutations,
      requiredSpecies,
      replacementMutation,
      yieldKind: 'coin',
      capsuleSpriteKey: null,
      accentColor: accentColorFor(def, replacementMutation, theme),
      applies(slot) {
        return slot.mutations.some((m) => m.toLowerCase() === targetLower);
      },
      projectGain(slot) {
        if (!this.applies(slot)) return { coin: 0, capsule: 0 };
        const before = computeSlotSellValue(slot);
        const after = valueIfMutationReplaced(slot, target, replacementMutation);
        return { coin: Math.max(0, after - before), capsule: 0 };
      },
      getCooldownRemainingMs(petSlotId) {
        return getAbilityCooldownRemainingMs(petSlotId, abilityId);
      },
    });
  }

  return out;
}
