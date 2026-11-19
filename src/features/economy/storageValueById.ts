// The storage value of one storage building, for surfaces that show several storages at once.
import { areCatalogsReady, onCatalogsReady } from '../../catalogs/gameCatalogs';
import { getFriendBonusMultiplier } from '../../store/friendBonus';
import {
  computeStorageValueById, getCachedStorages, getStorageValueConfig, onStorageDataChange, onStorageValueChange,
} from './storageValue';

export type StorageValueReading = { status: 'ready'; value: number } | { status: 'loading' };

/** 2dp k/M/B/T, as the storage window's value label shows it. */
export function formatStorageValue(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000_000) return `${(value / 1_000_000_000_000).toFixed(2)}T`;
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(2)}k`;
  return value.toFixed(0);
}

/**
 * What the storage window's label would show for this storage (`panelId` is the game's panel id, e.g. petHutch).
 * Null: that storage has no value label (switched off, not owned, or not one the value feature covers).
 */
export function readStorageValue(storageId: string, panelId: string): StorageValueReading | null {
  const config: Record<string, unknown> = { ...getStorageValueConfig() };
  if (panelId === 'inventory' || config[panelId] !== true) return null;
  const storages = getCachedStorages();
  if (!storages.some(s => !!s && typeof s === 'object' && (s as Record<string, unknown>).decorId === storageId)) return null;
  if (!areCatalogsReady()) return { status: 'loading' };
  return { status: 'ready', value: computeStorageValueById(storages, storageId, getFriendBonusMultiplier()) ?? 0 };
}

/** Fires when anything a storage value is read from may have changed (storage contents, settings, catalogs). */
export function onStorageValueInputsChange(cb: () => void): () => void {
  const offs = [onStorageDataChange(cb), onStorageValueChange(() => cb()), onCatalogsReady(() => cb())];
  return () => { for (const off of offs) off(); };
}
