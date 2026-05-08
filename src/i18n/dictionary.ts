// src/i18n/dictionary.ts

import type { Dictionary, I18nKey, I18nVars, LocalizedString, QpmLocale } from './types';
import { getCurrentLocale } from './gameLocale';
import en from './dictionaries/en';
import es from './dictionaries/es';

/** Registry of loaded dictionaries keyed by locale code. */
const dictionaries = new Map<string, Dictionary>();

// English is always loaded eagerly.
dictionaries.set('en', en);
dictionaries.set('es', es);

/**
 * Register a dictionary for a locale.
 * Intended for lazy loading: `registerDictionary('de', deDict)`.
 */
export function registerDictionary(locale: QpmLocale, dict: Dictionary): void {
  dictionaries.set(locale, dict);
}

/** Look up a raw template string from the active locale, falling back to English. */
function resolve(key: I18nKey, locale: string): string | undefined {
  const localeDict = dictionaries.get(locale);
  if (localeDict && key in localeDict) return localeDict[key];

  // Fallback to English
  if (locale !== 'en') {
    const enDict = dictionaries.get('en');
    if (enDict && key in enDict) return enDict[key];
  }

  return undefined;
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
