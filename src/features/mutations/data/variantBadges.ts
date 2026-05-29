// Shared variant badge and chip styling definitions for tooltips and journal UI

export interface VariantBadge {
  matches: string[];
  label: string;
  color?: string;
  gradient?: string;
  bold?: boolean;
}

// Colors sourced from the game's constants/colors.ts mutationColors table
export const VARIANT_BADGES: VariantBadge[] = [
  { matches: ['Normal'], label: 'N', color: '#FFFFFF', bold: true },
  { matches: ['Rainbow'], label: 'R', gradient: 'linear-gradient(135deg, #D02128, #D94C52, #FC6D30, #E9B52F, #5EAC46, #48ADF4, #6D1CF0, #AE53B0)', bold: true },
  { matches: ['Gold', 'Golden'], label: 'G', color: '#EBC800', bold: true },
  { matches: ['Wet'], label: 'W', color: '#5FFFFF' },
  { matches: ['Chilled'], label: 'C', color: '#B4E6FF' },
  { matches: ['Frozen'], label: 'F', color: '#B9C8FF' },
  { matches: ['Thunderstruck'], label: 'T', color: '#FFF700' },
  { matches: ['Dawnlit'], label: 'D', color: '#F59BE1' },
  { matches: ['Dawncharged', 'Dawnbound'], label: 'D', color: '#C896FF', bold: true },
  { matches: ['Amberlit', 'Ambershine'], label: 'A', color: '#FFB478' },
  { matches: ['Ambercharged', 'Amberbound'], label: 'A', color: '#FA8C4B', bold: true },
  { matches: ['Max Weight', 'Max', 'Max Size'], label: 'S', color: '#BDBDBD', bold: true },
];

const collectedTextColors: Record<string, string> = {
  normal: '#111111',
  rainbow: '#111111',
  gold: '#1a1a00',     // dark on bright yellow (#EBC800)
  golden: '#1a1a00',
  wet: '#003333',      // dark on bright cyan (#5FFFFF)
  chilled: '#002255',  // dark on light sky blue (#B4E6FF)
  frozen: '#1a1a44',   // dark on light periwinkle (#B9C8FF)
  thunderstruck: '#1a1a00', // dark on bright yellow (#FFF700)
  dawnlit: '#3a0030',  // dark on pink (#F59BE1)
  dawncharged: '#200040',  // dark on light purple (#C896FF)
  dawnbound: '#200040',
  amberlit: '#3a1a00', // dark on peach (#FFB478)
  ambershine: '#3a1a00',
  ambercharged: '#2a0800', // dark on orange (#FA8C4B)
  amberbound: '#2a0800',
  max: '#111111',
  'max weight': '#111111',
};

function normalizeVariantName(name: string): string {
  return name.trim().toLowerCase();
}

export function findVariantBadge(variant: string): VariantBadge | undefined {
  const target = normalizeVariantName(variant);
  return VARIANT_BADGES.find(badge =>
    badge.matches.some(match => normalizeVariantName(match) === target)
  );
}

export function getVariantChipColors(variant: string, collected: boolean): { bg: string; text: string; weight: 400 | 600 } {
  const badge = findVariantBadge(variant);
  if (!badge) {
    return {
      bg: collected ? '#4CAF50' : '#333',
      text: collected ? '#fff' : '#777',
      weight: collected ? 600 : 400,
    };
  }

  const normalized = normalizeVariantName(variant);
  const textColor = collectedTextColors[normalized] || '#111111';

  if (!collected) {
    return {
      bg: '#333',
      text: '#777',
      weight: 400,
    };
  }

  return {
    bg: badge.gradient || badge.color || '#4CAF50',
    text: badge.gradient ? '#111111' : textColor,
    weight: 600,
  };
}
