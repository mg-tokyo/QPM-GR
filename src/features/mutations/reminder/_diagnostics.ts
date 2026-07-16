// Shared diagnostics wiring for the mutation-reminder pipeline.
// Covers the sibling garden-side tracker (src/features/mutations/tracker.ts)
// AND the inventory-side reminder (src/features/mutations/reminder/*).
// Both publish under the same subsystem because they are two halves of the
// same summary-emitter feature and share a lifecycle.

import { createNamedLogger } from '../../../diagnostics/logger';
import { healthBus } from '../../../diagnostics/healthBus';
import { buildError } from '../../../diagnostics/result';
import type { ErrorCode, Subsystem } from '../../../diagnostics/types';

export const MUTATION_REMINDER_SUBSYSTEM: Subsystem = 'feature:mutationReminder';
const FEATURE_NAME = 'mutationReminder';

export const reminderDiag = createNamedLogger(MUTATION_REMINDER_SUBSYSTEM);

let busRegistered = false;

export function ensureReminderBusRegistered(): void {
  if (busRegistered) return;
  busRegistered = true;
  healthBus.register(MUTATION_REMINDER_SUBSYSTEM, {
    category: 'feature',
    status: 'starting',
  });
}

export function publishReminderOk(
  message: string,
  metrics?: Record<string, number | string>,
): void {
  ensureReminderBusRegistered();
  healthBus.publish({
    subsystem: MUTATION_REMINDER_SUBSYSTEM,
    category: 'feature',
    status: 'ok',
    message,
    ...(metrics ? { metrics } : {}),
  });
}

export function warnReminderFeature(
  code: ErrorCode,
  ctx: Record<string, unknown>,
  cause?: unknown,
): void {
  ensureReminderBusRegistered();
  const built = buildError(code, { feature: FEATURE_NAME, ...ctx }, cause);
  reminderDiag.warn({ ...built, subsystem: MUTATION_REMINDER_SUBSYSTEM, severity: 'warn' });
}
