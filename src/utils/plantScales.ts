// src/utils/plantScales.ts
// Normalized maximum scale per produce species.
// Values sourced directly from floraSpeciesDex.ts in the game source.
// Keys are the result of normalizeSpeciesKey(floraSpeciesId) — lowercase, no spaces/dashes,
// trailing 'seed'/'plant'/'baby'/'fruit'/'crop' stripped.

const PLANT_MAX_SCALE: Record<string, number> = {
  // --- Verified against floraSpeciesDex.ts ---
  carrot: 3,
  cabbage: 3,
  strawberry: 2,
  aloe: 2.5,
  clover: 3,
  fourleafclover: 3,
  beet: 3,
  rose: 4,
  favabean: 3,
  delphinium: 3,
  blueberry: 2,
  apple: 2,
  orangetulip: 3,
  tulip: 3,               // alias for OrangeTulip / generic Tulip
  tomato: 2,
  daffodil: 3,
  corn: 2,
  watermelon: 3,
  pumpkin: 3,
  echeveria: 2.75,
  pear: 2,
  gentian: 3,
  coconut: 3,
  pinetree: 3.5,
  banana: 1.7,
  lily: 2.75,
  camellia: 2.5,
  squash: 2.5,
  peach: 3,
  burrostail: 2.5,
  mushroom: 3.5,
  cactus: 1.8,
  bamboo: 2,
  poinsettia: 2,
  violetcort: 3.5,
  chrysanthemum: 2.75,
  date: 2,
  grape: 2,
  pepper: 2,
  lemon: 3,
  passionfruit: 2,
  dragonfruit: 2,         // floraSpeciesDex: maxScale 2 (not 2.024)
  cacao: 2.5,             // normalizeSpeciesKey('Cacao') → 'cacao'
  lychee: 2,
  sunflower: 2.5,
  starweaver: 2,
  dawncelestial: 2.5,     // floraSpeciesDex key: DawnCelestial
  mooncelestial: 2,       // floraSpeciesDex key: MoonCelestial
  // --- Normalisation aliases (suffixes stripped by normalizeSpeciesKey) ---
  appletree: 2,
  cornkernel: 2,
  echeveriacutting: 2.75,
  coconuttree: 3,
  burrostailcutting: 2.5,
  mushroomspore: 3.5,
  bambooshoot: 2,
  lemontree: 3,
  passion: 2,
  dragon: 2,
  lycheepit: 2,
  starweaverpod: 2,
  starweaverfruit: 2,     // normaliseSpeciesKey('StarweaverFruit') → 'starweaver' (fruit stripped)
  dawnbinder: 2.5,
  dawnbinderpod: 2.5,
  dawnbinderbulb: 2.5,
  moonbinder: 2,
  moonbinderpod: 2,
  moonbinderbulb: 2,
  favabeanpod: 3,
  cacaofruit: 2.5,        // normaliseSpeciesKey('CacaoFruit') → 'cacao' (fruit stripped)

  // Dawn content (PR-2644) — confirmed from beta floraSpeciesDex
  daisy: 2.5,
  purpledaisy: 2.5,
  lavender: 3,
  ube: 3,
  dawnbreaker: 3,
};

export function lookupMaxScale(normalizedKey: string): number | null {
  const value = PLANT_MAX_SCALE[normalizedKey];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function getKnownPlantKeys(): string[] {
  return Object.keys(PLANT_MAX_SCALE);
}
