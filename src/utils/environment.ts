import { gmLegacyStorage, gmModernStorage } from './gm';

/** True when running inside Discord's activity iframe. */
export const isDiscordSurface: boolean =
  typeof location !== 'undefined' && location.hostname.includes('discord');

/** True when any storage-capable GM APIs are available. */
export function hasGmApis(): boolean {
  return gmLegacyStorage() !== null || gmModernStorage() !== null;
}

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
