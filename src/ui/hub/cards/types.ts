// src/ui/hubWindow/cards/types.ts

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

interface CardConfigBase {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly icon: CardIcon;
  /** Optional color for the card label text (e.g. '#4ade80'). */
  readonly labelColor?: string;
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
