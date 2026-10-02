import { getAbilityDef, getWeatherDef } from '../../catalogs/gameCatalogs';
import { t } from '../../i18n';
import { getWeatherSnapshot } from '../../store/weatherHub';
import type { AbilityDefinition } from './data/petAbilities';

export function isRequiredWeatherActive(requirement: AbilityDefinition['requiredWeather'] | null): boolean {
  if (!requirement) return true;
  return getWeatherSnapshot().kind === requirement;
}

// Game wording `Not {requiredWeatherName}` uses weatherCatalog[baseParameters.requiredWeather].name
// (Frost → "Snow"), v1361 DraftedItemsChip.
function getRequiredWeatherName(abilityId: string): string | null {
  const raw = getAbilityDef(abilityId)?.baseParameters?.['requiredWeather'];
  if (typeof raw !== 'string' || !raw) return null;
  const name = getWeatherDef(raw)?.name;
  return typeof name === 'string' && name ? name : raw;
}

/** "Not {weather}" while a weather-gated ability's weather is inactive; null when ungated or active. */
export function getInactiveWeatherLabel(definition: AbilityDefinition): string | null {
  if (isRequiredWeatherActive(definition.requiredWeather ?? null)) return null;
  const weather = getRequiredWeatherName(definition.id);
  return weather ? t('feature.abilityTracker.notWeather', { weather }) : t('feature.abilityTracker.inactive');
}
