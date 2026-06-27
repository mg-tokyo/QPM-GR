// src/features/bloblingCustomiser/presets/types.ts
import type { SlotType, CosmeticColor } from '../types';

export const PRESETS_STORAGE_KEY = 'qpm.bloblingPresets.v1';
export const PRESETS_SOFT_CAP = 24;

export interface BloblingPreset {
  id: string;
  slots: Record<SlotType, string | null>;
  color: CosmeticColor;
  thumbnail: string;
  createdAt: number;
}

export interface BloblingPresetsConfig {
  presets: BloblingPreset[];
  updatedAt: number;
}

export function createDefaultPresetsConfig(): BloblingPresetsConfig {
  return { presets: [], updatedAt: 0 };
}
