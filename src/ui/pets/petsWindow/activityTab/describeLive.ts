import { t } from '../../../../i18n';
import { getAbilityDescriptionSafe, getAbilityName, getEggSafe, getMutationName, getPetSafe, getPlantSafe } from '../../../../utils/game/catalogHelpers';
import { formatCoins } from '../../../../utils/formatters';
import type { DescribeDeps } from './describe';

function durationSec(sec: number): string {
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}
export const liveDescribeDeps: DescribeDeps = {
  t: (key, vars) => t(key, vars),
  abilityName: getAbilityName,
  abilityDescription: getAbilityDescriptionSafe,
  mutationName: getMutationName,
  cropName: (s) => getPlantSafe(s)?.crop.name ?? s,
  petSpeciesName: (s) => getPetSafe(s)?.name ?? s,
  eggName: (id) => getEggSafe(id)?.name ?? id,
  seedName: (s) => getPlantSafe(s)?.seed.name ?? s,
  formatCoins,
  formatDurationSec: durationSec,
};
