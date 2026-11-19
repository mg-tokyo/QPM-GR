// One multi-shop session: several of the game's shop windows open at once. The first is the game's real shop,
// opened through the real modal state (Escape, scrim, chime and the interaction other players see stay native);
// the rest are extra instances of the game's shop view, drawn from a wrapper on the modal host's draw.
import { getShopPanelIds } from '../../catalogs/logic/gamePanelsCatalog';
import { readSync, subscribe, subscribeGameAtom } from '../../core/gameState';
import { onPixiCaptureChange } from '../../core/pixiCapture';
import { recordProbe } from '../../diagnostics/perfMonitor';
import { isRecord } from '../../utils/typeGuards';
import { toggleGameModal } from '../input/gameModal';
import { destroyHost, petSidebarRightEdge, type GameRenderer, type PixiNode } from '../multiStorage/gameHooks';
import { frontOrder, startingCells } from '../multiStorage/layout';
import { SIDEBAR_GAP_PX } from '../multiStorage/session';
import { findWeatherAtom, isGatedShop, liveGateDeps, shopGate, type GateDeps } from './gate';
import {
  CapabilityError, FIRST_PANEL, HOST_LABEL_PREFIX, addChrome, addCopy, currentModal, discard, dropChrome, getLastRealName,
  openRealPanel, realOriginals, retire, type CopySpec, type PendingShop, type Session,
} from './panels';
import { onHostDestroy, unbindRealView } from './panelView';
import { CANCELLED, checkSurface, clearMissingReport, diagnostics, failOpen, reportMissing, type ShopOpenResult } from './probe';
import { checkModalHost, ensureShopConfigs, findModalHost, getCachedShopBuilds, type ModalHostLike } from './quietBuild';
import { clearSavedShopLayout, getSavedShopLayout, getShopPick } from './settings';
import { SHOP_FIT } from './shopChrome';
import { chooseShopNames } from './shops';

export { HOST_LABEL_PREFIX } from './panels';

let session: Session | null = null;
let opening = false;

const sidebarLeft = (s: Session): number => petSidebarRightEdge(s.ui, SIDEBAR_GAP_PX);

/** Its saved place, else the next default slot after the panels already open. */
function lateCell(s: Session, name: string): CopySpec['cell'] {
  const ids = [...s.panels.map(p => p.id), name];
  const cells = startingCells(ids, getSavedShopLayout(), sidebarLeft(s), s.screen, SHOP_FIT);
  return cells[cells.length - 1] ?? { x: sidebarLeft(s), y: 0, w: s.screen.w, h: s.screen.h };
}

function openLate(s: Session, shop: PendingShop): void {
  let panel;
  try {
    panel = addCopy(s, { ...shop, cell: lateCell(s, shop.build.name) }, true);
  } catch (error) {
    s.lateBlocked = error instanceof CapabilityError ? error.missing.join(',') : 'build';
    diagnostics.warnFeature('QPM-MSHOP-002', { stage: 'late-open', shop: shop.build.name }, error);
    return;
  }
  if (!panel) {
    // Refused by the game after the gate said open: its own close went to the real shop as well.
    if (s.lateBlocked === null) diagnostics.warnFeature('QPM-MSHOP-002', { stage: 'late-gate', shop: shop.build.name });
    return;
  }
  if (s.chrome) {
    try { s.chrome.add(panel); } catch (error) { dropChrome(s, 'add', error); }
  }
  if (!s.chrome) s.order = [panel.id, ...s.order];
}

/** Closes copies whose weather or hours ended and opens picked shops that just opened (W1), behind the others. */
function recheckGates(s: Session, deps: GateDeps): void {
  for (const panel of s.panels.slice()) {
    if (panel.real || !panel.gated || shopGate(panel.build.config, deps) === 'open') continue;
    retire(s, panel);
    s.pending.push({ build: panel.build, index: panel.index, gated: true });
  }
  if (s.lateBlocked !== null) return;
  for (const shop of s.pending.slice()) {
    if (shopGate(shop.build.config, deps) !== 'open') continue;
    s.pending = s.pending.filter(other => other !== shop);
    openLate(s, shop);
    if (s.lateBlocked !== null || !s.realPanel?.view.isOpen) return;
  }
}

/** Only when a picked shop can open or close on its own; a session of standard shops watches nothing here. */
function watchGates(s: Session, gatedConfigs: ReadonlyArray<Readonly<Record<string, unknown>>>): void {
  if (gatedConfigs.length === 0) return;
  const mark = (): void => { s.recheck = true; };
  s.unwatch.push(subscribe('weather', mark));
  for (const config of gatedConfigs) {
    if (config.isOpenAtom == null) continue;
    const stop = subscribeGameAtom(config.isOpenAtom, mark);
    if (stop) s.unwatch.push(stop);
  }
}

function endBuild(s: Session, end: ShopOpenResult | null): void {
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
  // Restore by assignment only (never delete on a game object); leave a later wrapper on top in place.
  if (s.drawWrapper && s.modals.draw === s.drawWrapper) s.modals.draw = s.origDraw;
  s.drawWrapper = null;
  // Before the hosts go: the bar and grip own canvas textures that destroying the hosts would leak.
  try { s.chrome?.dispose(); } catch { /* torn down with the renderer */ }
  s.chrome = null;
  for (const panel of [...s.panels, ...s.retired]) {
    if (!panel.real) discard(s, panel);
  }
  s.panels = [];
  s.retired = [];
  s.order = [];
  // The real view leaves its host before the host is destroyed under it.
  if (s.binding) unbindRealView(s.binding, s.ui);
  s.binding = null;
  for (const host of s.hosts.splice(0)) {
    try { destroyHost(host); } catch { /* already gone with the renderer */ }
  }
}

/** Closes the real shop if it is still the session's, then tears down. */
async function teardown(s: Session): Promise<void> {
  // First, so no frame builds another copy while the modal write below is awaited.
  endBuild(s, CANCELLED);
  // While building no shop is the session's: an open one is the player's own.
  const name = s.realPanel?.id ?? s.binding?.view.shopConfig.modalName ?? null;
  try {
    if (name !== null && !s.done && currentModal() === name) await toggleGameModal(name);
  } catch { /* the modal write failed; the panels are dropped below either way */ }
  finish(s);
}

function abortBuild(s: Session, end: ShopOpenResult): void {
  endBuild(s, end);
  void teardown(s);
}

/**
 * One copy per frame, so the worst frame costs one shop's tile build. The step that finds nothing left ends
 * the build, and the real shop's modal write runs on that frame, apart from the last copy's build.
 */
function buildStep(s: Session): void {
  // Escape or a tap outside closed a hidden copy, or the player opened a modal: the open is off.
  if (currentModal() !== null || s.retired.length > 0 || s.panels.some(p => !p.view.isOpen)) {
    abortBuild(s, CANCELLED);
    return;
  }
  const next = s.toBuild.shift();
  if (!next) {
    s.phase = 'opening';
    endBuild(s, null);
    return;
  }
  try {
    if (!addCopy(s, next, false, true)) s.skipped[next.build.name] = 'closed';
  } catch (error) {
    abortBuild(s, error instanceof CapabilityError ? reportMissing(error.missing) : failOpen('build', error));
  }
}

/** Same task as the real shop's open, so every panel is drawn first on the same frame. */
function reveal(s: Session): void {
  s.phase = 'open';
  for (const panel of s.panels) {
    if (!panel.host.destroyed) panel.host.visible = true;
  }
}

function frame(s: Session, deltaTimeMs: number): void {
  if (s.phase === 'building') {
    if (s.built) buildStep(s);
    return;
  }
  // Hidden copies are not drawn, so their first draw step is the real shop's.
  if (s.phase !== 'open') return;
  for (const panel of s.panels.slice()) {
    if (panel.real) continue;
    try { panel.view.draw(deltaTimeMs); } catch { retire(s, panel); }
  }
  for (const panel of s.retired.splice(0)) discard(s, panel);
  // Escape, a tap outside, the real ✕ or another modal closed the real shop: every copy goes with it.
  if (!s.realPanel?.view.isOpen) {
    finish(s);
    return;
  }
  const start = performance.now();
  if (s.recheck) {
    s.recheck = false;
    try { recheckGates(s, liveGateDeps()); } catch (error) { diagnostics.warnFeature('QPM-MSHOP-002', { stage: 'gate' }, error); }
    if (!s.realPanel.view.isOpen) return;
  }
  try { s.chrome?.sync(); } catch (error) { dropChrome(s, 'sync', error); }
  recordProbe('multiShop.frame', performance.now() - start);
}

function installDraw(s: Session): void {
  const { origDraw } = s;
  const wrapper = function (this: ModalHostLike, ...args: unknown[]): void {
    origDraw.apply(this, args);
    if (session === s && !s.done) frame(s, typeof args[1] === 'number' ? args[1] : 0);
  };
  s.drawWrapper = wrapper;
  s.modals.draw = wrapper;
}

// A renderer rebuild (context loss) or a room reconnect destroys the game's modal host and views, but not the
// copies QPM built: their atom subscriptions would outlive the game's. Close everything on the first sign of one.
// On the host's own destroy no modal write: the new host owns the modal state and reopens the shop itself.
function watchRebuild(s: Session): void {
  const engine = readSync('quinoaEngine');
  const drop = (): void => { if (!s.done) void teardown(s); };
  s.unwatch.push(
    onHostDestroy(s.modals, () => finish(s)),
    onPixiCaptureChange(drop),
    subscribe('quinoaEngine', (next) => { if (next !== engine) drop(); }),
  );
}

async function openInner(pick: readonly string[] | null): Promise<ShopOpenResult> {
  const shopIds = getShopPanelIds();
  if (!shopIds) return reportMissing(['shop-panels']);
  const names = chooseShopNames(shopIds, pick);
  if (names.length === 0) return { ok: false, reason: 'no-shops' };

  // The quiet build refuses while a modal is open.
  const open = currentModal();
  if (open !== null) {
    try { await toggleGameModal(open); } catch (error) { return failOpen('modal-write', error); }
  }
  const ensured = ensureShopConfigs(names);
  if (!ensured.ok) return reportMissing(ensured.missing);
  const check = checkModalHost(findModalHost());
  if (!check.ok) return reportMissing(check.missing);
  const skipped: Record<string, string> = { ...ensured.skipped };
  const deps = liveGateDeps();
  const picked: PendingShop[] = names.flatMap((name, index) => {
    const build = ensured.builds.get(name);
    return build ? [{ build, index, gated: isGatedShop(build.config, deps) }] : [];
  });
  const openNow = picked.filter(shop => shopGate(shop.build.config, deps) === 'open');
  const pending = picked.filter(shop => !openNow.includes(shop));
  for (const shop of pending) skipped[shop.build.name] = 'closed';
  // P6: the game's real shop is one that cannot close on its own, when one is picked.
  const first = openNow.find(shop => !shop.gated) ?? openNow[0];
  if (!first) return { ok: false, reason: 'no-shops', skipped };
  const surfaceMissing = checkSurface(first.build.ui, first.build.renderer);
  if (surfaceMissing.length > 0) return reportMissing(surfaceMissing);

  const ui = first.build.ui as PixiNode;
  const real = first.build.renderer as GameRenderer;
  const screen = { w: real.width, h: real.height };
  // Laid out for the shops that open now only, so a closed pick leaves no gap (T4 overlap).
  const cells = startingCells(openNow.map(shop => shop.build.name), getSavedShopLayout(), petSidebarRightEdge(ui, SIDEBAR_GAP_PX), screen, SHOP_FIT);
  const specs = openNow.map((shop, i): CopySpec => ({ ...shop, cell: cells[i] ?? { x: 0, y: 0, w: screen.w, h: screen.h } }));
  const firstSpec = specs[openNow.indexOf(first)];
  if (!firstSpec) return { ok: false, reason: 'no-shops', skipped };
  const toBuild = specs.filter(spec => spec !== firstSpec);
  const modals = check.host;
  const s: Session = {
    phase: toBuild.length > 0 ? 'building' : 'opening', toBuild, built: null, skipped,
    modals, ui, real, screen, hosts: [], panels: [], retired: [], order: [], chrome: null, realPanel: null, binding: null,
    origDraw: modals.draw, drawWrapper: null, unwatch: [], done: false,
    pending, recheck: false, weatherAtom: findWeatherAtom(), unredirected: [], lateBlocked: null,
  };
  const built = toBuild.length > 0 ? new Promise<ShopOpenResult | null>((resolve) => { s.built = resolve; }) : null;
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
    const realPanel = await openRealPanel(s, firstSpec, skipped);
    if (s.done) return CANCELLED;
    // The awaits may have spanned a renderer rebuild.
    if (findModalHost() !== modals) throw new Error('rebuilt');
    if (!realPanel) {
      finish(s);
      return { ok: false, reason: 'no-shops', skipped };
    }
    s.realPanel = realPanel;
    s.panels = [realPanel, ...s.panels].sort((a, b) => a.index - b.index);
    s.order = frontOrder(s.panels.map(p => p.id), getSavedShopLayout());
    reveal(s);
    addChrome(s);
    watchGates(s, picked.filter(shop => shop.gated).map(shop => shop.build.config));
  } catch (error) {
    await teardown(s);
    if (error instanceof CapabilityError) return reportMissing(error.missing);
    return failOpen(error instanceof Error && error.message === FIRST_PANEL ? FIRST_PANEL : 'build', error);
  }
  clearMissingReport();
  diagnostics.publishOk('open', { panels: s.panels.length });
  return { ok: true, shops: s.panels.map(p => p.id), skipped };
}

/** Opens the picked shops (`undefined`: the saved pick; `null`: every shop). */
export async function openShops(pick?: readonly string[] | null): Promise<ShopOpenResult> {
  if (opening) return { ok: false, reason: 'busy' };
  if (session) return { ok: false, reason: 'open' };
  opening = true;
  try {
    return await openInner(pick === undefined ? getShopPick() : pick);
  } finally {
    opening = false;
  }
}

/** Closes the real shop, as Escape does, and every copy with it. */
export async function closeShops(): Promise<boolean> {
  const s = session;
  // While building, the open is cancelled; during the real shop's modal write it is left to finish.
  if (!s || (opening && s.phase !== 'building')) return false;
  await teardown(s);
  return true;
}

/** Feature stop: closes an open session; a no-op otherwise. */
export async function disposeShops(): Promise<void> {
  const s = session;
  if (s) await teardown(s);
}

export async function toggleShops(): Promise<ShopOpenResult | { ok: true; closed: true }> {
  // A session left on a replaced modal host is dropped; the key then opens afresh.
  if (session && session.modals !== findModalHost()) await closeShops();
  if (session) {
    // A second press while the copies are still being built cancels the open.
    if (!(await closeShops())) return { ok: false, reason: 'busy' };
    return { ok: true, closed: true };
  }
  return openShops();
}

export function isShopsOpen(): boolean {
  return session !== null;
}

/** Brings one open shop to the front and gives it the keyboard; false when it is not open or already in front. */
export function raiseShopPanel(name: string): boolean {
  return session?.chrome?.raise(name) ?? false;
}

/** Forgets every saved place and order; open shops go back side by side. True when shops were open. */
export function resetShopLayout(): boolean {
  clearSavedShopLayout();
  const s = session;
  if (!s?.chrome) return false;
  s.chrome.reset(petSidebarRightEdge(s.ui, SIDEBAR_GAP_PX));
  return true;
}

/** Live-check readout: the chrome's cells, front order and bar/grip centres, plus which panel is the real shop. */
export function describeShopPanels(): Record<string, unknown> | null {
  const s = session;
  if (!s) return null;
  return {
    ...(s.chrome?.describe() ?? { decorated: false }),
    order: [...s.order],
    shops: s.panels.map(p => ({ id: p.id, real: p.real, gated: p.gated, isOpen: p.view.isOpen })),
    pending: s.pending.map(p => p.build.name),
    unredirected: [...s.unredirected],
    lateBlocked: s.lateBlocked,
    weatherAtom: s.weatherAtom != null,
  };
}

function inspectReal(modals: ModalHostLike, ui: PixiNode | null): Record<string, unknown> | null {
  const lastRealName = getLastRealName();
  const view = lastRealName ? modals.built.get(lastRealName) : null;
  if (!isRecord(view)) return null;
  const original = realOriginals.get(view);
  const proto: unknown = Object.getPrototypeOf(view);
  return {
    name: lastRealName,
    isOpen: view.isOpen,
    rendererOriginal: original ? view.renderer === original.renderer : null,
    handleKeyDownOriginal: original ? view.handleKeyDown === original.handleKeyDown : null,
    onLayoutOriginal: isRecord(proto) && view.onLayout === proto.onLayout,
    underUi: ui ? ui.children.includes(view.container as PixiNode) : null,
  };
}

/** Read-only facts for live checks: hosts left in the UI and whether the game's objects are their own again. */
export function inspectShops(): Record<string, unknown> {
  const s = session;
  const base = {
    open: s !== null, opening, shops: s?.panels.map(p => p.id) ?? [], front: s?.order[s.order.length - 1] ?? null,
    retired: s?.retired.length ?? 0, modal: currentModal(),
    phase: s?.phase ?? null, hidden: s?.hosts.filter(h => !h.visible).length ?? 0,
  };
  const check = checkModalHost(findModalHost());
  if (!check.ok) return { ...base, host: false, missing: check.missing };
  const modals = check.host;
  const proto: unknown = Object.getPrototypeOf(modals);
  const cachedUi: unknown = s?.ui ?? [...getCachedShopBuilds().values()][0]?.ui;
  const ui = checkSurface(cachedUi, { width: 0, height: 0 }).includes('ui') ? null : cachedUi as PixiNode;
  return {
    ...base,
    host: true,
    canPeek: check.canPeek,
    built: [...modals.built.keys()],
    drawIsOriginal: isRecord(proto) && modals.draw === proto.draw,
    destroyIsOriginal: isRecord(proto) && modals.destroy === proto.destroy,
    uiChildren: ui ? ui.children.length : null,
    hostsInUi: ui ? ui.children.filter(c => (c.label ?? '').startsWith(HOST_LABEL_PREFIX)).length : null,
    real: inspectReal(modals, ui),
  };
}
