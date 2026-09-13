import type { OwnershipBaseline } from './types';

/**
 * Names the specific confirmation-source gaps that made a purchase unconfirmable,
 * so the alert-card status text explains WHY rather than just "no confirmation source".
 * Returns "" (no gap suffix) when both signals are available.
 */
export function describeConfirmationSourceGaps(baseline: OwnershipBaseline, hasEnvelope: boolean): string {
  const gaps: string[] = [];
  if (!baseline.includeInventory) gaps.push('inventory unbound');
  if (!hasEnvelope) gaps.push('legacy transport');
  if (gaps.length === 0) return '';
  return ` (${gaps.join(', ')})`;
}
