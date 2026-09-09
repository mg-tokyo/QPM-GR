import {
  getAbilityDef,
  getAllAbilities,
  onPetAbilitiesCaptured,
} from '../../../../catalogs/gameCatalogs';

// v1118 flat-Size shape: {sizeIncrease: N}. STR does NOT scale the effect.
// Legacy pre-v1118 percent shape: {scaleIncreasePercentage: N}. STR scales.
// Kept as separate sets so future game rebalances only edit these constants.
export const FLAT_SIZE_KEYS: ReadonlySet<string> = new Set(['sizeIncrease']);
export const PERCENT_SIZE_KEYS: ReadonlySet<string> = new Set(['scaleIncreasePercentage']);

export type SizeBoostShape =
  | { kind: 'flatSize'; amountPerProc: number; strengthScalesEffect: false }
  | { kind: 'scalePercent'; percentPerProc: number; strengthScalesEffect: true };

function toFinitePositive(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

export function classifySizeBoostAbility(abilityId: string): SizeBoostShape | null {
  const entry = getAbilityDef(abilityId);
  if (!entry) return null;
  const params = entry.baseParameters;
  if (!params || typeof params !== 'object') return null;

  for (const key of FLAT_SIZE_KEYS) {
    if (!(key in params)) continue;
    const amount = toFinitePositive((params as Record<string, unknown>)[key]);
    if (amount == null) continue;
    return { kind: 'flatSize', amountPerProc: amount, strengthScalesEffect: false };
  }

  for (const key of PERCENT_SIZE_KEYS) {
    if (!(key in params)) continue;
    const percent = toFinitePositive((params as Record<string, unknown>)[key]);
    if (percent == null) continue;
    return { kind: 'scalePercent', percentPerProc: percent, strengthScalesEffect: true };
  }

  return null;
}

export function isSizeBoostAbility(abilityId: string): boolean {
  return classifySizeBoostAbility(abilityId) !== null;
}

let cachedIds: string[] | null = null;
let cacheSubscribed = false;

function ensureSubscription(): void {
  if (cacheSubscribed) return;
  cacheSubscribed = true;
  // Persistent listener — fires on every capture/upgrade/top-up.
  onPetAbilitiesCaptured(() => { cachedIds = null; });
}

export function getAllSizeBoostAbilityIds(): readonly string[] {
  if (cachedIds) return cachedIds;
  ensureSubscription();
  const ids = getAllAbilities();
  const out: string[] = [];
  for (const id of ids) {
    if (classifySizeBoostAbility(id) !== null) out.push(id);
  }
  cachedIds = out;
  return out;
}
