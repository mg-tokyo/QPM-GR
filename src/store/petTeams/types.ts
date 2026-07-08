import type { WebSocketSendFailureReason } from '../../websocket/api';

export type ApplyErrorReason =
  | 'missing_connection'
  | 'missing_source_pet'
  | 'not_found'
  | 'retrieve_failed_or_inventory_full'
  | 'hutch_store_failed_or_full'
  | 'store_failed_or_timeout'
  | 'swap_failed_or_timeout'
  | 'place_failed_or_timeout'
  | 'balance_unpaired_hutch_target'
  | 'unknown';

export interface ApplyTeamResult {
  applied: number;
  errors: string[];
  reasonCounts?: Partial<Record<ApplyErrorReason, number>>;
  errorSummary?: string;
}

export interface InventorySnapshot {
  ids: Set<string>;
  petIds: string[];
  freeIndex: number | null;
  /** Total number of non-null items in inventory. */
  totalCount: number;
}

export interface HutchSnapshot {
  ids: Set<string>;
  count: number;
  hutchMax: number;
  freeIndex: number | null;
}

export function mapSendReason(
  reason: WebSocketSendFailureReason | undefined,
  fallback: ApplyErrorReason,
): ApplyErrorReason {
  switch (reason) {
    case 'no_connection':
      return 'missing_connection';
    case 'invalid_payload':
      return 'missing_source_pet';
    default:
      return fallback;
  }
}

export function incrementReasonCount(
  reasonCounts: Partial<Record<ApplyErrorReason, number>>,
  reason: ApplyErrorReason,
): void {
  reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
}

export function buildErrorSummary(reasonCounts: Partial<Record<ApplyErrorReason, number>>): string | undefined {
  const labels: Record<ApplyErrorReason, string> = {
    missing_connection: 'No connection',
    missing_source_pet: 'Missing pet IDs',
    not_found: 'Pet not found',
    retrieve_failed_or_inventory_full: 'Inventory full / retrieve failed',
    hutch_store_failed_or_full: 'Hutch full / store failed',
    store_failed_or_timeout: 'Store timeout',
    swap_failed_or_timeout: 'Swap timeout',
    place_failed_or_timeout: 'Place timeout',
    balance_unpaired_hutch_target: 'No outgoing pet for hutch balance',
    unknown: 'Unknown',
  };

  const entries = Object.entries(reasonCounts)
    .filter(([, count]) => typeof count === 'number' && count > 0)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .slice(0, 3);

  if (entries.length === 0) {
    return undefined;
  }

  return entries
    .map(([reason, count]) => labels[reason as ApplyErrorReason] + ' x' + String(count))
    .join(', ');
}
