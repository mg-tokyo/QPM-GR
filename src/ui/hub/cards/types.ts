// src/ui/hubWindow/cards/types.ts

import type { PerTileStatusProvider } from '../../panel/tileStatusTypes';

export type CardTier = 'inline-toggle' | 'expandable' | 'launcher';
export type HubGroupId = 'trackers' | 'items' | 'garden' | 'config' | 'tools';

export interface BunchedSpriteEntry {
  readonly spriteKey: string;
  readonly mutations?: readonly string[];
  readonly offsetX?: number;
  readonly offsetY?: number;
  readonly scale?: number;
}

export interface CardIcon {
  readonly kind: 'emoji' | 'svg' | 'sprite';
  readonly value: string;
  /** Sprite key (e.g. 'pet/Cat', 'plant/Rose', 'ui/Coin'). Used when kind='sprite'. */
  readonly spriteKey?: string;
  /** Mutations to apply to the sprite (e.g. ['Rainbow', 'Wet']). */
  readonly spriteMutations?: readonly string[];
  /** Fallback emoji if sprite isn't loaded yet. */
  readonly fallback?: string;
  /** When present, renders overlapping sprite cluster instead of single sprite. */
  readonly bunched?: ReadonlyArray<BunchedSpriteEntry>;
}

/**
 * Tile metadata for auto-registering a panel tile from a hub card.
 * When present on a card, `registerTilesFromGroups` derives a `TileDefinition`.
 */
export interface TileMeta {
  /** Tile ID. Defaults to `card.key` if omitted. */
  readonly tileId?: string;
  /** Emoji icon shown on the tile. */
  readonly icon: string;
  /** rgba color for background tint + glow. */
  readonly color: string;
  /** Fallback status string shown before live data loads. */
  readonly defaultStatus?: string;
  /** Per-tile live status provider. Omit for multi-tile providers or static tiles. */
  readonly statusProvider?: PerTileStatusProvider;
  /** Explicit tile action. Auto-derived from `onOpen`/`onDetach` if omitted. */
  readonly action?: () => void;
}

interface CardConfigBase {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly icon: CardIcon;
  /** Optional color for the card label text (e.g. '#4ade80'). */
  readonly labelColor?: string;
  /** When present, a panel tile is auto-registered for this card. */
  readonly tile?: TileMeta;
}

export interface InlineToggleConfig extends CardConfigBase {
  readonly tier: 'inline-toggle';
  readonly getEnabled: () => boolean;
  readonly setEnabled: (enabled: boolean) => void;
  readonly renderSettings?: (container: HTMLElement) => (() => void) | void;
}

export interface ExpandableCardConfig extends CardConfigBase {
  readonly tier: 'expandable';
  readonly renderSummary: (container: HTMLElement) => (() => void) | void;
  readonly renderExpanded: (container: HTMLElement) => (() => void) | void;
  readonly detachWindowId?: string;
  readonly onDetach?: () => void;
  readonly onBeforeExpand?: () => void;
  readonly onBeforeCollapse?: () => void;
}

export interface LauncherCardConfig extends CardConfigBase {
  readonly tier: 'launcher';
  readonly renderSummary: (container: HTMLElement) => (() => void) | void;
  readonly onOpen: () => void;
}

export type CardConfig = InlineToggleConfig | ExpandableCardConfig | LauncherCardConfig;

export interface HubGroupDef {
  readonly id: HubGroupId;
  readonly label: string;
  readonly icon: CardIcon;
  readonly cards: ReadonlyArray<CardConfig>;
}
