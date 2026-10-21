// Catalog detection functions — identify catalogs by their unique
// "fingerprint" properties. All pure; no module state.

/**
 * Detect itemCatalog: has WateringCan, PlanterPot, Shovel, RainbowPotion
 * with coinPrice and creditPrice properties
 */
export function looksLikeItemCatalog(obj: Record<string, unknown>, keys: string[]): boolean {
  const required = ['WateringCan', 'PlanterPot', 'Shovel', 'RainbowPotion'];
  if (!required.every(k => keys.includes(k))) return false;

  const sample = obj.WateringCan;
  return (
    sample !== null &&
    typeof sample === 'object' &&
    'coinPrice' in sample &&
    'creditPrice' in sample
  );
}

/**
 * Detect decorCatalog: has rock types with coinPrice/creditPrice
 */
export function looksLikeDecorCatalog(obj: Record<string, unknown>, keys: string[]): boolean {
  const required = ['SmallRock', 'MediumRock', 'LargeRock'];
  if (!required.every(k => keys.includes(k))) return false;

  const sample = obj.SmallRock;
  return (
    sample !== null &&
    typeof sample === 'object' &&
    'coinPrice' in sample &&
    'creditPrice' in sample
  );
}

/**
 * Detect mutationCatalog: has Gold, Rainbow, Wet, etc. with baseChance/coinMultiplier
 */
export function looksLikeMutationCatalog(obj: Record<string, unknown>, keys: string[]): boolean {
  const required = ['Gold', 'Rainbow', 'Wet', 'Chilled', 'Frozen'];
  if (!required.every(k => keys.includes(k))) return false;

  const sample = obj.Gold;
  return (
    sample !== null &&
    typeof sample === 'object' &&
    'baseChance' in sample &&
    'coinMultiplier' in sample
  );
}

/**
 * Detect eggCatalog: has egg types with faunaSpawnWeights and secondsToHatch
 */
export function looksLikeEggCatalog(obj: Record<string, unknown>, keys: string[]): boolean {
  const required = ['CommonEgg', 'UncommonEgg', 'RareEgg', 'LegendaryEgg'];
  if (!required.every(k => keys.includes(k))) return false;

  const sample = obj.CommonEgg;
  return (
    sample !== null &&
    typeof sample === 'object' &&
    'faunaSpawnWeights' in sample &&
    'secondsToHatch' in sample
  );
}

/**
 * Detect petCatalog: has pet species with diet array and coinsToFullyReplenishHunger
 * RELAXED DETECTION: Only requires 3 of 5 common pets to allow for game updates
 */
export function looksLikePetCatalog(obj: Record<string, unknown>, keys: string[]): boolean {
  const commonPets = ['Worm', 'Snail', 'Bee', 'Chicken', 'Bunny', 'Turkey', 'Goat'];

  const matchCount = commonPets.filter(k => keys.includes(k)).length;
  if (matchCount < 3) return false;

  const sampleKey = commonPets.find(k => keys.includes(k));
  if (!sampleKey) return false;

  const sample = obj[sampleKey];
  return (
    sample !== null &&
    typeof sample === 'object' &&
    'coinsToFullyReplenishHunger' in sample &&
    'diet' in sample &&
    Array.isArray((sample as { diet: unknown }).diet)
  );
}

/**
 * Detect petAbilities: has ability names with trigger and baseParameters.
 * RELAXED (3-of-N) so one rename doesn't break capture.
 */
export function looksLikePetAbilities(obj: Record<string, unknown>, keys: string[]): boolean {
  const anchors = ['ProduceScaleBoost', 'DoubleHarvest', 'SeedFinderI', 'CoinFinderI', 'RainbowGranter', 'GoldGranter', 'PlantGrowthBoost'];
  const present = anchors.filter(k => keys.includes(k));
  if (present.length < 3) return false;
  const sample = obj[present[0]!];
  return (
    sample !== null &&
    typeof sample === 'object' &&
    'trigger' in sample &&
    'baseParameters' in sample
  );
}

/**
 * Detect plantCatalog: has plant species with seed/plant/crop sub-objects
 * RELAXED DETECTION: Only requires 3 of 5 common plants to allow for game updates
 */
export function looksLikePlantCatalog(obj: Record<string, unknown>, keys: string[]): boolean {
  const commonPlants = ['Carrot', 'Strawberry', 'Aloe', 'Blueberry', 'Apple', 'Tomato', 'Corn'];

  const matchCount = commonPlants.filter(k => keys.includes(k)).length;
  if (matchCount < 3) return false;

  const sampleKey = commonPlants.find(k => keys.includes(k));
  if (!sampleKey) return false;

  const sample = obj[sampleKey];
  return (
    sample !== null &&
    typeof sample === 'object' &&
    'seed' in sample &&
    'plant' in sample &&
    'crop' in sample
  );
}

/**
 * Detect weatherCatalog: weather IDs with mutator/iconSpriteKey metadata.
 */
export function looksLikeWeatherCatalog(obj: Record<string, unknown>, keys: string[]): boolean {
  const hasRain = keys.includes('Rain');
  const hasDawn = keys.includes('Dawn');
  const hasThunderstorm = keys.includes('Thunderstorm');
  const hasAmber = keys.includes('AmberMoon');
  const hasSnowFamily = keys.includes('Frost') || keys.includes('Snow');

  if (!hasRain || !hasDawn || !hasThunderstorm || !hasAmber || !hasSnowFamily) {
    return false;
  }

  const rain = obj.Rain;
  if (!rain || typeof rain !== 'object') return false;

  const rainRecord = rain as Record<string, unknown>;
  const rainMutation = (rainRecord.mutator as Record<string, unknown> | undefined)?.mutation;
  const hasWeatherLikeShape =
    typeof rainRecord.iconSpriteKey === 'string' ||
    typeof rainRecord.name === 'string' ||
    typeof rainMutation === 'string';

  if (!hasWeatherLikeShape) return false;
  if (typeof rainMutation === 'string' && rainMutation !== 'Wet') return false;

  return true;
}

export function looksLikeCosmeticArray(arr: unknown[]): boolean {
  if (arr.length < 10) return false;
  const sample = arr[0];
  return (
    sample !== null &&
    typeof sample === 'object' &&
    'id' in sample &&
    'type' in sample &&
    'filename' in sample &&
    'displayName' in sample &&
    'availability' in sample &&
    'price' in sample
  );
}

export function normalizeWeatherCatalog(
  source: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const ids = ['Rain', 'Frost', 'Snow', 'Thunderstorm', 'Dawn', 'AmberMoon'];

  for (const id of ids) {
    const entry = source[id];
    if (!entry || typeof entry !== 'object') continue;
    const raw = entry as Record<string, unknown>;
    const spriteId = typeof raw.iconSpriteKey === 'string' ? raw.iconSpriteKey : null;
    out[id] = {
      weatherId: id,
      spriteId,
      ...raw,
    };
  }

  if (out.Frost && !out.Snow) {
    out.Snow = { ...(out.Frost as Record<string, unknown>), weatherId: 'Snow', name: 'Snow' };
  }
  if (out.Snow && !out.Frost) {
    out.Frost = { ...(out.Snow as Record<string, unknown>), weatherId: 'Frost', name: 'Frost' };
  }
  if (!out.Sunny) {
    out.Sunny = {
      weatherId: 'Sunny',
      name: 'Sunny',
      spriteId: 'sprite/ui/SunnyIcon',
      type: 'primary',
    };
  }

  return out;
}

const WEB_ADDRESS_RE = /^[a-z][a-z0-9+.-]*:\/\//;
const WEB_ADDRESS_SAMPLE = 3;

function ownStringHasWebAddress(obj: Record<string, unknown>, depth: number): boolean {
  // for..in, not Object.keys: this runs inside the Object.* hook and must not re-enter it.
  for (const key in obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
    let value: unknown;
    try { value = obj[key]; } catch { continue; }
    if (typeof value === 'string') {
      if (WEB_ADDRESS_RE.test(value)) return true;
    } else if (depth === 0 && value && typeof value === 'object' && !Array.isArray(value)) {
      if (ownStringHasWebAddress(value as Record<string, unknown>, 1)) return true;
    }
  }
  return false;
}

/**
 * Another mod's copy of the game data (Arie's Mod loads one from its own API)
 * carries web-address sprites; the game's own dex never does. Samples the
 * first entries, at entry level and one stage down (plant seed/plant/crop).
 */
export function hasWebAddressSprite(obj: Record<string, unknown>, keys: string[]): boolean {
  for (const key of keys.slice(0, WEB_ADDRESS_SAMPLE)) {
    let entry: unknown;
    try { entry = obj[key]; } catch { continue; }
    if (entry && typeof entry === 'object' && !Array.isArray(entry)
      && ownStringHasWebAddress(entry as Record<string, unknown>, 0)) return true;
  }
  return false;
}
