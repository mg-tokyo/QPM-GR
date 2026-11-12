import { isMirrorAvailable, mirrorGet, mirrorKeys, mirrorRemove, mirrorSet } from './storageMirror';

type LegacyGmGetValue = (key: string) => string | undefined;
type LegacyGmSetValue = (key: string, value: string) => void;
type LegacyGmDeleteValue = (key: string) => void;
type LegacyGmListValues = () => string[];

export interface LegacyGmStorageApi {
  getValue: LegacyGmGetValue;
  setValue: LegacyGmSetValue;
  deleteValue: LegacyGmDeleteValue;
  listValues?: LegacyGmListValues;
}

export interface ModernGmStorageApi {
  getValue: <T = unknown>(key: string, defaultValue?: T) => Promise<T>;
  setValue: (key: string, value: string) => Promise<void>;
  deleteValue: (key: string) => Promise<void>;
  listValues?: () => Promise<string[]>;
}

const globalScope = globalThis as Record<string, unknown>;

function getLocalStorageSafe(): globalThis.Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function readLocalRaw(key: string): string | null {
  const ls = getLocalStorageSafe();
  if (!ls) return null;
  try {
    return ls.getItem(key);
  } catch {
    return null;
  }
}

export function writeLocalRaw(key: string, raw: string): boolean {
  const ls = getLocalStorageSafe();
  if (!ls) return false;
  try {
    ls.setItem(key, raw);
    return true;
  } catch {
    return false;
  }
}

export function removeLocalKey(key: string): void {
  const ls = getLocalStorageSafe();
  if (!ls) return;
  try {
    ls.removeItem(key);
  } catch {}
}

export function listLocalKeys(): string[] {
  const ls = getLocalStorageSafe();
  if (!ls) return [];
  try {
    return Object.keys(ls);
  } catch {
    return [];
  }
}

// Mirror facade. The in-memory map always serves reads; IndexedDB persists it. Without
// IDB the persistence falls back to localStorage, where a failed (quota) write must
// remove the stale copy rather than leave it to be read back on the next load.
export function mirrorWrite(key: string, raw: string): void {
  mirrorSet(key, raw);
  if (!isMirrorAvailable() && !writeLocalRaw(key, raw)) removeLocalKey(key);
}

export function mirrorDelete(key: string): void {
  mirrorRemove(key);
  removeLocalKey(key);
}

export function mirrorRead(key: string): string | null {
  const raw = mirrorGet(key);
  if (raw != null || isMirrorAvailable()) return raw;
  return readLocalRaw(key);
}

export function mirrorKeyList(): string[] {
  return Array.from(new Set([...mirrorKeys(), ...listLocalKeys()]));
}

export function serialize(value: unknown): string {
  return JSON.stringify(value);
}

export function deserialize<T>(raw: string | null | undefined, fallback: T): T {
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return raw as T;
  }
}

export function getLegacyGmApi(): LegacyGmStorageApi | null {
  const getValue = globalScope.GM_getValue;
  const setValue = globalScope.GM_setValue;
  const deleteValue = globalScope.GM_deleteValue;
  const listValues = globalScope.GM_listValues;

  if (
    typeof getValue === 'function' &&
    typeof setValue === 'function' &&
    typeof deleteValue === 'function'
  ) {
    const api: LegacyGmStorageApi = {
      getValue: getValue as LegacyGmGetValue,
      setValue: setValue as LegacyGmSetValue,
      deleteValue: deleteValue as LegacyGmDeleteValue,
    };
    if (typeof listValues === 'function') {
      api.listValues = listValues as LegacyGmListValues;
    }
    return api;
  }

  return null;
}

export function getModernGmApi(): ModernGmStorageApi | null {
  const gm = globalScope.GM;
  if (!gm || typeof gm !== 'object') return null;

  const gmRecord = gm as Record<string, unknown>;
  const getValue = gmRecord.getValue;
  const setValue = gmRecord.setValue;
  const deleteValue = gmRecord.deleteValue;
  const listValues = gmRecord.listValues;

  if (
    typeof getValue === 'function' &&
    typeof setValue === 'function' &&
    typeof deleteValue === 'function'
  ) {
    const api: ModernGmStorageApi = {
      getValue: getValue as <T = unknown>(key: string, defaultValue?: T) => Promise<T>,
      setValue: setValue as (key: string, value: string) => Promise<void>,
      deleteValue: deleteValue as (key: string) => Promise<void>,
    };
    if (typeof listValues === 'function') {
      api.listValues = listValues as () => Promise<string[]>;
    }
    return api;
  }

  return null;
}
