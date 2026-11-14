import type { DetailedWeather } from '../utils/game/weatherDetection';
import { getAbilityName } from '../utils/game/catalogHelpers';
import { getAbilityDefinition, type AbilityDefinition } from '../features/pets/data/petAbilities';
import type { ActivePetInfo } from './pets';
import { calculateXpStats, getCombinedXpStats, type XpAbilityStats } from './xpTracker';

// The game's passive pet XP rate: beta common/games/Quinoa/utils/pets.ts:176 `xpPerHour = 3600`.
export const PASSIVE_XP_PER_HOUR = 3600;

export interface TeamXpRates {
  stats: XpAbilityStats[];
  abilityXpPerHour: number;
  /** Passive + abilities at the current stage and weather. */
  liveTeamXpPerHour: number;
  /** Passive + the abilities' day average when every row has one, else the live rate. */
  planningTeamXpPerHour: number;
  totalProcsPerHour: number;
  totalProcCount: number;
}

function findXpAbilities(pet: ActivePetInfo): AbilityDefinition[] {
  if (!pet.abilities?.length) return [];
  return pet.abilities
    .map((id) => getAbilityDefinition(id))
    .filter((def): def is AbilityDefinition => def?.category === 'xp' && def.trigger === 'continuous');
}

export function computeTeamXpRates(pets: ActivePetInfo[], weather: DetailedWeather): TeamXpRates {
  const stats: XpAbilityStats[] = [];
  for (const pet of pets) {
    for (const def of findXpAbilities(pet)) {
      stats.push(calculateXpStats(pet, def, getAbilityName(def.id), weather));
    }
  }
  const combined = stats.length > 0 ? getCombinedXpStats(stats) : null;
  const abilityXpPerHour = combined?.totalXpPerHour ?? 0;
  return {
    stats,
    abilityXpPerHour,
    liveTeamXpPerHour: PASSIVE_XP_PER_HOUR + abilityXpPerHour,
    planningTeamXpPerHour: PASSIVE_XP_PER_HOUR + (combined?.totalDayAverageXpPerHour ?? abilityXpPerHour),
    totalProcsPerHour: combined?.totalProcsPerHour ?? 0,
    totalProcCount: combined?.totalProcCount ?? 0,
  };
}

export interface XpProgress {
  xp: number;
  strength: number;
  maxStr: number;
  xpPerLevel: number;
}

/** XP still needed to reach max STR; null at or above max or when xpPerLevel is unusable. */
export function xpToMaxStr(p: XpProgress): number | null {
  if (!(p.xpPerLevel > 0) || p.strength >= p.maxStr) return null;
  const xpIntoLevel = p.xp % p.xpPerLevel;
  return (p.xpPerLevel - xpIntoLevel) + p.xpPerLevel * (p.maxStr - p.strength - 1);
}

/** Minutes to max STR at `xpPerHour`; null when already max or the rate is not positive. */
export function minutesToMaxStr(p: XpProgress, xpPerHour: number): number | null {
  const needed = xpToMaxStr(p);
  if (needed === null || !(xpPerHour > 0)) return null;
  return (needed / xpPerHour) * 60;
}
