import { storage } from '../../../utils/storage';
import { createNamedLogger } from '../../../diagnostics/logger';
import { TD_CUSTOM_DESIGNS_KEY, type TDCustomDesignsV1 } from './types';

const log = createNamedLogger('td-custom-designs');

function isValid(v: unknown): v is TDCustomDesignsV1 {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as { version?: unknown; library?: unknown; bindings?: unknown };
  return r.version === 1 && Array.isArray(r.library) && Array.isArray(r.bindings);
}

function freshState(): TDCustomDesignsV1 {
  return { version: 1, library: [], bindings: [] };
}

export function loadStoredState(): TDCustomDesignsV1 {
  const raw = storage.get<unknown>(TD_CUSTOM_DESIGNS_KEY, null);
  if (raw === null || raw === undefined) return freshState();
  if (isValid(raw)) return raw;
  const backupKey = `${TD_CUSTOM_DESIGNS_KEY}.corrupt.${Date.now()}`;
  try {
    storage.set(backupKey, raw);
    log.warn('QPM-TDCDINIT-001', { backedUpTo: backupKey, reason: 'shape mismatch' });
  } catch (e) {
    log.error('QPM-TDCDINIT-001', { backupFailed: true, error: String(e) });
  }
  return freshState();
}

export function saveStoredState(state: TDCustomDesignsV1): void {
  storage.set(TD_CUSTOM_DESIGNS_KEY, state);
}

export function clearStoredState(): void {
  storage.remove(TD_CUSTOM_DESIGNS_KEY);
}
