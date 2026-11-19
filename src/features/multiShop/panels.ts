// The panels of one multi-shop session: the game's real shop bound into a host, the copies beside it, and
// their teardown. The session lifecycle (open, close paths, per-frame work) is in session.ts.
import { readSync } from '../../core/gameState';
import { createPanelChrome, type PanelChrome } from '../multiStorage/chrome';
import { cellRenderer, destroyHost, makeHost, type GameRenderer, type PixiNode } from '../multiStorage/gameHooks';
import type { Cell, Screen } from '../multiStorage/layout';
import { toggleGameModal, openGameModal } from '../input/gameModal';
import { forwardDismissal, redirectGateSubscriptions } from './gate';
import {
  bindCellLayout, bindRealView, checkPanelView, clearScrim, gateKeys, interceptCreate, unbindRealView,
  type RealBinding, type ShopPanelView,
} from './panelView';
import { diagnostics, type ShopOpenResult } from './probe';
import type { ModalHostLike, ShopBuild } from './quietBuild';
import { shopPanelKind, type ShopChromePanel } from './shopChrome';

export const HOST_LABEL_PREFIX = 'MultiShopHost:';

/** `id` is the shop's modal name (`seedShop`). */
export interface Panel extends ShopChromePanel {
  readonly real: boolean;
  readonly build: ShopBuild;
  /** Weather-gated or on a clock of its own: it can close while the others stay. */
  readonly gated: boolean;
}

/** A picked shop that is closed right now; it opens as a panel when its weather or hours start. */
export interface PendingShop { build: ShopBuild; index: number; gated: boolean }

/**
 * building: one copy per frame, hidden and not drawn. opening: the real shop's modal write.
 * open: every panel shown and drawn, from the same frame.
 */
export type Phase = 'building' | 'opening' | 'open';

export interface Session {
  phase: Phase;
  /** Copies still to build, one per frame. */
  toBuild: CopySpec[];
  /** Settles the open's wait on the build: null when every copy is built, else the open's result. */
  built: ((end: ShopOpenResult | null) => void) | null;
  skipped: Record<string, string>;
  modals: ModalHostLike;
  ui: PixiNode;
  real: GameRenderer;
  screen: Screen;
  hosts: PixiNode[];
  panels: Panel[];
  /** Copies closed by their own ✕: closed at once, destroyed on the next frame (the press is still being handled). */
  retired: Panel[];
  /** Shop names back to front, as the chrome last reported them; the last one has the keyboard. */
  order: readonly string[];
  /** Bar, grip, press-to-front and the saved layout; null when it could not be built (the shops still work). */
  chrome: PanelChrome | null;
  realPanel: Panel | null;
  binding: RealBinding | null;
  origDraw: ModalHostLike['draw'];
  drawWrapper: ModalHostLike['draw'] | null;
  unwatch: Array<() => void>;
  done: boolean;
  pending: PendingShop[];
  /** Set by a weather or opening-hours change; the next frame opens and closes gated panels to match. */
  recheck: boolean;
  /** The game's weather atom; a copy's subscription to it is redirected to `recheck`. */
  weatherAtom: unknown;
  /** Copies whose weather end could not be redirected: their weather end closes every panel, as T2 did. */
  unredirected: string[];
  /** Why panels can no longer be added while open (late-open capability miss); null while they can. */
  lateBlocked: string | null;
}

export class CapabilityError extends Error {
  constructor(readonly missing: string[]) { super('capability'); }
}
export const FIRST_PANEL = 'first-panel';

/** Live checks only: what the last real shop view held before it was bound. */
export const realOriginals = new WeakMap<object, { renderer: unknown; handleKeyDown: unknown }>();
let lastRealName: string | null = null;
export const getLastRealName = (): string | null => lastRealName;

export function currentModal(): string | null {
  const state = readSync('activeModalState');
  return state ? state.modal : readSync('activeModal');
}

// Once the session is over a still-registered handler must not swallow a normally opened shop's keys.
const frontOnly = (s: Session, name: string) => (): boolean => s.done || s.order[s.order.length - 1] === name;

export function dropHost(s: Session, host: PixiNode): void {
  s.hosts = s.hosts.filter(h => h !== host);
  try { destroyHost(host); } catch { /* torn down with the renderer */ }
}

export function discard(s: Session, panel: Panel): void {
  try { panel.view.close(); } catch { /* already closed */ }
  try { panel.view.destroy(); } catch { /* torn down with the renderer */ }
  dropHost(s, panel.host);
}

/** The panels stay open and usable; only the bar and grip go. */
export function dropChrome(s: Session, stage: string, error?: unknown): void {
  try { s.chrome?.dispose(); } catch { /* already gone */ }
  s.chrome = null;
  diagnostics.warnFeature('QPM-MSHOP-003', { stage }, error);
}

export function addChrome(s: Session): void {
  try {
    s.chrome = createPanelChrome({
      ui: s.ui, real: s.real, screen: s.screen, panels: s.panels, kind: shopPanelKind,
      isLive: () => !s.done,
      onOrder: (order) => { s.order = [...order]; },
    });
    // Without bar and grip the front order, reset and resize-follow still work.
    if (!s.chrome.decorated) diagnostics.warnFeature('QPM-MSHOP-003', { stage: 'kit' });
  } catch (error) {
    dropChrome(s, 'build', error);
  }
}

/** Takes a panel out of the session; it is destroyed on the next frame. */
export function retire(s: Session, panel: Panel): void {
  if (!s.panels.includes(panel)) return;
  s.panels = s.panels.filter(p => p !== panel);
  s.order = s.order.filter(id => id !== panel.id);
  try { s.chrome?.remove(panel.id); } catch (error) { dropChrome(s, 'sync', error); }
  try { panel.view.close(); } catch { /* destroyed on the next frame either way */ }
  panel.host.visible = false;
  s.retired.push(panel);
}

export interface CopySpec { build: ShopBuild; index: number; gated: boolean; cell: Cell }

/**
 * Null when the shop is closed right now (it bails before building its header). With `late` (the real shop
 * is already open) the copy also hands Escape and outside taps to the real shop; null when it cannot.
 * A `hidden` copy stays invisible until the session shows every panel at once.
 */
export function addCopy(s: Session, spec: CopySpec, late: boolean, hidden = false): Panel | null {
  const { build, index, gated, cell } = spec;
  const host = makeHost(s.ui, build.name, cell, HOST_LABEL_PREFIX);
  host.visible = !hidden;
  s.hosts.push(host);
  const view = new build.ViewClass(host, cellRenderer(s.real, cell), build.riveBatchRenderer, build.config) as ShopPanelView;
  const panel: Panel = { id: build.name, index, host, cell, view, real: false, build, gated };
  const missing = checkPanelView(view);
  if (missing.length > 0) {
    discard(s, panel);
    throw new CapabilityError(missing);
  }
  if (gated) {
    const atoms = [s.weatherAtom, build.config.isOpenAtom].filter(atom => atom != null);
    const redirected = redirectGateSubscriptions(view, atoms, () => { s.recheck = true; });
    if (!redirected || s.weatherAtom == null) s.unredirected.push(build.name);
  }
  if (late && !forwardDismissal(view, s.realPanel?.view)) {
    s.lateBlocked = 'dismissal';
    discard(s, panel);
    return null;
  }
  clearScrim(view);
  bindCellLayout(view, cell);
  gateKeys(view, frontOnly(s, build.name));
  view.open({ restoring: false, closeLayer: () => retire(s, panel) });
  if (!view.isOpen || !view.header) {
    discard(s, panel);
    return null;
  }
  host.zIndex = view.container.zIndex;
  s.panels.push(panel);
  return panel;
}

/**
 * The game's own view of the shop, bound to a host and a cell before the game opens it: at once when the game
 * has it cached, else as the modal host builds it inside the open. Null when the shop is closed right now.
 */
export async function openReal(s: Session, spec: CopySpec): Promise<Panel | null> {
  const { build, index, gated, cell } = spec;
  const { name } = build;
  const cached = s.modals.built.get(name);
  if (cached) {
    const missing = checkPanelView(cached);
    if (missing.length > 0) throw new CapabilityError(missing);
  }
  const host = makeHost(s.ui, name, cell, HOST_LABEL_PREFIX);
  s.hosts.push(host);
  const bind = (view: unknown): void => {
    if (s.binding || checkPanelView(view).length > 0) return;
    const shop = view as ShopPanelView;
    realOriginals.set(shop, { renderer: shop.renderer, handleKeyDown: shop.handleKeyDown });
    lastRealName = name;
    s.binding = bindRealView(shop, host, cellRenderer(s.real, cell), cell, frontOnly(s, name));
  };
  if (cached) bind(cached);
  const restoreRead = cached ? (): void => undefined : interceptCreate(s.modals, name, bind);
  try {
    await openGameModal(name);
  } finally {
    restoreRead();
  }
  // Torn down during the write (the host was replaced): any shop open now is the new host's, not the session's.
  if (s.done) return null;
  const binding = s.binding;
  const built = s.modals.built.get(name);
  if (!binding || binding.view !== built) {
    // The game's shop is open outside a panel, full size and ungated.
    if (currentModal() === name) await toggleGameModal(name);
    const missing = checkPanelView(built);
    throw missing.length > 0 ? new CapabilityError(missing) : new Error(FIRST_PANEL);
  }
  const { view } = binding;
  if (!view.isOpen || !view.header) {
    if (currentModal() === name) await toggleGameModal(name);
    unbindRealView(binding, s.ui);
    s.binding = null;
    dropHost(s, host);
    return null;
  }
  host.zIndex = view.container.zIndex;
  return { id: name, index, host, cell, view, real: true, build, gated };
}

/**
 * After the copies (Escape and outside taps go to the newest request in the band). When `spec`'s shop turns
 * out closed, the first open copy takes its place as the game's real shop.
 */
export async function openRealPanel(s: Session, spec: CopySpec, skipped: Record<string, string>): Promise<Panel | null> {
  let candidate: CopySpec | undefined = spec;
  while (candidate) {
    const panel = await openReal(s, candidate);
    if (panel) return panel;
    skipped[candidate.build.name] = 'closed';
    // Closed after all: its place as the game's real shop goes to the first open copy.
    const promote: Panel | undefined = s.panels[0];
    if (!promote) return null;
    s.panels = s.panels.filter(p => p !== promote);
    discard(s, promote);
    candidate = { build: promote.build, index: promote.index, gated: promote.gated, cell: promote.cell };
  }
  return null;
}
