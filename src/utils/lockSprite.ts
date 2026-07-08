import { Sprites, getAnySpriteDataUrl, onSpritesReady } from '../sprite-v2/compat';

type LockState = 'locked' | 'unlocked';

const cache: Partial<Record<LockState, string>> = {};
let spritesReadyHookAttached = false;

function ensureSpritesReadyHook(): void {
  if (spritesReadyHookAttached) return;
  spritesReadyHookAttached = true;
  // Reset the cache when sprites become ready so any '' from pre-atlas lookups
  // gets replaced with the real data URL on the next call. Same pattern as
  // bulkFavorite.ts:981.
  try { onSpritesReady(() => { delete cache.locked; delete cache.unlocked; }); }
  catch { /* ignore */ }
}

function tryGetAnySpriteUrl(keys: string[]): string {
  for (const key of keys) {
    const url = getAnySpriteDataUrl(key);
    if (url && url.startsWith('data:image')) return url;
  }
  return '';
}

function scoreSpriteKeyForLock(key: string, target: LockState): number {
  const normalized = key.toLowerCase();
  let score = 0;

  if (normalized.includes('/ui/')) score += 3;
  if (normalized.includes('sprite/ui/')) score += 3;

  if (target === 'locked') {
    if (normalized.includes('unlocked') || normalized.includes('unlock')) return -100;
    if (normalized.includes('locked')) score += 8;
    else if (normalized.includes('lock')) score += 5;
  } else {
    if (normalized.includes('unlocked')) score += 8;
    else if (normalized.includes('unlock')) score += 6;
    if (normalized.includes('locked') && !normalized.includes('unlocked')) score -= 5;
  }

  return score;
}

function findBestLockSprite(target: LockState): string {
  const directCandidates =
    target === 'locked'
      ? ['sprite/ui/Locked', 'ui/Locked', 'sprite/ui/Lock', 'ui/Lock']
      : ['sprite/ui/Unlocked', 'ui/Unlocked', 'sprite/ui/Unlock', 'ui/Unlock'];

  const direct = tryGetAnySpriteUrl(directCandidates);
  if (direct) return direct;

  const allKeys = Sprites.lists().all;
  if (!Array.isArray(allKeys) || allKeys.length === 0) return '';

  const scored = allKeys
    .map((key) => ({ key, score: scoreSpriteKeyForLock(String(key), target) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  for (const candidate of scored) {
    const url = getAnySpriteDataUrl(candidate.key);
    if (url && url.startsWith('data:image')) return url;
  }

  return '';
}

export function findLockSpriteUrl(state: LockState): string {
  ensureSpritesReadyHook();
  // Do NOT cache '' — a pre-atlas call returns empty; caching that would
  // freeze the badge in a hidden state until the caller happened to re-init.
  // The onSpritesReady hook also invalidates cached '' via cache reset, but
  // this guard makes the utility correct even when the hook is absent.
  const cached = cache[state];
  if (cached) return cached;

  const url = findBestLockSprite(state);
  if (url) cache[state] = url;
  return url;
}
