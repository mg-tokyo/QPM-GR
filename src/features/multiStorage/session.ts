// One multi-storage session: several of the game's storage panels open at once. The first is the game's
// real storage window (Escape, scrim and HUD stay native); the rest are extra copies of its storage system.
import { readSync, subscribe } from '../../core/gameState';
import { onPixiCaptureChange } from '../../core/pixiCapture';
import { recordProbe } from '../../diagnostics/perfMonitor';
import { openGameModal, toggleGameModal } from '../input/gameModal';
import { createPanelChrome, type PanelChrome } from './chrome';
import { createStripFitter, getStripFitCount } from './filterStrip';
import {
  HOST_LABEL_PREFIX, cellRenderer, checkFirstView, checkStorageSystem, destroyHost, dropPouchCell, findStorageSystem,
  liftHost, makeHost, panelIdFor, petSidebarRightEdge,
  type GameRenderer, type PixiNode, type StorageHandles, type StorageSystemLike, type StorageViewLike,
} from './gameHooks';
import { startingCells, type Cell, type Screen } from './layout';
import {
  CANCELLED, clearMissingReport, diagnostics, failOpen, probeStorageCapabilities, reportMissing, type OpenResult,
} from './probe';
import { clearSavedLayout, getSavedLayout, getStoragePick } from './settings';
import { chooseStorageIds, readOwnedStorageIds } from './storages';
import { storagePanelKind } from './storageChrome';
import { createValueLabels, type ValueLabels } from './valueLabels';

export interface OpenPanel {
  readonly storageId: string;
  readonly index: number;
  readonly host: PixiNode;
  /** Mutable: move and resize change it, then move the host. */
  readonly cell: Cell;
  view(): StorageViewLike | null;
}

export type { OpenResult };

interface Extra { system: StorageSystemLike; host: PixiNode; storageId: string; closed: boolean; broken: boolean }
interface Target { storageId: string; panelId: string }
interface PendingExtra { target: Target; cell: Cell; index: number }

/**
 * building: one extra panel per frame, hidden and not drawn. opening: the real panel's modal write.
 * open: every panel shown and drawn (they start their slide-in on the same frame).
 */
type Phase = 'building' | 'opening' | 'open';

interface Session extends StorageHandles {
  real: GameRenderer;
  screen: Screen;
  phase: Phase;
  pending: PendingExtra[];
  /** Settles the open's wait on the build: null when every extra is built, else the open's result. */
  built: ((end: OpenResult | null) => void) | null;
  stripFits: Array<() => void>;
  first: Target;
  firstHost: PixiNode | null;
  firstView: StorageViewLike | null;
  hosts: PixiNode[];
  extras: Extra[];
  panels: OpenPanel[];
  origDraw: StorageSystemLike['draw'];
  drawWrapper: StorageSystemLike['draw'] | null;
  origOnModalChanged: StorageSystemLike['onModalChanged'];
  modalWrapper: StorageSystemLike['onModalChanged'] | null;
  chrome: PanelChrome | null;
  labels: ValueLabels | null;
  unwatch: Array<() => void>;
  done: boolean;
}

export const SIDEBAR_GAP_PX = 8;

let session: Session | null = null;
let opening = false;

function currentModal(): string | null {
  const state = readSync('activeModalState');
  return state ? state.modal : readSync('activeModal');
}

function isIdle(system: StorageSystemLike): boolean {
  return !system.modalView && !system.closingView;
}

/** The real system's view has left the first host (closed, or replaced by a normally opened panel). */
function firstGone(s: Session): boolean {
  return s.firstView !== null && s.sys.modalView !== s.firstView && s.sys.closingView !== s.firstView;
}

function ownsRealView(s: Session): boolean {
  return !!s.firstHost && !s.firstHost.destroyed && s.firstHost.children.length > 0;
}

function closeExtra(s: Session, extra: Extra): void {
  if (extra.closed) return;
  extra.closed = true;
  try { s.proto.onModalChanged.call(extra.system, null); } catch { /* destroyed in finish */ }
}

function restoreModalWrapper(s: Session): void {
  if (!s.modalWrapper) return;
  // Restore by assignment only (never delete on a game object); leave a later wrapper on top in place.
  if (s.sys.onModalChanged === s.modalWrapper) s.sys.onModalChanged = s.origOnModalChanged;
  s.modalWrapper = null;
}

function restoreDraw(s: Session): void {
  if (!s.drawWrapper) return;
  if (s.sys.draw === s.drawWrapper) s.sys.draw = s.origDraw;
  s.drawWrapper = null;
}

function endBuild(s: Session, end: OpenResult | null): void {
  const settle = s.built;
  s.built = null;
  settle?.(end);
}

function finish(s: Session): void {
  if (s.done) return;
  s.done = true;
  if (session === s) session = null;
  endBuild(s, CANCELLED);
  for (const stop of s.unwatch.splice(0)) {
    try { stop(); } catch { /* listener already gone */ }
  }
  restoreModalWrapper(s);
  restoreDraw(s);
  // Before the hosts go: the header and grip own canvas textures that destroying the hosts would leak.
  try { s.chrome?.dispose(); } catch { /* torn down with the renderer */ }
  try { s.labels?.dispose(); } catch { /* torn down with the renderer */ }
  for (const extra of s.extras) {
    try { extra.system.destroy(); } catch { /* already gone with the renderer */ }
  }
  for (const host of s.hosts) {
    try { destroyHost(host); } catch { /* already gone with the renderer */ }
  }
}

/** Closes the real modal if it is still the session's, drops the real view out of its host, then tears down. */
async function teardown(s: Session): Promise<void> {
  // First, so no frame builds another extra while the modal write below is awaited.
  endBuild(s, CANCELLED);
  restoreModalWrapper(s);
  for (const extra of s.extras) closeExtra(s, extra);
  try {
    // While building, an open panel is the player's own, not the session's.
    if (s.phase !== 'building' && currentModal() === s.first.panelId) await toggleGameModal(s.first.panelId);
  } catch { /* the modal write failed; the views are dropped below either way */ }
  // The hosts may still hold the real system's view; destroying them under it makes the next open throw.
  if (ownsRealView(s)) {
    try { s.sys.forceCloseViews(); } catch { /* nothing open */ }
  }
  finish(s);
}

function frame(s: Session, context: unknown, deltaTimeMs: number): void {
  if (s.phase === 'building') {
    if (s.built) buildStep(s);
    return;
  }
  if (s.phase !== 'open') return;
  for (const extra of s.extras) {
    if (extra.broken) continue;
    try {
      extra.system.draw(context, deltaTimeMs);
    } catch {
      extra.broken = true;
      closeExtra(s, extra);
      try { extra.system.forceCloseViews(); } catch { /* destroyed in finish */ }
    }
  }
  const start = performance.now();
  if (firstGone(s)) for (const extra of s.extras) closeExtra(s, extra);
  if (firstGone(s) && s.extras.every(extra => isIdle(extra.system))) {
    finish(s);
  } else {
    for (const fit of s.stripFits) {
      try { fit(); } catch { /* strip mid-rebuild */ }
    }
    try { s.chrome?.sync(); } catch (error) { dropChrome(s, 'sync', error); }
    try { s.labels?.sync(); } catch (error) { dropLabels(s, 'sync', error); }
  }
  recordProbe('multiStorage.frame', performance.now() - start);
}

/** The panels stay open and usable; only the header and grip go. */
function dropChrome(s: Session, stage: string, error?: unknown): void {
  try { s.chrome?.dispose(); } catch { /* already gone */ }
  s.chrome = null;
  diagnostics.warnFeature('QPM-MSTORE-003', { stage }, error);
}

/** The panels stay open and usable; only the storage-value labels go. */
function dropLabels(s: Session, stage: string, error?: unknown): void {
  try { s.labels?.dispose(); } catch { /* already gone */ }
  s.labels = null;
  diagnostics.warnFeature('QPM-MSTORE-004', { stage }, error);
}

function addLabels(s: Session): void {
  try {
    s.labels = createValueLabels(s.panels);
    if (!s.labels) diagnostics.warnFeature('QPM-MSTORE-004', { stage: 'kit' });
  } catch (error) {
    dropLabels(s, 'build', error);
  }
}

function addChrome(s: Session): void {
  try {
    const panels = s.panels.map(p => ({ ...p, id: p.storageId }));
    s.chrome = createPanelChrome({ ui: s.sys.uiContainer, real: s.real, screen: s.screen, panels, kind: storagePanelKind, isLive: () => session === s && !s.done });
    // Without header and grip the order, reset and resize-follow still work.
    if (!s.chrome.decorated) diagnostics.warnFeature('QPM-MSTORE-003', { stage: 'kit' });
  } catch (error) {
    dropChrome(s, 'build', error);
  }
}

// A renderer rebuild (context loss) destroys the game's storage system and stage, but not the copies QPM
// built: their atom subscriptions would outlive the game's. Close everything on the first sign of one.
function watchRebuild(s: Session): void {
  const engine = readSync('quinoaEngine');
  const drop = (): void => { if (!s.done) void teardown(s); };
  s.unwatch.push(
    onPixiCaptureChange(drop),
    subscribe('quinoaEngine', (next) => { if (next !== engine) drop(); }),
  );
}

function installDraw(s: Session): void {
  const { origDraw } = s;
  const wrapper = function (this: StorageSystemLike, context: unknown, deltaTimeMs: number): void {
    origDraw.call(this, context, deltaTimeMs);
    if (session === s && !s.done) frame(s, context, deltaTimeMs);
  };
  s.drawWrapper = wrapper;
  s.sys.draw = wrapper;
}

/** Decision P1: the real system builds the first storage's view inside the first host, with that cell's renderer. */
function installModalWrapper(s: Session, firstHost: PixiNode, firstRenderer: GameRenderer): void {
  const orig = s.origOnModalChanged;
  const wrapper = function (this: StorageSystemLike, storageType: string | null): void {
    if (s.modalWrapper !== wrapper || storageType !== s.first.storageId) {
      orig.call(this, storageType);
      return;
    }
    restoreModalWrapper(s);
    const ui = this.uiContainer;
    const renderer = this.renderer;
    this.uiContainer = firstHost;
    this.renderer = firstRenderer;
    try {
      orig.call(this, storageType);
    } finally {
      this.uiContainer = ui;
      this.renderer = renderer;
    }
    // Same task as the real panel's build, so every panel takes its first motion step on the next frame.
    reveal(s);
  };
  s.modalWrapper = wrapper;
  s.sys.onModalChanged = wrapper;
}

function reveal(s: Session): void {
  if (s.done || s.phase === 'open') return;
  s.phase = 'open';
  for (const extra of s.extras) {
    if (!extra.host.destroyed) extra.host.visible = true;
  }
  s.stripFits = [
    ...s.extras.map(extra => createStripFitter(extra.host, () => extra.system.modalView?.itemSheet?.widthPx)),
    ...(s.firstHost ? [createStripFitter(s.firstHost, () => s.sys.modalView?.itemSheet?.widthPx)] : []),
  ];
}

/** Hidden and not drawn until the reveal: the game's sheet motion only advances on drawn frames (beta itemSheet/SheetMotion.ts:212-221). */
function addExtra(s: Session, target: Target, cell: Cell, index: number): void {
  const host = makeHost(s.sys.uiContainer, target.storageId, cell);
  host.visible = false;
  s.hosts.push(host);
  const system = new s.SystemClass(host, cellRenderer(s.real, cell), s.sys.batchRenderer);
  const extra: Extra = { system, host, storageId: target.storageId, closed: false, broken: false };
  s.extras.push(extra);
  // Its own modal subscription only tells it when the session's real panel went away.
  system.onModalChanged = (storageType) => { if (storageType !== s.first.storageId) closeExtra(s, extra); };
  s.proto.onModalChanged.call(system, target.storageId);
  try { dropPouchCell(system.modalView); } catch { /* keeps an empty pouch cell */ }
  liftHost(host);
  s.panels.push({ storageId: target.storageId, index, host, cell, view: () => system.modalView });
}

function abortBuild(s: Session, end: OpenResult): void {
  endBuild(s, end);
  void teardown(s);
}

/**
 * One extra per frame, so the worst frame costs one panel's tile build. The step that finds nothing left
 * ends the build, and the real panel's modal write runs on that frame, apart from the last extra's build.
 */
function buildStep(s: Session): void {
  // Escape on an extra's scrim, or a panel the player opened, closes the extras; the open is off.
  if (currentModal() !== null || s.extras.some(extra => extra.closed)) {
    abortBuild(s, CANCELLED);
    return;
  }
  const next = s.pending.shift();
  if (!next) {
    s.phase = 'opening';
    endBuild(s, null);
    return;
  }
  try {
    addExtra(s, next.target, next.cell, next.index);
  } catch (error) {
    abortBuild(s, failOpen('build', error));
    return;
  }
  const viewMissing = s.extras.length === 1 ? checkFirstView(s.extras[0]?.system.modalView) : [];
  if (viewMissing.length > 0) abortBuild(s, reportMissing(viewMissing));
}

async function openInner(pick: readonly string[] | null): Promise<OpenResult> {
  let probe = probeStorageCapabilities();
  if (!probe.ok) return reportMissing(probe.missing);
  const panelIds = probe.panelIds;
  const targets: Target[] = [];
  for (const storageId of chooseStorageIds(readOwnedStorageIds(), pick)) {
    const panelId = panelIdFor(storageId, panelIds);
    if (panelId) targets.push({ storageId, panelId });
  }
  const first = targets[0];
  if (!first) return { ok: false, reason: 'no-storages' };

  const open = currentModal();
  if (open !== null) {
    try { await toggleGameModal(open); } catch (error) { return failOpen('modal-write', error); }
  }
  // The await may have spanned a renderer rebuild.
  probe = probeStorageCapabilities();
  if (!probe.ok) return reportMissing(probe.missing);
  const { sys } = probe;
  const real = sys.renderer;
  const screen = { w: real.width, h: real.height };
  const cells = startingCells(targets.map(t => t.storageId), getSavedLayout(), petSidebarRightEdge(sys.uiContainer, SIDEBAR_GAP_PX), screen);
  // Extras first: the game puts the tool pouch in the panel opened last, which is the real one.
  const pending = targets.slice(1).map((target, i) => ({ target, cell: cells[i + 1] as Cell, index: i + 1 }));
  const s: Session = {
    ...probe, real, screen, phase: pending.length > 0 ? 'building' : 'opening', pending, built: null, stripFits: [],
    first, firstHost: null, firstView: null, hosts: [], extras: [], panels: [],
    origDraw: sys.draw, drawWrapper: null, origOnModalChanged: sys.onModalChanged, modalWrapper: null, chrome: null, labels: null,
    unwatch: [], done: false,
  };
  const built = pending.length > 0 ? new Promise<OpenResult | null>((resolve) => { s.built = resolve; }) : null;

  try {
    session = s;
    installDraw(s);
    watchRebuild(s);
  } catch (error) {
    await teardown(s);
    return failOpen('build', error);
  }
  // The game's own frames drive the build; a key press, Escape, stop or a renderer rebuild ends it early.
  const buildEnd = built ? await built : null;
  if (buildEnd) return buildEnd;
  if (s.done) return CANCELLED;

  try {
    const firstCell = cells[0] as Cell;
    const firstHost = makeHost(sys.uiContainer, first.storageId, firstCell);
    s.firstHost = firstHost;
    s.hosts.push(firstHost);
    installModalWrapper(s, firstHost, cellRenderer(real, firstCell));
  } catch (error) {
    await teardown(s);
    return failOpen('build', error);
  }

  try {
    await openGameModal(first.panelId);
  } catch (error) {
    await teardown(s);
    return failOpen('modal-write', error);
  }
  restoreModalWrapper(s);
  const firstHost = s.firstHost as PixiNode;
  if (sys.activeStorageType !== first.storageId || !sys.modalView || firstHost.children.length === 0) {
    await teardown(s);
    return failOpen('first-panel');
  }
  const viewMissing = s.extras.length === 0 ? checkFirstView(sys.modalView) : [];
  if (viewMissing.length > 0) {
    await teardown(s);
    return reportMissing(viewMissing);
  }
  s.firstView = sys.modalView;
  liftHost(firstHost);
  s.panels.unshift({ storageId: first.storageId, index: 0, host: firstHost, cell: cells[0] as Cell, view: () => sys.modalView });
  addChrome(s);
  addLabels(s);
  clearMissingReport();
  diagnostics.publishOk('open', { panels: s.panels.length });
  return { ok: true, storageIds: s.panels.map(p => p.storageId) };
}

/** Opens the picked storages (`undefined`: the saved pick; `null`: every owned storage). */
export async function openStorages(pick?: readonly string[] | null): Promise<OpenResult> {
  if (opening) return { ok: false, reason: 'busy' };
  if (session) return { ok: false, reason: 'open' };
  opening = true;
  try {
    return await openInner(pick === undefined ? getStoragePick() : pick);
  } finally {
    opening = false;
  }
}

/** Closes through the real modal, as Escape does; the panels finish closing on the game's own frames. */
export async function closeStorages(): Promise<boolean> {
  const s = session;
  if (s?.phase === 'building') {
    await teardown(s);
    return true;
  }
  if (!s || opening) return false;
  for (const extra of s.extras) closeExtra(s, extra);
  if (currentModal() === s.first.panelId) await toggleGameModal(s.first.panelId);
  return true;
}

/** Immediate teardown (stop, or a session left on a replaced storage system). */
export async function disposeStorages(): Promise<void> {
  const s = session;
  if (s) await teardown(s);
}

export async function toggleStorages(): Promise<OpenResult | { ok: true; closed: true }> {
  if (session && session.sys !== findStorageSystem()) await disposeStorages();
  // A second press while the panels are still being built cancels the open.
  if (session?.phase === 'building') {
    await closeStorages();
    return { ok: true, closed: true };
  }
  if (session) {
    await closeStorages();
    return { ok: true, closed: true };
  }
  return openStorages();
}

export function isStoragesOpen(): boolean {
  return session !== null;
}

/** Forgets every saved place and order; open panels go back side by side. True when panels were open. */
export function resetStorageLayout(): boolean {
  clearSavedLayout();
  const s = session;
  if (!s?.chrome) return false;
  s.chrome.reset(petSidebarRightEdge(s.sys.uiContainer, SIDEBAR_GAP_PX));
  return true;
}

/** Live-check readout: each panel's cell, front order, and where its header and grip are on screen. */
export function describeStoragePanels(): Record<string, unknown> | null {
  return session?.chrome?.describe() ?? null;
}

/** Live-check readout: each panel's storage-value label (text, shown, where in its host). */
export function describeStorageValues(): Array<Record<string, unknown>> | null {
  return session?.labels?.describe() ?? null;
}

/** The open panels, for header/grip and the storage-value labels; empty when closed. */
export function getOpenPanels(): readonly OpenPanel[] {
  return session?.panels ?? [];
}

/** Read-only facts for live checks: hosts left in the UI and whether the game's methods are its own again. */
export function inspectStorages(): Record<string, unknown> {
  const check = checkStorageSystem(findStorageSystem());
  const base = {
    open: session !== null, opening, phase: session?.phase ?? null, hidden: session?.hosts.filter(h => !h.visible).length ?? 0,
    stripFits: getStripFitCount(),
    storageIds: session?.panels.map(p => p.storageId) ?? [],
  };
  if (!check.ok) return { ...base, system: false, missing: check.missing };
  const { sys, proto } = check;
  return {
    ...base,
    system: true,
    uiChildren: sys.uiContainer.children.length,
    hostsInUi: sys.uiContainer.children.filter(c => (c.label ?? '').startsWith(HOST_LABEL_PREFIX)).length,
    drawIsOriginal: sys.draw === proto.draw,
    onModalChangedIsOriginal: sys.onModalChanged === proto.onModalChanged,
    activeStorageType: sys.activeStorageType,
    modal: currentModal(),
  };
}
