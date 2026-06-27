// src/ui/components/floatingCard/types.ts
// Reusable shell for QPM's draggable floating cards.
// Extracted from src/ui/pets/floatingCard/card.ts so multiple features can reuse the
// drag/persistence/clamp/registry mechanics without duplicating them.

export interface FloatingCardPosition {
  xPct: number;
  yPct: number;
}

export interface FloatingCardConfig {
  /** Unique key per card instance. Used by the registry and (if persistKey is set) by storage. */
  key: string;
  /** Optional initial viewport-ratio position. Falls back to a safe default if omitted. */
  defaultPosition?: FloatingCardPosition;
  /** Storage key under which to persist this card's position. Omit to skip persistence. */
  persistKey?: string;
  /** Header element — used as the drag handle. Receives mousedown listeners. */
  header: HTMLElement;
  /** Body element — rendered below the header. Consumer owns its content + cleanup. */
  body: HTMLElement;
  /** Optional teardown hook called when the card is destroyed. */
  onDestroy?: () => void;
  /** Base width used for default placement + drag clamp math. Defaults to 172px. */
  baseWidth?: number;
  /** Optional max width hint for consumer auto-expansion logic. */
  maxWidth?: number;
  /** CSS class to apply on the wrapper element. */
  className?: string;
  /**
   * Optional list of CSS selectors. mousedown originating from any element matching
   * a selector (including descendants) is ignored by the drag handler. Use this to
   * exclude clickable header elements such as close buttons.
   */
  dragExcludeSelectors?: readonly string[];
}

export interface FloatingCardEntry {
  key: string;
  el: HTMLElement;
  /** Force-recompute clamped position (e.g. after viewport resize or content change). */
  refresh: () => void;
  destroy: () => void;
}

export interface PersistedFloatingCard {
  key: string;
  xPct: number;
  yPct: number;
}

export interface PersistedFloatingCardsState {
  cards: PersistedFloatingCard[];
  updatedAt: number;
}
