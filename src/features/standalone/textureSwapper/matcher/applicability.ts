import type { TextureOverrideRule } from '../types';
import { isMutationSpriteKey, isPlantBaseSpriteKey } from './keys';

// ---------------------------------------------------------------------------
// Rule applicability checks
// ---------------------------------------------------------------------------

export function normalizeHintForSearch(raw: string): string {
  return raw.trim().toLowerCase().replace(/[_\-./\\]+/g, '');
}

export function hintContainsTargetId(raw: string, targetIdLower: string): boolean {
  if (!targetIdLower) return false;
  const normHint = normalizeHintForSearch(raw);
  if (!normHint) return false;
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

function spriteLooksLikeMutationAsset(spriteKeys: Set<string>, hints: string[]): boolean {
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

export function ruleCanApplyToSprite(entry: { rule: TextureOverrideRule }, spriteKeys: Set<string>, hints: string[]): boolean {
  const mutationSprite = spriteLooksLikeMutationAsset(spriteKeys, hints);
  const isMutationRule = isMutationSpriteKey(entry.rule.targetSpriteKey);
  const isPlantBaseRule = isPlantBaseSpriteKey(entry.rule.targetSpriteKey);

  if (isPlantBaseRule && mutationSprite) return false;
  if (isMutationRule && !mutationSprite) return false;
  return true;
}
