import type { ErrorCodeDefinition } from '../types';

const V = '3.3.65';
const SUB = 'feature:multiShop';

export const MULTI_SHOP_CODES: readonly ErrorCodeDefinition[] = [
  {
    code: 'QPM-MSHOP-001', subsystem: SUB, category: 'feature', severity: 'warn',
    title: 'Multi-shop panels unavailable (game changed)',
    description: 'A part of the game\'s shop window that multi-shop builds on is missing or changed shape, so the shops were not opened. The normal shop windows are unaffected.',
    userAction: 'None needed. Report it if it persists after a game update.',
    devNotes: 'src/features/multiShop/quietBuild.ts checkModalHost() / checkShopView(), panelView.ts checkPanelView(), probe.ts checkSurface(); context.missing names the failed handles (\'modals.*\' for the modal host, \'shop-panels\' when the game shop list is unread, \'view.*\' for a built shop view, \'ui\' / \'renderer\' for what a view was built with). QPM_DEBUG_API.multiShop.state() shows the host check.',
    sinceVersion: V, notifyUser: false,
  },
  {
    code: 'QPM-MSHOP-002', subsystem: SUB, category: 'feature', severity: 'warn',
    title: 'Multi-shop panels failed to open',
    description: 'Opening several shop windows threw or the game\'s own shop window did not land in its panel, so everything was closed again.',
    userAction: 'None needed. The normal shop windows still work.',
    devNotes: 'src/features/multiShop/session.ts openShops(); context.stage is \'build\' (a copy or a host threw), \'first-panel\' (the real shop opened outside its host, unbound) or \'modal-write\'.',
    sinceVersion: V, notifyUser: false,
  },
  {
    code: 'QPM-MSHOP-003', subsystem: SUB, category: 'feature', severity: 'warn',
    title: 'Multi-shop panels opened without their move bar',
    description: 'The shops opened, but the bar to drag a shop by or its resize corner could not be built, so the shops stay where they opened.',
    userAction: 'None needed. Closing and reopening the shops tries again.',
    devNotes: 'src/features/multiStorage/chrome.ts createPanelChrome() with multiShop/shopChrome.ts; context.stage is \'kit\' (no plain PIXI sprite inside the shop hosts, or ui.toLocal / renderer.canvas missing), \'build\' (threw while dressing) or \'sync\' (the per-frame sync or a copy\'s removal threw; bar and grip were removed). QPM_DEBUG_API.multiShop.panels() shows decorated.',
    sinceVersion: V, notifyUser: false,
  },
];
