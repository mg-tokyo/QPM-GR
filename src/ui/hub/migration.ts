// src/ui/hubWindow/migration.ts — One-time migration from old hub storage

import { storage } from '../../utils/storage';

const MIGRATION_KEY = 'qpm.hub.migrated.v1';

/**
 * Migrate from old 3-hub visibility keys to unified hub.
 * Old keys are preserved for one version cycle (users can downgrade safely).
 */
export function migrateHubStorage(): void {
  if (storage.get<boolean>(MIGRATION_KEY, false)) return;
  // Mark migration complete. Old keys are no longer read by anything
  // but we don't delete them yet in case user rolls back.
  storage.set(MIGRATION_KEY, true);
}
