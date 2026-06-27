import type { SlotType } from '../types';

export const CUSTOM_SKINS_STORAGE_KEY = 'qpm.bloblingCustomSkins.v1';

export interface CustomSkin {
  id: string;            // generated, "skin_<ts>_<rand>"
  name: string;          // user-supplied; defaults to original file basename
  dataUrl: string;       // data:image/png;base64,... or webp post-compress
  width: number;
  height: number;
  createdAt: number;     // ms epoch
}

export interface CustomSkinsState {
  version: 1;
  /** Per-cosmetic library: cosmetic filename → list of saved customs. */
  library: Record<string, CustomSkin[]>;
  /** Per-cosmetic active selection: cosmetic filename → CustomSkin.id (or null). */
  active: Record<string, string | null>;
  /**
   * When true, uploaded customs are masked to the original cosmetic's alpha
   * channel before storage. Prevents user art from extending beyond the
   * cosmetic's natural silhouette. Default true (safer for most uploads).
   */
  trimToShape: boolean;
}

export function emptyState(): CustomSkinsState {
  return { version: 1, library: {}, active: {}, trimToShape: true };
}

/** Resolve the currently-active skin for a cosmetic, or null if none. */
export function findActiveSkin(state: CustomSkinsState, cosmeticFilename: string): CustomSkin | null {
  const id = state.active[cosmeticFilename];
  if (!id) return null;
  const list = state.library[cosmeticFilename];
  if (!list) return null;
  return list.find(s => s.id === id) ?? null;
}

export type { SlotType };
