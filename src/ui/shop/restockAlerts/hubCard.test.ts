// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AlertModel } from './types';

vi.mock('../../../i18n', () => ({ t: (key: string) => key }));
vi.mock('../../../utils/restock/dataService', () => ({
  getItemIdVariants: () => [] as string[],
  canonicalItemId: (_shopType: string, id: string) => id,
}));
vi.mock('../../../sprite-v2/compat', () => ({
  getAnySpriteDataUrl: () => null,
  getCropSpriteCanvas: () => null,
  getPetSpriteCanvas: () => null,
}));
vi.mock('../../../utils/dom/canvasHelpers', () => ({ canvasToDataUrl: () => null }));
vi.mock('../../../catalogs/shopEligibility', () => ({ getItemCatalogSpriteKey: () => null }));
vi.mock('./ownershipTracker', () => ({
  debugLog: () => { /* silenced */ },
  toCanonicalKey: (kind: string, id: string) => `${kind}:${id}`,
  clearPendingOwnershipConfirmation: () => { /* none pending */ },
}));
vi.mock('./purchaseActions', () => ({ handleBuyAll: vi.fn(async () => { /* no-op */ }) }));
vi.mock('./stockProcessor', () => ({ markDismissedCycle: () => { /* no-op */ } }));
vi.mock('../../../store/shopStock', () => ({
  getShopStockItemByKey: () => null,
  onShopStockItemChange: () => () => { /* no-op */ },
}));
vi.mock('./soundConfig', () => ({
  getSoundConfig: () => null,
  getCustomSounds: () => ({}),
  DEFAULT_LOOP_INTERVAL_MS: 5_000,
}));
vi.mock('./soundEngine', () => ({
  playSound: vi.fn(async () => { /* no-op */ }),
  playCustomSound: vi.fn(async () => { /* no-op */ }),
  startLoop: vi.fn(),
  stopLoop: vi.fn(),
  isLooping: () => false,
  isBuiltinSound: () => true,
}));

import { registerAlertRow } from '../../../features/alertHub/registry';
import { createAlert, removeAlert } from './alertDom';
import { activeAlerts } from './alertState';
import { closeAllHubCards, getHubCardCount, presentHubCard } from './hubCard';
import { ALERT_ROOT_ID } from './types';

const root = (): HTMLElement | null => document.getElementById(ALERT_ROOT_ID);
const hubCardEl = (): HTMLElement | null => document.querySelector('[data-qpm-alert-row="t.row"]');
const finishExit = (el: Element | null | undefined): void => { el?.dispatchEvent(new Event('animationend')); };

function present(extra: Partial<Parameters<typeof presentHubCard>[0]> = {}): { handle: ReturnType<typeof presentHubCard>; onClose: ReturnType<typeof vi.fn> } {
  const onClose = vi.fn();
  const handle = presentHubCard({ rowId: 't.row', title: 'Title', body: 'Body', onClose, ...extra });
  return { handle, onClose };
}

const model: AlertModel = {
  key: 'seed:CarrotSeed', shopType: 'seed', itemId: 'CarrotSeed', stockCycleId: 'c1',
  label: 'Carrot Seed', quantity: 3, priceCoins: 100,
};

describe('hub card', () => {
  beforeEach(() => {
    registerAlertRow({ id: 't.row', group: 'qpm', labelKey: 'row.label', defaultSound: 'none' });
  });

  afterEach(() => {
    closeAllHubCards();
    activeAlerts.clear();
    document.body.innerHTML = '';
  });

  it('creates a card on the shared root: caption, title, body, close, at most two actions', () => {
    const a = vi.fn();
    present({ actions: [{ label: 'One', onClick: a }, { label: 'Two', onClick: a }, { label: 'Three', onClick: a }] });
    const el = hubCardEl();
    expect(el?.parentElement).toBe(root());
    expect(el?.querySelector('.qpm-restock-alert__title')?.textContent).toBe('row.label');
    expect(el?.querySelector('.qpm-restock-alert__item')?.textContent).toBe('Title');
    expect(el?.querySelector('.qpm-restock-alert__qty')?.textContent).toBe('Body');
    expect(el?.querySelector('.qpm-restock-alert__close')?.getAttribute('title')).toBe('common.close');
    const buttons = [...(el?.querySelectorAll('.qpm-restock-alert__actions button') ?? [])];
    expect(buttons.map((b) => [b.textContent, b.classList.contains('qpm-restock-alert__btn--ghost')])).toEqual([['One', false], ['Two', true]]);
    expect(getHubCardCount()).toBe(1);
  });

  it('shows the icon (smooth, not pixelated) and a meter that update() moves in place', () => {
    const { handle } = present({ iconUrl: 'data:image/png;base64,AA', meter: { pct: 40, color: 'var(--qpm-hunger-mid)' } });
    const el = hubCardEl();
    const img = el?.querySelector<HTMLImageElement>('.qpm-restock-alert__icon-shell img');
    expect(img?.getAttribute('src')).toBe('data:image/png;base64,AA');
    expect(img?.style.imageRendering).toBe('');
    const fill = el?.querySelector<HTMLElement>('.qpm-alert-meter > div');
    expect([fill?.style.width, fill?.style.background]).toEqual(['40%', 'var(--qpm-hunger-mid)']);
    handle?.update('Lower', { pct: 12, color: 'var(--qpm-hunger-low)' });
    expect([fill?.style.width, fill?.style.background]).toEqual(['12%', 'var(--qpm-hunger-low)']);
    expect(el?.querySelectorAll('.qpm-alert-meter')).toHaveLength(1);
  });

  it('no icon or meter unless given', () => {
    present();
    expect(hubCardEl()?.querySelector('.qpm-restock-alert__icon-shell, .qpm-alert-meter')).toBeNull();
  });

  it('update rewrites the body in place; an empty body hides the line', () => {
    const { handle } = present();
    handle?.update('Second');
    const body = hubCardEl()?.querySelector<HTMLElement>('.qpm-restock-alert__qty');
    expect(body?.textContent).toBe('Second');
    handle?.update('');
    expect(body?.style.display).toBe('none');
    expect(document.querySelectorAll('.qpm-restock-alert')).toHaveLength(1);
  });

  it('an action runs, closes the card once and removes the empty root after the exit', () => {
    const a = vi.fn();
    const { onClose, handle } = present({ actions: [{ label: 'Go', onClick: a }] });
    const el = hubCardEl();
    el?.querySelector<HTMLButtonElement>('.qpm-restock-alert__btn')?.click();
    handle?.close();
    expect(a).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(getHubCardCount()).toBe(0);
    expect(el?.classList.contains('qpm-restock-alert--exit')).toBe(true);
    finishExit(el);
    expect(el?.isConnected).toBe(false);
    expect(root()).toBeNull();
  });

  it('the close button and closeAllHubCards close cards and call onClose', () => {
    const first = present();
    hubCardEl()?.querySelector<HTMLButtonElement>('.qpm-restock-alert__close')?.click();
    expect(first.onClose).toHaveBeenCalledTimes(1);
    const second = present();
    const third = present();
    closeAllHubCards();
    expect([second.onClose.mock.calls.length, third.onClose.mock.calls.length, getHubCardCount()]).toEqual([1, 1, 0]);
  });

  it('a restock card closing keeps the root while a hub card is open', () => {
    const restock = createAlert(model);
    present();
    removeAlert(model.key);
    finishExit(restock.root);
    expect(restock.root.isConnected).toBe(false);
    expect(root()).not.toBeNull();
    expect(hubCardEl()?.parentElement).toBe(root());
    const el = hubCardEl();
    closeAllHubCards();
    finishExit(el);
    expect(root()).toBeNull();
  });
});
