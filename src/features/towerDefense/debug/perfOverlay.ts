import { storage } from '../../../utils/storage';
import { visibleInterval } from '../../../utils/scheduling/timerManager';
import { getMatchSnapshot } from '../state';
import { sampleAndReset } from './perfCounters';

const STORAGE_KEY = 'qpm.td.debug.perfOverlay.v1';

// Dev-only overlay: gated behind a storage key and never shown to normal
// users. Strings below are engineering terms (fps, p95, ms) whose meaning is
// invariant across locales — deliberately not routed through t().
const TITLE_TEXT = 'TD PERF';
const MS_SUFFIX = 'ms';

interface OverlayState {
  root: HTMLDivElement;
  fpsEl: HTMLSpanElement;
  simEl: HTMLSpanElement;
  renderEl: HTMLSpanElement;
  countsEl: HTMLSpanElement;
  allocEl: HTMLSpanElement;
  stopInterval: (() => void) | null;
}

let state: OverlayState | null = null;

function readEnabled(): boolean {
  return storage.get<boolean>(STORAGE_KEY, false) === true;
}

function writeEnabled(enabled: boolean): void {
  storage.set(STORAGE_KEY, enabled);
}

function fmt(n: number, digits: number): string {
  return n.toFixed(digits);
}

function buildRow(label: string): { row: HTMLDivElement; value: HTMLSpanElement } {
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;justify-content:space-between;gap:12px;';
  const l = document.createElement('span');
  l.textContent = label;
  l.style.cssText = 'color:var(--qpm-text-muted,rgba(255,255,255,0.6));';
  const value = document.createElement('span');
  value.textContent = '—';
  value.style.cssText = 'color:var(--qpm-text,#fff);text-align:right;font-variant-numeric:tabular-nums;';
  row.append(l, value);
  return { row, value };
}

function mount(host: HTMLElement): OverlayState {
  const root = document.createElement('div');
  root.className = 'qpm-td-perf-overlay';
  root.style.cssText = [
    'position:absolute',
    'top:56px',
    'right:8px',
    'z-index:2147483001',
    'min-width:200px',
    'padding:8px 10px',
    'background:rgba(18,20,26,0.9)',
    'border:1px solid var(--qpm-border,rgba(143,130,255,0.5))',
    'border-radius:8px',
    'font:12px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace',
    'color:var(--qpm-text,#fff)',
    'pointer-events:none',
    'user-select:none',
  ].join(';');

  const title = document.createElement('div');
  title.textContent = TITLE_TEXT;
  title.style.cssText = 'font-weight:600;letter-spacing:1px;margin-bottom:6px;color:var(--qpm-accent,#8f82ff);';
  root.appendChild(title);

  const fps = buildRow('fps');
  const sim = buildRow('sim p95');
  const render = buildRow('render avg');
  const counts = buildRow('T/B/P');
  const alloc = buildRow('snap/pos /s');
  root.append(fps.row, sim.row, render.row, counts.row, alloc.row);

  host.appendChild(root);

  return {
    root,
    fpsEl: fps.value,
    simEl: sim.value,
    renderEl: render.value,
    countsEl: counts.value,
    allocEl: alloc.value,
    stopInterval: null,
  };
}

function refresh(s: OverlayState): void {
  const sample = sampleAndReset();
  const snap = getMatchSnapshot();
  s.fpsEl.textContent = fmt(sample.fps, 0);
  s.simEl.textContent = `${fmt(sample.simP95Ms, 2)}${MS_SUFFIX}`;
  s.renderEl.textContent = `${fmt(sample.renderAvgMs, 2)}${MS_SUFFIX}`;
  s.countsEl.textContent = `${snap.towers.length}/${snap.balloons.length}/${snap.projectiles.length}`;
  const snaps = sample.snapshotsPerSec.toFixed(0);
  const pos = sample.positionsPerSec.toFixed(0);
  s.allocEl.textContent = `${snaps} / ${pos}`;
}

export function isPerfOverlayEnabled(): boolean {
  return readEnabled();
}

export function initPerfOverlay(host: HTMLElement): void {
  if (state) return;
  if (!readEnabled()) return;
  const s = mount(host);
  s.stopInterval = visibleInterval('qpm-td-perf-overlay', () => {
    try { refresh(s); } catch { /* overlay must not break gameplay */ }
  }, 500);
  state = s;
}

export function stopPerfOverlay(): void {
  const s = state;
  if (!s) return;
  state = null;
  try { s.stopInterval?.(); } catch { /* ignore */ }
  try { s.root.remove(); } catch { /* ignore */ }
}

// Toggle at runtime. Persists the preference and mounts/unmounts against the
// current TD host if provided. Returns the new enabled state.
export function togglePerfOverlay(host: HTMLElement | null, enable?: boolean): boolean {
  const target = enable !== undefined ? enable : !readEnabled();
  writeEnabled(target);
  if (target) {
    if (host) initPerfOverlay(host);
  } else {
    stopPerfOverlay();
  }
  return target;
}
