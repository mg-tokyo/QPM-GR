import type { TextureManipulatorState } from '../types';

export const PRESETS_STORAGE_KEY = 'qpm.gardenPainter.presets.v1';
export const PRESETS_SOFT_CAP = 12;

export interface GardenPainterPreset {
  id: string;
  name: string;
  ruleCount: number;
  snapshot: TextureManipulatorState;
  createdAt: number;
}

export interface GardenPainterPresetsConfig {
  presets: GardenPainterPreset[];
  updatedAt: number;
}

export function createDefaultPresetsConfig(): GardenPainterPresetsConfig {
  return { presets: [], updatedAt: 0 };
}
