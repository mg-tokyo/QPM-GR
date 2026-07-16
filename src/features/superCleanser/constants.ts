// WEATHER_MUTATIONS mirrored verbatim from beta source:
//   scraped-data/BetaGameSourceFiles/DawnPets/preview.magicgarden.gg/common/games/Quinoa/systems/mutation/mutationsDex.ts:93-102
// The mutation catalog atom does not expose the weather subset separately,
// and beta source is not imported at runtime. Update this list if the game
// adds a new weather mutation (flagged by /analyze-beta).
export const WEATHER_MUTATIONS = [
  'Wet',
  'Chilled',
  'Frozen',
  'Thunderstruck',
  'Dawnlit',
  'Ambershine',
  'Dawncharged',
  'Ambercharged',
] as const satisfies readonly string[];

export const PANEL_POSITION_STORAGE_KEY = 'qpm.superCleanser.panel.position.v1';
export const DEFAULT_PANEL_POSITION = { xPct: 0.82, yPct: 0.30 } as const;

export const CROP_CLEANSER_TOOL_ID = 'CropCleanser';
