export type UnknownRecord = Record<string, unknown>;

export type ActivityLogEntry = {
  timestamp: number;
  action?: string | null;
  parameters?: unknown;
  [key: string]: unknown;
};

export type ActionKey =
  | 'all'
  | 'found'
  | 'buy'
  | 'sell'
  | 'harvest'
  | 'plant'
  | 'feed'
  | 'hatch'
  | 'water'
  | 'coinFinder'
  | 'seedFinder'
  | 'double'
  | 'eggGrowth'
  | 'plantGrowth'
  | 'granter'
  | 'kisser'
  | 'refund'
  | 'boost'
  | 'remove'
  | 'storage'
  | 'travel'
  | 'other'
  | string;

export type TypeFilter =
  | 'all'
  | 'purchase'
  | 'sell'
  | 'feed'
  | 'plant'
  | 'harvest'
  | 'hatch'
  | 'boost'
  | 'travel'
  | 'storage'
  | 'other';

export type OrderFilter = 'newest' | 'oldest';

export interface FilterState {
  action: ActionKey;
  type: TypeFilter;
  order: OrderFilter;
  petSpecies: string;
  plantSpecies: string;
}

export interface ModalRef {
  root: HTMLElement;
  content: HTMLElement;
  list: HTMLElement;
}

export interface ModalHandles extends ModalRef {
  toolbar: HTMLElement;
  typeSelect: HTMLSelectElement;
  orderSelect: HTMLSelectElement;
  petDropdown: SpeciesDropdownHandle;
  plantDropdown: SpeciesDropdownHandle;
  summary: HTMLElement;
  ariesFilterPresent: boolean;
  scrollHost: HTMLElement;
  scrollTargets: HTMLElement[];
  listObserver: MutationObserver;
  listScrollListener: EventListener;
  listClickCaptureListener: EventListener;
  refreshQueued: boolean;
  refreshTimer: number | null;
  speciesOptionsReady: boolean;
}

export interface SpeciesDropdownHandle {
  root: HTMLElement;
  button: HTMLButtonElement;
  menu: HTMLElement;
  setValue(value: string): void;
  getValue(): string;
  setOptions(options: SpeciesDropdownOption[]): void;
  destroy(): void;
}

export interface SpeciesDropdownOption {
  value: string;
  label: string;
  iconUrl: string | null;
}

export interface RowMetadata {
  row: HTMLElement;
  action: ActionKey;
  type: TypeFilter;
  petFilterKey: string | null;
  plantFilterKey: string | null;
}

export interface SpeciesLookupEntry {
  value: string;
  label: string;
  matchKey: string;
  matchKeys: string[];
  iconUrl: string | null;
  categoryRank: number;
  rarityRank: number;
  priceRank: number;
  shopRank: number;
}

export type HistoryEnvelope = {
  version: 1;
  savedAt: number;
  count: number;
  firstTimestamp: number;
  lastTimestamp: number;
  checksum: number;
  entries: ActivityLogEntry[];
};

export interface HistorySpeciesContext {
  messageToPet: Map<string, string>;
  messageToPlant: Map<string, string>;
  petNameAliases: Array<{ aliasKey: string; speciesKey: string }>;
}

export type StringField = {
  path: string;
  value: string;
};
