// src/i18n/types.ts

import type { SUPPORTED_LOCALES } from './locales';

/** A locale code supported by QPM's translation system. */
export type QpmLocale = (typeof SUPPORTED_LOCALES)[number];

/**
 * How QPM determines the active locale:
 * - `'follow-game'` — mirror whatever the game is using (default)
 * - A specific `QpmLocale` — user override, ignores game setting
 */
export type LocaleMode = 'follow-game' | QpmLocale;

/** A dot-delimited dictionary key, e.g. `'hub.trackers.title'`. */
export type I18nKey = string;

/** Variable bag for interpolation: `t('greeting', { name: 'Mx' })` → `'Hello, Mx!'` */
export type I18nVars = Record<string, string | number>;

/**
 * A deferred translation: stores key + vars so it can be resolved later
 * (e.g. when the locale changes and a bound element needs updating).
 */
export interface LocalizedString {
  readonly __localized: true;
  readonly key: I18nKey;
  readonly vars?: I18nVars | undefined;
  readonly fallback?: string | undefined;
}

/**
 * Anything that can be rendered as text in the UI:
 * - A plain string (already resolved)
 * - A `LocalizedString` (deferred — resolved at render time via `text()`)
 */
export type DisplayText = string | LocalizedString;

/** A flat dictionary mapping keys to template strings. */
export type Dictionary = Record<I18nKey, string>;
