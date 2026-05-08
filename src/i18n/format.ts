// src/i18n/format.ts
// Locale-aware Intl wrappers. Stub exports for now — Stage 4 will flesh these out.

import { getCurrentLocale } from './gameLocale';

/**
 * Format a number using the active locale's conventions.
 * e.g. 1234.5 → '1,234.5' (en) or '1.234,5' (de).
 */
export function formatNumber(
  value: number,
  options?: Intl.NumberFormatOptions,
): string {
  try {
    return new Intl.NumberFormat(getCurrentLocale(), options).format(value);
  } catch {
    return String(value);
  }
}

/**
 * Format a date using the active locale's conventions.
 */
export function formatDate(
  value: Date | number,
  options?: Intl.DateTimeFormatOptions,
): string {
  try {
    return new Intl.DateTimeFormat(getCurrentLocale(), options).format(value);
  } catch {
    return String(value);
  }
}

/**
 * Format a relative time (e.g. "3 hours ago") using the active locale.
 */
export function formatRelativeTime(
  value: number,
  unit: Intl.RelativeTimeFormatUnit,
  options?: Intl.RelativeTimeFormatOptions,
): string {
  try {
    return new Intl.RelativeTimeFormat(getCurrentLocale(), options).format(value, unit);
  } catch {
    return `${value} ${unit}`;
  }
}
