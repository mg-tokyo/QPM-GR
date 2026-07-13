import type { SpriteConfig, SpriteState } from '../types';
import * as api from '../api';
import { clearVariantCache } from '../cache';
import { clearSpriteDataUrlCache } from '../compat';
import { spriteLog } from '../diagnostics';
import { delay, YieldController } from '../../utils/scheduling/scheduling';
import { TARGET_COMPRESSED_COVERAGE } from './constants';
import type { AtlasBootReport, CompressedAtlasEntry } from './types';
import { bootReportRef, buildRendererReport, finalizeReportStatus } from './bootReport';
import { dispatchHydrationEvent } from './hydrationEvents';
import { getBridgeSnapshot } from './bridge';
import { recalcSpriteCatalog } from './state';
import { loadCompressedAtlasFromRuntime } from './atlasHydration';

function parseSpriteItemKey(key: string): { category: string; id: string } | null {
  const clean = String(key || '').replace(/^\/+/, '');
  const parts = clean.split('/').filter(Boolean);
  if (parts.length < 3) return null;
  if (parts[0] !== 'sprite' && parts[0] !== 'sprites') return null;
  const category = parts[1] || '';
  const id = parts.slice(2).join('/');
  if (!category || !id) return null;
  return { category, id };
}

export async function runPostHydrationMutationPass(state: SpriteState, cfg: SpriteConfig): Promise<void> {
  const candidates = state.items
    .filter((item) => item.key.startsWith('sprite/plant/') || item.key.startsWith('sprite/tallplant/'))
    .slice(0, 8);
  if (!candidates.length) return;

  const mutationsToPrime: string[][] = [['Rainbow'], ['Gold']];
  const yieldCtl = new YieldController(2, 8);

  for (const item of candidates) {
    const parsed = parseSpriteItemKey(item.key);
    if (!parsed) continue;
    for (const mutations of mutationsToPrime) {
      try {
        api.getSpriteWithMutations(
          {
            category: parsed.category as any,
            id: parsed.id,
            mutations,
          },
          state,
          cfg
        );
      } catch {
        // Ignore warmup misses, this pass is best-effort only.
      }
      await yieldCtl.yieldIfNeeded();
    }
  }
}

export async function runBackgroundCompressedRehydrate(
  base: string,
  compressedEntries: CompressedAtlasEntry[],
  atlasReports: AtlasBootReport[],
  state: SpriteState
): Promise<void> {
  if (!compressedEntries.length) return;
  const needsRehydrate = atlasReports.some(
    (r) => r.mode === 'compressed' && r.coverage < TARGET_COMPRESSED_COVERAGE
  );
  if (!needsRehydrate) return;

  const reportByPath = new Map(atlasReports.map((r) => [r.atlasPath, r] as const));
  let anyChanged = false;

  for (let attempt = 1; attempt <= 6; attempt++) {
    await delay(600);
    let changedThisAttempt = false;

    for (const entry of compressedEntries) {
      const report = reportByPath.get(entry.atlasPath);
      if (!report || report.coverage >= TARGET_COMPRESSED_COVERAGE) continue;

      const pass = await loadCompressedAtlasFromRuntime(
        base,
        entry.atlasPath,
        entry.data,
        state,
        { maxWaitMs: 1400, loadAssets: false, loadBridge: true }
      );
      if (pass.hydrated > report.hydratedFrames) {
        report.hydratedFrames = pass.hydrated;
        report.coverage = pass.coverage;
        report.status = pass.status;
        report.sourceHits.assets += pass.sourceHits.assets;
        report.sourceHits.bridge += pass.sourceHits.bridge;
        report.sourceHits.runtime += pass.sourceHits.runtime;
        report.missingSample = pass.missingSample;
        changedThisAttempt = true;
      }
    }

    if (changedThisAttempt) {
      anyChanged = true;
      clearVariantCache(state);
      clearSpriteDataUrlCache();
      recalcSpriteCatalog(state);
      const finalized = finalizeReportStatus(atlasReports);
      if (bootReportRef.current) {
        bootReportRef.current = {
          ...bootReportRef.current,
          expectedFrames: finalized.expectedFrames,
          hydratedFrames: finalized.hydratedFrames,
          coverage: finalized.coverage,
          status: finalized.status,
          finalMode: finalized.finalMode,
          atlasReports: atlasReports.map((r) => ({ ...r })),
          bridgeSnapshot: getBridgeSnapshot(),
          renderer: buildRendererReport(state),
          generatedAt: Date.now(),
        };
      }
      dispatchHydrationEvent('rehydrated', {
        attempt,
        loadMode: state.loadMode ?? 'unknown',
        degraded: atlasReports.some((r) => r.status !== 'ok'),
        textures: state.tex.size,
        reports: atlasReports.map((r) => ({
          atlasPath: r.atlasPath,
          mode: r.mode,
          coverage: Number(r.coverage.toFixed(3)),
          status: r.status,
        })),
      });
    }

    const done = atlasReports
      .filter((r) => r.mode === 'compressed')
      .every((r) => r.coverage >= TARGET_COMPRESSED_COVERAGE);
    if (done) break;
  }

  if (anyChanged) {
    spriteLog('info', 'background-rehydrate-complete', 'Post-load compressed rehydrate completed', {
      textures: state.tex.size,
      reports: atlasReports.map((r) => ({
        atlasPath: r.atlasPath,
        coverage: Number(r.coverage.toFixed(3)),
        status: r.status,
      })),
    });
  }
}
