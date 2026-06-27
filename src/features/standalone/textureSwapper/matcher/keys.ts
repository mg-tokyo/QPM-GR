import { SPRITE_KEY_EXT_RE, KNOWN_SPRITE_PREFIXES } from '../types';

// ---------------------------------------------------------------------------
// Sprite key normalization
// ---------------------------------------------------------------------------

export function normalizeSpriteKeyCandidate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let key = String(raw).trim();
  if (!key) return null;
  key = key.replace(/\\/g, '/').replace(/[?#].*$/, '').replace(/^\/+/, '');
  if (!key) return null;

  const variantPos = key.indexOf('|');
  if (variantPos > 0) {
    key = key.slice(0, variantPos);
  }

  const spritePos = key.toLowerCase().lastIndexOf('sprite/');
  if (spritePos >= 0) {
    key = key.slice(spritePos);
  }
  key = key.replace(SPRITE_KEY_EXT_RE, '');
  if (!key) return null;

  if (key.startsWith('sprite/')) return key;
  const first = key.split('/')[0]?.toLowerCase() ?? '';
  if (!KNOWN_SPRITE_PREFIXES.has(first)) return null;
  return `sprite/${key}`;
}

export function isMutationSpriteKey(key: string): boolean {
  const normalized = normalizeSpriteKeyCandidate(key);
  if (!normalized) return false;
  const lower = normalized.toLowerCase();
  return lower.startsWith('sprite/mutation/') || lower.startsWith('sprite/mutation-overlay/');
}

export function isPlantBaseSpriteKey(key: string): boolean {
  const normalized = normalizeSpriteKeyCandidate(key);
  if (!normalized) return false;
  const lower = normalized.toLowerCase();
  return lower.startsWith('sprite/plant/') || lower.startsWith('sprite/crop/') || lower.startsWith('sprite/tallplant/');
}
