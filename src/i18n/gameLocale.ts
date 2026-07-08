// src/i18n/gameLocale.ts

import { storage } from '../utils/storage';
import { readLocalRaw } from '../utils/storage';
import { visibleInterval } from '../utils/scheduling/timerManager';
import type { QpmLocale, LocaleMode } from './types';
import { isSupportedQpmLocale, normalizeLocale } from './locales';

const LOCALE_OVERRIDE_KEY = 'qpm.localeOverride.v1';
const GAME_LOCALE_LS_KEY = 'locale';
const POLL_INTERVAL_MS = 30_000;

type LocaleListener = (locale: QpmLocale) => void;

let currentLocale: QpmLocale = 'en';
let currentMode: LocaleMode = 'follow-game';
const listeners = new Set<LocaleListener>();
const cleanups: Array<() => void> = [];

// --- Detection ---

/** Read the game's persisted locale from localStorage (JSON-encoded by Jotai persistedAtom). */
function readGameLocaleFromStorage(): QpmLocale | null {
  const raw = readLocalRaw(GAME_LOCALE_LS_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'string' && isSupportedQpmLocale(parsed)) {
      return parsed as QpmLocale;
    }
  } catch {
    // Not valid JSON — try as plain string
    if (typeof raw === 'string' && isSupportedQpmLocale(raw)) {
      return raw as QpmLocale;
    }
  }
  return null;
}

/** Read from <html lang="...">. */
function readHtmlLang(): QpmLocale | null {
  try {
    const lang = document.documentElement.lang;
    if (!lang) return null;
    const normalized = normalizeLocale(lang);
    return normalized && isSupportedQpmLocale(normalized)
      ? (normalized as QpmLocale)
      : null;
  } catch {
    return null;
  }
}

/** Read from navigator.language. */
function readNavigatorLocale(): QpmLocale | null {
  try {
    const lang = navigator.language;
    if (!lang) return null;
    const normalized = normalizeLocale(lang);
    return normalized && isSupportedQpmLocale(normalized)
      ? (normalized as QpmLocale)
      : null;
  } catch {
    return null;
  }
}

/** Detect the game locale using the cascade: storage → html lang → navigator → 'en'. */
function detectGameLocale(): QpmLocale {
  return (
    readGameLocaleFromStorage() ??
    readHtmlLang() ??
    readNavigatorLocale() ??
    'en'
  );
}

/** Resolve the effective locale based on mode. */
function resolveLocale(): QpmLocale {
  if (currentMode !== 'follow-game') {
    return currentMode;
  }
  return detectGameLocale();
}

// --- Notification ---

function notifyIfChanged(): void {
  const next = resolveLocale();
  if (next === currentLocale) return;
  currentLocale = next;
  for (const fn of listeners) {
    try {
      fn(currentLocale);
    } catch (err) {
      console.error('[QPM][i18n] Locale listener error:', err);
    }
  }
}

// --- Change detection observers ---

function startHtmlLangObserver(): void {
  try {
    const observer = new MutationObserver(() => notifyIfChanged());
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['lang'],
    });
    cleanups.push(() => observer.disconnect());
  } catch {
    // MutationObserver unavailable — silent fallback
  }
}

function startStorageEventListener(): void {
  const handler = (e: StorageEvent): void => {
    if (e.key === GAME_LOCALE_LS_KEY) {
      notifyIfChanged();
    }
  };
  window.addEventListener('storage', handler);
  cleanups.push(() => window.removeEventListener('storage', handler));
}

function startPolling(): void {
  const stop = visibleInterval('i18n-gamelocale-poll', () => notifyIfChanged(), POLL_INTERVAL_MS);
  cleanups.push(stop);
}

// --- Public API ---

/**
 * Initialise locale detection. Call once during boot (after storage init, before UI).
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function initLocale(): void {
  // Load persisted mode
  const stored = storage.get<string>(LOCALE_OVERRIDE_KEY, 'follow-game');
  if (stored === 'follow-game') {
    currentMode = 'follow-game';
  } else if (typeof stored === 'string' && isSupportedQpmLocale(stored)) {
    currentMode = stored as QpmLocale;
  } else {
    currentMode = 'follow-game';
  }

  // Set initial locale
  currentLocale = resolveLocale();

  // Start change detection
  startHtmlLangObserver();
  startStorageEventListener();
  startPolling();
}

/** Tear down all observers. Primarily for testing. */
export function destroyLocale(): void {
  for (const fn of cleanups) {
    try {
      fn();
    } catch {}
  }
  cleanups.length = 0;
  listeners.clear();
}

/** Get the currently active locale. */
export function getCurrentLocale(): QpmLocale {
  return currentLocale;
}

/** Get the current locale mode. */
export function getLocaleMode(): LocaleMode {
  return currentMode;
}

/**
 * Set locale mode. Persists to storage.
 * - `'follow-game'` — mirror the game setting
 * - A specific locale code — override
 */
export function setLocaleMode(mode: LocaleMode): void {
  currentMode = mode;
  storage.set(LOCALE_OVERRIDE_KEY, mode);
  notifyIfChanged();
}

/**
 * Subscribe to locale changes. Returns an unsubscribe function.
 * The listener is called immediately with the current locale.
 */
export function subscribeLocale(fn: LocaleListener): () => void {
  listeners.add(fn);
  try {
    fn(currentLocale);
  } catch (err) {
    console.error('[QPM][i18n] Locale listener error:', err);
  }
  return () => listeners.delete(fn);
}
