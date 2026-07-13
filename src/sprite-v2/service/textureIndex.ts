import type { SpriteState } from '../types';
import { getRuntimeWindow } from '../detector';
import { IMAGE_EXT_RE } from './constants';
import type { RuntimeTextureIndex } from './types';

export function normalizeTextureKey(raw: string): string {
  return String(raw ?? '')
    .replace(/\\/g, '/')
    .replace(/[?#].*$/, '')
    .replace(/^\/+/, '')
    .replace(IMAGE_EXT_RE, '')
    .trim()
    .toLowerCase();
}

export function isTextureLike(value: any): boolean {
  if (!value || typeof value !== 'object') return false;
  if (value.frame && (value.source || value.orig || value._frame || value._source)) return true;
  if (value.source && (value.width != null || value.height != null || value.pixelWidth != null || value.pixelHeight != null)) return true;
  if (value.orig && (value.orig.width != null || value.orig.height != null)) return true;
  return false;
}

export function isMapLike(value: any): value is { entries: () => Iterable<[unknown, unknown]>; forEach: (cb: (v: any, k: any) => void) => void } {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof value.entries === 'function' &&
    typeof value.forEach === 'function'
  );
}

export function addTextureToIndex(index: RuntimeTextureIndex, key: string, texture: any): void {
  if (!key || !isTextureLike(texture)) return;
  const normalized = normalizeTextureKey(key);
  if (!normalized) return;

  const trimmedKey = String(key).replace(/^\/+/, '');
  index.exact.set(key, texture);
  if (trimmedKey && !index.exact.has(trimmedKey)) {
    index.exact.set(trimmedKey, texture);
  }
  index.normalized.set(normalized, texture);

  const spritePos = key.indexOf('sprite/');
  if (spritePos >= 0) {
    const spriteKey = key.slice(spritePos);
    if (spriteKey && !index.exact.has(spriteKey)) {
      index.exact.set(spriteKey, texture);
    }
    const spriteNorm = normalizeTextureKey(spriteKey);
    if (spriteNorm && !index.normalized.has(spriteNorm)) {
      index.normalized.set(spriteNorm, texture);
    }
  }

  if (trimmedKey.startsWith('sprite/')) {
    const withoutPrefix = trimmedKey.slice('sprite/'.length);
    if (withoutPrefix && !index.exact.has(withoutPrefix)) {
      index.exact.set(withoutPrefix, texture);
    }
    const withoutPrefixNorm = normalizeTextureKey(withoutPrefix);
    if (withoutPrefixNorm && !index.normalized.has(withoutPrefixNorm)) {
      index.normalized.set(withoutPrefixNorm, texture);
    }
  } else if (
    trimmedKey &&
    trimmedKey.includes('/') &&
    !trimmedKey.startsWith('atlases/') &&
    !/^https?:\/\//i.test(trimmedKey)
  ) {
    const spritePrefixed = `sprite/${trimmedKey}`;
    if (!index.exact.has(spritePrefixed)) {
      index.exact.set(spritePrefixed, texture);
    }
    const spritePrefixedNorm = normalizeTextureKey(spritePrefixed);
    if (spritePrefixedNorm && !index.normalized.has(spritePrefixedNorm)) {
      index.normalized.set(spritePrefixedNorm, texture);
    }
  }
}

export function collectTexturesFromContainer(index: RuntimeTextureIndex, container: any): void {
  if (!container) return;

  // Cross-context Map objects from page window do not satisfy `instanceof Map`.
  if (isMapLike(container)) {
    try {
      for (const pair of container.entries()) {
        if (!Array.isArray(pair) || pair.length < 2) continue;
        const key = pair[0];
        const value: any = pair[1];
        addTextureToIndex(index, String(key), value);
        addTextureToIndex(index, String(key), value?.texture);
        addTextureToIndex(index, String(key), value?.tex);
        addTextureToIndex(index, String(key), value?.first);
        if (value?.textures) {
          collectTexturesFromContainer(index, value.textures);
        }
        if (value?.frames && typeof value.frames === 'object') {
          collectTexturesFromContainer(index, value.frames);
        }
      }
    } catch {
      try {
        container.forEach((value: any, key: any) => {
          addTextureToIndex(index, String(key), value);
          addTextureToIndex(index, String(key), value?.texture);
          addTextureToIndex(index, String(key), value?.tex);
          addTextureToIndex(index, String(key), value?.first);
          if (value?.textures) {
            collectTexturesFromContainer(index, value.textures);
          }
          if (value?.frames && typeof value.frames === 'object') {
            collectTexturesFromContainer(index, value.frames);
          }
        });
      } catch {
        // Ignore map scan errors from cross-context proxy wrappers.
      }
    }
    return;
  }

  if (Array.isArray(container)) {
    for (const value of container) {
      if (value?.textures) {
        collectTexturesFromContainer(index, value.textures);
      }
    }
    return;
  }

  if (typeof container === 'object') {
    for (const key of Object.keys(container)) {
      if (key === 'name' || key === 'baseTexture') continue;
      const value = (container as any)[key];
      addTextureToIndex(index, key, value);
      addTextureToIndex(index, key, (value as any)?.texture);
      addTextureToIndex(index, key, (value as any)?.tex);
      addTextureToIndex(index, key, (value as any)?.first);
      if ((value as any)?.textures) {
        collectTexturesFromContainer(index, (value as any).textures);
      }
      if ((value as any)?.frames && typeof (value as any).frames === 'object') {
        collectTexturesFromContainer(index, (value as any).frames);
      }
    }
  }
}

function shouldSkipDeepTraversal(value: any): boolean {
  if (!value || typeof value !== 'object') return true;
  if (typeof Window !== 'undefined' && value instanceof Window) return true;
  if (typeof Document !== 'undefined' && value instanceof Document) return true;
  if (typeof Element !== 'undefined' && value instanceof Element) return true;
  if (typeof HTMLCanvasElement !== 'undefined' && value instanceof HTMLCanvasElement) return true;
  if (typeof OffscreenCanvas !== 'undefined' && value instanceof OffscreenCanvas) return true;
  return false;
}

export function collectTexturesDeep(
  index: RuntimeTextureIndex,
  rootValue: any,
  options: { maxDepth?: number; maxNodes?: number } = {}
): void {
  const maxDepth = Math.max(2, options.maxDepth ?? 7);
  const maxNodes = Math.max(2000, options.maxNodes ?? 25000);
  const seen = new WeakSet<object>();
  const stack: Array<{ value: any; depth: number; keyHint: string }> = [
    { value: rootValue, depth: 0, keyHint: '' },
  ];
  let nodes = 0;

  while (stack.length > 0 && nodes < maxNodes) {
    const current = stack.pop();
    if (!current) continue;
    const { value, depth, keyHint } = current;
    if (!value || typeof value !== 'object') continue;
    if (shouldSkipDeepTraversal(value)) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    nodes++;

    if (isTextureLike(value)) {
      if (keyHint) {
        addTextureToIndex(index, keyHint, value);
      }
      const label = String((value as any)?.label ?? '').trim();
      if (label) {
        addTextureToIndex(index, label, value);
      }
      continue;
    }

    if (isMapLike(value)) {
      try {
        for (const pair of value.entries()) {
          if (!Array.isArray(pair) || pair.length < 2) continue;
          const key = String(pair[0]);
          const itemValue = pair[1];
          addTextureToIndex(index, key, itemValue);
          if (depth < maxDepth && itemValue && typeof itemValue === 'object') {
            stack.push({ value: itemValue, depth: depth + 1, keyHint: key });
          }
        }
      } catch {
        try {
          value.forEach((itemValue: any, key: any) => {
            const keyStr = String(key);
            addTextureToIndex(index, keyStr, itemValue);
            if (depth < maxDepth && itemValue && typeof itemValue === 'object') {
              stack.push({ value: itemValue, depth: depth + 1, keyHint: keyStr });
            }
          });
        } catch {
          // ignore map traversal errors
        }
      }
      continue;
    }

    if (Array.isArray(value)) {
      if (depth < maxDepth) {
        for (let i = 0; i < value.length; i++) {
          const itemValue = value[i];
          if (itemValue && typeof itemValue === 'object') {
            stack.push({ value: itemValue, depth: depth + 1, keyHint });
          }
        }
      }
      continue;
    }

    if (depth >= maxDepth) continue;

    try {
      for (const key of Object.keys(value)) {
        if (key === 'name' || key === 'baseTexture') continue;
        const itemValue = (value as any)[key];
        addTextureToIndex(index, key, itemValue);
        if (itemValue && typeof itemValue === 'object') {
          stack.push({ value: itemValue, depth: depth + 1, keyHint: key });
        }
      }
    } catch {
      // ignore object traversal errors
    }
  }
}

export function buildRuntimeTextureIndex(extraCandidates: any[] = [], useDeepScan = false): RuntimeTextureIndex {
  const index: RuntimeTextureIndex = {
    exact: new Map(),
    normalized: new Map(),
  };

  const root = getRuntimeWindow() as any;
  const pixiRoots = [root?.PIXI, root?.__PIXI__].filter(Boolean);
  const candidates = [
    root?.__PIXI_TEXTURE_CACHE__,
    root?.__PIXI_ASSET_CACHE__,
    root?.__QPM_PIXI_CAPTURED__?.app,
    root?.__QPM_PIXI_CAPTURED__?.renderer,
    ...extraCandidates,
  ];

  for (const P of pixiRoots) {
    candidates.push(
      P?.utils?.TextureCache,
      P?.TextureCache,
      P?.Cache?._cache,
      P?.Assets?.cache,
      P?.Assets?.cache?._cache
    );
  }

  for (const candidate of candidates) {
    collectTexturesFromContainer(index, candidate);
  }

  if (useDeepScan) {
    for (const candidate of candidates) {
      collectTexturesDeep(index, candidate);
    }
  }

  return index;
}

export function buildTextureIndexFromContainers(containers: any[]): RuntimeTextureIndex {
  const index: RuntimeTextureIndex = {
    exact: new Map(),
    normalized: new Map(),
  };
  for (const container of containers) {
    collectTexturesFromContainer(index, container);
  }
  return index;
}

export function readTextureFromIndex(index: RuntimeTextureIndex, key: string): any | null {
  const raw = String(key ?? '').replace(/^\/+/, '');
  if (!raw) return null;

  const exactCandidates = new Set<string>([raw, `/${raw}`]);
  if (raw.startsWith('sprite/')) {
    const withoutPrefix = raw.slice('sprite/'.length);
    if (withoutPrefix) {
      exactCandidates.add(withoutPrefix);
      exactCandidates.add(`/${withoutPrefix}`);
    }
  } else {
    exactCandidates.add(`sprite/${raw}`);
    exactCandidates.add(`/sprite/${raw}`);
  }

  for (const candidate of exactCandidates) {
    const hit = index.exact.get(candidate);
    if (hit) return hit;
  }

  for (const candidate of exactCandidates) {
    const normalized = normalizeTextureKey(candidate);
    if (!normalized) continue;
    const hit = index.normalized.get(normalized);
    if (hit) return hit;
  }

  return null;
}

export function countHydratedFrames(frameKeys: string[], state: SpriteState): number {
  let n = 0;
  for (const key of frameKeys) {
    if (state.tex.has(key)) n++;
  }
  return n;
}
