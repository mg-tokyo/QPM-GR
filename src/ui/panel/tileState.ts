// src/ui/panel/tileState.ts
import { storage } from '../../utils/storage';

const STORAGE_KEY = 'qpm.home-tiles.v1';

export interface TileConfig {
  tiles: Array<{ id: string; order: number }>;
}

const DEFAULT_TILE_IDS = ['pet-teams', 'shop-restock', 'public-rooms', 'journal-checker'];

function defaultConfig(): TileConfig {
  return { tiles: DEFAULT_TILE_IDS.map((id, i) => ({ id, order: i })) };
}

let cached: TileConfig | null = null;

function load(): TileConfig {
  if (cached) return cached;
  const raw = storage.get<TileConfig | null>(STORAGE_KEY, null);
  if (raw && Array.isArray(raw.tiles) && raw.tiles.length > 0) {
    cached = raw;
  } else {
    cached = defaultConfig();
    save();
  }
  return cached;
}

function save(): void {
  if (!cached) return;
  storage.set(STORAGE_KEY, cached);
}

export function getTileIds(): string[] {
  const config = load();
  return config.tiles
    .slice()
    .sort((a, b) => a.order - b.order)
    .map(t => t.id);
}

export function addTile(id: string): void {
  const config = load();
  if (config.tiles.some(t => t.id === id)) return;
  const maxOrder = config.tiles.reduce((max, t) => Math.max(max, t.order), -1);
  config.tiles.push({ id, order: maxOrder + 1 });
  save();
}

export function removeTile(id: string): void {
  const config = load();
  config.tiles = config.tiles.filter(t => t.id !== id);
  save();
}

export function reorderTiles(orderedIds: string[]): void {
  const config = load();
  config.tiles = orderedIds.map((id, i) => ({ id, order: i }));
  save();
}

export function isTileAdded(id: string): boolean {
  return load().tiles.some(t => t.id === id);
}

export function resetTilesToDefault(): void {
  cached = defaultConfig();
  save();
}
