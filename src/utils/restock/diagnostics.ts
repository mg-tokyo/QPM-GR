// src/utils/restock/diagnostics.ts
// Health-bus wiring + named logger for the restockData subsystem.
// Lives in a sister file so the (already-over-hard-limit) dataService.ts diff
// stays minimal — see tracker item 5.4 / design §4.4 RESTOCK row.

import { healthBus } from '../../diagnostics/healthBus';
import { createNamedLogger } from '../../diagnostics/logger';

const RESTOCK_SUBSYSTEM = 'restockData';

export const restockLog = createNamedLogger(RESTOCK_SUBSYSTEM);

let registered = false;

/**
 * Register restockData with the bus in 'starting' state. Idempotent.
 * dataService.ts seeds 'ok' from cache after this if a usable snapshot exists.
 */
export function registerRestockBus(): void {
  if (registered) return;
  registered = true;
  healthBus.register(RESTOCK_SUBSYSTEM, { category: 'service', status: 'starting' });
}

/** Publish a successful fetch / cached snapshot. */
export function publishRestockOk(itemCount: number, fetchedAt: number): void {
  healthBus.publish({
    subsystem: RESTOCK_SUBSYSTEM,
    category: 'service',
    status: 'ok',
    message: `${itemCount} item${itemCount === 1 ? '' : 's'} cached`,
    metrics: { itemCount, fetchedAt },
  });
}

/**
 * Fetch path failed but the path is recoverable (cache fallback served or
 * caller will retry). Bus auto-degrades via the warn transport.
 */
export function warnRestockFetch(
  context: Record<string, unknown>,
  cause?: unknown,
): void {
  restockLog.warn('QPM-RESTOCK-001', context, cause);
}

/**
 * Fetch path failed and the caller will see the throw (force-refresh path).
 * Bus moves to 'failed' via the error transport.
 */
export function errorRestockFetch(
  context: Record<string, unknown>,
  cause?: unknown,
): void {
  restockLog.error('QPM-RESTOCK-001', context, cause);
}

/** Response parsed but was unparseable or unexpected shape. */
export function warnRestockParse(
  context: Record<string, unknown>,
  cause?: unknown,
): void {
  restockLog.warn('QPM-RESTOCK-002', context, cause);
}

/** RESTOCK_URL malformed or anon key missing — static for the session. */
export function warnRestockConfig(context: Record<string, unknown>): void {
  restockLog.warn('QPM-RESTOCK-003', context);
}
