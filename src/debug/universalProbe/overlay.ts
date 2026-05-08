import type { ProbeLifecycleState } from './lifecycle';
import type { ProbeBounds, ProbeScanResult } from './types';

const OVERLAY_ID = 'qpm-probe-overlay';

function addOverlayRect(root: HTMLElement, rect: ProbeBounds, label: string, color: string, dashed: boolean): void {
  if (rect.width <= 0 || rect.height <= 0) return;

  const box = document.createElement('div');
  box.style.cssText = [
    'position:fixed',
    `left:${Math.round(rect.left)}px`,
    `top:${Math.round(rect.top)}px`,
    `width:${Math.round(rect.width)}px`,
    `height:${Math.round(rect.height)}px`,
    `border:2px ${dashed ? 'dashed' : 'solid'} ${color}`,
    'box-sizing:border-box',
    'pointer-events:none',
    'border-radius:4px',
    'z-index:2147483645',
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

export function ensureOverlayRoot(state: ProbeLifecycleState): HTMLElement {
  if (state.overlayRoot && document.body.contains(state.overlayRoot)) return state.overlayRoot;

  let root = document.getElementById(OVERLAY_ID);
  if (!(root instanceof HTMLElement)) {
    root = document.createElement('div');
    root.id = OVERLAY_ID;
    root.style.cssText = [
      'position:fixed',
      'left:0',
      'top:0',
      'width:100vw',
      'height:100vh',
      'pointer-events:none',
      'z-index:2147483645',
    ].join(';');
    document.body.appendChild(root);
  }

  state.overlayRoot = root;
  return root;
}

export function clearOverlay(state: ProbeLifecycleState): void {
  state.overlayRoot?.replaceChildren();
}

export function removeOverlay(state: ProbeLifecycleState): void {
  clearOverlay(state);
  state.overlayRoot?.remove();
  state.overlayRoot = null;
  state.overlayEnabled = false;
}

export function drawOverlay(state: ProbeLifecycleState, result: ProbeScanResult): void {
  if (!state.overlayEnabled) return;

  const root = ensureOverlayRoot(state);
  root.replaceChildren();

  for (const container of result.containers.slice(0, 8)) {
    const color = container.confidence >= 75 ? '#22c55e' : container.confidence >= 55 ? '#f59e0b' : '#ef4444';
    addOverlayRect(root, container.boundsCss, `${container.stableTag ?? 'c?'} ${container.kindGuess} ${Math.round(container.confidence)}`, color, false);
  }

  for (const target of result.targets.slice(0, 120)) {
    const color = target.kind === 'scene-object'
      ? (target.source === 'dom' ? '#f59e0b' : '#a78bfa')
      : (target.source === 'dom' ? '#60a5fa' : '#f472b6');
    addOverlayRect(root, target.boundsCss, `${target.stableTag ?? 't?'} ${Math.round(target.confidence)}`, color, true);
  }

  for (const hit of result.clickReport?.pixiHits.slice(0, 5) ?? []) {
    addOverlayRect(root, hit.boundsCss, `${hit.stableTag ?? 'h?'} ${hit.type}`, '#a855f7', true);
  }
}

export function setOverlayEnabled(state: ProbeLifecycleState, on?: boolean): boolean {
  state.overlayEnabled = typeof on === 'boolean' ? on : !state.overlayEnabled;
  if (state.overlayEnabled) {
    ensureOverlayRoot(state);
    if (state.last) drawOverlay(state, state.last);
  } else {
    removeOverlay(state);
  }
  return state.overlayEnabled;
}

export function highlightRect(rect: ProbeBounds, color = '#22c55e', durationMs = 900): void {
  const root = document.createElement('div');
  root.style.cssText = [
    'position:fixed',
    'left:0',
    'top:0',
    'width:100vw',
    'height:100vh',
    'pointer-events:none',
    'z-index:2147483646',
  ].join(';');
  document.body.appendChild(root);
  addOverlayRect(root, rect, 'highlight', color, false);
  window.setTimeout(() => root.remove(), durationMs);
}
