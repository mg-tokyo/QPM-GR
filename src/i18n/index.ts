// src/i18n/index.ts — Public barrel

export type {
  QpmLocale,
  LocaleMode,
  I18nKey,
  I18nVars,
  LocalizedString,
  DisplayText,
  Dictionary,
} from './types';

export {
  initLocale,
  destroyLocale,
  getCurrentLocale,
  getLocaleMode,
  setLocaleMode,
  subscribeLocale,
} from './gameLocale';

export { t, l, registerDictionary } from './dictionary';
export { text, bindText, bindAttr } from './dom';
export { formatNumber, formatDate, formatRelativeTime } from './format';
export { SUPPORTED_LOCALES, isSupportedQpmLocale, normalizeLocale, RTL_LOCALES } from './locales';
