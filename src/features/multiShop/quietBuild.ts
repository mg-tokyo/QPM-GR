// Each shop's config and view class, read without opening the shop. The game keeps a shop's config only inside
// the modal host's builder for it (beta QuinoaCanvas/pixi/ModalHost.ts:76, 90-102; installPlayerSystems.ts:231-240),
// so a shop the player has not opened is built hidden from a peeked request, read, and destroyed.
import { getShopPanelIds } from '../../catalogs/logic/gamePanelsCatalog';
import { peekModalRequests, readSync, type ModalPeekRefusal } from '../../core/gameState';
import { getEngineSystem } from '../../utils/quinoaEngine';
import { isRecord } from '../../utils/typeGuards';

export type ShopConfigLike = Readonly<Record<string, unknown>> & { readonly modalName: string };

export interface ShopViewLike {
  shopConfig: ShopConfigLike;
  ui: unknown;
  renderer: unknown;
  riveBatchRenderer: unknown;
  open(options: unknown): void;
  close(): void;
  draw(deltaTimeMs: number): void;
  destroy(): void;
  invalidateLayout(): void;
  handleKeyDown: (event: KeyboardEvent) => void;
}
export type ShopViewClass = new (host: unknown, renderer: unknown, riveBatchRenderer: unknown, config: ShopConfigLike) => ShopViewLike;

export interface ModalRequestLike { create(): unknown }
export interface ModalHostLike {
  built: Map<string, unknown>;
  read?: () => ModalRequestLike | null;
  draw(...args: unknown[]): void;
  destroy?: (...args: unknown[]) => void;
}

export interface ShopBuild {
  name: string;
  config: ShopConfigLike;
  ViewClass: ShopViewClass;
  riveBatchRenderer: unknown;
  /** The UI container and renderer the game built the view with; a panel's host and cell renderer come from them. */
  ui: unknown;
  renderer: unknown;
}

export type HostCheck = { ok: true; host: ModalHostLike; canPeek: boolean } | { ok: false; missing: string[] };

export type ShopSkipReason =
  | 'not-a-shop'      // not in the game's shop list, or the list is unread
  | 'no-read'         // the host has no `read`: only shops the game already built can be used
  | 'no-request'      // the host knows no builder for the name
  | 'build-failed'    // `create()` threw
  | 'view-mismatch'   // the built view lacks what a panel needs, or carries another shop's config
  | `peek:${ModalPeekRefusal}`;

export type EnsureResult =
  | { ok: true; builds: Map<string, ShopBuild>; skipped: Record<string, ShopSkipReason>; peeked: string[] }
  | { ok: false; missing: string[] };

export interface PeekRecord { names: string[]; refused: ModalPeekRefusal | null; ms: number }

const VIEW_FUNCTIONS = ['open', 'close', 'draw', 'destroy', 'invalidateLayout', 'handleKeyDown'] as const;
const MODAL_HOST_SYSTEM = 'modals';

const isFn = (v: unknown): boolean => typeof v === 'function';

let generation: { engine: unknown; host: unknown } | null = null;
let builds = new Map<string, ShopBuild>();
let lastPeek: PeekRecord | null = null;
let simulatedMissing: readonly string[] = [];

const READ_HANDLE = 'modals.read';

/** Debug only: the next host checks report these handles missing (`modals.read` only switches the peek off). */
export function setSimulatedHostMissing(names: readonly string[] | null): void {
  simulatedMissing = names ? [...names] : [];
}

export function findModalHost(): unknown {
  let engine: unknown;
  try { engine = readSync('quinoaEngine'); } catch { engine = null; }
  return getEngineSystem(engine, MODAL_HOST_SYSTEM);
}

/** `missing` names what an open cannot do without; a missing `read` alone only switches the peek off. */
export function checkModalHost(host: unknown): HostCheck {
  if (!isRecord(host)) return { ok: false, missing: ['modals'] };
  const missing: string[] = [];
  if (!(host.built instanceof Map)) missing.push('modals.built');
  if (!isFn(host.draw)) missing.push('modals.draw');
  missing.push(...simulatedMissing.filter(name => name !== READ_HANDLE));
  if (missing.length > 0) return { ok: false, missing };
  return { ok: true, host: host as unknown as ModalHostLike, canPeek: isFn(host.read) && !simulatedMissing.includes(READ_HANDLE) };
}

/** What a panel needs on a built shop view; empty when it is all there. */
export function checkShopView(view: unknown): string[] {
  if (!isRecord(view)) return ['view'];
  const missing: string[] = [];
  if (!isFn(view.constructor) || view.constructor === Object) missing.push('view.constructor');
  const config = view.shopConfig;
  if (!isRecord(config) || typeof config.modalName !== 'string') missing.push('view.shopConfig');
  for (const name of VIEW_FUNCTIONS) if (!isFn(view[name])) missing.push(`view.${name}`);
  if (view.renderer == null) missing.push('view.renderer');
  if (view.riveBatchRenderer == null) missing.push('view.riveBatchRenderer');
  if (!isRecord(view.ui)) missing.push('view.ui');
  return missing;
}

function buildFrom(name: string, view: unknown): ShopBuild | null {
  if (checkShopView(view).length > 0) return null;
  const shop = view as ShopViewLike;
  if (shop.shopConfig.modalName !== name) return null;
  return {
    name,
    config: shop.shopConfig,
    ViewClass: shop.constructor as unknown as ShopViewClass,
    riveBatchRenderer: shop.riveBatchRenderer,
    ui: shop.ui,
    renderer: shop.renderer,
  };
}

function destroyPeeked(view: unknown): void {
  if (!isRecord(view) || !isFn(view.destroy)) return;
  try { (view as unknown as ShopViewLike).destroy(); } catch { /* the view was never shown */ }
}

// A renderer rebuild replaces the engine page and its modal host; configs from the old one are dropped unread.
function syncGeneration(host: unknown): void {
  let engine: unknown;
  try { engine = readSync('quinoaEngine'); } catch { engine = null; }
  if (generation && generation.engine === engine && generation.host === host) return;
  generation = { engine, host };
  builds = new Map();
}

function peekMissing(host: ModalHostLike, names: string[], skipped: Record<string, ShopSkipReason>): void {
  const read = host.read;
  if (!read) return;
  const started = performance.now();
  const peek = peekModalRequests(names, () => read.call(host));
  lastPeek = { names, refused: peek.ok ? null : peek.reason, ms: performance.now() - started };
  if (!peek.ok) {
    for (const name of names) skipped[name] = `peek:${peek.reason}`;
    return;
  }
  // `create()` runs out here: a view's constructor subscribes, and a subscribe inside the batch flushes listeners.
  for (const name of names) {
    const request = peek.requests.get(name);
    if (!isRecord(request) || !isFn(request.create)) { skipped[name] = 'no-request'; continue; }
    let view: unknown;
    try { view = request.create(); } catch { skipped[name] = 'build-failed'; continue; }
    const build = buildFrom(name, view);
    destroyPeeked(view);
    if (build) builds.set(name, build);
    else skipped[name] = 'view-mismatch';
  }
}

/**
 * A build for each name that is one of the game's shops: cached, else read off the view the game already
 * built, else peeked (all the rest in one batch). Never opens a shop and never writes the host's `built`.
 */
export function ensureShopConfigs(names: readonly string[]): EnsureResult {
  const check = checkModalHost(findModalHost());
  if (!check.ok) return { ok: false, missing: check.missing };
  const { host, canPeek } = check;
  syncGeneration(host);

  const shopIds = getShopPanelIds();
  const skipped: Record<string, ShopSkipReason> = {};
  const toPeek: string[] = [];
  for (const name of new Set(names)) {
    if (builds.has(name)) continue;
    const fromBuilt = host.built.has(name) ? buildFrom(name, host.built.get(name)) : null;
    if (fromBuilt) builds.set(name, fromBuilt);
    else if (!shopIds?.includes(name)) skipped[name] = 'not-a-shop';
    else if (!canPeek) skipped[name] = 'no-read';
    else toPeek.push(name);
  }
  if (toPeek.length > 0) peekMissing(host, toPeek, skipped);

  const out = new Map<string, ShopBuild>();
  for (const name of names) {
    const build = builds.get(name);
    if (build) out.set(name, build);
  }
  return { ok: true, builds: out, skipped, peeked: toPeek };
}

export function getCachedShopBuilds(): ReadonlyMap<string, ShopBuild> {
  return builds;
}

export function dropShopBuilds(): void {
  generation = null;
  builds = new Map();
}

export function getLastPeek(): PeekRecord | null {
  return lastPeek;
}
