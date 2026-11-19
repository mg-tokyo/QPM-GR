// What an open needs from the game, and how a failed or cancelled open is reported.
import { getStoragePanelIds } from '../../catalogs/logic/gamePanelsCatalog';
import { createFeatureDiagnostics } from '../../diagnostics/featureDiagnostics';
import { checkStorageSystem, findStorageSystem, type StorageHandles } from './gameHooks';

export type OpenResult =
  | { ok: true; storageIds: string[] }
  | { ok: false; reason: 'busy' | 'open' | 'no-storages' | 'unavailable' | 'failed' | 'cancelled'; missing?: string[] };

export const CANCELLED: OpenResult = { ok: false, reason: 'cancelled' };

export const diagnostics = createFeatureDiagnostics('feature:multiStorage', 'multiStorage');

let simulatedMissing: readonly string[] = [];
let lastMissingKey = '';

/** Debug only: the next checks report these handles as missing (a test double for a changed game). */
export function setSimulatedMissing(names: readonly string[] | null): void {
  simulatedMissing = names ? [...names] : [];
}

type Probe = ({ ok: true; panelIds: readonly string[] } & StorageHandles) | { ok: false; missing: string[] };

export function probeStorageCapabilities(): Probe {
  const check = checkStorageSystem(findStorageSystem());
  const panelIds = getStoragePanelIds();
  const missing = [...(check.ok ? [] : check.missing), ...(panelIds ? [] : ['storage-panels']), ...simulatedMissing];
  if (!check.ok || !panelIds || missing.length > 0) return { ok: false, missing };
  return { ...check, panelIds };
}

/** Logged once per distinct set of missing handles, until an open succeeds. */
export function reportMissing(missing: string[]): OpenResult {
  const key = missing.join(',');
  if (key !== lastMissingKey) {
    lastMissingKey = key;
    diagnostics.warnFeature('QPM-MSTORE-001', { missing });
  }
  return { ok: false, reason: 'unavailable', missing };
}

export function clearMissingReport(): void {
  lastMissingKey = '';
}

export function failOpen(stage: string, error?: unknown): OpenResult {
  diagnostics.warnFeature('QPM-MSTORE-002', { stage }, error);
  return { ok: false, reason: 'failed' };
}
