import { getProbeRuntime } from '../../debug/universalProbe/runtime';
import { buildDomIndex } from '../../debug/universalProbe/domIndex';
import { buildSceneIndex } from '../../debug/universalProbe/sceneIndex';
import type { ProbeBounds, ProbeTargetCandidate } from '../../debug/universalProbe/types';
import { evaluateSignal, confidenceFromEvidence } from './confidence';
import { getTargetRecipe, TARGET_RECIPES } from './recipes';
import type { ResolveTargetParams, ResolveTargetResult, TargetRecipe } from './types';

function emptyResult(recipeId: string, warning: string): ResolveTargetResult {
  return { found: false, recipeId, confidence: 0, source: null, evidence: [], warnings: [warning] };
}

export function listTargetRecipes(): Array<Pick<TargetRecipe, 'id' | 'sources' | 'minConfidence'>> {
  return TARGET_RECIPES.map(({ id, sources, minConfidence }) => ({ id, sources, minConfidence }));
}

/** Build pixi candidates directly from the scene index — no area caps or keyword filtering. */
function buildPixiCandidates(runtime: ReturnType<typeof getProbeRuntime>): ProbeTargetCandidate[] {
  if (!runtime.ready) return [];
  const scene = buildSceneIndex(runtime);
  const out: ProbeTargetCandidate[] = [];
  for (const node of scene.nodes) {
    out.push({
      source: 'pixi',
      kind: 'scene-object',
      type: node.type,
      label: node.label,
      assetHint: node.assetHint,
      boundsCss: node.cssRect,
      confidence: 50,
      interactive: node.interactive,
      childCount: node.childCount,
      node: node.node,
    });
  }
  return out;
}

/** Build DOM candidates from the DOM index. */
function buildDomCandidates(): ProbeTargetCandidate[] {
  const out: ProbeTargetCandidate[] = [];
  for (const entry of buildDomIndex()) {
    out.push({
      source: 'dom',
      kind: 'dom-element',
      type: entry.role ? `${entry.type}[role=${entry.role}]` : entry.type,
      label: entry.label,
      boundsCss: entry.boundsCss,
      confidence: 60,
      interactive: entry.interactive,
      role: entry.role,
      childCount: entry.childCount,
      layout: entry.layout,
      element: entry.element,
    });
  }
  return out;
}

/** Core resolve logic — no side effects. */
function resolveInternal(recipeId: string, params: ResolveTargetParams = {}): ResolveTargetResult {
  const recipe = getTargetRecipe(recipeId);
  if (!recipe) return emptyResult(recipeId, `Unknown target recipe: ${recipeId}`);

  const runtime = getProbeRuntime();
  const needsPixi = recipe.sources.includes('pixi');
  const needsDom = recipe.sources.includes('dom');
  const candidates: ProbeTargetCandidate[] = [];
  if (needsPixi) candidates.push(...buildPixiCandidates(runtime));
  if (needsDom) candidates.push(...buildDomCandidates());

  let best: ResolveTargetResult | null = null;
  for (const candidate of candidates) {
    if (params.text && !candidate.label.toLowerCase().includes(params.text.toLowerCase())) continue;
    if (params.label && !candidate.label.toLowerCase().includes(params.label.toLowerCase())) continue;
    const requiredEvidence = recipe.requiredSignals.map((signal) => evaluateSignal(candidate, signal));
    const rejectEvidence = (recipe.rejectSignals ?? []).map((signal) => evaluateSignal(candidate, signal));
    if (rejectEvidence.some((item) => item.matched)) continue;
    const confidence = confidenceFromEvidence(candidate.confidence, requiredEvidence);
    const result: ResolveTargetResult = {
      found: confidence >= (params.minConfidence ?? recipe.minConfidence),
      recipeId,
      confidence,
      source: candidate.source,
      ...(candidate.stableTag !== undefined ? { stableTag: candidate.stableTag } : {}),
      bounds: candidate.boundsCss,
      target: candidate,
      evidence: [...requiredEvidence, ...rejectEvidence],
      warnings: [],
    };
    if (!best || result.confidence > best.confidence) best = result;
  }

  return best ?? emptyResult(recipeId, 'No candidates matched recipe sources and params');
}

// ── Live tracking overlay ──────────────────────────────────────────

const TRACK_INTERVAL_MS = 200;
const TRACK_OVERLAY_ID = 'qpm-resolve-track';

let trackCancel: (() => void) | null = null;

function ensureTrackOverlay(): HTMLElement {
  let root = document.getElementById(TRACK_OVERLAY_ID);
  if (root) return root;
  root = document.createElement('div');
  root.id = TRACK_OVERLAY_ID;
  root.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483646';
  document.body.appendChild(root);
  return root;
}

function drawTrackRect(root: HTMLElement, bounds: ProbeBounds, label: string, color: string): void {
  root.replaceChildren();
  if (bounds.width <= 0 || bounds.height <= 0) return;

  const box = document.createElement('div');
  box.style.cssText = [
    'position:fixed',
    `left:${Math.round(bounds.left)}px`,
    `top:${Math.round(bounds.top)}px`,
    `width:${Math.round(bounds.width)}px`,
    `height:${Math.round(bounds.height)}px`,
    `border:2px solid ${color}`,
    'box-sizing:border-box',
    'pointer-events:none',
    'border-radius:4px',
  ].join(';');

  const tag = document.createElement('div');
  tag.textContent = label;
  tag.style.cssText = [
    'position:absolute',
    'left:0',
    'top:-16px',
    `background:${color}`,
    'color:#000',
    'font-size:10px',
    'font-weight:700',
    'padding:1px 4px',
    'border-radius:3px',
    'white-space:nowrap',
  ].join(';');

  box.appendChild(tag);
  root.appendChild(box);
}

function startTracking(recipeId: string, params: ResolveTargetParams, displayLabel: string): void {
  // Stop any existing track
  if (trackCancel) trackCancel();

  const root = ensureTrackOverlay();

  const tick = (): void => {
    const result = resolveInternal(recipeId, params);
    if (result.found && result.bounds) {
      const color = result.confidence >= 0.75 ? '#22c55e' : '#f59e0b';
      drawTrackRect(root, result.bounds, displayLabel, color);
    } else {
      const lostTag = root.querySelector('div > div') as HTMLElement | null;
      if (lostTag) {
        lostTag.textContent = `${displayLabel} (lost)`;
        lostTag.style.background = '#ef4444';
      }
    }
  };

  tick();
  const timer = window.setInterval(tick, TRACK_INTERVAL_MS);

  const stop = (): void => {
    window.clearInterval(timer);
    root.replaceChildren();
    root.remove();
    if (trackCancel === stop) trackCancel = null;
  };

  trackCancel = stop;
}

// ── Public API ─────────────────────────────────────────────────────

export function resolveTarget(recipeId: string, params: ResolveTargetParams = {}): ResolveTargetResult {
  const result = resolveInternal(recipeId, params);

  if (result.found) {
    const displayLabel = params.label ? `${recipeId} (${params.label})` : recipeId;
    startTracking(recipeId, params, displayLabel);
  } else {
    // Not found — stop any active tracking
    if (trackCancel) trackCancel();
  }

  return result;
}

export function explainTarget(recipeId: string, params: ResolveTargetParams = {}): ResolveTargetResult {
  const result = resolveTarget(recipeId, params);
  console.info('[QPM targetResolver] explain', result);
  return result;
}

export function untrackTarget(): void {
  if (trackCancel) {
    trackCancel();
    console.log('%c[resolve]%c tracking stopped', 'color:#a78bfa;font-weight:700', 'color:inherit');
  }
}
