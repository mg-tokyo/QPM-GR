// Shared diagnostics wiring for the mutation-reminder pipeline.
// Covers the sibling garden-side tracker (src/features/mutations/tracker.ts)
// AND the inventory-side reminder (src/features/mutations/reminder/*).
// Both publish under the same subsystem because they are two halves of the
// same summary-emitter feature and share a lifecycle.

import { createFeatureDiagnostics } from '../../../diagnostics/featureDiagnostics';
import type { Subsystem } from '../../../diagnostics/types';

export const MUTATION_REMINDER_SUBSYSTEM: Subsystem = 'feature:mutationReminder';

const d = createFeatureDiagnostics(MUTATION_REMINDER_SUBSYSTEM, 'mutationReminder');

export const reminderDiag = d.diag;
export const ensureReminderBusRegistered = d.ensureBusRegistered;
export const publishReminderOk = d.publishOk;
export const warnReminderFeature = d.warnFeature;
