import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QpmLocale } from './types';

let locale: QpmLocale = 'en';
vi.mock('./gameLocale', () => ({ getCurrentLocale: () => locale }));

const { registerDictionary, t } = await import('./dictionary');

// Keys go through a table: check:i18n reads every literal t('…') in src as a used key.
const K = { plain: 'x.plain', marked: 'x.marked', vars: 'x.vars', deOnly: 'x.deOnly', odd: 'x.odd' } as const;

describe('t() and [VERIFY] placeholders (polish P14)', () => {
  beforeEach(() => {
    registerDictionary('en', { [K.plain]: 'Hello', [K.marked]: 'Look sensitivity', [K.vars]: 'Hi {name}' });
    registerDictionary('de', { [K.plain]: 'Hallo', [K.marked]: '[VERIFY] Look sensitivity', [K.vars]: '[VERIFY] Hi {name}', [K.deOnly]: '[VERIFY] Only here' });
  });

  it('a translated value is used as is', () => {
    locale = 'de';
    expect(t(K.plain)).toBe('Hallo');
  });

  it('a value still marked [VERIFY] falls back to English', () => {
    locale = 'de';
    expect(t(K.marked)).toBe('Look sensitivity');
    expect(t(K.vars, { name: 'Mx' })).toBe('Hi Mx');
  });

  it('with no English value the marked value is all there is', () => {
    locale = 'de';
    expect(t(K.deOnly)).toBe('[VERIFY] Only here');
  });

  it('English itself is never filtered', () => {
    locale = 'en';
    registerDictionary('en', { [K.odd]: '[VERIFY] kept' });
    expect(t(K.odd)).toBe('[VERIFY] kept');
  });
});
