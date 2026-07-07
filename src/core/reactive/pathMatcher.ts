// src/core/reactive/pathMatcher.ts
// JSON Pointer prefix matching for patch-based subscription routing.
//
// A patch has a full path (e.g. '/child/data/userSlots/2/data/inventory/items/3/quantity').
// A subscription declares a path prefix; a match is either exact equality OR
// a prefix followed by a '/' segment boundary — so 'inv' never matches 'inventory'.

const MY_IDX_PLACEHOLDER = '{myIdx}';

/**
 * Match a JSON Pointer patch path against a subscription prefix. Both are
 * JSON Pointer strings (leading '/', segments separated by '/').
 *
 * `subscriptionPrefix` may contain '{myIdx}' placeholders which are replaced
 * with the caller-supplied `myIdx` (as a string) before matching. If the
 * placeholder is present and `myIdx` is null, we return false — no local
 * player slot resolved yet means the subscription cannot match anything.
 */
export function matchesPathPrefix(
  patchPath: string,
  subscriptionPrefix: string,
  myIdx: number | null,
): boolean {
  let prefix = subscriptionPrefix;
  if (prefix.includes(MY_IDX_PLACEHOLDER)) {
    if (myIdx === null) return false;
    prefix = prefix.split(MY_IDX_PLACEHOLDER).join(String(myIdx));
  }
  if (prefix === '') return true;
  if (patchPath === prefix) return true;
  if (!patchPath.startsWith(prefix)) return false;
  return patchPath.charCodeAt(prefix.length) === 47; // '/'
}
