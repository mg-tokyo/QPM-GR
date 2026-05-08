// src/i18n/locales.ts

/**
 * All locale codes supported by the game.
 * Source: game's common/locales.ts — `en es pt de fr ja zh th nl ru pl it ko vi sv tr ar fil sr`.
 */
export const SUPPORTED_LOCALES = [
  'en', 'es', 'pt', 'de', 'fr', 'ja', 'zh', 'th',
  'nl', 'ru', 'pl', 'it', 'ko', 'vi', 'sv', 'tr',
  'ar', 'fil', 'sr',
] as const;

const localeSet = new Set<string>(SUPPORTED_LOCALES);

/** Returns true if `code` is one of the game's supported locale codes. */
export function isSupportedQpmLocale(code: string): boolean {
  return localeSet.has(code);
}

/**
 * Best-effort normalisation of a BCP 47 tag or loose locale string
 * to one of the supported locale codes.
 *
 * Examples:
 * - `'en-US'` → `'en'`
 * - `'pt-BR'` → `'pt'`
 * - `'zh-Hans'` → `'zh'`
 * - `'fil'` → `'fil'`
 * - `'tl'` → `'fil'` (Tagalog → Filipino alias)
 * - `'unknown'` → `null`
 */
export function normalizeLocale(raw: string): string | null {
  const cleaned = raw.trim().toLowerCase();
  if (!cleaned) return null;

  // Direct match
  if (localeSet.has(cleaned)) return cleaned;

  // Try base language (before first hyphen)
  const base = cleaned.split('-')[0] ?? cleaned;
  if (localeSet.has(base)) return base;

  // Known aliases
  if (base === 'tl') return 'fil'; // Tagalog → Filipino

  return null;
}

/** RTL locale codes within the supported set. */
export const RTL_LOCALES: ReadonlySet<string> = new Set(['ar']);
