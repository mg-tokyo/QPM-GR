/** Standard singular types, the 'weather' event pseudo-type, or any weather-gated shop id (dawn, snow, thunder, runtime-discovered). */
export type DetailShopType = 'seed' | 'egg' | 'decor' | 'tool' | 'weather' | (string & {});

export interface DetailWindowRegistryEntry {
  shopType: DetailShopType;
  itemId: string;
  itemName: string;
  updatedAt: number;
}

export type Tier = 'good' | 'warn' | 'bad' | 'none';

export interface RowData {
  timestamp: number;
  quantity:  number | null;
  predicted_next_ms: number | null;
  gapMs:     number | null;
  errorMs:   number | null;
}

export type MarkerPositionContext = 'between' | 'after-latest' | 'before-oldest';

export interface AlgorithmMarkerSlot {
  timestampMs: number;
  label: string;
  insertIdx: number;
  context: MarkerPositionContext;
  inserted: boolean;
}

export interface OverviewHandle {
  container: HTMLElement;
  setEventCount: (count: number, totalSightings?: number) => void;
  setAccuracyRate: (accuratePct: number, accurateCount: number, totalCount: number) => void;
  setLastSeen: (timestamp: number | null) => void;
  browseBtn: HTMLButtonElement;
  /** Tears down live subscriptions (pity row); call when the card leaves the DOM. */
  dispose: () => void;
}

export interface EventCardHandle {
  container: HTMLElement;
  update: (index: number) => void;
}
