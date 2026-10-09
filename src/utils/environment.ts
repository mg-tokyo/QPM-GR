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

// The game's Discord activity shell (installDiscordFrameHost) replaces its body with one
// same-origin <iframe> that loads the game; our @match runs a second QPM in that child.
// Decidable only once parsed — the shell script runs during parsing.
export function isGameFrameHost(doc: Document = document): boolean {
  if (doc.readyState === 'loading') return false;
  const body = doc.body;
  if (!body || body.childElementCount !== 1) return false;
  const only = body.firstElementChild;
  // tagName, not instanceof: Firefox Xray wrappers fail cross-realm instanceof.
  if (!only || only.tagName !== 'IFRAME') return false;
  const src = only.getAttribute('src');
  if (!src) return false;
  try {
    return new URL(src, doc.baseURI).origin === doc.location?.origin;
  } catch {
    return false;
  }
}
