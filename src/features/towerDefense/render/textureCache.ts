import { getStageTextureCtor } from './stage';
import { createNamedLogger } from '../../../diagnostics/logger';

const log = createNamedLogger('td');

export interface CachedTexture {
  readonly texture: unknown;
  readonly widthPx: number;
  readonly heightPx: number;
}

type DestroyableTexture = { destroy?: (destroySource?: boolean) => void };

// One texture per descriptor key for the lifetime of a TD session. Every
// spawn-time Texture.from(freshCanvas) leaked its texture + canvas (destroy
// was always { texture: false }) — thousands of spawns at high waves OOM'd
// the tab. Key convention: plan 2026-08-20-td-performance-memory.md.
const cache = new Map<string, CachedTexture>();

export function getSharedTexture(
  key: string,
  build: () => HTMLCanvasElement | null,
): CachedTexture | null {
  const hit = cache.get(key);
  if (hit) return hit;
  const TextureCtor = getStageTextureCtor();
  if (!TextureCtor) return null;
  const canvas = build();
  if (!canvas) return null;
  try {
    const entry: CachedTexture = {
      texture: TextureCtor.from(canvas),
      widthPx: canvas.width,
      heightPx: canvas.height,
    };
    cache.set(key, entry);
    return entry;
  } catch (err) {
    log.warn('QPM-TD-TEXCACHE-001', { reason: 'texture_from_failed', key }, err);
    return null;
  }
}

export function getSharedTextureCount(): number {
  return cache.size;
}

export function clearSharedTextures(): void {
  for (const entry of cache.values()) {
    try { (entry.texture as DestroyableTexture).destroy?.(true); } catch { /* ignore */ }
  }
  cache.clear();
}
