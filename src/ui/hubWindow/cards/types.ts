/** Card tier determines how a feature renders in the hub */
export type CardTier = 'inline-toggle' | 'expandable' | 'launcher';

/** Hub group IDs */
export type HubGroupId = 'trackers' | 'items' | 'garden' | 'config' | 'tools';

/** Icon definition — matches toolsHubWindow's proven pattern */
export interface CardIcon {
  readonly kind: 'emoji' | 'svg' | 'sprite';
  /** Emoji character, SVG markup string, or sprite key */
  readonly value: string;
  /** For sprite icons: category for runtime lookup */
  readonly category?: string;
}

/** Base config shared by all card tiers */
interface CardConfigBase {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly icon: CardIcon;
}

/** Tier 1: Simple toggle with optional settings reveal */
export interface InlineToggleConfig extends CardConfigBase {
  readonly tier: 'inline-toggle';
  readonly getEnabled: () => boolean;
  readonly setEnabled: (enabled: boolean) => void;
  readonly renderSettings?: (container: HTMLElement) => (() => void) | void;
}

/** Tier 2: Expandable card with summary + full inline UI */
export interface ExpandableCardConfig extends CardConfigBase {
  readonly tier: 'expandable';
  readonly renderSummary: (container: HTMLElement) => (() => void) | void;
  readonly renderExpanded: (container: HTMLElement) => (() => void) | void;
  readonly detachWindowId?: string;
  readonly onDetach?: () => void;
}

/** Tier 3: Launcher card — summary + "Open →" button */
export interface LauncherCardConfig extends CardConfigBase {
  readonly tier: 'launcher';
  readonly renderSummary: (container: HTMLElement) => (() => void) | void;
  readonly onOpen: () => void;
}

/** Union of all card configs */
export type CardConfig = InlineToggleConfig | ExpandableCardConfig | LauncherCardConfig;

/** Group definition */
export interface HubGroupDef {
  readonly id: HubGroupId;
  readonly label: string;
  readonly icon: CardIcon;
  readonly cards: ReadonlyArray<CardConfig>;
}
