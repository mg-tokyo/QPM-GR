import type { TextureOverrideRule } from '../types';
import { isMutationSpriteKey, isPlantBaseSpriteKey } from './keys';

// ---------------------------------------------------------------------------
// Rule applicability checks
// ---------------------------------------------------------------------------

export function normalizeHintForSearch(raw: string): string {
  return raw.trim().toLowerCase().replace(/[_\-./\\]+/g, '');
}

export function buildHintRegex(targetIdLower: string): RegExp | null {
  if (!targetIdLower) return null;
  const escaped = targetIdLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, 'i');
}

export function hintContainsTargetId(raw: string, targetIdLower: string, precompiled?: RegExp | null): boolean {
  if (!targetIdLower) return false;
  const normHint = normalizeHintForSearch(raw);
  if (!normHint) return false;
  if (precompiled) return precompiled.test(normHint);
  const escaped = targetIdLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, 'i');
  return re.test(normHint);
}

function hintLooksLikeMutationAsset(raw: string): boolean {
  const hint = normalizeHintForSearch(raw);
  if (!hint) return false;
  return hint.includes('/mutation/')
    || hint.includes('mutation-overlay')
    || hint.includes('mutation-icon')
    || hint.includes('sprite/mutation');
}

export function spriteLooksLikeMutationAsset(spriteKeys: Set<string>, hints: string[]): boolean {
  for (const key of spriteKeys) {
    if (key.startsWith('sprite/mutation/') || key.startsWith('sprite/mutation-overlay/')) {
      return true;
    }
  }
  for (const hint of hints) {
    if (hintLooksLikeMutationAsset(hint)) return true;
  }
  return false;
}

export function ruleCanApplyToSprite(entry: { rule: TextureOverrideRule; isMutationRule: boolean; isPlantBaseRule: boolean }, isMutationAsset: boolean): boolean {
  if (entry.isPlantBaseRule && isMutationAsset) return false;
  if (entry.isMutationRule && !isMutationAsset) return false;
  return true;
}
