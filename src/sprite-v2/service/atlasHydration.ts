import type { SpriteState } from '../types';
import { getRuntimeWindow } from '../detector';
import { getBlob, joinPath, relPath } from '../manifest';
import { rememberBaseTex } from '../utils';
import { buildAtlasTextures } from '../atlas';
import type { Ktx2DecoderPool } from '../ktx2';
import { delay } from '../../utils/scheduling/scheduling';
import { MAX_MISSING_SAMPLE, TARGET_COMPRESSED_COVERAGE } from './constants';
import type { HydratePassResult, RuntimeTextureIndex, TextureSourceName } from './types';
import { computeHydrationStatus } from './hydrationEvents';
import {
  buildRuntimeTextureIndex,
  buildTextureIndexFromContainers,
  countHydratedFrames,
  readTextureFromIndex,
} from './textureIndex';
import { getBridgeTextureContainers, tryLoadAtlasViaBridge, tryLoadAtlasViaPixiAssets } from './bridge';
import { hydrateAtlasFromManagedTextureCandidates } from './atlasCandidates';

export function hydrateAtlasFromRuntimeIndex(data: any, state: SpriteState, index: RuntimeTextureIndex): number {
  let loaded = 0;
  for (const key of Object.keys(data?.frames || {})) {
    const tex = readTextureFromIndex(index, key);
    if (!tex) continue;
    state.tex.set(key, tex);
    rememberBaseTex(tex, state.atlasBases);
    loaded++;
  }
  return loaded;
}

export function hydrateAtlasFromSources(
  frameKeys: string[],
  state: SpriteState,
  sourceIndices: Array<{ source: TextureSourceName; index: RuntimeTextureIndex }>
): HydratePassResult {
  let hydrated = 0;
  const sourceHits: Record<TextureSourceName, number> = {
    assets: 0,
    bridge: 0,
    runtime: 0,
  };
  const missingSample: string[] = [];

  for (const frameKey of frameKeys) {
    if (state.tex.has(frameKey)) {
      hydrated++;
      continue;
    }

    let resolvedTexture: any = null;
    let resolvedSource: TextureSourceName | null = null;
    for (const source of sourceIndices) {
      const tex = readTextureFromIndex(source.index, frameKey);
      if (!tex) continue;
      resolvedTexture = tex;
      resolvedSource = source.source;
      break;
    }

    if (resolvedTexture) {
      state.tex.set(frameKey, resolvedTexture);
      rememberBaseTex(resolvedTexture, state.atlasBases);
      hydrated++;
      if (resolvedSource) {
        sourceHits[resolvedSource] += 1;
      }
    } else if (missingSample.length < MAX_MISSING_SAMPLE) {
      missingSample.push(frameKey);
    }
  }

  const expected = frameKeys.length || 1;
  const coverage = hydrated / expected;
  return {
    hydrated,
    coverage,
    sourceHits,
    missingSample,
    status: computeHydrationStatus(coverage),
  };
}

export async function loadCompressedAtlasFromRuntime(
  base: string,
  atlasPath: string,
  data: any,
  state: SpriteState,
  options: { maxWaitMs?: number; loadAssets?: boolean; loadBridge?: boolean } = {}
): Promise<HydratePassResult> {
  const frameKeys = Object.keys(data?.frames || {});
  const expected = frameKeys.length;
  if (expected === 0) {
    return {
      hydrated: 0,
      coverage: 1,
      sourceHits: { assets: 0, bridge: 0, runtime: 0 },
      missingSample: [],
      status: 'ok',
    };
  }

  const root = getRuntimeWindow() as any;
  const pixiRoots = [root?.PIXI, root?.__PIXI__].filter(Boolean);
  const hasAssetsLoader = pixiRoots.some((P) => typeof (P as any)?.Assets?.load === 'function');
  const runtimeHints = Array.isArray(state.runtimeTextureHints)
    ? (state.runtimeTextureHints as any[]).filter(Boolean)
    : [];
  const hasRuntimeHints = runtimeHints.length > 0;

  const shouldLoadAssets = options.loadAssets !== false && hasAssetsLoader;
  const shouldLoadBridge = options.loadBridge !== false;
  const maxWaitMs = Math.max(250, options.maxWaitMs ?? 9000);
  const waitBudgetMs = !hasAssetsLoader && !hasRuntimeHints
    ? Math.min(maxWaitMs, 1500)
    : maxWaitMs;
  const imagePath = relPath(atlasPath, data?.meta?.image || '');

  const loadedAssets = shouldLoadAssets ? await tryLoadAtlasViaPixiAssets(base, atlasPath, imagePath) : [];
  const bridgeContainers = shouldLoadBridge
    ? await tryLoadAtlasViaBridge(base, atlasPath, imagePath, data)
    : getBridgeTextureContainers(atlasPath);
  const liveBridgeContainers = [...bridgeContainers];

  const start = performance.now();
  let best: HydratePassResult = {
    hydrated: 0,
    coverage: 0,
    sourceHits: { assets: 0, bridge: 0, runtime: 0 },
    missingSample: frameKeys.slice(0, MAX_MISSING_SAMPLE),
    status: 'failed',
  };
  const cumulativeSourceHits: Record<TextureSourceName, number> = { assets: 0, bridge: 0, runtime: 0 };
  const runtimeHintCandidates = Array.isArray(state.runtimeTextureHints)
    ? (state.runtimeTextureHints as any[])
    : [];
  const runtimeCandidates = [state.app, state.renderer, ...runtimeHintCandidates];
  let bridgeProbeAttempts = shouldLoadBridge ? 1 : 0;
  const initialManagedPass = hydrateAtlasFromManagedTextureCandidates(
    atlasPath,
    imagePath,
    data,
    state,
    runtimeCandidates
  );
  if (initialManagedPass?.hydrated) {
    cumulativeSourceHits.runtime += initialManagedPass.sourceHits.runtime;
    best = {
      ...initialManagedPass,
      sourceHits: { ...cumulativeSourceHits },
    };
    if (initialManagedPass.coverage >= TARGET_COMPRESSED_COVERAGE) {
      return {
        ...initialManagedPass,
        sourceHits: { ...cumulativeSourceHits },
        status: 'ok',
      };
    }
  }

  let zeroIndexPasses = 0;
  while (performance.now() - start < waitBudgetMs) {
    if (shouldLoadBridge && bridgeProbeAttempts < 10) {
      const bridgeReload = await tryLoadAtlasViaBridge(base, atlasPath, imagePath, data);
      if (bridgeReload.length > 0) {
        liveBridgeContainers.push(...bridgeReload);
      }
      bridgeProbeAttempts += 1;
    }

    const assetIndex = buildTextureIndexFromContainers(loadedAssets);
    const bridgeIndex = buildTextureIndexFromContainers([
      ...liveBridgeContainers,
      ...getBridgeTextureContainers(atlasPath),
    ]);
    const runtimeIndex = buildRuntimeTextureIndex(runtimeCandidates, false);
    const pass = hydrateAtlasFromSources(frameKeys, state, [
      { source: 'assets', index: assetIndex },
      { source: 'bridge', index: bridgeIndex },
      { source: 'runtime', index: runtimeIndex },
    ]);
    cumulativeSourceHits.assets += pass.sourceHits.assets;
    cumulativeSourceHits.bridge += pass.sourceHits.bridge;
    cumulativeSourceHits.runtime += pass.sourceHits.runtime;

    if (pass.hydrated > best.hydrated) {
      best = {
        ...pass,
        sourceHits: { ...cumulativeSourceHits },
      };
    }

    if (pass.coverage >= TARGET_COMPRESSED_COVERAGE) {
      return {
        ...pass,
        sourceHits: { ...cumulativeSourceHits },
        status: 'ok',
      };
    }

    if (assetIndex.exact.size === 0 && bridgeIndex.exact.size === 0 && runtimeIndex.exact.size === 0) {
      zeroIndexPasses += 1;
      if (zeroIndexPasses >= 6) {
        break;
      }
    } else {
      zeroIndexPasses = 0;
    }

    const loopManagedPass = hydrateAtlasFromManagedTextureCandidates(
      atlasPath,
      imagePath,
      data,
      state,
      runtimeCandidates
    );
    if (loopManagedPass?.hydrated && loopManagedPass.hydrated > best.hydrated) {
      cumulativeSourceHits.runtime += loopManagedPass.sourceHits.runtime;
      best = {
        ...loopManagedPass,
        sourceHits: { ...cumulativeSourceHits },
      };
      if (loopManagedPass.coverage >= TARGET_COMPRESSED_COVERAGE) {
        return {
          ...loopManagedPass,
          sourceHits: { ...cumulativeSourceHits },
          status: 'ok',
        };
      }
    }
    await delay(140);
  }

  if (best.coverage < TARGET_COMPRESSED_COVERAGE) {
    const lateManagedPass = hydrateAtlasFromManagedTextureCandidates(
      atlasPath,
      imagePath,
      data,
      state,
      runtimeCandidates
    );
    if (lateManagedPass?.hydrated && lateManagedPass.hydrated > best.hydrated) {
      cumulativeSourceHits.runtime += lateManagedPass.sourceHits.runtime;
      best = {
        ...lateManagedPass,
        sourceHits: { ...cumulativeSourceHits },
      };
    }
    if (lateManagedPass && lateManagedPass.coverage >= TARGET_COMPRESSED_COVERAGE) {
      return {
        ...lateManagedPass,
        sourceHits: { ...cumulativeSourceHits },
        status: 'ok',
      };
    }
  }

  const finalCoverage = best.hydrated / expected;
  return {
    hydrated: best.hydrated,
    coverage: finalCoverage,
    sourceHits: { ...cumulativeSourceHits },
    missingSample: best.missingSample,
    status: computeHydrationStatus(finalCoverage),
  };
}

function rgbaToCanvas(width: number, height: number, rgba: Uint8ClampedArray): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx2d = canvas.getContext('2d', { willReadFrequently: false });
  if (!ctx2d) {
    throw new Error('2D context unavailable for decoded KTX2 atlas');
  }
  // Ensure an ArrayBuffer-backed view for ImageData in strict TS DOM typings.
  const pixels = new Uint8ClampedArray(rgba.length);
  pixels.set(rgba);
  const imageData = new ImageData(pixels, width, height);
  ctx2d.putImageData(imageData, 0, 0);
  return canvas;
}

export async function loadCompressedAtlasViaDecoder(
  base: string,
  atlasPath: string,
  data: any,
  state: SpriteState,
  decoder: Ktx2DecoderPool
): Promise<HydratePassResult> {
  const frameKeys = Object.keys(data?.frames || {});
  const expected = frameKeys.length;
  if (expected === 0) {
    return {
      hydrated: 0,
      coverage: 1,
      sourceHits: { assets: 0, bridge: 0, runtime: 0 },
      missingSample: [],
      status: 'ok',
    };
  }

  const imagePath = relPath(atlasPath, data?.meta?.image || '');
  const blob = await getBlob(joinPath(base, imagePath));
  const bytes = await blob.arrayBuffer();
  const decoded = await decoder.decode(bytes, imagePath);

  const canvas = rgbaToCanvas(decoded.width, decoded.height, decoded.rgba);
  const baseTex = state.ctors!.Texture.from(canvas);
  buildAtlasTextures(data, baseTex, state.tex, state.atlasBases, state.ctors!);

  // Store the KTX2 source canvas so textureToCanvas can bypass GPU extraction.
  // GPU textures may not be uploaded (never rendered to screen), causing blank extract.
  const texSource = baseTex?.source ?? baseTex?._source ?? baseTex;
  if (texSource && typeof texSource === 'object' && state.ktx2Canvases) {
    state.ktx2Canvases.set(texSource as object, canvas);
  }

  const hydrated = countHydratedFrames(frameKeys, state);
  const coverage = expected > 0 ? hydrated / expected : 1;
  return {
    hydrated,
    coverage,
    sourceHits: { assets: hydrated, bridge: 0, runtime: 0 },
    missingSample: frameKeys.filter((key) => !state.tex.has(key)).slice(0, MAX_MISSING_SAMPLE),
    status: computeHydrationStatus(coverage),
  };
}
