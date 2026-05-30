/**
 * Controller brand detection and per-brand button label tables.
 *
 * Standard Gamepad API button layout (W3C mapping):
 *   0  face-bottom   1  face-right   2  face-left   3  face-top
 *   4  LB            5  RB           6  LT           7  RT
 *   8  Select/Back   9  Start/Menu  10  L3          11  R3
 *  12  D-Up         13  D-Down      14  D-Left      15  D-Right
 */

export type ControllerBrand = 'xbox' | 'playstation' | 'nintendo' | 'generic';

export interface ControllerProfile {
  brand: ControllerBrand;
  /** Display name shown in the UI badge, e.g. "PlayStation". */
  name: string;
  /** True when gamepad.mapping === 'standard' (W3C layout confirmed). */
  isStandard: boolean;
  /** Maps standard button index → human-readable label for this brand. */
  buttonLabels: Record<number, string>;
}

// ---------------------------------------------------------------------------
// Per-brand label tables (standard mapping positions)
// ---------------------------------------------------------------------------

const XBOX_LABELS: Record<number, string> = {
  0: 'A',    1: 'B',    2: 'X',    3: 'Y',
  4: 'LB',   5: 'RB',   6: 'LT',   7: 'RT',
  8: 'View', 9: 'Menu', 10: 'L3',  11: 'R3',
  12: '↑',   13: '↓',   14: '←',   15: '→',
};

const PS_LABELS: Record<number, string> = {
  0: '×',      1: '○',       2: '□',   3: '△',
  4: 'L1',     5: 'R1',      6: 'L2',  7: 'R2',
  8: 'Select', 9: 'Options', 10: 'L3', 11: 'R3',
  12: '↑',     13: '↓',      14: '←',  15: '→',
};

const NINTENDO_LABELS: Record<number, string> = {
  0: 'B',  1: 'A',  2: 'Y',   3: 'X',
  4: 'L',  5: 'R',  6: 'ZL',  7: 'ZR',
  8: '−',  9: '+',  10: 'LS', 11: 'RS',
  12: '↑', 13: '↓', 14: '←',  15: '→',
};

const GENERIC_LABELS: Record<number, string> = {
  0: 'Button 0',  1: 'Button 1',  2: 'Button 2',  3: 'Button 3',
  4: 'L Bumper',  5: 'R Bumper',  6: 'L Trigger',  7: 'R Trigger',
  8: 'Select',    9: 'Start',     10: 'L3',         11: 'R3',
  12: '↑',        13: '↓',        14: '←',          15: '→',
};

const BRAND_DATA: Record<ControllerBrand, { name: string; labels: Record<number, string> }> = {
  xbox:        { name: 'Xbox',        labels: XBOX_LABELS },
  playstation: { name: 'PlayStation', labels: PS_LABELS },
  nintendo:    { name: 'Nintendo',    labels: NINTENDO_LABELS },
  generic:     { name: 'Generic',     labels: GENERIC_LABELS },
};

// ---------------------------------------------------------------------------
// Profile detection
// ---------------------------------------------------------------------------

/**
 * Detects the controller profile from the connected Gamepad object.
 * Uses `gamepad.id` for brand detection and `gamepad.mapping` for layout
 * validation. Non-standard mapping falls back to generic labels since
 * button indices are vendor-defined.
 */
export function detectProfile(gamepad: Gamepad): ControllerProfile {
  const brand = detectBrand(gamepad.id);
  const isStandard = gamepad.mapping === 'standard';
  const { name, labels } = BRAND_DATA[brand];

  return {
    brand,
    name,
    isStandard,
    // Non-standard mapping → button indices are unknown; use generic labels
    buttonLabels: isStandard ? labels : GENERIC_LABELS,
  };
}

function detectBrand(id: string): ControllerBrand {
  const lower = id.toLowerCase();

  // PlayStation: vendor 054c, DualShock/DualSense keywords
  if (lower.includes('054c') ||
      lower.includes('dualshock') ||
      lower.includes('dualsense') ||
      lower.includes('wireless controller')) {
    return 'playstation';
  }

  // Xbox: vendor 045e, or keyword
  if (lower.includes('045e') || lower.includes('xbox')) {
    return 'xbox';
  }

  // Nintendo: vendor 057e, Pro Controller, Joy-Con
  if (lower.includes('057e') ||
      lower.includes('pro controller') ||
      lower.includes('joy-con')) {
    return 'nintendo';
  }

  return 'generic';
}
