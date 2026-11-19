import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShopOpenResult } from './probe';

const toggleShops = vi.fn<() => Promise<ShopOpenResult | { ok: true; closed: true }>>();
const disposeShops = vi.fn(() => Promise.resolve());
const resetShopLayout = vi.fn(() => true);
const closeShops = vi.fn(() => Promise.resolve(true));
let enabled = true;
const setMultiShopEnabled = vi.fn((v: boolean) => { enabled = v; });
const showToast = vi.fn();

vi.mock('./session', () => ({ toggleShops, disposeShops, resetShopLayout, closeShops }));
vi.mock('./settings', () => ({ isMultiShopEnabled: () => enabled, setMultiShopEnabled }));
vi.mock('../../ui/components', () => ({ showToast }));
vi.mock('../../i18n', () => ({ t: (key: string) => key }));

const { resetShopLayoutFromKey, setShopsEnabled, startMultiShop, stopMultiShop, toggleShopsFromKey } = await import('./control');

const OPENED: ShopOpenResult = { ok: true, shops: ['seedShop'], skipped: {} };

describe('multi-shop key actions', () => {
  beforeEach(() => {
    stopMultiShop();
    vi.clearAllMocks();
    enabled = true;
    toggleShops.mockResolvedValue(OPENED);
    startMultiShop();
  });

  it('does nothing before start or after stop', async () => {
    stopMultiShop();
    await toggleShopsFromKey();
    resetShopLayoutFromKey();
    expect(toggleShops).not.toHaveBeenCalled();
    expect(resetShopLayout).not.toHaveBeenCalled();
  });

  it('does nothing while switched off', async () => {
    enabled = false;
    await toggleShopsFromKey();
    resetShopLayoutFromKey();
    expect(toggleShops).not.toHaveBeenCalled();
    expect(resetShopLayout).not.toHaveBeenCalled();
  });

  it('start is idempotent and stop closes an open session once', () => {
    startMultiShop();
    stopMultiShop();
    stopMultiShop();
    expect(disposeShops).toHaveBeenCalledTimes(1);
  });

  it('closes shops that finished opening after stop', async () => {
    let resolve: (r: ShopOpenResult) => void = () => undefined;
    toggleShops.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    const pending = toggleShopsFromKey();
    stopMultiShop();
    resolve(OPENED);
    await pending;
    expect(closeShops).toHaveBeenCalledTimes(1);
  });

  it('says the shops are loading on every press while the shop list is unread', async () => {
    toggleShops.mockResolvedValue({ ok: false, reason: 'unavailable', missing: ['shop-panels'] });
    await toggleShopsFromKey();
    await toggleShopsFromKey();
    expect(showToast).toHaveBeenCalledTimes(2);
    expect(showToast).toHaveBeenCalledWith('feature.multiShop.notReady');
  });

  it('tells a changed game once, again after a good open', async () => {
    toggleShops.mockResolvedValue({ ok: false, reason: 'unavailable', missing: ['draw'] });
    await toggleShopsFromKey();
    await toggleShopsFromKey();
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith('feature.multiShop.unavailable', { variant: 'error' });

    toggleShops.mockResolvedValueOnce(OPENED);
    await toggleShopsFromKey();
    await toggleShopsFromKey();
    expect(showToast).toHaveBeenCalledTimes(2);
  });

  it('a list miss together with another miss is a changed game', async () => {
    toggleShops.mockResolvedValue({ ok: false, reason: 'unavailable', missing: ['shop-panels', 'read'] });
    await toggleShopsFromKey();
    expect(showToast).toHaveBeenCalledWith('feature.multiShop.unavailable', { variant: 'error' });
  });

  it('says so every time no picked shop can open', async () => {
    toggleShops.mockResolvedValue({ ok: false, reason: 'no-shops' });
    await toggleShopsFromKey();
    await toggleShopsFromKey();
    expect(showToast).toHaveBeenCalledTimes(2);
    expect(showToast).toHaveBeenCalledWith('feature.multiShop.noShops');
  });

  it('stays quiet on close, busy and already open', async () => {
    toggleShops.mockResolvedValueOnce({ ok: true, closed: true });
    toggleShops.mockResolvedValueOnce({ ok: false, reason: 'busy' });
    toggleShops.mockResolvedValueOnce({ ok: false, reason: 'open' });
    for (let i = 0; i < 3; i += 1) await toggleShopsFromKey();
    expect(showToast).not.toHaveBeenCalled();
    expect(closeShops).not.toHaveBeenCalled();
  });

  it('reset confirms with a toast', () => {
    resetShopLayoutFromKey();
    expect(resetShopLayout).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith('feature.multiShop.layoutReset', { variant: 'success' });
  });

  it('closes open shops when switched off, and only then', () => {
    setShopsEnabled(true);
    expect(closeShops).not.toHaveBeenCalled();
    setShopsEnabled(false);
    expect(setMultiShopEnabled).toHaveBeenLastCalledWith(false);
    expect(closeShops).toHaveBeenCalledTimes(1);
  });
});
