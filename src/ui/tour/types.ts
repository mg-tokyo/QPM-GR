// src/ui/tour/types.ts

/** Tour categories — mirrors the tours/ folder structure */
export type TourCategory =
  | 'welcome'
  | 'panel'
  | 'trackers'
  | 'pets'
  | 'shops'
  | 'items'
  | 'garden'
  | 'config'
  | 'tools';

/** Preferred tooltip placement relative to the spotlight target */
export type TourPlacement = 'top' | 'bottom' | 'left' | 'right' | 'auto';

/** How to advance past this step */
export type TourAdvanceMode = 'click' | 'dismiss';

/** A single step in a tour */
export interface TourStep {
  /** Unique step ID for progress tracking */
  readonly id: string;

  /** CSS selector scoped to the window body. Mutually exclusive with `resolve`. */
  readonly selector?: string;

  /** Dynamic element lookup for lazy/dynamic targets. */
  readonly resolve?: (windowBody: HTMLElement) => HTMLElement | null;

  /** Tooltip title — short, action-oriented */
  readonly title: string;

  /** Tooltip body — plain language, 1-2 sentences max */
  readonly body: string;

  /** Preferred tooltip placement relative to target. Default: 'auto' */
  readonly placement?: TourPlacement;

  /** Wait for this element to exist before showing step (for lazy tabs). */
  readonly waitFor?: string | (() => HTMLElement | null);

  /**
   * 'click' = advance when user clicks the spotlighted element.
   * 'dismiss' = advance only via Next button (default).
   */
  readonly advanceOn?: TourAdvanceMode;
}

/** A complete tour definition — pure data, no behavior */
export interface TourDefinition {
  /** Must match the window ID or a stable surface identifier */
  readonly windowId: string;

  /** Human-readable name shown in settings/reset UI */
  readonly label: string;

  /** Tour category — mirrors folder structure */
  readonly category: TourCategory;

  /** Ordered steps */
  readonly steps: readonly TourStep[];

  /** Bump when steps change to re-show tour to existing users */
  readonly version: number;
}

/** Persisted progress for a single tour */
export interface TourProgress {
  /** Tour version the user last saw */
  version: number;

  /** Index of the last completed step. -1 = not started. */
  lastCompletedStep: number;

  /** Whether the tour is fully dismissed */
  completed: boolean;
}

// ── Discovery Dot Types ─────────────────────────────────────

/** A single discoverable element in a window. */
export interface DiscoveryItem {
  /** Unique ID for persistence (e.g., 'feed-toggle') */
  readonly id: string;
  /** CSS selector scoped to the window body */
  readonly selector: string;
}

/** Discovery definition for a window — ordered priority list. */
export interface DiscoveryDefinition {
  /** Must match the window ID */
  readonly windowId: string;
  /** Max dots visible at once (default 3) */
  readonly maxVisible: number;
  /** Ordered by importance — top items show dots first */
  readonly items: readonly DiscoveryItem[];
}

// ── Help Panel Types ────────────────────────────────────────

/** Icon for a help card — emoji or sprite key */
export interface HelpCardIcon {
  readonly kind: 'emoji' | 'sprite';
  /** Emoji character or sprite-v2 key */
  readonly value: string;
}

/** A single help card in the panel. */
export interface HelpCard {
  readonly id: string;
  readonly icon: HelpCardIcon;
  readonly title: string;
  readonly body: string;
  /** If provided, "Show me" button spotlights this element. If omitted, no button. */
  readonly showMeSelector?: string;
}

/** A group of help cards under a topic header. */
export interface HelpGroup {
  readonly id: string;
  readonly label: string;
  readonly cards: readonly HelpCard[];
}

/** Help panel definition for a window. */
export interface HelpPanelDefinition {
  readonly windowId: string;
  readonly groups: readonly HelpGroup[];
}
