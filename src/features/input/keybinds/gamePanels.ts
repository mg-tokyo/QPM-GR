// Game panel actions (INP-1 D2). Rows exist only for ids in the game's own panel list (PD2); the bag needs no id.

import { getGamePanelIds, getStoragePanelIds } from '../../../catalogs/logic/gamePanelsCatalog';
import { getShopWeatherKind, getWeatherShopIds } from '../../../store/shopRegistry';
import { getWeatherSnapshot } from '../../../store/weatherHub';
import { showToast } from '../../../ui/components';
import { t } from '../../../i18n';
import { toggleBag, toggleGameModal } from '../gameModal';
import type { RunnableAction } from './types';

export type GameAction = RunnableAction;

// Panels with no runtime list of their own (D2); each shows only when the game's panel list holds it (PD2).
const NAMED_PANELS = ['journal', 'dailyQuests', 'weatherStation'] as const;

/**
 * The shop the running weather opens, as the game picks it (beta deriveAvailableActions.ts:102-108,677-680):
 * weather → its registry shop → that shop's panel id, which must be in the game's panel list.
 */
export function resolveWeatherShopPanel(
  weather: string,
  shopIds: readonly string[],
  weatherOf: (shopId: string) => string | null,
  panelIds: readonly string[],
): string | null {
  if (weather === 'sunny' || weather === 'unknown') return null;
  const shop = shopIds.find(id => weatherOf(id) === weather);
  if (!shop) return null;
  return [`${shop}Shop`, shop].find(id => panelIds.includes(id)) ?? null;
}

async function openWeatherShop(): Promise<void> {
  const panel = resolveWeatherShopPanel(
    getWeatherSnapshot().kind, getWeatherShopIds(), getShopWeatherKind, getGamePanelIds() ?? [],
  );
  if (!panel) {
    showToast(t('feature.keybinds.noWeatherShop'));
    return;
  }
  await toggleGameModal(panel);
}

function panelAction(panelId: string): GameAction {
  return { id: `panel:${panelId}`, section: 'gamePanels', panelId, run: () => toggleGameModal(panelId) };
}

export function buildGameActions(
  panelIds: readonly string[] | null = getGamePanelIds(),
  storageIds: readonly string[] | null = getStoragePanelIds(),
): GameAction[] {
  const actions: GameAction[] = [{ id: 'bag', section: 'gamePanels', run: toggleBag }];
  if (!panelIds) return actions;
  const panels = [...(storageIds ?? []), ...NAMED_PANELS].filter(id => panelIds.includes(id));
  for (const id of new Set(panels)) actions.push(panelAction(id));
  actions.push({ id: 'weatherShop', section: 'shops', run: openWeatherShop });
  return actions;
}
