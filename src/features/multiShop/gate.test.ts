import { describe, expect, it, vi } from 'vitest';

vi.mock('../../core/gameState', () => ({ atomObjectFor: () => null, readGameAtom: () => ({ ok: false }), readSync: () => null }));
vi.mock('../../store/shopRegistry', () => ({ getShopWeatherKind: () => null }));
// weatherDetection imports dom.ts, whose module-scope `ready` reads `document` (absent in the node env).
vi.mock('../../utils/dom/dom', () => ({ getGameHudRoot: () => null }));

import { forwardDismissal, isGatedShop, redirectGateSubscriptions, shopGate, type GateDeps } from './gate';
import type { ShopConfigLike } from './quietBuild';

const SPOOKY_OPEN = { label: 'spookyShopIsOpenAtom' };
const WEATHER_OF: Record<string, string> = { rain: 'rain', snow: 'snow', thunder: 'thunderstorm' };

function deps(weather: string, isOpen: boolean | null = true): GateDeps {
  return { weather, weatherOf: type => WEATHER_OF[type] ?? null, isOpen: () => isOpen };
}
const config = (modalName: string, shopType: string, extra: Record<string, unknown> = {}): ShopConfigLike =>
  ({ modalName, shopType, ...extra });

const seed = config('seedShop', 'seed');
const rain = config('rainShop', 'rain');
const snow = config('snowShop', 'snow');
const thunder = config('thunderShop', 'thunder');
const spooky = config('spookyShop', 'spooky', { isOpenAtom: SPOOKY_OPEN });

describe('shopGate (game rule, beta ShopModalView.ts:503-512)', () => {
  it('keeps a standard shop open in any weather', () => {
    expect(shopGate(seed, deps('sunny'))).toBe('open');
    expect(shopGate(seed, deps('rain'))).toBe('open');
    expect(shopGate(seed, deps('unknown'))).toBe('open');
  });
  it('opens a weather shop only in its own weather', () => {
    expect(shopGate(rain, deps('rain'))).toBe('open');
    expect(shopGate(rain, deps('sunny'))).toBe('closed');
    expect(shopGate(rain, deps('snow'))).toBe('closed');
    expect(shopGate(snow, deps('snow'))).toBe('open');
    expect(shopGate(thunder, deps('thunderstorm'))).toBe('open');
  });
  it('closes a weather shop in a weather QPM does not know', () => {
    expect(shopGate(rain, deps('unknown'))).toBe('closed');
  });
  it('follows a shop clock of its own through its isOpenAtom', () => {
    expect(shopGate(spooky, deps('sunny', true))).toBe('open');
    expect(shopGate(spooky, deps('rain', true))).toBe('open');
    expect(shopGate(spooky, deps('sunny', false))).toBe('closed');
  });
  it('treats an unreadable isOpenAtom as closed', () => {
    expect(shopGate(spooky, deps('sunny', null))).toBe('closed');
  });
  it('treats a config with no shopType as ungated', () => {
    expect(shopGate({ modalName: 'oddShop' }, deps('sunny'))).toBe('open');
  });
});

describe('isGatedShop (P6: the real panel is an ungated shop when one is picked)', () => {
  it('marks weather and clock shops only', () => {
    expect(isGatedShop(seed, deps('sunny'))).toBe(false);
    expect(isGatedShop(rain, deps('sunny'))).toBe(true);
    expect(isGatedShop(spooky, deps('sunny'))).toBe(true);
  });
});

class FakeShop {
  subs: Array<[unknown, (value: unknown) => void]> = [];
  closedActive = 0;
  escapes = 0;
  dismissals = 0;
  addOpenSubscription(atom: unknown, callback: (value: unknown) => void): void { this.subs.push([atom, callback]); }
  handleEscape(): void { this.escapes += 1; }
  requestDismissFromOutside(): void { this.dismissals += 1; }
  /** What the game's weather-gated shop does on open (beta ShopModalView.ts:682-692). */
  openAsGame(weatherAtom: unknown, isOpenAtom: unknown, other: unknown): void {
    this.addOpenSubscription(weatherAtom, () => { this.closedActive += 1; });
    this.addOpenSubscription(isOpenAtom, () => { this.closedActive += 1; });
    this.addOpenSubscription(other, () => undefined);
  }
}

describe('redirectGateSubscriptions (P5)', () => {
  const weatherAtom = { label: 'weatherAtom' };
  const other = { label: 'shopTargetItemAtom' };

  it('sends the gate callbacks to onChange and leaves the others to the game', () => {
    const view = new FakeShop();
    let changes = 0;
    expect(redirectGateSubscriptions(view, [weatherAtom, SPOOKY_OPEN], () => { changes += 1; })).toBe(true);
    view.openAsGame(weatherAtom, SPOOKY_OPEN, other);
    expect(view.subs.map(([atom]) => atom)).toEqual([weatherAtom, SPOOKY_OPEN, other]);
    for (const [, callback] of view.subs) callback('Rain');
    expect(changes).toBe(2);
    expect(view.closedActive).toBe(0);
  });
  it('keeps the game callback for an atom it was not given', () => {
    const view = new FakeShop();
    redirectGateSubscriptions(view, [SPOOKY_OPEN], () => undefined);
    view.openAsGame(weatherAtom, SPOOKY_OPEN, other);
    for (const [, callback] of view.subs) callback(null);
    expect(view.closedActive).toBe(1);
  });
  it('reports false when the view has no addOpenSubscription', () => {
    expect(redirectGateSubscriptions({}, [weatherAtom], () => undefined)).toBe(false);
  });
});

describe('forwardDismissal (beta ScrimSystem.ts:497-505: the newest request gets Escape)', () => {
  it('hands Escape and outside taps to the real shop', () => {
    const copy = new FakeShop();
    const real = new FakeShop();
    expect(forwardDismissal(copy, real)).toBe(true);
    copy.handleEscape();
    copy.requestDismissFromOutside();
    expect([real.escapes, real.dismissals, copy.escapes, copy.dismissals]).toEqual([1, 1, 0, 0]);
  });
  it('refuses when either side lacks a handler', () => {
    expect(forwardDismissal(new FakeShop(), {})).toBe(false);
    expect(forwardDismissal({}, new FakeShop())).toBe(false);
  });
});
