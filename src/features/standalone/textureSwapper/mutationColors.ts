// ---------------------------------------------------------------------------
// Single-color mutation colors for Rive decor overlays
//
// Mirrors the FILTERS table at src/sprite-v2/renderer.ts:19-36 and the more
// authoritative MutationVisualEffectsDex at
// scraped-data/BetaGameSourceFiles/Thundershop/.../mutation-filters.ts.
// Both define identical color values for the source-atop blend mutations.
//
// Rainbow is NOT in this table — it uses a 6-color gradient with HSL color
// blend, implemented separately in riveAdapter via lite (masked overlay) or
// proper (custom Filter) paths.
// ---------------------------------------------------------------------------

type MutationColorEntry = { color: string; alpha: number };

const TABLE: Record<string, MutationColorEntry> = {
  Gold: { color: 'rgb(235, 200, 0)', alpha: 0.7 },
  Wet: { color: 'rgb(50, 180, 200)', alpha: 0.25 },
  Chilled: { color: 'rgb(100, 160, 210)', alpha: 0.45 },
  Frozen: { color: 'rgb(100, 130, 220)', alpha: 0.5 },
  Thunderstruck: { color: 'rgb(16, 141, 163)', alpha: 0.4 },
  Dawnlit: { color: 'rgb(209, 70, 231)', alpha: 0.5 },
  Ambershine: { color: 'rgb(190, 100, 40)', alpha: 0.5 },
  Dawncharged: { color: 'rgb(140, 80, 200)', alpha: 0.5 },
  Ambercharged: { color: 'rgb(170, 60, 25)', alpha: 0.5 },
  Thundercharged: { color: 'rgb(90, 70, 220)', alpha: 0.45 },
};

export const RIVE_SINGLE_COLOR_MUTATIONS: readonly string[] = Object.keys(TABLE);

export function getMutationColor(name: string): MutationColorEntry | null {
  return TABLE[name] ?? null;
}

// Per MutationVisualEffectsDex at scraped-data/.../mutation-filters.ts,
// each mutation has a specific iconSprite atlas key (or null for Gold/Rainbow
// per src/sprite-v2/renderer.ts:542 which skips icon rendering for those).
const ICON_KEYS: Record<string, string | null> = {
  Gold: null,
  Rainbow: null,
  Wet: 'sprite/ui/MutationWet',
  Chilled: 'sprite/ui/MutationChilled',
  Frozen: 'sprite/ui/MutationFrozen',
  Thunderstruck: 'sprite/ui/MutationThunderstruck',
  Dawnlit: 'sprite/ui/MutationDawnlit',
  Ambershine: 'sprite/ui/MutationAmberlit', // not Ambershine per CLAUDE.md sprite-api notes
  Dawncharged: 'sprite/ui/MutationDawncharged',
  Ambercharged: 'sprite/ui/MutationAmbercharged',
  Thundercharged: 'sprite/ui/MutationThundercharged',
};

export function getMutationIconSpriteKey(name: string): string | null {
  return ICON_KEYS[name] ?? null;
}
