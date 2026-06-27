import { parseAtlasKey } from '../types';

// Active/Sideways/Backwards/Lit — transient render states, NOT category variants or mutation overlays
export const RENDER_STATE_SUFFIXES = ['Active', 'Sideways', 'Backwards', 'Lit'] as const;

export function stripRenderState(spriteKey: string): string {
  const parsed = parseAtlasKey(spriteKey);
  if (!parsed) return spriteKey;
  const { category, id } = parsed;
  for (const s of RENDER_STATE_SUFFIXES) {
    if (id.endsWith(s) && id.length > s.length) {
      return `${category}/${id.slice(0, -s.length)}`;
    }
  }
  return `${category}/${id}`;
}
