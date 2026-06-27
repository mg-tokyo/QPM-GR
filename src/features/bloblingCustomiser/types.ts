import type { CosmeticColor } from '../../websocket/api';
import type { CosmeticCatalogEntry } from '../../catalogs/types';

export type SlotType = 'Bottom' | 'Mid' | 'Top' | 'Expression';

export interface SlotConfig {
  readonly type: SlotType;
  readonly label: string;
  readonly arrowColor: string;
  readonly avatarIndex: number;
  readonly riveProperty: string;
}

export const SLOT_TYPES: readonly SlotType[] = ['Bottom', 'Mid', 'Top', 'Expression'] as const;

export const SLOT_CONFIG: readonly SlotConfig[] = [
  { type: 'Bottom',     label: 'BTM',  arrowColor: '#3b82f6', avatarIndex: 0, riveProperty: 'bottom' },
  { type: 'Mid',        label: 'MID',  arrowColor: '#4fd18b', avatarIndex: 1, riveProperty: 'mid' },
  { type: 'Top',        label: 'TOP',  arrowColor: '#a855f7', avatarIndex: 2, riveProperty: 'top' },
  { type: 'Expression', label: 'FACE', arrowColor: '#fbbf24', avatarIndex: 3, riveProperty: 'expression' },
] as const;

export const AVATAR_SLOT_INDEX: Record<SlotType, number> = {
  Bottom: 0, Mid: 1, Top: 2, Expression: 3,
};

export const COLORS: readonly CosmeticColor[] = [
  'Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple', 'White', 'Black',
] as const;

export const COLOR_HEX: Record<CosmeticColor, string> = {
  Red: '#ef4444', Orange: '#f97316', Yellow: '#eab308', Green: '#22c55e',
  Blue: '#3b82f6', Purple: '#a855f7', White: '#f0f0f0', Black: '#1a1a1a',
};

export interface CarouselPosition {
  index: number;
  items: CosmeticCatalogEntry[];
}

export interface CartItem {
  slot: SlotType;
  entry: CosmeticCatalogEntry;
}

export interface SessionState {
  selectedSlots: Record<SlotType, string | null>;
  selectedColor: CosmeticColor;
  carousel: Record<SlotType, CarouselPosition>;
  ownershipSet: Set<string>;
  previewActive: boolean;
  previewEndTime: number;
  purchaseInProgress: boolean;
}

export type { CosmeticColor } from '../../websocket/api';
export type { CosmeticCatalogEntry } from '../../catalogs/types';
