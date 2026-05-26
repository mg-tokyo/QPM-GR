import type { SpriteCategory } from '../../sprite-v2/types';
import { getAbilityColor as getSharedAbilityColor } from '../../utils/petCardRenderer';

export type SpriteKey = { category: SpriteCategory; id: string };

export type SpriteFilterConfig = {
  blendMode: GlobalCompositeOperation;
  colors: string[];
  alpha?: number;
  gradientAngle?: number;
  masked?: boolean;
};

export const mutationFilters: Record<string, SpriteFilterConfig> = {
  gold: { blendMode: 'source-atop', colors: ['rgb(255, 215, 0)'], alpha: 0.7 },
  rainbow: { blendMode: 'color', colors: ['#FF1744', '#FF9100', '#FFEA00', '#00E676', '#2979FF', '#D500F9'], gradientAngle: 130, masked: true },
  wet: { blendMode: 'source-atop', colors: ['rgb(128, 128, 255)'], alpha: 0.2 },
  chilled: { blendMode: 'source-atop', colors: ['rgb(183, 183, 236)'], alpha: 0.5 },
  frozen: { blendMode: 'source-atop', colors: ['rgb(128, 128, 255)'], alpha: 0.6 },
  dawnlit: { blendMode: 'source-atop', colors: ['rgb(120, 100, 180)'], alpha: 0.4 },
  ambershine: { blendMode: 'source-atop', colors: ['rgb(255, 140, 26)', 'rgb(230, 92, 26)', 'rgb(178, 58, 26)'], alpha: 0.5 },
  dawncharged: { blendMode: 'source-atop', colors: ['rgb(100, 80, 160)', 'rgb(110, 90, 170)', 'rgb(120, 100, 180)'], alpha: 0.5 },
  ambercharged: { blendMode: 'source-atop', colors: ['rgb(167, 50, 30)', 'rgb(177, 60, 40)', 'rgb(187, 70, 50)'], alpha: 0.5 },
};

export const itemIconMap: Record<string, string> = {
  shovel: '⛏️',
  wateringcan: '💧',
  watering: '💧',
  fertilizer: '🧪',
  hoe: '⚒️',
  bucket: '🪣',
  seed: '🌱',
};

export const ITEM_SHEET = 'items';

export const itemTileMap: Record<string, number> = {
  shovel: 1,
  'watering can': 8,
  wateringcan: 8,
  'planter pot': 5,
  planterpot: 5,
  'wet potion': 15,
  wetpotion: 15,
  'frozen potion': 17,
  frozenpotion: 17,
  'chilled potion': 16,
  chilledpotion: 16,
  'dawnlit potion': 18,
  dawnlitpotion: 18,
  'amberlit potion': 19,
  amberlitpotion: 19,
  'ambercharged potion': 19,
  'amberbound potion': 19,
  'dawncharged potion': 18,
  'dawnbound potion': 18,
  'gold potion': 14,
  goldpotion: 14,
  'rainbow potion': 13,
  rainbowpotion: 13,
};

export function getAbilityColor(abilityName: string): { base: string; glow: string; text: string } {
  return getSharedAbilityColor(abilityName);
}
