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
