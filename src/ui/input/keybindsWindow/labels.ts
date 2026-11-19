import { myItemOf, toolIdOf, type KeybindActionInfo, type KeybindSection, type PanelLook, type ToolLook } from '../../../features/input/keybinds';
import type { MyItem } from '../../../features/input/selectItem';
import type { CardConfig, HubGroupDef } from '../../hub';
import { t } from '../../../i18n';

export type RowIcon =
  | { kind: 'sprite'; spriteKey: string }
  | { kind: 'card'; card: CardConfig }
  | { kind: 'team'; teamId: string }
  | { kind: 'none' };

export interface RowLook {
  name: string;
  /** Static line under the name (the weather shop rule). */
  hint?: string;
  icon: RowIcon;
}

export interface LookContext {
  cards: ReadonlyMap<string, CardConfig>;
  teamName(teamId: string): string | null;
  storageLook(panelId: string): PanelLook | null;
  toolLook(toolId: string): ToolLook;
  myItemLook(item: MyItem): ToolLook;
}

// literal-list-justified: QPM's own action ids (registry adapters, gamePanels.ts NAMED_PANELS); sprites are UI icons
// from the game atlas, a missing one falls back to a letter box.
const FIXED: Readonly<Record<string, { name: string; sprite: string; hint?: string }>> = {
  panel: { name: 'feature.keybinds.row.panel', sprite: 'sprite/ui/ArrowKeys' },
  'shop:seedShop': { name: 'feature.keybinds.row.seedShop', sprite: 'sprite/ui/SeedIconColor' },
  'shop:eggShop': { name: 'feature.keybinds.row.eggShop', sprite: 'sprite/ui/EggIconColor' },
  'shop:toolShop': { name: 'feature.keybinds.row.toolShop', sprite: 'sprite/ui/ToolIconColor' },
  'shop:decorShop': { name: 'feature.keybinds.row.decorShop', sprite: 'sprite/ui/DecorIconColor' },
  weatherShop: { name: 'feature.keybinds.row.weatherShop', sprite: 'sprite/ui/IconShop', hint: 'feature.keybinds.row.weatherShopHint' },
  bag: { name: 'feature.keybinds.row.bag', sprite: 'sprite/ui/InventoryBag' },
  'panel:journal': { name: 'feature.keybinds.row.journal', sprite: 'sprite/ui/JournalIconColor' },
  'panel:dailyQuests': { name: 'feature.keybinds.row.dailyQuests', sprite: 'sprite/ui/QuestIcon' },
  'panel:weatherStation': { name: 'feature.keybinds.row.weatherStation', sprite: 'sprite/ui/WeatherStationIcon' },
  multiStorage: { name: 'feature.multiStorage.card.keyToggle', sprite: 'sprite/ui/StorageButton' },
  multiStorageReset: { name: 'feature.multiStorage.card.resetLayout', sprite: 'sprite/ui/StorageButton' },
  multiShop: { name: 'feature.multiShop.keyToggle', sprite: 'sprite/ui/IconShop' },
  multiShopReset: { name: 'feature.multiShop.keyReset', sprite: 'sprite/ui/IconShop' },
  teamNext: { name: 'feature.keybinds.row.teamNext', sprite: 'sprite/ui/TeamIconColor' },
  teamPrev: { name: 'feature.keybinds.row.teamPrev', sprite: 'sprite/ui/TeamIconColor' },
  sellAll: { name: 'feature.keybinds.row.sellAll', sprite: 'sprite/ui/IconSell' },
};

export const KEYBINDS_SPRITE = FIXED.panel?.sprite ?? '';

/** The game's shop icon for a picker kind (same sprites as the shop rows). */
export function kindSprite(kind: 'seed' | 'egg' | 'decor'): string {
  return FIXED[`shop:${kind}Shop`]?.sprite ?? '';
}

/** The shop rows' icon for a shop window (`seedShop`); null for a shop without a row of its own. */
export function shopSprite(modalName: string): string | null {
  return FIXED[`shop:${modalName}`]?.sprite ?? null;
}

const SECTION_TITLES: Readonly<Record<KeybindSection, string>> = {
  general: 'feature.keybinds.section.general',
  windows: 'feature.keybinds.section.windows',
  shops: 'feature.keybinds.section.shops',
  gamePanels: 'feature.keybinds.section.gamePanels',
  tools: 'feature.keybinds.section.tools',
  myItems: 'feature.keybinds.section.myItems',
  pets: 'feature.keybinds.section.pets',
};

export const SECTION_ORDER = Object.keys(SECTION_TITLES) as KeybindSection[];

export function sectionTitle(section: KeybindSection): string {
  return t(SECTION_TITLES[section]);
}

export function cardsByKey(groups: ReadonlyArray<HubGroupDef>): Map<string, CardConfig> {
  const map = new Map<string, CardConfig>();
  for (const group of groups) for (const card of group.cards) if (!map.has(card.key)) map.set(card.key, card);
  return map;
}

function humanize(id: string): string {
  const words = id.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function describeAction(info: KeybindActionInfo, ctx: LookContext): RowLook {
  const fixed = FIXED[info.id];
  if (fixed) {
    const look: RowLook = { name: t(fixed.name), icon: { kind: 'sprite', spriteKey: fixed.sprite } };
    if (fixed.hint) look.hint = t(fixed.hint);
    return look;
  }
  if (info.id.startsWith('window:')) {
    const card = ctx.cards.get(info.id.slice('window:'.length));
    if (card) return { name: card.label, icon: { kind: 'card', card } };
  }
  const toolId = toolIdOf(info.id);
  const myItem = myItemOf(info.id);
  const bagLook = toolId !== null ? ctx.toolLook(toolId) : myItem !== null ? ctx.myItemLook(myItem) : null;
  if (bagLook) {
    return { name: bagLook.name, icon: bagLook.spriteKey ? { kind: 'sprite', spriteKey: bagLook.spriteKey } : { kind: 'none' } };
  }
  if (info.id.startsWith('feed:')) {
    const n = Number(info.id.slice('feed:'.length)) + 1;
    return { name: t('feature.keybinds.row.feed', { n }), icon: { kind: 'sprite', spriteKey: 'sprite/ui/TroughButton' } };
  }
  if (info.teamId !== undefined) {
    return { name: ctx.teamName(info.teamId) ?? t('feature.keybinds.row.team'), icon: { kind: 'team', teamId: info.teamId } };
  }
  if (info.panelId !== undefined) {
    const storage = ctx.storageLook(info.panelId);
    if (storage) return { name: storage.name, icon: storage.spriteKey ? { kind: 'sprite', spriteKey: storage.spriteKey } : { kind: 'none' } };
    return { name: humanize(info.panelId), icon: { kind: 'none' } };
  }
  return { name: humanize(info.id.replace(/^[a-z]+:/, '')), icon: { kind: 'none' } };
}
