import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AbilityDefinition } from './data/petAbilities';

let weatherKind = 'sunny';
const abilityParams: Record<string, Record<string, unknown>> = {
  ThunderCoinFinder: { baseMaxCoinsFindable: 5500000, requiredWeather: 'Thunderstorm' },
  SnowyCoinFinder: { baseMaxCoinsFindable: 5000000, requiredWeather: 'Frost' },
  MysteryBoost: { bonusXp: 1, requiredWeather: 'Eclipse' },
};
const weatherNames: Record<string, string> = { Thunderstorm: 'Thunderstorm', Frost: 'Snow' };

vi.mock('../../catalogs/gameCatalogs', () => ({
  getAbilityDef: (id: string) => (abilityParams[id] ? { baseParameters: abilityParams[id] } : null),
  getWeatherDef: (id: string) => (weatherNames[id] ? { name: weatherNames[id] } : null),
}));
vi.mock('../../store/weatherHub', () => ({
  getWeatherSnapshot: () => ({ kind: weatherKind }),
}));
vi.mock('../../i18n', () => ({
  t: (key: string, params?: Record<string, string>) => (params ? `${key}:${params.weather}` : key),
}));

const { getInactiveWeatherLabel, isRequiredWeatherActive } = await import('./abilityWeatherGate');

function def(id: string, requiredWeather?: AbilityDefinition['requiredWeather']): AbilityDefinition {
  return { id, name: id, category: 'coins', trigger: 'continuous', ...(requiredWeather ? { requiredWeather } : {}) };
}

beforeEach(() => {
  weatherKind = 'sunny';
});

describe('weather gate', () => {
  it('ungated abilities are always active', () => {
    expect(isRequiredWeatherActive(null)).toBe(true);
    expect(getInactiveWeatherLabel(def('CoinFinderI'))).toBeNull();
  });

  it('gated ability is active only during its weather', () => {
    expect(getInactiveWeatherLabel(def('ThunderCoinFinder', 'thunderstorm'))).toBe('feature.abilityTracker.notWeather:Thunderstorm');
    weatherKind = 'thunderstorm';
    expect(getInactiveWeatherLabel(def('ThunderCoinFinder', 'thunderstorm'))).toBeNull();
  });

  it('names the weather from the weather catalog, like the game (Frost → Snow)', () => {
    weatherKind = 'rain';
    expect(getInactiveWeatherLabel(def('SnowyCoinFinder', 'snow'))).toBe('feature.abilityTracker.notWeather:Snow');
  });

  it('falls back to the raw weather id, then to a plain inactive label', () => {
    expect(getInactiveWeatherLabel(def('MysteryBoost', 'dawn'))).toBe('feature.abilityTracker.notWeather:Eclipse');
    expect(getInactiveWeatherLabel(def('UncataloguedBoost', 'dawn'))).toBe('feature.abilityTracker.inactive');
  });

  it('unknown current weather counts as inactive', () => {
    weatherKind = 'unknown';
    expect(isRequiredWeatherActive('thunderstorm')).toBe(false);
  });
});
