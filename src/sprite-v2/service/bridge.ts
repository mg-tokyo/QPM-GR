import { getRuntimeWindow } from '../detector';
import { joinPath } from '../manifest';
import type { SpriteBridge } from './types';

export function getSpriteBridge(): SpriteBridge | null {
  const root = getRuntimeWindow() as any;
  const bridge = root?.__QPM_SPRITE_BRIDGE__;
  if (!bridge || typeof bridge !== 'object') return null;
  return bridge as SpriteBridge;
}

export function getBridgeTextureContainers(atlasPath: string): any[] {
  const bridge = getSpriteBridge();
  if (!bridge) return [];
  const out: any[] = [];

  try {
    if (typeof bridge.getAtlasTextures === 'function') {
      const fromGetter = bridge.getAtlasTextures(atlasPath);
      if (fromGetter) out.push(fromGetter);
    }
  } catch {
    // ignore bridge getter errors
  }

  const rec = bridge.atlas?.[atlasPath];
  if (rec?.textures) {
    out.push(rec.textures);
  }

  return out;
}

export function getBridgeSnapshot(): any {
  const bridge = getSpriteBridge();
  if (!bridge) return null;
  try {
    if (typeof bridge.snapshot === 'function') {
      return bridge.snapshot();
    }
  } catch {
    // ignore bridge snapshot failures
  }
  return null;
}

export async function tryLoadAtlasViaPixiAssets(base: string, atlasPath: string, imagePath?: string): Promise<any[]> {
  const root = getRuntimeWindow() as any;
  const pixiRoots = [root?.PIXI, root?.__PIXI__].filter(Boolean);

  const loadedAssets: any[] = [];
  const candidates = Array.from(
    new Set(
      [atlasPath, imagePath]
        .filter((value): value is string => Boolean(value))
        .flatMap((value) => [value, joinPath(base, value)])
    )
  );
  for (const P of pixiRoots) {
    const Assets = (P as any)?.Assets;
    if (!Assets?.load) continue;
    for (const candidate of candidates) {
      try {
        const loaded = await Assets.load(candidate);
        if (loaded != null) {
          loadedAssets.push(loaded);
        }
      } catch {
        // Try next candidate/root
      }
    }
  }
  return loadedAssets;
}

export async function tryLoadAtlasViaBridge(base: string, atlasPath: string, imagePath?: string, atlasData?: any): Promise<any[]> {
  const bridge = getSpriteBridge();
  if (!bridge || typeof bridge.loadAtlas !== 'function') return [];

  try {
    await bridge.loadAtlas(atlasPath, base, imagePath, atlasData);
  } catch {
    // ignore bridge load failures, fallback sources are still checked
  }

  return getBridgeTextureContainers(atlasPath);
}
