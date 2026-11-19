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
vi.mock('../../../catalogs/shopEligibility', () => ({ getItemCatalogSpriteKey: () => null, getItemCatalogRarity: () => null }));
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

const cardSizes = new Map<string, number>();
vi.mock('../../../features/alertHub/settings', () => ({ getRowCardSize: (id: string) => cardSizes.get(id) ?? 1 }));

import { registerAlertRow } from '../../../features/alertHub/registry';
import { createAlert, removeAlert } from './alertDom';
import { activeAlerts } from './alertState';
import { getCountdownStats } from './cardShell';
import { closeAllHubCards, getHubCardCount, presentHubCard, resizeHubCards } from './hubCard';
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
    cardSizes.clear();
    activeAlerts.clear();
    document.body.innerHTML = '';
  });

  it('creates a card on the shared root: caption, title, body, close, at most two actions', () => {
    const a = vi.fn();
    present({ actions: [{ label: 'One', onClick: a }, { label: 'Two', onClick: a }, { label: 'Three', onClick: a }] });
    const el = hubCardEl();
    expect(el?.parentElement).toBe(root());
    expect(el?.querySelector('.qpm-alert-card__caption')?.textContent).toBe('feature.alertCentre.group.qpm · row.label');
    expect(el?.querySelector('.qpm-alert-card__title')?.textContent).toBe('Title');
    expect(el?.querySelector('.qpm-alert-card__body')?.textContent).toBe('Body');
    expect(el?.querySelector('.qpm-alert-card__close')?.getAttribute('title')).toBe('common.close');
    const buttons = [...(el?.querySelectorAll('.qpm-alert-card__actions button') ?? [])];
    expect(buttons.map((b) => b.textContent)).toEqual(['One', 'Two']);
    expect(getHubCardCount()).toBe(1);
  });

  it('shows the icon (smooth, not pixelated) and a meter that update() moves in place', () => {
    const { handle } = present({ iconUrl: 'data:image/png;base64,AA', meter: { pct: 40, color: 'var(--qpm-hunger-mid)' } });
    const el = hubCardEl();
    const img = el?.querySelector<HTMLImageElement>('.qpm-alert-card__icon img');
    expect(img?.getAttribute('src')).toBe('data:image/png;base64,AA');
    expect(img?.style.imageRendering).toBe('');
    const fill = el?.querySelector<HTMLElement>('.qpm-alert-meter > div');
    expect([fill?.style.width, fill?.style.background]).toEqual(['40%', 'var(--qpm-hunger-mid)']);
    handle?.update({ body: 'Lower', meter: { pct: 12, color: 'var(--qpm-hunger-low)' } });
    expect([fill?.style.width, fill?.style.background]).toEqual(['12%', 'var(--qpm-hunger-low)']);
    expect(el?.querySelectorAll('.qpm-alert-meter')).toHaveLength(1);
  });

  it("opens at the row's stored size; resize changes only that row's open cards (ALR-17.11a)", () => {
    present();
    const scale = (el: HTMLElement | null | undefined): string | undefined => el?.style.getPropertyValue('--qpm-alert-scale');
    expect(scale(hubCardEl())).toBe('');
    cardSizes.set('t.row', 1.2);
    registerAlertRow({ id: 'o.row', group: 'qpm', labelKey: 'other', defaultSound: 'none' });
    presentHubCard({ rowId: 'o.row', title: 'Other', onClose: vi.fn() });
    present();
    const tCards = [...document.querySelectorAll<HTMLElement>('[data-qpm-alert-row="t.row"]')];
    const other = document.querySelector<HTMLElement>('[data-qpm-alert-row="o.row"]');
    expect(tCards.map(scale)).toEqual(['1.2', '']);
    resizeHubCards('t.row', 0.8);
    expect(tCards.map(scale)).toEqual(['0.8', '0.8']);
    expect(scale(other)).toBe('');
    resizeHubCards('t.row', 1);
    expect(tCards.map(scale)).toEqual(['', '']);
  });

  it('no icon or meter unless given', () => {
    present();
    expect(hubCardEl()?.querySelector('.qpm-alert-card__icon, .qpm-alert-meter')).toBeNull();
  });

  it('update rewrites the body in place; an empty body hides the line', () => {
    const { handle } = present();
    handle?.update({ body: 'Second' });
    const body = hubCardEl()?.querySelector<HTMLElement>('.qpm-alert-card__body');
    expect(body?.textContent).toBe('Second');
    handle?.update({ chips: [{ text: 'x3' }], figure: { value: '3', label: 'EGGS' } });
    expect(body?.textContent).toBe('Second');
    handle?.update({ body: '' });
    expect(body?.style.display).toBe('none');
    expect(document.querySelectorAll('.qpm-alert-card')).toHaveLength(1);
  });

  it('draws every D1 field: accent glow, sprites with counts, chips, figure; update changes chips/figure in place', () => {
    const { handle } = present({
      accent: 'var(--qpm-dawn)', iconUrl: 'data:icon',
      sprites: [{ url: 'data:a' }, { url: 'data:b', count: 3 }],
      chips: [{ text: 'Frozen', color: 'var(--qpm-info)' }],
      figure: { value: '12', label: 'Crops' },
    });
    const el = hubCardEl();
    expect([el?.classList.contains('qpm-alert-card--accent'), el?.style.getPropertyValue('--qpm-alert-color')]).toEqual([true, 'var(--qpm-dawn)']);
    expect(el?.querySelectorAll('.qpm-alert-card__sprites .qpm-alert-card__icon--sm')).toHaveLength(2);
    expect(el?.querySelector('.qpm-alert-card__sprites .qpm-alert-card__count')?.textContent).toBe('x3');
    handle?.update({ chips: [{ text: '6/6' }, { text: 'x1.5 sell' }], figure: { value: '14', label: 'Crops' } });
    expect([...(el?.querySelectorAll('.qpm-alert-card__chip') ?? [])].map((c) => c.textContent)).toEqual(['6/6', 'x1.5 sell']);
    expect(el?.querySelector('.qpm-alert-card__figure-value')?.textContent).toBe('14');
    expect(el?.querySelectorAll('.qpm-alert-card__meta')).toHaveLength(1);
  });

  it('warn without an accent colours the border only; the row icon fills in for a missing iconUrl', () => {
    registerAlertRow({ id: 't.row', group: 'pets', labelKey: 'row.label', defaultSound: 'none', icon: () => 'data:row' });
    present({ level: 'warn' });
    const el = hubCardEl();
    expect([el?.classList.contains('qpm-alert-card--accent'), el?.style.getPropertyValue('--qpm-alert-color')]).toEqual([false, 'var(--qpm-warning)']);
    expect(el?.querySelector('.qpm-alert-card__icon img')?.getAttribute('src')).toBe('data:row');
    expect(el?.querySelector('.qpm-alert-card__caption')?.textContent).toBe('feature.alertCentre.group.pets · row.label');
  });

  it('closing a countdown card stops the shared tick', () => {
    const { handle } = present({ figure: { countdownTo: Date.now() + 60_000, label: 'Ends in' } });
    expect(getCountdownStats()).toEqual({ cards: 1, ticking: true });
    handle?.close();
    expect(getCountdownStats()).toEqual({ cards: 0, ticking: false });
  });

  it('an action runs, closes the card once and removes the empty root after the exit', () => {
    const a = vi.fn();
    const { onClose, handle } = present({ actions: [{ label: 'Go', onClick: a }] });
    const el = hubCardEl();
    el?.querySelector<HTMLButtonElement>('.qpm-alert-card__actions button')?.click();
    handle?.close();
    expect(a).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(getHubCardCount()).toBe(0);
    expect(el?.classList.contains('qpm-alert-card--exit')).toBe(true);
    finishExit(el);
    expect(el?.isConnected).toBe(false);
    expect(root()).toBeNull();
  });

  it('a keepOpen action runs without closing the card', () => {
    const a = vi.fn();
    const { onClose, handle } = present({ actions: [{ label: 'Next', onClick: a, keepOpen: true }] });
    const btn = hubCardEl()?.querySelector<HTMLButtonElement>('.qpm-alert-card__actions button');
    btn?.click();
    btn?.click();
    expect(a).toHaveBeenCalledTimes(2);
    expect(onClose).not.toHaveBeenCalled();
    expect(getHubCardCount()).toBe(1);
    handle?.close();
  });

  it('the close button and closeAllHubCards close cards and call onClose', () => {
    const first = present();
    hubCardEl()?.querySelector<HTMLButtonElement>('.qpm-alert-card__close')?.click();
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
