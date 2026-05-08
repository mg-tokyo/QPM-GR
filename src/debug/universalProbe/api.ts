import { detectContainers } from './containers';
import { buildResolverProxy, explainTarget, listTargetRecipes, resolveTarget, untrackTarget } from '../../core/targetResolver';
import type { ProbeLifecycleState } from './lifecycle';
import { storeProbeResult, stopProbeState } from './lifecycle';
import { drawOverlay, highlightRect, removeOverlay, setOverlayEnabled } from './overlay';
import { inspectPoint as inspectProbePoint, pickOnce as startPickOnce } from './pointInspect';
import { getProbeRuntime } from './runtime';
import { buildSceneIndex } from './sceneIndex';
import { detectTargets } from './targets';
import { startProbeWatch } from './watch';
import type { ResolveTargetParams, ResolveTargetResult } from '../../core/targetResolver';
import type {
  ProbeBounds,
  ProbeContainerCandidate,
  ProbeClickReport,
  ProbeScanOptions,
  ProbeScanResult,
  ProbeTargetCandidate,
} from './types';

function toRuntimeRecord(runtime: ReturnType<typeof getProbeRuntime>): Record<string, unknown> {
  return {
    ready: runtime.ready,
    version: runtime.version,
    hasApp: !!runtime.app,
    hasRenderer: !!runtime.renderer,
    hasStage: !!runtime.stage,
    hasCanvas: !!runtime.canvas,
  };
}

function runScan(state: ProbeLifecycleState, options: ProbeScanOptions = {}): ProbeScanResult {
  const runtime = getProbeRuntime();
  const scene = runtime.ready ? buildSceneIndex(runtime) : null;

  const containers = detectContainers(scene, options.includeDomContainers !== false);
  const targets = detectTargets(scene, options.targetMode ?? 'action', options.onlyInteractive ?? false, options.targetTopN ?? 120);
  const clickReport = options.clickReport ?? state.lastClickReport;

  state.stableIds.assign(containers, 'containers', 'c');
  state.stableIds.assign(targets, 'targets', 't');
  if (clickReport?.pixiHits.length) {
    state.stableIds.assign(clickReport.pixiHits, 'hits', 'h');
  }

  const result: ProbeScanResult = {
    runtime: toRuntimeRecord(runtime),
    containers,
    targets,
    clickReport,
    timestamp: new Date().toISOString(),
  };

  storeProbeResult(state, result);
  drawOverlay(state, result);

  if (!options.suppressConsole) {
    console.info('[QPM Probe] scan complete', {
      containers: containers.length,
      targets: targets.length,
      runtime: result.runtime,
    });
    if (containers.length > 0) {
      console.table(containers.slice(0, 12).map((c) => ({
        tag: c.stableTag ?? '?',
        kind: c.kindGuess,
        type: c.type,
        label: c.label?.slice(0, 40),
        confidence: c.confidence,
        children: c.childCount,
      })));
    }
    if (targets.length > 0) {
      console.table(targets.slice(0, 20).map((t) => ({
        tag: t.stableTag ?? '?',
        kind: t.kind,
        source: t.source,
        type: t.type,
        label: t.label?.slice(0, 40),
        confidence: t.confidence,
        interactive: t.interactive,
      })));
    }
  }

  return result;
}

function findBoundsByRef(state: ProbeLifecycleState, ref: string | ProbeBounds): ProbeBounds | null {
  if (typeof ref !== 'string') return ref;
  const needle = ref.trim();
  if (!needle || !state.last) return null;
  const fromContainers = state.last.containers.find((item) => item.stableTag === needle || item.stableKey === needle);
  if (fromContainers) return fromContainers.boundsCss;
  const fromTargets = state.last.targets.find((item) => item.stableTag === needle || item.stableKey === needle);
  if (fromTargets) return fromTargets.boundsCss;
  const fromHits = state.last.clickReport?.pixiHits.find((item) => item.stableTag === needle || item.stableKey === needle);
  return fromHits?.boundsCss ?? null;
}

type ProbePickOptions = ProbeScanOptions & { preventDefault?: boolean };

export interface UniversalProbeApi {
  state: () => Record<string, unknown>;
  scan: (options?: ProbeScanOptions) => ProbeScanResult;
  scanContainers: (options?: ProbeScanOptions) => ProbeContainerCandidate[];
  scanTargets: (options?: ProbeScanOptions) => ProbeTargetCandidate[];
  findTargets: (query: string, options?: ProbeScanOptions) => ProbeTargetCandidate[];
  inspectPoint: (x: number, y: number, options?: ProbeScanOptions) => ProbeClickReport;
  pickOnce: (options?: ProbePickOptions) => { active: true };
  watch: (options?: ProbeScanOptions) => { active: true };
  overlay: (on?: boolean) => boolean;
  highlight: (ref: string | ProbeBounds) => boolean;
  resolve: (recipeId: string, params?: ResolveTargetParams) => ResolveTargetResult;
  explain: (recipeId: string, params?: ResolveTargetParams) => ResolveTargetResult;
  untrack: () => void;
  r: Record<string, unknown>;
  recipes: () => ReturnType<typeof listTargetRecipes>;
  getLast: () => ProbeScanResult | null;
  getHistory: (limit?: number) => ProbeScanResult[];
  stop: () => void;
}

export function createProbeApi(state: ProbeLifecycleState): UniversalProbeApi {
  return {
    state: () => {
      const runtime = getProbeRuntime();
      return {
        ...toRuntimeRecord(runtime),
        historyLength: state.history.length,
        overlayEnabled: state.overlayEnabled,
        watchActive: !!state.watchCancel,
        pickActive: !!state.pickCancel,
      };
    },

    scan: (options?: ProbeScanOptions) => runScan(state, options),

    scanContainers: (options?: ProbeScanOptions) => {
      const result = runScan(state, { ...options, suppressConsole: true });
      if (!options?.suppressConsole) {
        console.table(result.containers.slice(0, 20).map((c) => ({
          tag: c.stableTag ?? '?',
          kind: c.kindGuess,
          type: c.type,
          label: c.label?.slice(0, 40),
          confidence: c.confidence,
          children: c.childCount,
        })));
      }
      return result.containers;
    },

    scanTargets: (options?: ProbeScanOptions) => {
      const result = runScan(state, { ...options, suppressConsole: true });
      if (!options?.suppressConsole) {
        console.table(result.targets.slice(0, 20).map((t) => ({
          tag: t.stableTag ?? '?',
          kind: t.kind,
          source: t.source,
          type: t.type,
          label: t.label?.slice(0, 40),
          confidence: t.confidence,
          interactive: t.interactive,
        })));
      }
      return result.targets;
    },

    findTargets: (query: string, options?: ProbeScanOptions) => {
      const result = runScan(state, { ...options, targetMode: 'all', suppressConsole: true });
      const lower = query.toLowerCase();
      const matches = result.targets.filter((t) => {
        const text = `${t.label} ${t.type} ${t.kind} ${t.assetHint ?? ''} ${t.stableTag ?? ''}`.toLowerCase();
        return text.includes(lower);
      });
      if (!options?.suppressConsole) {
        console.info(`[QPM Probe] findTargets("${query}") → ${matches.length} matches`);
        if (matches.length > 0) {
          console.table(matches.slice(0, 20).map((t) => ({
            tag: t.stableTag ?? '?',
            kind: t.kind,
            source: t.source,
            type: t.type,
            label: t.label?.slice(0, 40),
            confidence: t.confidence,
            interactive: t.interactive,
          })));
        }
      }
      return matches;
    },

    inspectPoint: (x: number, y: number, options?: ProbeScanOptions) => {
      const report = inspectProbePoint(x, y);
      state.lastClickReport = report;
      if (report.pixiHits.length) state.stableIds.assign(report.pixiHits, 'hits', 'h');
      runScan(state, { ...options, clickReport: report });
      return report;
    },

    pickOnce: (options?: ProbePickOptions) => {
      startPickOnce(state, (report) => {
        state.lastClickReport = report;
        runScan(state, { ...options, clickReport: report });
        console.info('[QPM Probe] pick captured', report);
      }, options?.preventDefault === true);
      return { active: true };
    },

    watch: (options?: ProbeScanOptions) => startProbeWatch(state, (scanOptions?: ProbeScanOptions) => runScan(state, scanOptions), options),

    overlay: (on?: boolean) => setOverlayEnabled(state, on),

    highlight: (ref: string | ProbeBounds) => {
      const bounds = findBoundsByRef(state, ref);
      if (!bounds) {
        console.warn('[QPM Probe] highlight target not found', ref);
        return false;
      }
      highlightRect(bounds);
      return true;
    },

    resolve: (recipeId: string, params?: ResolveTargetParams) => resolveTarget(recipeId, params),

    explain: (recipeId: string, params?: ResolveTargetParams) => explainTarget(recipeId, params),

    untrack: () => untrackTarget(),

    r: buildResolverProxy(),

    recipes: () => listTargetRecipes(),

    getLast: () => state.last,

    getHistory: (limit = 10) => state.history.slice(0, limit),

    stop: () => {
      stopProbeState(state);
      removeOverlay(state);
    },
  };
}
