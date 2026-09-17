// src/core/reactive/pathMatcher.ts
// JSON Pointer prefix matching for patch-based subscription routing.
//
// A patch has a full path (e.g. '/child/data/userSlots/2/data/inventory/items/3/quantity').
// A subscription declares a path prefix; a match is either exact equality, a
// patch BELOW the subscription (descendant — the classic case), or a patch
// ABOVE it (ancestor — a slot replace at '/child/data/userSlots/2' rewrites
// '/child/data/userSlots/2/data/petTeams'). Both directions require a '/'
// segment boundary — so 'inv' never matches 'inventory'.

const MY_IDX_PLACEHOLDER = '{myIdx}';

/** True when the subscription prefix carries the `{myIdx}` placeholder. */
export function hasMyIdxPlaceholder(subscriptionPrefix: string): boolean {
  return subscriptionPrefix.includes(MY_IDX_PLACEHOLDER);
}

function isSegmentPrefix(shorter: string, longer: string): boolean {
  return longer.startsWith(shorter) && longer.charCodeAt(shorter.length) === 47; // '/'
}

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
  if (hasMyIdxPlaceholder(prefix)) {
    if (myIdx === null) return false;
    prefix = prefix.split(MY_IDX_PLACEHOLDER).join(String(myIdx));
  }
  if (prefix === '' || patchPath === prefix) return true;
  // Descendant patch (below the subscription) OR ancestor patch (a replace
  // above it rewrites the whole subtree — plain JSON-Patch semantics).
  return isSegmentPrefix(prefix, patchPath) || isSegmentPrefix(patchPath, prefix);
}
