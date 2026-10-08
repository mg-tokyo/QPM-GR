// src/i18n/dictionary.ts

import type { Dictionary, I18nKey, I18nVars, LocalizedString, QpmLocale } from './types';
import { getCurrentLocale } from './gameLocale';
import en from './dictionaries/en';
import es from './dictionaries/es';
import de from './dictionaries/de';
import fr from './dictionaries/fr';
import pt from './dictionaries/pt';

/** Registry of loaded dictionaries keyed by locale code. */
const dictionaries = new Map<string, Dictionary>();

// English is always loaded eagerly.
dictionaries.set('en', en);
dictionaries.set('es', es);
dictionaries.set('de', de);
dictionaries.set('fr', fr);
dictionaries.set('pt', pt);

/**
 * Register a dictionary for a locale.
 * Intended for lazy loading: `registerDictionary('de', deDict)`.
 */
export function registerDictionary(locale: QpmLocale, dict: Dictionary): void {
  dictionaries.set(locale, dict);
}

// The glossary rule marks an unchecked translation '[VERIFY] <English>'; users get the English text instead.
const UNVERIFIED = '[VERIFY]';

function lookup(dict: Dictionary | undefined, key: I18nKey): string | undefined {
  return dict && key in dict ? dict[key] : undefined;
}

/** Look up a raw template string from the active locale, falling back to English. */
function resolve(key: I18nKey, locale: string): string | undefined {
  const value = lookup(dictionaries.get(locale), key);
  if (locale === 'en') return value;
  if (value !== undefined && !value.startsWith(UNVERIFIED)) return value;
  return lookup(dictionaries.get('en'), key) ?? value;
}

/** True when the key exists in the active locale OR the English fallback. */
export function hasKey(key: I18nKey): boolean {
  const locale = getCurrentLocale();
  const localeDict = dictionaries.get(locale);
  if (localeDict && key in localeDict) return true;
  if (locale === 'en') return false;
  const enDict = dictionaries.get('en');
  return !!(enDict && key in enDict);
}

/** Simple `{name}` interpolation. No HTML evaluation. */
function interpolate(template: string, vars: I18nVars): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    if (name in vars) return String(vars[name]);
    return match;
  });
}

/**
 * Translate a key immediately using the active locale.
 *
 * Resolution order: active locale dict → English dict → `fallback` arg → key itself.
 */
export function t(key: I18nKey, vars?: I18nVars, fallback?: string): string {
  const locale = getCurrentLocale();
  const template = resolve(key, locale) ?? fallback ?? key;
  return vars ? interpolate(template, vars) : template;
}

/**
 * Create a deferred `LocalizedString` that will be resolved later
 * (e.g. when passed to `bindText` or `text`).
 */
export function l(key: I18nKey, fallback?: string, vars?: I18nVars): LocalizedString {
  return { __localized: true, key, vars, fallback };
}

/** Resolve a `LocalizedString` to a plain string using the current locale. */
export function resolveLocalized(ls: LocalizedString): string {
  return t(ls.key, ls.vars, ls.fallback);
}
