import { getAbilityDef, getAllAbilities } from '../../../../catalogs/gameCatalogs';
import { getAbilityDefinition } from './catalogAdapter';
import { getAbilityFamilyKey } from '../../compare/families';

const HIGH_VALUE_OVERRIDES = new Set(['RainDance', 'PetXpBoost', 'ProduceScaleBoost', 'PetHatchSizeBoost', 'DoubleHatch', 'DoubleHatchII', 'ProduceRefund', 'DawnbinderBoost', 'ThunderstruckGranter']);
const LOW_VALUE_OVERRIDES = new Set(['ProduceEater']);

export function getAbilityTier(abilityId: string): 1 | 2 | 3 | 4 | null {
  const match = abilityId.match(/(IV|III|II|I)(?:_NEW)?$/i);
  const tier = match?.[1]?.toUpperCase();
  if (tier === 'IV') return 4;
  if (tier === 'III') return 3;
  if (tier === 'II') return 2;
  if (tier === 'I') return 1;
  return null;
}

function params(abilityId: string): Record<string, unknown> {
  const entry = getAbilityDef(abilityId);
  return entry?.baseParameters && typeof entry.baseParameters === 'object' ? entry.baseParameters : {};
}

export function getAbilityFamilySiblings(abilityId: string): string[] {
  const family = getAbilityFamilyKey(abilityId).toLowerCase();
  return getAllAbilities().filter((id) => id !== abilityId && getAbilityFamilyKey(id).toLowerCase() === family);
}

export function isHighValueAbility(abilityId: string): boolean {
  const def = getAbilityDefinition(abilityId);
  if (!def) return false;
  const id = def.id;
  if (HIGH_VALUE_OVERRIDES.has(id)) return true;
  const p = params(id);
  if (def.trigger === 'playerActivated' || def.trigger === 'harvest') return true;
  if (Array.isArray(p['grantedMutations']) || typeof p['requiredWeather'] === 'string' || def.requiredWeather) return true;
  return (getAbilityTier(id) ?? 0) >= 2;
}

export function isLowValueAbility(abilityId: string): boolean {
  const def = getAbilityDefinition(abilityId);
  if (!def) return false;
  const id = def.id;
  if (LOW_VALUE_OVERRIDES.has(id)) return true;
  const p = params(id);
  if (def.trigger === 'playerActivated' || def.trigger === 'harvest') return false;
  if (Array.isArray(p['grantedMutations']) || typeof p['requiredWeather'] === 'string' || def.requiredWeather) return false;
  const tier = getAbilityTier(id);
  if (tier === 1) return true;
  if (tier === null) return getAbilityFamilySiblings(id).some((sibling) => (getAbilityTier(sibling) ?? 0) >= 2);
  return false;
}

export function getSpecialAbilityScore(abilityId: string, table: Record<string, number>): number | null {
  if (abilityId in table) return table[abilityId] ?? null;
  const p = params(abilityId);
  const def = getAbilityDef(abilityId);
  if (Array.isArray(p['grantedMutations']) || def?.trigger === 'playerActivated') return 85;
  return null;
}
