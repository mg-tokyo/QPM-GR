import { t } from '../../../i18n';

export interface PurchaseRefusal {
  message: string;
  /** The server may accept the same purchase on a later press (load, sequencing), so the card stays. */
  retryable: boolean;
}

// Server reject codes: beta common/games/Quinoa/messages.ts QuinoaCommandRejectCode; dropped_stale is QPM-minted.
const REFUSAL_KEYS: Readonly<Record<string, { key: string; retryable: boolean }>> = {
  insufficient_currency: { key: 'feature.restockAlert.notEnoughBalance', retryable: false },
  already_owned: { key: 'feature.restockAlert.refusalAlreadyOwned', retryable: false },
  account_required: { key: 'feature.restockAlert.refusalAccountRequired', retryable: false },
  rejected: { key: 'feature.restockAlert.refusalRejected', retryable: false },
  rate_limited: { key: 'feature.restockAlert.refusalRateLimited', retryable: true },
  write_conflict: { key: 'feature.restockAlert.refusalServerBusy', retryable: true },
  dropped_stale: { key: 'feature.restockAlert.refusalNotProcessed', retryable: true },
  invalid_sequence: { key: 'feature.restockAlert.refusalNotProcessed', retryable: true },
};

export function describePurchaseRefusal(code: string | undefined): PurchaseRefusal {
  const known = code && Object.prototype.hasOwnProperty.call(REFUSAL_KEYS, code) ? REFUSAL_KEYS[code] : undefined;
  if (known) return { message: t(known.key), retryable: known.retryable };
  return code
    ? { message: t('feature.restockAlert.refusalWithCode', { code }), retryable: false }
    : { message: t('feature.restockAlert.refusalRejected'), retryable: false };
}

/** Across a batch, a refusal that will not change on retry outranks one that might. */
export function mergeRefusals(prev: PurchaseRefusal | null, next: PurchaseRefusal): PurchaseRefusal {
  if (prev && !prev.retryable && next.retryable) return prev;
  return next;
}
