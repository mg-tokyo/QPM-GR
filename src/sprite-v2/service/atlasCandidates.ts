import type { SpriteState } from '../types';
import { buildAtlasTextures } from '../atlas';
import {
  ATLAS_DIMENSION_TOLERANCE,
  MAX_MISSING_SAMPLE,
  RENDER_TARGET_HINT_RE,
  TARGET_COMPRESSED_COVERAGE,
} from './constants';
import type { HydratePassResult } from './types';
import { computeHydrationStatus } from './hydrationEvents';
import { countHydratedFrames, isMapLike, isTextureLike, normalizeTextureKey } from './textureIndex';
import { getSpriteBridge } from './bridge';

function safeNumber(value: any): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function readObjectDimensions(value: any): { w: number; h: number } | null {
  if (!value || typeof value !== 'object') return null;
  const widthCandidates = [
    value.width,
    value.w,
    value.pixelWidth,
    value?.orig?.width,
    value?.frame?.width,
    value?._frame?.width,
    value?.source?.width,
    value?.source?.pixelWidth,
    value?.resource?.width,
    value?.resource?.pixelWidth,
  ];
  const heightCandidates = [
    value.height,
    value.h,
    value.pixelHeight,
    value?.orig?.height,
    value?.frame?.height,
    value?._frame?.height,
    value?.source?.height,
    value?.source?.pixelHeight,
    value?.resource?.height,
    value?.resource?.pixelHeight,
  ];
  const w = widthCandidates.map(safeNumber).find((n): n is number => n != null);
  const h = heightCandidates.map(safeNumber).find((n): n is number => n != null);
  if (!w || !h || w <= 0 || h <= 0) return null;
  return { w, h };
}

function readTextureDimensions(value: any): { w: number; h: number } | null {
  return readObjectDimensions(value) ?? readObjectDimensions(value?.source) ?? readObjectDimensions(value?._source);
}

function dimensionsMatch(
  actual: { w: number; h: number } | null,
  expected: { w: number; h: number } | null
): boolean {
  if (!actual || !expected) return false;
  return (
    Math.abs(actual.w - expected.w) <= ATLAS_DIMENSION_TOLERANCE &&
    Math.abs(actual.h - expected.h) <= ATLAS_DIMENSION_TOLERANCE
  );
}

function readAtlasExpectedSize(data: any): { w: number; h: number } | null {
  const w = safeNumber(data?.meta?.size?.w);
  const h = safeNumber(data?.meta?.size?.h);
  if (!w || !h || w <= 0 || h <= 0) return null;
  return { w, h };
}

function collectHintStrings(value: any): string[] {
  if (!value || typeof value !== 'object') return [];
  const out: string[] = [];
  const push = (raw: any) => {
    if (typeof raw !== 'string') return;
    const s = raw.trim();
    if (!s) return;
    out.push(s);
  };

  push(value.label);
  push(value.cacheId);
  push(value.cacheKey);
  push(value.src);
  push(value.url);
  push(value.href);
  push(value.path);
  push(value?.resource?.src);
  push(value?.resource?.url);
  push(value?.source?.label);
  push(value?.source?.src);
  push(value?.source?.url);
  push(value?.source?.resource?.src);
  push(value?.source?.resource?.url);

  const ids = value.textureCacheIds;
  if (Array.isArray(ids)) {
    for (const id of ids) push(id);
  }
  return out;
}

function buildAtlasAliasTokens(atlasPath: string, imagePath: string): string[] {
  const rawParts = [atlasPath, imagePath]
    .filter(Boolean)
    .map((part) => String(part).replace(/\\/g, '/').replace(/^\/+/, '').replace(/[?#].*$/, ''));
  const tokens = new Set<string>();

  for (const part of rawParts) {
    const normalized = normalizeTextureKey(part);
    if (normalized) tokens.add(normalized);

    const extless = part.replace(/\.[^/.]+$/i, '');
    const extlessNorm = normalizeTextureKey(extless);
    if (extlessNorm) tokens.add(extlessNorm);

    const seg = part.split('/').filter(Boolean).pop() || '';
    const segNorm = normalizeTextureKey(seg);
    if (segNorm) tokens.add(segNorm);

    const segExtlessNorm = normalizeTextureKey(seg.replace(/\.[^/.]+$/i, ''));
    if (segExtlessNorm) tokens.add(segExtlessNorm);
  }

  return [...tokens].filter((token) => token.length >= 3);
}

function scoreAtlasHint(hint: string, tokens: string[]): number {
  if (!hint || !tokens.length) return 0;
  const normalized = normalizeTextureKey(hint);
  if (!normalized) return 0;
  let score = 0;
  for (const token of tokens) {
    if (!token) continue;
    if (normalized === token) {
      score += 6;
    } else if (normalized.includes(token) || token.includes(normalized)) {
      score += 3;
    }
  }
  return score;
}

function coerceTextureForAtlas(raw: any, state: SpriteState, expectedSize: { w: number; h: number } | null): any | null {
  if (!raw || typeof raw !== 'object') return null;

  const Texture = state.ctors?.Texture;
  if (!Texture) return null;

  const candidates: any[] = [];
  const pushCandidate = (tex: any) => {
    if (!isTextureLike(tex)) return;
    candidates.push(tex);
  };

  // Prefer explicit source-derived textures first for atlas bases.
  const sourceCandidates = [raw?.source, raw?._source, raw];
  for (const source of sourceCandidates) {
    if (!source || typeof source !== 'object') continue;
    try {
      const t = new Texture({ source });
      pushCandidate(t);
    } catch {
      // try next constructor mode
    }
    try {
      const t = Texture.from(source);
      pushCandidate(t);
    } catch {
      // try next constructor mode
    }
    try {
      const t = new Texture(source);
      pushCandidate(t);
    } catch {
      // no-op
    }
  }

  pushCandidate(raw?.texture);
  pushCandidate(raw?.tex);
  pushCandidate(raw);

  if (candidates.length > 0) {
    if (!expectedSize) return candidates[0] ?? null;

    const perfect = candidates.find((candidate) => dimensionsMatch(readTextureDimensions(candidate), expectedSize));
    if (perfect) return perfect;

    const fallback = candidates[0] ?? null;
    if (fallback) return fallback;
  }

  const rawSource = raw?.source ?? raw?._source ?? raw;
  const rawDims = readObjectDimensions(rawSource);
  if (!rawDims) return null;
  if (expectedSize && !dimensionsMatch(rawDims, expectedSize)) return null;
  return rawSource;
}

type AtlasTextureCandidate = {
  texture: any;
  hint: string;
  score: number;
};

function collectAtlasTextureCandidates(
  state: SpriteState,
  runtimeCandidates: any[],
  tokens: string[],
  expectedSize: { w: number; h: number } | null
): AtlasTextureCandidate[] {
  const out: AtlasTextureCandidate[] = [];
  const seen = new Set<any>();
  const visited = new WeakSet<object>();

  const pushCandidate = (raw: any, hint: string) => {
    if (!raw || typeof raw !== 'object') return;
    const hintText = `${hint} ${collectHintStrings(raw).join(' ')}`.trim();
    const hintScore = scoreAtlasHint(hintText, tokens);
    const rawDims = readObjectDimensions(raw) ?? readObjectDimensions(raw?.source) ?? readObjectDimensions(raw?._source);
    const sizeScore = dimensionsMatch(rawDims, expectedSize) ? 4 : 0;
    const renderPenalty = RENDER_TARGET_HINT_RE.test(hintText.toLowerCase()) ? 4 : 0;

    if (hintScore <= 0 && sizeScore <= 0) return;
    if (renderPenalty > 0 && hintScore <= 0) return;

    const tex = coerceTextureForAtlas(raw, state, expectedSize);
    if (!tex) return;
    const identity = tex?.source ?? tex?._source ?? tex;
    if (identity && seen.has(identity)) return;

    const texDims = readTextureDimensions(tex);
    if (expectedSize && texDims && !dimensionsMatch(texDims, expectedSize) && hintScore < 3) {
      return;
    }

    if (identity) seen.add(identity);
    const score = hintScore + sizeScore - renderPenalty;
    if (score <= 0) return;
    out.push({ texture: tex, hint: hintText, score });
  };

  const scan = (container: any, label: string, depth: number) => {
    if (!container || typeof container !== 'object') return;
    if (visited.has(container)) return;
    visited.add(container);
    if (depth > 2) return;

    if (isMapLike(container)) {
      let n = 0;
      try {
        for (const pair of container.entries()) {
          if (!Array.isArray(pair) || pair.length < 2) continue;
          const keyObject = pair[0];
          const key = String(keyObject);
          const value = pair[1];
          const nextHint = `${label} ${key} ${collectHintStrings(keyObject).join(' ')}`.trim();
          pushCandidate(keyObject, `${nextHint} #map-key`);
          pushCandidate(value, nextHint);
          if (depth < 2) {
            scan(value, nextHint, depth + 1);
          }
          if (++n >= 2500) break;
        }
      } catch {
        // ignore map scan errors
      }
      return;
    }

    if (Array.isArray(container)) {
      for (let i = 0; i < container.length && i < 1200; i++) {
        const value = container[i];
        const nextHint = `${label}[${i}]`;
        pushCandidate(value, nextHint);
        if (depth < 2) {
          scan(value, nextHint, depth + 1);
        }
      }
      return;
    }

    let keys: string[] = [];
    try {
      keys = Object.keys(container);
    } catch {
      return;
    }
    const recurseKeyRe = /texture|source|cache|atlas|sprite|upload|managed|bound|resource|ktx|basis|asset/i;
    for (let i = 0; i < keys.length && i < 2200; i++) {
      const key = keys[i]!;
      if (key === 'name' || key === 'baseTexture') continue;
      const value = (container as any)[key];
      const nextHint = `${label}.${key}`;
      pushCandidate(value, nextHint);
      if (depth < 2 && recurseKeyRe.test(key)) {
        scan(value, nextHint, depth + 1);
      }
    }
  };

  const bridge = getSpriteBridge();
  const containers: Array<[string, any]> = [
    ['renderer.texture._managedTextures', state.renderer?.texture?._managedTextures],
    ['renderer.texture._boundTextures', state.renderer?.texture?._boundTextures],
    ['renderer.texture._uploads.compressed', state.renderer?.texture?._uploads?.compressed],
    ['renderer.texture._uploads.image', state.renderer?.texture?._uploads?.image],
    ['renderer.texture', state.renderer?.texture],
    ['state.renderer', state.renderer],
    ['state.app', state.app],
    ['bridge.runtimePool', bridge?.runtimePool],
    ['bridge.atlas', bridge?.atlas],
  ];
  for (let i = 0; i < runtimeCandidates.length; i++) {
    containers.push([`runtimeHint[${i}]`, runtimeCandidates[i]]);
  }

  for (const [label, container] of containers) {
    scan(container, label, 0);
  }

  out.sort((a, b) => b.score - a.score);
  return out.slice(0, 8);
}

export function hydrateAtlasFromManagedTextureCandidates(
  atlasPath: string,
  imagePath: string,
  data: any,
  state: SpriteState,
  runtimeCandidates: any[]
): HydratePassResult | null {
  if (!state.ctors?.Texture || !state.ctors?.Rectangle) return null;
  const frameKeys = Object.keys(data?.frames || {});
  if (!frameKeys.length) return null;

  const baselineHydrated = countHydratedFrames(frameKeys, state);
  const expectedSize = readAtlasExpectedSize(data);
  const tokens = buildAtlasAliasTokens(atlasPath, imagePath);
  const candidates = collectAtlasTextureCandidates(state, runtimeCandidates, tokens, expectedSize);
  if (!candidates.length) return null;

  let bestHydrated = baselineHydrated;
  for (const candidate of candidates) {
    try {
      buildAtlasTextures(data, candidate.texture, state.tex, state.atlasBases, state.ctors);
    } catch {
      continue;
    }
    const hydrated = countHydratedFrames(frameKeys, state);
    if (hydrated > bestHydrated) {
      bestHydrated = hydrated;
    }
    if (expectedSize && bestHydrated >= frameKeys.length * TARGET_COMPRESSED_COVERAGE) {
      break;
    }
  }

  if (bestHydrated <= baselineHydrated) return null;
  const coverage = frameKeys.length > 0 ? bestHydrated / frameKeys.length : 1;
  const runtimeDelta = Math.max(0, bestHydrated - baselineHydrated);
  return {
    hydrated: bestHydrated,
    coverage,
    sourceHits: { assets: 0, bridge: 0, runtime: runtimeDelta },
    missingSample: frameKeys.filter((key) => !state.tex.has(key)).slice(0, MAX_MISSING_SAMPLE),
    status: computeHydrationStatus(coverage),
  };
}
