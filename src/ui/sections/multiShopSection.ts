import {
  ensureShopChoiceConfigs, getShopLayoutPreview, isMultiShopEnabled, listShopChoices, onShopChoicesChange, resetShopLayout,
  setShopsEnabled, toggleShopChoice, type ShopChoice,
} from '../../features/multiShop';
import { t } from '../../i18n';
import { getAllWeatherDefsSafe } from '../../utils/game/catalogHelpers';
import { classifyWeatherFromLabel } from '../../utils/game/weatherDetection';
import type { CardIcon, ExpandableCardConfig } from '../hub/cards/types';
import { shopSprite } from '../input/keybindsWindow/labels';
import { createPanelsCard, createPanelsSection, type PanelChoice, type PanelsCardSpec } from './panelsCard';
import type { SectionHandle } from './sectionLayout';

const SHOP_ICON = 'sprite/ui/IconShop';
// eslint-disable-next-line qpm/no-emoji-in-ui -- CardIcon fallback while sprites load, as the Storage panels card.
const ICON: CardIcon = { kind: 'sprite', value: '🛒', spriteKey: SHOP_ICON, fallback: '🛒' };

/** The weather's own icon from the weather catalog, as the game marks a weather shop (beta actionHud/actionLabels.ts:213-232). */
function weatherSprite(kind: string): string | null {
  const def = getAllWeatherDefsSafe().find(d => classifyWeatherFromLabel(d.id) === kind || classifyWeatherFromLabel(d.name) === kind);
  return def?.spriteKey ?? null;
}

function toPanelChoice(choice: ShopChoice): PanelChoice {
  const closed = choice.status === 'closed';
  return {
    id: choice.name,
    title: choice.title,
    spriteKey: shopSprite(choice.name) ?? (choice.weather ? weatherSprite(choice.weather) : null) ?? SHOP_ICON,
    picked: choice.picked,
    value: closed ? t('feature.multiShop.card.closedNow') : null,
    valueMuted: closed,
  };
}

const SPEC: PanelsCardSpec = {
  key: 'multiShop',
  attr: 'mshop',
  detachId: 'config-multi-shop',
  icon: ICON,
  text: {
    title: 'feature.multiShop.card.title',
    caption: 'feature.multiShop.card.caption',
    listTitle: 'feature.multiShop.card.shopsTitle',
    listHelp: 'feature.multiShop.card.shopsHelp',
    lastPicked: 'feature.multiShop.card.lastPicked',
    empty: 'feature.multiShop.card.loading',
    summaryOne: 'feature.multiShop.card.summaryOne',
    summaryMany: 'feature.multiShop.card.summaryMany',
  },
  // The registry action ids from features/input/keybinds/multiShop.ts.
  keyRows: [
    { actionId: 'multiShop', label: 'feature.multiShop.keyToggle' },
    { actionId: 'multiShopReset', label: 'feature.multiShop.keyReset' },
  ],
  toggleActionId: 'multiShop',
  isEnabled: isMultiShopEnabled,
  setEnabled: setShopsEnabled,
  choices: () => listShopChoices().map(toPanelChoice),
  toggle: toggleShopChoice,
  preview: () => getShopLayoutPreview(),
  reset: () => { resetShopLayout(); },
  onChange: onShopChoicesChange,
  // Picked and not closed right now: what the key would open.
  summaryCount: () => listShopChoices().filter(c => c.picked && c.status !== 'closed').length,
  // Plan U3, only while the feature is on: switched off it leaves the game alone. Switching on repaints, so it reads then.
  beforeRender: () => { if (isMultiShopEnabled()) ensureShopChoiceConfigs(); },
};

export function createMultiShopSection(): SectionHandle {
  return createPanelsSection(SPEC);
}

export function getMultiShopCard(): ExpandableCardConfig {
  return createPanelsCard(SPEC);
}
