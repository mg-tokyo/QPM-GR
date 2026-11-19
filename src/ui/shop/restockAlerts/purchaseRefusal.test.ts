import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../i18n', () => ({
  t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key}${JSON.stringify(vars)}` : key),
}));

import { describePurchaseRefusal, mergeRefusals } from './purchaseRefusal';

describe('describePurchaseRefusal', () => {
  it.each([
    ['insufficient_currency', 'feature.restockAlert.notEnoughBalance', false],
    ['already_owned', 'feature.restockAlert.refusalAlreadyOwned', false],
    ['account_required', 'feature.restockAlert.refusalAccountRequired', false],
    ['rejected', 'feature.restockAlert.refusalRejected', false],
    ['rate_limited', 'feature.restockAlert.refusalRateLimited', true],
    ['write_conflict', 'feature.restockAlert.refusalServerBusy', true],
    ['dropped_stale', 'feature.restockAlert.refusalNotProcessed', true],
    ['invalid_sequence', 'feature.restockAlert.refusalNotProcessed', true],
  ])('%s → %s (retryable %s)', (code, message, retryable) => {
    expect(describePurchaseRefusal(code)).toEqual({ message, retryable });
  });

  it('names an unknown code and does not retry', () => {
    expect(describePurchaseRefusal('insufficient_credits')).toEqual({
      message: 'feature.restockAlert.refusalWithCode{"code":"insufficient_credits"}',
      retryable: false,
    });
  });

  it('treats inherited object keys as unknown codes', () => {
    expect(describePurchaseRefusal('toString').retryable).toBe(false);
    expect(describePurchaseRefusal('toString').message).toContain('refusalWithCode');
  });

  it('a missing code reads as a plain refusal', () => {
    expect(describePurchaseRefusal(undefined)).toEqual({ message: 'feature.restockAlert.refusalRejected', retryable: false });
  });
});

describe('mergeRefusals', () => {
  const final = { message: 'owned', retryable: false };
  const retry = { message: 'busy', retryable: true };

  it('keeps a final refusal over a later retryable one', () => {
    expect(mergeRefusals(final, retry)).toBe(final);
  });

  it('a final refusal replaces a retryable one', () => {
    expect(mergeRefusals(retry, final)).toBe(final);
  });

  it('the first refusal stands alone', () => {
    expect(mergeRefusals(null, retry)).toBe(retry);
  });
});
