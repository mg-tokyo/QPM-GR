import { safeNum, SPRITE_KEY_EXT_RE } from '../types';
import type { SpriteVariantInfo } from '../types';
import { normalizeSpriteKeyCandidate } from './keys';
import { parseVariantInfoFromLabel } from './variants';
import { pageWindow } from '../../../../core/pageContext';

// ---------------------------------------------------------------------------
// Texture introspection
// ---------------------------------------------------------------------------

export function getTextureFrame(tex: any): any {
  return tex?.frame ?? tex?._frame ?? null;
}

export function getTextureOrig(tex: any): any {
  return tex?.orig ?? tex?._orig ?? null;
}

export function getTextureSourceToken(tex: any): string {
  const source = tex?.source ?? tex?.baseTexture ?? tex?._source ?? tex?._baseTexture ?? null;
  const raw = source?.label
    ?? source?.resource?.url
    ?? source?.resource?.src
    ?? source?.resource?.source?.currentSrc
    ?? source?.resource?.source?.src
    ?? '';
  if (typeof raw !== 'string' || raw.trim() === '') return '?';
  const cleaned = raw
    .replace(/\\/g, '/')
    .replace(/[?#].*$/, '')
    .split('/')
    .pop() ?? raw;
  const token = cleaned.replace(SPRITE_KEY_EXT_RE, '').toLowerCase();
  return token || '?';
}

export function makeFrameSignature(tex: any): string | null {
  if (!tex) return null;
  const frame = getTextureFrame(tex);
  if (!frame) return null;
  const orig = getTextureOrig(tex) ?? {};
  const source = tex?.source ?? tex?.baseTexture ?? tex?._source ?? tex?._baseTexture ?? null;
  const sourceW = safeNum(source?.pixelWidth ?? source?.width ?? source?.resource?.source?.width);
  const sourceH = safeNum(source?.pixelHeight ?? source?.height ?? source?.resource?.source?.height);
  return [
    getTextureSourceToken(tex),
    `${safeNum(frame.x)}:${safeNum(frame.y)}:${safeNum(frame.width)}:${safeNum(frame.height)}`,
    `${safeNum(orig.width ?? frame.width)}:${safeNum(orig.height ?? frame.height)}`,
    `${sourceW}:${sourceH}`,
  ].join('|');
}

export function extractTextureSpriteKeys(tex: any): string[] {
  if (!tex) return [];
  const out = new Set<string>();
  const add = (candidate: unknown) => {
    const normalized = normalizeSpriteKeyCandidate(candidate);
    if (normalized) out.add(normalized.toLowerCase());
  };
  add(tex?.label);
  add(tex?._label);
  add(tex?.textureCacheIds?.[0]);
  add(tex?.source?.label);
  add(tex?.source?.resource?.url);
  add(tex?.source?.resource?.src);
  return [...out];
}

export function extractTextureHintStrings(tex: any): string[] {
  if (!tex) return [];
  const out = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (!trimmed) return;
    out.add(trimmed);
  };
  add(tex?.label);
  add(tex?._label);
  add(tex?.textureCacheIds?.[0]);
  add(tex?.source?.label);
  add(tex?.source?.resource?.url);
  add(tex?.source?.resource?.src);
  add(tex?.baseTexture?.resource?.url);
  add(tex?.baseTexture?.resource?.src);
  return [...out];
}

export function extractVariantInfoFromTexture(tex: any): SpriteVariantInfo | null {
  if (!tex) return null;
  const candidates = [
    tex?.label,
    tex?._label,
    tex?.textureCacheIds?.[0],
    tex?.source?.label,
  ];
  for (const raw of candidates) {
    const parsed = parseVariantInfoFromLabel(raw);
    if (parsed) return parsed;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Runtime texture reference map
// ---------------------------------------------------------------------------

function isMapLike(value: any): value is { entries: () => Iterable<[unknown, unknown]> } {
  return !!value && typeof value === 'object' && typeof value.entries === 'function';
}

function addRefKey(refMap: Map<object, Set<string>>, ref: any, keyCandidate: unknown): void {
  if (!ref || typeof ref !== 'object') return;
  const key = normalizeSpriteKeyCandidate(keyCandidate);
  if (!key) return;
  const normalized = key.toLowerCase();
  const prev = refMap.get(ref as object);
  if (prev) {
    prev.add(normalized);
    return;
  }
  refMap.set(ref as object, new Set([normalized]));
}

function scanTextureContainerForRefKeys(container: any, refMap: Map<object, Set<string>>): void {
  const addEntry = (rawKey: unknown, value: any) => {
    addRefKey(refMap, value, rawKey);
    addRefKey(refMap, value?.texture, rawKey);
    addRefKey(refMap, value?.tex, rawKey);
    addRefKey(refMap, value?.first, rawKey);
    addRefKey(refMap, value?.source, rawKey);
    addRefKey(refMap, value?.baseTexture, rawKey);
  };

  if (!container) return;
  if (isMapLike(container)) {
    try {
      for (const entry of container.entries()) {
        if (!Array.isArray(entry) || entry.length < 2) continue;
        addEntry(entry[0], entry[1]);
      }
    } catch {}
    return;
  }
  if (typeof container === 'object') {
    try {
      for (const [k, v] of Object.entries(container)) {
        addEntry(k, v);
      }
    } catch {}
  }
}

export function buildRuntimeTextureRefKeyMap(): Map<object, Set<string>> {
  const refMap = new Map<object, Set<string>>();
  const root = pageWindow as any;
  const candidates = [
    root?.PIXI?.Cache?._cache,
    root?.__PIXI__?.Cache?._cache,
    root?.PIXI?.utils?.TextureCache,
    root?.__PIXI__?.utils?.TextureCache,
    root?.__PIXI_TEXTURE_CACHE__,
    root?.__PIXI_ASSET_CACHE__,
    root?.__QPM_PIXI_CAPTURED__?.app?.renderer?.textures,
    root?.__QPM_PIXI_CAPTURED__?.renderer?.textures,
  ];
  for (const candidate of candidates) {
    scanTextureContainerForRefKeys(candidate, refMap);
  }
  return refMap;
}
