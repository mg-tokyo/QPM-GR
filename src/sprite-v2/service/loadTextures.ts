import type { SpriteState } from '../types';
import { blobToImage, getBlob, getJSON, isAtlas, joinPath, loadAtlasJsons, relPath } from '../manifest';
import { buildAtlasTextures, buildItemsFromTextures } from '../atlas';
import { clearVariantCache } from '../cache';
import { clearSpriteDataUrlCache } from '../compat';
import { spriteLog } from '../diagnostics';
import { createKtx2DecoderPool } from '../ktx2';
import { delay, yieldToBrowser, YieldController } from '../../utils/scheduling/scheduling';
import { COMPRESSED_ATLAS_RE, MAX_MISSING_SAMPLE, TARGET_COMPRESSED_COVERAGE } from './constants';
import type {
  AtlasBootReport,
  CompressedAtlasEntry,
  HydratePassResult,
  LoadTexturesResult,
  PrefetchedAtlas,
  SpriteLoadMode,
} from './types';
import { notifyWarmup } from './warmup';
import { computeHydrationStatus } from './hydrationEvents';
import { finalizeReportStatus } from './bootReport';
import { countHydratedFrames } from './textureIndex';
import {
  chooseKtx2DecoderConcurrency,
  classifyKtx2Error,
  createDecoderTelemetry,
  isWasmAvailable,
  shouldAllowLegacyFallbackOnKtx2,
} from './ktx2Telemetry';
import { loadCompressedAtlasViaDecoder } from './atlasHydration';
import { isKtx2NativeRequired, tryLegacyVersionFallback } from './legacyFallback';
import { getBridgeSnapshot } from './bridge';
import { recalcSpriteCatalog } from './state';
import { diagLog } from './healthIntegration';

let sprite005ReportedThisBoot = false;
let sprite006ReportedThisBoot = false;

/** Prefetch atlas data in parallel with PIXI init to reduce total load time. */
export async function prefetchAtlasData(base: string): Promise<PrefetchedAtlas | null> {
  try {
    notifyWarmup({ phase: 'prefetch-manifest' });
    const manifest = await getJSON(joinPath(base, 'manifest.json'));

    notifyWarmup({ phase: 'prefetch-atlas-json' });
    const atlasJsons = await loadAtlasJsons(base, manifest);

    const blobs = new Map<string, Blob>();
    const entries = Object.entries(atlasJsons);
    const legacyAtlasEntries = entries.filter(([path, data]) => {
      if (!isAtlas(data)) return false;
      const imagePath = relPath(path, data.meta.image);
      return !COMPRESSED_ATLAS_RE.test(imagePath);
    });
    const atlasCount = legacyAtlasEntries.length;

    notifyWarmup({ phase: 'prefetch-images', total: atlasCount, done: 0 });

    let fetched = 0;
    const yieldCtl = new YieldController(3, 16); // Yield every 3 fetches or 16ms

    for (const [path, data] of legacyAtlasEntries) {
      const imgPath = relPath(path, data.meta.image);
      try {
        const blob = await getBlob(joinPath(base, imgPath));
        blobs.set(imgPath, blob);
        fetched++;
        notifyWarmup({ done: fetched });
      } catch {
        /* ignore individual fetch errors - will be retried in loadTextures */
      }

      await yieldCtl.yieldIfNeeded();
    }

    return { base, atlasJsons, blobs };
  } catch (error) {
    spriteLog('warn', 'prefetch-failed', 'Prefetch failed, falling back to normal loading', {
      error: String((error as Error)?.message ?? error),
    });
    return null;
  }
}

export async function loadTextures(
  base: string,
  state: SpriteState,
  prefetched?: PrefetchedAtlas | null
): Promise<LoadTexturesResult> {
  const ATLAS_YIELD_DELAY_MS = 16; // ~1 frame at 60fps
  const FRAMES_PER_YIELD = 4;
  const MAX_CHUNK_MS = 12;

  const ctors = state.ctors;
  if (!ctors?.Texture || !ctors?.Rectangle) {
    throw new Error('PIXI constructors missing');
  }

  const usePrefetched = prefetched && prefetched.base === base ? prefetched : null;

  notifyWarmup({ phase: 'load-manifest' });
  const manifest = usePrefetched?.atlasJsons
    ? null // Already have atlas JSONs
    : await getJSON(joinPath(base, 'manifest.json'));

  const atlasJsons = usePrefetched?.atlasJsons ?? await loadAtlasJsons(base, manifest!);

  const entries = Object.entries(atlasJsons);
  const atlasEntries = entries.filter(([, data]) => isAtlas(data));
  const totalAtlases = atlasEntries.length;
  const atlasReports: AtlasBootReport[] = [];
  const compressedEntries: CompressedAtlasEntry[] = [];
  const wasmOk = isWasmAvailable();
  const decoderConcurrency = chooseKtx2DecoderConcurrency();
  const decoder = wasmOk
    ? createKtx2DecoderPool({
        concurrency: decoderConcurrency,
        decodeTimeoutMs: decoderConcurrency === 1 ? 12000 : 9000,
      })
    : null;
  let decoderSnapshot = createDecoderTelemetry();

  if (!wasmOk) {
    spriteLog('warn', 'wasm-unavailable', 'WebAssembly blocked (CSP?), skipping KTX2 decoder — using legacy image path');
  }

  notifyWarmup({ phase: 'load-textures', total: totalAtlases, done: 0 });

  const yieldCtl = new YieldController(FRAMES_PER_YIELD, MAX_CHUNK_MS);
  let processed = 0;

  try {
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!entry) continue;
      const [path, data] = entry;
      if (!isAtlas(data)) continue;

      const imgPath = relPath(path, data.meta.image);
      const frameKeys = Object.keys(data.frames || {});
      const expected = frameKeys.length;

      // Capability-based branch: KTX2 uses native decoder path, all others keep legacy image decode.
      // When WASM is unavailable (CSP), skip decoder entirely → fall through to legacy image path.
      if (decoder && COMPRESSED_ATLAS_RE.test(imgPath)) {
        let pass: HydratePassResult;
        try {
          pass = await loadCompressedAtlasViaDecoder(base, path, data, state, decoder);
        } catch (error) {
          const failureKind = classifyKtx2Error(error);
          pass = {
            hydrated: 0,
            coverage: 0,
            status: 'failed',
            sourceHits: { assets: 0, bridge: 0, runtime: 0 },
            missingSample: frameKeys.slice(0, MAX_MISSING_SAMPLE),
          };
          spriteLog('warn', 'ktx2-atlas-decode-failed', 'KTX2 atlas decode failed', {
            atlasPath: path,
            imagePath: imgPath,
            failureKind,
            error: String((error as Error)?.message ?? error),
          });
          if (failureKind === 'discovery-failed' && !sprite005ReportedThisBoot) {
            sprite005ReportedThisBoot = true;
            diagLog.error('QPM-SPRITE-005', {
              atlasPath: path,
              imagePath: imgPath,
              error: String((error as Error)?.message ?? error),
            }, error);
          } else if (failureKind === 'protocol-mismatch' && !sprite006ReportedThisBoot) {
            sprite006ReportedThisBoot = true;
            diagLog.error('QPM-SPRITE-006', {
              atlasPath: path,
              imagePath: imgPath,
              error: String((error as Error)?.message ?? error),
            }, error);
          }
        }

        atlasReports.push({
          atlasPath: path,
          imagePath: imgPath,
          mode: 'compressed',
          source: 'ktx2-decoder',
          expectedFrames: expected,
          hydratedFrames: pass.hydrated,
          coverage: pass.coverage,
          status: pass.status,
          sourceHits: {
            assets: pass.sourceHits.assets,
            bridge: pass.sourceHits.bridge,
            runtime: pass.sourceHits.runtime,
          },
          missingSample: pass.missingSample,
        });
        compressedEntries.push({ atlasPath: path, imagePath: imgPath, data });

        processed++;
        notifyWarmup({ done: processed });
        await yieldCtl.yieldIfNeeded();
        if (i < entries.length - 1) {
          await delay(ATLAS_YIELD_DELAY_MS);
        }
        continue;
      }

      let blob = usePrefetched?.blobs.get(imgPath);
      if (!blob) {
        blob = await getBlob(joinPath(base, imgPath));
      }

      const img = await blobToImage(blob);
      const baseTex = ctors.Texture.from(img);

      buildAtlasTextures(data, baseTex, state.tex, state.atlasBases, ctors);
      const hydrated = countHydratedFrames(frameKeys, state);
      const coverage = expected > 0 ? hydrated / expected : 1;

      atlasReports.push({
        atlasPath: path,
        imagePath: imgPath,
        mode: 'legacy',
        source: 'legacy-image',
        expectedFrames: expected,
        hydratedFrames: hydrated,
        coverage,
        status: computeHydrationStatus(coverage),
        sourceHits: { assets: hydrated, bridge: 0, runtime: 0 },
        missingSample: [],
      });

      processed++;
      notifyWarmup({ done: processed });

      await yieldCtl.yieldIfNeeded();

      // Small delay between atlases to prevent frame drops on low-end devices
      if (i < entries.length - 1) {
        await delay(ATLAS_YIELD_DELAY_MS);
      }
    }
  } finally {
    if (decoder) {
      decoderSnapshot = decoder.snapshot();
      decoder.destroy();
    }
  }

  notifyWarmup({ phase: 'build-catalog' });

  // Yield before building item catalog (can be CPU-intensive)
  await yieldToBrowser();

  const { items, cats } = buildItemsFromTextures(state.tex, { catLevels: 1 });

  // Yield after building to let GC run
  await yieldToBrowser();

  state.items = items;
  state.filtered = items.slice();
  state.cats = cats;

  let fallbackBase: string | null = null;
  let loadMode: SpriteLoadMode = compressedEntries.length > 0 ? 'ktx2-native' : 'legacy';
  const getCompressedStats = () => {
    const compressedExpected = atlasReports
      .filter((report) => report.mode === 'compressed')
      .reduce((sum, report) => sum + report.expectedFrames, 0);
    const compressedHydrated = atlasReports
      .filter((report) => report.mode === 'compressed')
      .reduce((sum, report) => sum + report.hydratedFrames, 0);
    return { compressedExpected, compressedHydrated };
  };

  let { compressedExpected, compressedHydrated } = getCompressedStats();
  const compressedDegraded =
    compressedEntries.length > 0 &&
    compressedExpected > 0 &&
    compressedHydrated < compressedExpected * TARGET_COMPRESSED_COVERAGE;
  if (compressedDegraded) {
    const nativeRequired = isKtx2NativeRequired(state.version);
    const allowFallback = shouldAllowLegacyFallbackOnKtx2();
    const canAttemptFallback = !nativeRequired || allowFallback;

    if (canAttemptFallback) {
      fallbackBase = await tryLegacyVersionFallback(base, state, compressedEntries, atlasReports, ctors);
      if (fallbackBase) {
        recalcSpriteCatalog(state);
        ({ compressedExpected, compressedHydrated } = getCompressedStats());
        loadMode = 'legacy-fallback';
        spriteLog(
          'warn',
          'legacy-fallback-applied',
          'Applied legacy atlas fallback for compressed runtime compatibility',
          {
            fallbackBase,
            textures: state.tex.size,
            items: state.items.length,
          },
          { alwaysConsole: true, onceKey: 'legacy-fallback-applied' }
        );
      } else {
        loadMode = 'ktx2-native-failed';
      }
    } else {
      loadMode = 'ktx2-native-failed';
    }
  }

  const degradedCompressedReports = atlasReports.filter((report) => report.mode === 'compressed' && report.status !== 'ok');
  if (degradedCompressedReports.length > 0) {
    const degradedExpected = degradedCompressedReports.reduce((sum, report) => sum + report.expectedFrames, 0);
    const degradedHydrated = degradedCompressedReports.reduce((sum, report) => sum + report.hydratedFrames, 0);
    const degradedCoverage = degradedExpected > 0 ? degradedHydrated / degradedExpected : 0;
    const summary =
      `Compressed atlas hydration degraded ` +
      `(${degradedHydrated}/${degradedExpected}, ${(degradedCoverage * 100).toFixed(1)}%) ` +
      `across ${degradedCompressedReports.length} atlas(es)`;

    spriteLog('warn', 'compressed-hydration-degraded', summary, undefined, {
      alwaysConsole: true,
      onceKey: 'compressed-hydration-degraded',
    });
    spriteLog('warn', 'compressed-hydration-degraded-details', 'Per-atlas degraded hydration details', {
      atlases: degradedCompressedReports.map((report) => ({
        atlasPath: report.atlasPath,
        imagePath: report.imagePath,
        expectedFrames: report.expectedFrames,
        hydratedFrames: report.hydratedFrames,
        coverage: Number(report.coverage.toFixed(3)),
        sourceHits: report.sourceHits,
        missingSample: report.missingSample,
      })),
    });
  }

  notifyWarmup({ phase: 'complete', completed: true });

  if (compressedEntries.length > 0) {
    clearVariantCache(state);
    clearSpriteDataUrlCache();
  }

  const finalized = finalizeReportStatus(atlasReports);
  if (compressedEntries.length > 0 && loadMode === 'ktx2-native' && finalized.status !== 'ok') {
    loadMode = 'ktx2-native-failed';
  }
  state.loaded = true;
  return {
    atlasReports,
    compressedEntries,
    expectedFrames: finalized.expectedFrames,
    hydratedFrames: finalized.hydratedFrames,
    status: finalized.status,
    finalMode: finalized.finalMode,
    loadMode,
    bridgeSnapshot: getBridgeSnapshot(),
    fallbackBase,
    decoder: decoderSnapshot,
  };
}
