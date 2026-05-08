import { domChainAt } from './domIndex';
import type { ProbeLifecycleState } from './lifecycle';
import { getProbeRuntime } from './runtime';
import { buildSceneIndex } from './sceneIndex';
import type { ProbeClickReport, ProbeHitCandidate } from './types';

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && (typeof value === 'object' || typeof value === 'function');
}

function toNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function mapClientToPixi(clientX: number, clientY: number): { x: number; y: number } | null {
  const runtime = getProbeRuntime();
  if (!runtime.renderer || !runtime.canvas) return null;

  const canvasRect = runtime.canvas.getBoundingClientRect();
  if (canvasRect.width <= 0 || canvasRect.height <= 0) return null;

  const renderer = runtime.renderer;
  const screen = isObject(renderer) && isObject(renderer.screen) ? renderer.screen : null;
  const screenW = toNumber(screen?.width, runtime.canvas.width || 0);
  const screenH = toNumber(screen?.height, runtime.canvas.height || 0);
  if (screenW <= 0 || screenH <= 0) return null;

  return {
    x: ((clientX - canvasRect.left) / canvasRect.width) * screenW,
    y: ((clientY - canvasRect.top) / canvasRect.height) * screenH,
  };
}

function containsPixiPoint(hit: ProbeHitCandidate, pixiX: number, pixiY: number): boolean {
  const bounds = hit.boundsPixi;
  if (!bounds) return false;
  return pixiX >= bounds.x
    && pixiX <= bounds.x + bounds.width
    && pixiY >= bounds.y
    && pixiY <= bounds.y + bounds.height;
}

export function inspectPoint(clientX: number, clientY: number): ProbeClickReport {
  const runtime = getProbeRuntime();
  const mapped = mapClientToPixi(clientX, clientY);
  const domChain = domChainAt(clientX, clientY);
  const pixiHits: ProbeHitCandidate[] = [];

  if (runtime.ready && mapped) {
    const scene = buildSceneIndex(runtime);
    for (const node of scene.nodes) {
      const hit: ProbeHitCandidate = {
        source: 'pixi',
        kind: node.interactive ? 'action-target' : 'scene-object',
        type: node.type,
        label: node.label,
        assetHint: node.assetHint,
        boundsCss: node.cssRect,
        confidence: Math.min(99, 45 + node.depth + (node.interactive ? 20 : 0) + (node.label ? 8 : 0)),
        interactive: node.interactive,
        node: node.node,
        depth: node.depth,
        boundsPixi: node.pixiBounds,
      };
      if (containsPixiPoint(hit, mapped.x, mapped.y)) pixiHits.push(hit);
    }
  }

  pixiHits.sort((a, b) => b.depth - a.depth || b.confidence - a.confidence);

  return {
    clientX,
    clientY,
    pixiX: mapped?.x ?? null,
    pixiY: mapped?.y ?? null,
    domChain,
    pixiHits,
    bestDomTarget: domChain[0] ?? null,
    bestPixiTarget: pixiHits[0] ?? null,
  };
}

export function pickOnce(
  state: ProbeLifecycleState,
  onReport: (report: ProbeClickReport) => void,
  preventDefault = false,
): void {
  if (state.pickCancel) state.pickCancel();

  const handler = (event: MouseEvent): void => {
    if (preventDefault) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (state.pickCancel) state.pickCancel();
    const report = inspectPoint(event.clientX, event.clientY);
    onReport(report);
  };

  document.addEventListener('click', handler, true);
  state.pickCancel = () => {
    document.removeEventListener('click', handler, true);
    state.pickCancel = null;
  };
}
