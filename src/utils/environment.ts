/** True when running inside Discord's activity iframe. */
export const isDiscordSurface: boolean =
  typeof location !== 'undefined' && location.hostname.includes('discord');

function hasLegacyGmStorage(): boolean {
  const scope = globalThis as Record<string, unknown>;
  return (
    typeof scope.GM_getValue === 'function' &&
    typeof scope.GM_setValue === 'function' &&
    typeof scope.GM_deleteValue === 'function'
  );
}

function hasModernGmStorage(): boolean {
  const scope = globalThis as Record<string, unknown>;
  const gm = scope.GM;
  if (!gm || typeof gm !== 'object') return false;

  const api = gm as Record<string, unknown>;
  return (
    typeof api.getValue === 'function' &&
    typeof api.setValue === 'function' &&
    typeof api.deleteValue === 'function'
  );
}

/** True when any storage-capable GM APIs are available. */
export const hasGmApis: boolean = hasLegacyGmStorage() || hasModernGmStorage();
