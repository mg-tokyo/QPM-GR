import type { SpriteState } from '../types';
import { blobToImage, getBlob, getJSON, isAtlas, joinPath, loadAtlasJsons, relPath } from '../manifest';
import { buildAtlasTextures } from '../atlas';
import { COMPRESSED_ATLAS_RE, KTX2_NATIVE_REQUIRED_VERSION, MAX_MISSING_SAMPLE } from './constants';
import type { AtlasBootReport, CompressedAtlasEntry } from './types';
import { computeHydrationStatus } from './hydrationEvents';
import { countHydratedFrames } from './textureIndex';

export function parseNumericVersion(version: string | null | undefined): number | null {
  const raw = String(version ?? '').trim();
  if (!/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function isKtx2NativeRequired(version: string | null | undefined): boolean {
  const parsed = parseNumericVersion(version);
  return parsed != null && parsed >= KTX2_NATIVE_REQUIRED_VERSION;
}

function swapBaseVersion(base: string, version: number): string | null {
  const normalized = String(base || '').trim();
  if (!normalized) return null;
  const withSlash = normalized.endsWith('/') ? normalized : `${normalized}/`;
  const swapped = withSlash.replace(/\/version\/[^/]+\/assets\/$/i, `/version/${version}/assets/`);
  if (swapped === withSlash) return null;
  return swapped;
}

export async function tryLegacyVersionFallback(
  base: string,
  state: SpriteState,
  compressedEntries: CompressedAtlasEntry[],
  atlasReports: AtlasBootReport[],
  ctors: any
): Promise<string | null> {
  if (!compressedEntries.length) return null;
  const currentVersion = parseNumericVersion(state.version);
  if (!currentVersion) return null;

  const minVersion = Math.max(1, currentVersion - 8);
  const candidates: number[] = [];
  for (let v = currentVersion - 1; v >= minVersion; v--) {
    candidates.push(v);
  }

  for (const version of candidates) {
    const fallbackBase = swapBaseVersion(base, version);
    if (!fallbackBase) continue;

    try {
      const manifest = await getJSON(joinPath(fallbackBase, 'manifest.json'));
      const atlasJsons = await loadAtlasJsons(fallbackBase, manifest);
      const usableEntries = Object.entries(atlasJsons).filter(([path, data]) => {
        if (!isAtlas(data)) return false;
        const imagePath = relPath(path, data.meta.image);
        return !COMPRESSED_ATLAS_RE.test(imagePath);
      });
      if (!usableEntries.length) continue;

      for (const [path, data] of usableEntries) {
        const imagePath = relPath(path, data.meta.image);
        const blob = await getBlob(joinPath(fallbackBase, imagePath));
        const img = await blobToImage(blob);
        const baseTex = ctors.Texture.from(img);
        buildAtlasTextures(data, baseTex, state.tex, state.atlasBases, ctors);
      }

      let hydratedCompressed = 0;
      let expectedCompressed = 0;
      for (const entry of compressedEntries) {
        const keys = Object.keys(entry.data?.frames || {});
        expectedCompressed += keys.length;
        hydratedCompressed += countHydratedFrames(keys, state);
      }
      if (hydratedCompressed <= 0) {
        continue;
      }

      const reportByPath = new Map(atlasReports.map((report) => [report.atlasPath, report] as const));
      for (const entry of compressedEntries) {
        const report = reportByPath.get(entry.atlasPath);
        if (!report) continue;
        const keys = Object.keys(entry.data?.frames || {});
        const hydrated = countHydratedFrames(keys, state);
        if (hydrated > report.hydratedFrames) {
          report.sourceHits.assets += hydrated - report.hydratedFrames;
        }
        report.hydratedFrames = hydrated;
        report.coverage = keys.length > 0 ? hydrated / keys.length : 1;
        report.status = computeHydrationStatus(report.coverage);
        report.source = 'legacy-fallback';
        report.missingSample = keys.filter((key) => !state.tex.has(key)).slice(0, MAX_MISSING_SAMPLE);
      }

      return fallbackBase;
    } catch {
      // Continue to next candidate version.
    }
  }

  return null;
}
