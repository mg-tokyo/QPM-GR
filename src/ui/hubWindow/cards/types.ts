// src/ui/hubWindow/cards/types.ts

export type CardTier = 'inline-toggle' | 'expandable' | 'launcher';
export type HubGroupId = 'trackers' | 'items' | 'garden' | 'config' | 'tools';

export interface CardIcon {
  readonly kind: 'emoji' | 'svg' | 'sprite';
  readonly value: string;
  /** Sprite key for getAnySpriteDataUrl (e.g. 'sprite/ui/Coin'). Used when kind='sprite'. */
  readonly spriteKey?: string;
  /** Sprite categories for runtime resolution (e.g. ['pet']). */
  readonly spriteCategories?: readonly string[];
  /** Fallback emoji if sprite isn't loaded yet. */
  readonly fallback?: string;
}

interface CardConfigBase {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly icon: CardIcon;
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
