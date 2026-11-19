// Whether a shop is open right now, decided as the game decides it before it builds a shop's header
// (beta ShopModalView.ts:503-512): its weather must be running, and its own `isOpenAtom` (Spooky's hours) true.
// Plus the instance overrides that let a copy's weather end close only that copy (beta ShopModalView.ts:682-692).
import { atomObjectFor, readGameAtom, readSync } from '../../core/gameState';
import { getShopWeatherKind } from '../../store/shopRegistry';
import { classifyWeatherFromLabel } from '../../utils/game/weatherDetection';
import { isRecord } from '../../utils/typeGuards';
import type { ShopConfigLike } from './quietBuild';

export type ShopGateState = 'open' | 'closed';

export interface GateDeps {
  /** The weather kind running now: `sunny` when clear, `unknown` for a weather QPM does not know. */
  weather: string;
  /** The weather kind a shop type opens in; null for a shop no weather gates. */
  weatherOf(shopType: string): string | null;
  /** A config's own open gate; null when it cannot be read. */
  isOpen(atom: unknown): boolean | null;
}

const shopTypeOf = (config: ShopConfigLike): string | null =>
  typeof config.shopType === 'string' ? config.shopType : null;

function neededWeather(config: ShopConfigLike, deps: GateDeps): string | null {
  const type = shopTypeOf(config);
  return type ? deps.weatherOf(type) : null;
}

/** Unreadable counts as closed: opening a shop the game then refuses closes the real shop with it. */
export function shopGate(config: ShopConfigLike, deps: GateDeps): ShopGateState {
  const weather = neededWeather(config, deps);
  if (weather !== null && deps.weather !== weather) return 'closed';
  if (config.isOpenAtom != null && deps.isOpen(config.isOpenAtom) !== true) return 'closed';
  return 'open';
}

/** A shop that can close on its own while open: weather-gated, or on a clock of its own. */
export function isGatedShop(config: ShopConfigLike, deps: GateDeps): boolean {
  return neededWeather(config, deps) !== null || config.isOpenAtom != null;
}

// The game's own weather atom first: the shop gates on that value, and QPM's state-tree rung can run ahead of it.
function currentWeatherLabel(): string | null {
  const read = readGameAtom(findWeatherAtom());
  if (read.ok && (typeof read.value === 'string' || read.value === null)) return read.value;
  try { return readSync('weather') ?? null; } catch { return null; }
}

export function liveGateDeps(): GateDeps {
  const raw = currentWeatherLabel();
  return {
    weather: classifyWeatherFromLabel(raw),
    weatherOf: shopType => getShopWeatherKind(shopType),
    isOpen: (atom) => {
      const read = readGameAtom(atom);
      return read.ok && typeof read.value === 'boolean' ? read.value : null;
    },
  };
}

/** The atom the game's weather state lives in; the one a weather shop subscribes to while open. */
export function findWeatherAtom(): unknown {
  try { return atomObjectFor('weather') ?? null; } catch { return null; }
}

type OpenSubscribe = (atom: unknown, callback: (value: unknown) => void) => unknown;

/**
 * Before `open()`: the copy's subscriptions to `gateAtoms` call `onChange` in place of the game's callback,
 * which would close the active modal, i.e. the real shop and every panel with it. False when the view has no
 * `addOpenSubscription` (the game's callbacks then stay).
 */
export function redirectGateSubscriptions(view: unknown, gateAtoms: readonly unknown[], onChange: () => void): boolean {
  if (!isRecord(view) || typeof view.addOpenSubscription !== 'function') return false;
  const subscribe = view.addOpenSubscription as OpenSubscribe;
  const redirected: OpenSubscribe = function (this: unknown, atom, callback) {
    return subscribe.call(this, atom, gateAtoms.includes(atom) ? (): void => onChange() : callback);
  };
  view.addOpenSubscription = redirected;
  return true;
}

const DISMISS_HANDLERS = ['handleEscape', 'requestDismissFromOutside'] as const;

/**
 * Among requests in the top overlay band the newest gets Escape and outside taps (beta ScrimSystem.ts:497-505).
 * A copy opened after the real shop hands both to the real shop, so they still close every panel.
 */
export function forwardDismissal(copy: unknown, real: unknown): boolean {
  if (!isRecord(copy) || !isRecord(real)) return false;
  if (DISMISS_HANDLERS.some(name => typeof copy[name] !== 'function' || typeof real[name] !== 'function')) return false;
  for (const name of DISMISS_HANDLERS) {
    copy[name] = (): unknown => (real[name] as (this: unknown) => unknown).call(real);
  }
  return true;
}
