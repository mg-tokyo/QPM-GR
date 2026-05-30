import type { ActionKey, TypeFilter, OrderFilter } from './types';

export const HISTORY_STORAGE_KEY = 'qpm.activityLog.history.v1';
export const HISTORY_BACKUP_STORAGE_KEY = 'qpm.activityLog.history.backup.v1';
export const HISTORY_META_STORAGE_KEY = 'qpm.activityLog.history.meta.v1';
export const FILTER_ACTION_STORAGE_KEY = 'qpm.activityLog.filter.action.v1';
export const FILTER_TYPE_STORAGE_KEY = 'qpm.activityLog.filter.type.v1';
export const FILTER_ORDER_STORAGE_KEY = 'qpm.activityLog.filter.order.v1';
export const FILTER_PET_SPECIES_STORAGE_KEY = 'qpm.activityLog.filter.petSpecies.v1';
export const FILTER_PLANT_SPECIES_STORAGE_KEY = 'qpm.activityLog.filter.plantSpecies.v1';
export const MIGRATION_STORAGE_KEY = 'qpm.activityLog.migration.v1';
export const SUMMARY_DEBUG_STORAGE_KEY = 'qpm.activityLog.debug.summary.v1';
export const ARIES_IMPORT_STORAGE_KEY = 'qpm.activityLog.ariesImport.v1';
export const ACTIVITY_LOG_ENABLED_STORAGE_KEY = 'qpm.activityLog.enabled.v1';

export const LEGACY_STORAGE_KEYS = [
  'qpm.activityLogEnhanced.entries.v3',
  'qpm.activityLogEnhanced.entries.v2',
  'qpm.activityLogEnhanced.entries.v1',
] as const;

export const HISTORY_LIMIT = 5000;
export const FAST_REPLAY_DELAY_MS = 24;
export const VIRTUAL_WINDOW_SIZE = 60;
export const VIRTUAL_SCROLL_THROTTLE_MS = 96;
export const VIRTUAL_DEFAULT_ROW_HEIGHT = 46;
export const VIRTUAL_SPACER_ATTR = 'data-qpm-activity-virtual-spacer';
export const VIRTUAL_SPACER_TOP = 'top';
export const VIRTUAL_SPACER_BOTTOM = 'bottom';
export const VIRTUAL_HIDDEN_LOAD_ATTR = 'data-qpm-activity-virtual-hidden-load';
export const VIRTUAL_CUSTOM_LOAD_ATTR = 'data-qpm-activity-virtual-load-button';
export const VIRTUAL_HYDRATE_CHUNK_MIN = 8;
export const VIRTUAL_HYDRATE_CHUNK_MAX = 40;
export const VIRTUAL_HYDRATE_NEAR_BOTTOM_PX = 260;
export const LARGE_LIST_REFRESH_THRESHOLD = 450;
export const LARGE_LIST_REFRESH_DELAY_MS = 72;
export const STYLE_ID = 'qpm-activity-log-native-style';
export const TOOLBAR_ATTR = 'data-qpm-activity-toolbar';
export const TITLE_SELECTOR = 'p.chakra-text';
export const NATIVE_LIST_SELECTOR = 'div.McFlex.css-iek5kf > div.McFlex';

export const ACTION_ORDER: ActionKey[] = [
  'all',
  'found',
  'buy',
  'sell',
  'harvest',
  'plant',
  'feed',
  'hatch',
  'water',
  'coinFinder',
  'seedFinder',
  'double',
  'eggGrowth',
  'plantGrowth',
  'granter',
  'kisser',
  'refund',
  'boost',
  'remove',
  'storage',
  'travel',
  'other',
];

export const ACTION_LABELS: Record<string, string> = {
  all: 'All',
  found: 'Finds',
  buy: 'Purchases',
  sell: 'Sold',
  harvest: 'Harvests',
  plant: 'Planted',
  feed: 'Feed',
  hatch: 'Hatch',
  water: 'Water',
  coinFinder: 'Coin Finder',
  seedFinder: 'Seed Finder',
  double: 'Double',
  eggGrowth: 'Egg Growth',
  plantGrowth: 'Plant Growth',
  granter: 'Granters',
  kisser: 'Kissers',
  refund: 'Refunds',
  boost: 'Boosts',
  remove: 'Remove',
  storage: 'Storage',
  travel: 'Travel',
  other: 'Other',
};

export const ACTION_MAP: Record<string, ActionKey> = {
  purchaseDecor: 'buy',
  purchaseSeed: 'buy',
  purchaseEgg: 'buy',
  purchaseTool: 'buy',
  waterPlant: 'water',
  plantSeed: 'plant',
  plantGardenPlant: 'plant',
  potPlant: 'plant',
  removeGardenObject: 'remove',
  harvest: 'harvest',
  feedPet: 'feed',
  plantEgg: 'hatch',
  hatchEgg: 'hatch',
  instaGrow: 'boost',
  customRestock: 'boost',
  spinSlotMachine: 'boost',
  sellAllCrops: 'sell',
  sellPet: 'sell',
  logItems: 'boost',
  mutationPotion: 'boost',
  ProduceScaleBoost: 'boost',
  ProduceScaleBoostII: 'boost',
  DoubleHarvest: 'double',
  DoubleHatch: 'double',
  ProduceEater: 'boost',
  SellBoostI: 'boost',
  SellBoostII: 'boost',
  SellBoostIII: 'boost',
  SellBoostIV: 'boost',
  ProduceRefund: 'boost',
  PlantGrowthBoost: 'plantGrowth',
  PlantGrowthBoostII: 'plantGrowth',
  SnowyPlantGrowthBoost: 'plantGrowth',
  HungerRestore: 'boost',
  HungerRestoreII: 'boost',
  SnowyHungerRestore: 'boost',
  GoldGranter: 'granter',
  RainbowGranter: 'granter',
  RainDance: 'granter',
  SnowGranter: 'granter',
  FrostGranter: 'granter',
  PetXpBoost: 'boost',
  PetXpBoostII: 'boost',
  SnowyPetXpBoost: 'boost',
  SnowyEggGrowthBoost: 'eggGrowth',
  EggGrowthBoost: 'eggGrowth',
  EggGrowthBoostII_NEW: 'eggGrowth',
  EggGrowthBoostII: 'eggGrowth',
  PetAgeBoost: 'boost',
  PetAgeBoostII: 'boost',
  CoinFinderI: 'coinFinder',
  CoinFinderII: 'coinFinder',
  CoinFinderIII: 'coinFinder',
  SnowyCoinFinder: 'coinFinder',
  SnowyCropSizeBoost: 'boost',
  SnowyHungerBoost: 'boost',
  SeedFinderI: 'seedFinder',
  SeedFinderII: 'seedFinder',
  SeedFinderIII: 'seedFinder',
  SeedFinderIV: 'seedFinder',
  PetHatchSizeBoost: 'boost',
  PetHatchSizeBoostII: 'boost',
  MoonKisser: 'kisser',
  DawnKisser: 'kisser',
  PetRefund: 'refund',
  PetRefundII: 'refund',
};

export const ACTION_MAP_LOWER: Record<string, ActionKey> = Object.fromEntries(
  Object.entries(ACTION_MAP).map(([key, value]) => [key.toLowerCase(), value]),
) as Record<string, ActionKey>;

export const TYPE_OPTIONS: Array<{ value: TypeFilter; label: string }> = [
  { value: 'all', label: 'Type: All' },
  { value: 'purchase', label: 'Type: Purchase' },
  { value: 'sell', label: 'Type: Sell' },
  { value: 'feed', label: 'Type: Feed' },
  { value: 'plant', label: 'Type: Plant' },
  { value: 'harvest', label: 'Type: Harvest' },
  { value: 'hatch', label: 'Type: Hatch' },
  { value: 'boost', label: 'Type: Boost' },
  { value: 'travel', label: 'Type: Travel' },
  { value: 'storage', label: 'Type: Storage' },
  { value: 'other', label: 'Type: Other' },
];

export const ORDER_OPTIONS: Array<{ value: OrderFilter; label: string }> = [
  { value: 'newest', label: 'Order: Newest' },
  { value: 'oldest', label: 'Order: Oldest' },
];

export const PATTERNS: Array<{ key: ActionKey; re: RegExp }> = [
  { key: 'found', re: /\bfound\b/i },
  { key: 'buy', re: /\b(bought|purchas(e|ed))\b/i },
  { key: 'sell', re: /\bsold\b/i },
  { key: 'harvest', re: /harvest/i },
  { key: 'water', re: /water(ed)?/i },
  { key: 'plant', re: /planted|potted/i },
  { key: 'feed', re: /\bfed\b/i },
  { key: 'hatch', re: /\bhatched?\b/i },
  { key: 'remove', re: /\b(remove|removed|delete)\b/i },
  { key: 'storage', re: /\b(storage|stored|retrieve|retrieved)\b/i },
  { key: 'travel', re: /\b(travel|teleport)\b/i },
  { key: 'coinFinder', re: /\b(coin\s*finder|coins?\s+found)\b/i },
  { key: 'seedFinder', re: /\b(seed\s*finder|seeds?\s+found)\b/i },
  { key: 'double', re: /\b(double\s+(harvest|hatch)|extra\s+(crop|pet))\b/i },
  { key: 'eggGrowth', re: /\b(egg\s*growth|hatch\s*time|hatch\s*speed)\b/i },
  { key: 'plantGrowth', re: /\b((plant|crop)\s*growth)\b/i },
  { key: 'granter', re: /\b(granter|granted|granting)\b/i },
  { key: 'kisser', re: /\b(kisser|kissed)\b/i },
  { key: 'refund', re: /\b(refund|refunded)\b/i },
  { key: 'boost', re: /\b(boost|potion|growth|restock|spin)\b/i },
];

export const RARITY_ORDER: Record<string, number> = {
  common: 0,
  uncommon: 1,
  rare: 2,
  legendary: 3,
  mythic: 4,
  mythical: 4,
  divine: 5,
  celestial: 6,
};
