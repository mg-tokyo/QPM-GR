import type { SpriteState } from '../types';
import type {
  AtlasBootReport,
  AtlasLoaderMode,
  SpriteBootReport,
  SpriteHydrationStatus,
  SpriteRendererReport,
} from './types';
import { computeHydrationStatus } from './hydrationEvents';

// Live holders — mutated by index.ts (boot publish, render errors) and
// postHydration.ts (background rehydrate); read by healthIntegration + getters.
export const bootReportRef: { current: SpriteBootReport | null } = { current: null };
export const renderErrorState: { message: string | null; at: number | null } = {
  message: null,
  at: null,
};

export function hasExtractCanvas(renderer: any): boolean {
  return typeof renderer?.extract?.canvas === 'function';
}

export function getRendererUid(renderer: any): string | number | null {
  const uid = renderer?.uid ?? renderer?._uid ?? renderer?.CONTEXT_UID ?? renderer?.context?.uid ?? null;
  if (uid == null) return null;
  return typeof uid === 'number' || typeof uid === 'string' ? uid : String(uid);
}

export function getRendererType(renderer: any): string | number | null {
  const type = renderer?.type ?? renderer?.context?.type ?? null;
  if (type == null) return null;
  return typeof type === 'number' || typeof type === 'string' ? type : String(type);
}

export function buildRendererReport(state: SpriteState | null | undefined): SpriteRendererReport {
  const renderer = state?.renderer ?? null;
  const appRenderer = state?.app?.renderer ?? null;
  return {
    rendererUid: getRendererUid(renderer),
    rendererType: getRendererType(renderer),
    appRendererUid: getRendererUid(appRenderer),
    sameAsAppRenderer: Boolean(renderer && appRenderer && renderer === appRenderer),
    hasExtractCanvas: hasExtractCanvas(renderer),
    appHasExtractCanvas: hasExtractCanvas(appRenderer),
    lastRenderError: renderErrorState.message,
    lastRenderErrorAt: renderErrorState.at,
  };
}

export function updateBootReportRenderer(state: SpriteState | null | undefined): void {
  if (!bootReportRef.current) return;
  bootReportRef.current = {
    ...bootReportRef.current,
    renderer: buildRendererReport(state),
  };
}

function cloneBootReport(report: SpriteBootReport | null): SpriteBootReport | null {
  if (!report) return null;
  try {
    return JSON.parse(JSON.stringify(report)) as SpriteBootReport;
  } catch {
    return report;
  }
}

export function getSpriteBootReport(): SpriteBootReport | null {
  return cloneBootReport(bootReportRef.current);
}

export function finalizeReportStatus(reports: AtlasBootReport[]): {
  expectedFrames: number;
  hydratedFrames: number;
  coverage: number;
  status: SpriteHydrationStatus;
  finalMode: AtlasLoaderMode | 'mixed' | 'unknown';
} {
  let expectedFrames = 0;
  let hydratedFrames = 0;
  const seenModes = new Set<AtlasLoaderMode>();
  let status: SpriteHydrationStatus = 'ok';

  for (const report of reports) {
    expectedFrames += report.expectedFrames;
    hydratedFrames += report.hydratedFrames;
    seenModes.add(report.mode);
    if (report.status === 'failed') {
      status = 'failed';
    } else if (report.status === 'degraded' && status !== 'failed') {
      status = 'degraded';
    }
  }

  const coverage = expectedFrames > 0 ? hydratedFrames / expectedFrames : 1;
  let finalMode: AtlasLoaderMode | 'mixed' | 'unknown' = 'unknown';
  if (seenModes.size === 1) {
    finalMode = Array.from(seenModes)[0] ?? 'unknown';
  } else if (seenModes.size > 1) {
    finalMode = 'mixed';
  }

  return {
    expectedFrames,
    hydratedFrames,
    coverage,
    status: status === 'ok' ? computeHydrationStatus(coverage) : status,
    finalMode,
  };
}
