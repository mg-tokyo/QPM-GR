// src/i18n/dom.ts

import type { DisplayText, LocalizedString } from './types';
import { t, resolveLocalized } from './dictionary';
import { subscribeLocale } from './gameLocale';

/** Check if a value is a deferred LocalizedString. */
function isLocalized(value: DisplayText): value is LocalizedString {
  return typeof value === 'object' && value !== null && '__localized' in value;
}

/**
 * Resolve a `DisplayText` to a plain string immediately.
 * - If it's already a string, returns it as-is.
 * - If it's a `LocalizedString`, resolves it via the current locale.
 */
export function text(value: DisplayText): string {
  if (typeof value === 'string') return value;
  if (isLocalized(value)) return resolveLocalized(value);
  return String(value);
}

/**
 * Set an element's `textContent` and keep it updated when the locale changes.
 * Returns an unsubscribe function.
 *
 * For plain strings, sets once and returns a no-op unsubscribe.
 * For `LocalizedString` values, subscribes to locale changes.
 */
export function bindText(el: HTMLElement, value: DisplayText): () => void {
  if (typeof value === 'string') {
    el.textContent = value;
    return () => {};
  }

  if (isLocalized(value)) {
    // Set immediately
    el.textContent = resolveLocalized(value);

    // Re-resolve on locale change
    const unsub = subscribeLocale(() => {
      el.textContent = resolveLocalized(value);
    });
    return unsub;
  }

  el.textContent = String(value);
  return () => {};
}

/**
 * Set an element attribute and keep it updated when the locale changes.
 * Useful for `title`, `aria-label`, `placeholder`, etc.
 * Returns an unsubscribe function.
 */
export function bindAttr(
  el: HTMLElement,
  attr: string,
  value: DisplayText,
): () => void {
  if (typeof value === 'string') {
    el.setAttribute(attr, value);
    return () => {};
  }

  if (isLocalized(value)) {
    el.setAttribute(attr, resolveLocalized(value));

    const unsub = subscribeLocale(() => {
      el.setAttribute(attr, resolveLocalized(value));
    });
    return unsub;
  }

  el.setAttribute(attr, String(value));
  return () => {};
}
