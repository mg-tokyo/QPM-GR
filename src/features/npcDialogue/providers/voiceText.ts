import { t } from '../../../i18n';
import type { Voice } from '../types';

// t(key, vars, fallback) resolves active locale → English → fallback → key (i18n/dictionary.ts:66-70).
// Passing '' as fallback lets a missing themed key fall through to the neutral form.
export function voiced(base: string, voice: Voice, params?: Record<string, string | number>): string {
  if (voice !== 'neutral') {
    const themed = t(`${base}.${voice}`, params, '');
    if (themed) return themed;
  }
  return t(`${base}.neutral`, params);
}
