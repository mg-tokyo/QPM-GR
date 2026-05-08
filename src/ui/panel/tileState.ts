// src/ui/panel/tileState.ts
import { storage } from '../../utils/storage';

const STORAGE_KEY = 'qpm.home-tiles.v3';
const DEFAULT_LAYOUT_VERSION = 1;

export interface TileConfig {
  rows: string[][];
  tiles?: Array<{ id: string; order: number }>;
  layoutVersion?: number;
  updatedAt?: number;
}

const DEFAULT_TILE_ROWS = [
  ['pet-teams'],
  ['public-rooms'],
  ['locker', 'crop-calculator'],
  ['ability-tracker', 'xp-tracker'],
  ['shop-restock', 'garden-stats'],
];

function pairIds(ids: string[]): string[][] {
  const rows: string[][] = [];
  for (let i = 0; i < ids.length; i += 2) {
    rows.push(ids.slice(i, i + 2));
  }
  return rows;
}

function defaultConfig(): TileConfig {
  return {
    rows: DEFAULT_TILE_ROWS.map(row => [...row]),
    layoutVersion: DEFAULT_LAYOUT_VERSION,
    updatedAt: Date.now(),
  };
}

function normalizeRows(rows: unknown): string[][] {
  if (!Array.isArray(rows)) return [];
  const out: string[][] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    let nextRow: string[] = [];
    for (const id of row) {
      if (typeof id !== 'string' || seen.has(id)) continue;
      nextRow.push(id);
      seen.add(id);
      if (nextRow.length === 2) {
        out.push(nextRow);
        nextRow = [];
      }
    }
    if (nextRow.length > 0) out.push(nextRow);
  }
  return out;
}

function normalizeConfig(raw: TileConfig | null): TileConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const updatedAt = typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0;
  const rows = normalizeRows(raw.rows);
  if (rows.length > 0) return { rows, layoutVersion: DEFAULT_LAYOUT_VERSION, updatedAt };
  if (Array.isArray(raw.tiles) && raw.tiles.length > 0) {
    const ids = raw.tiles
      .slice()
      .sort((a, b) => a.order - b.order)
      .map(t => t.id)
      .filter((id): id is string => typeof id === 'string');
    if (ids.length > 0) return { rows: pairIds(ids), layoutVersion: DEFAULT_LAYOUT_VERSION, updatedAt };
  }
  return null;
}

let cached: TileConfig | null = null;

function load(): TileConfig {
  if (cached) return cached;
  const normalized = normalizeConfig(storage.get<TileConfig | null>(STORAGE_KEY, null));
  if (normalized) {
    cached = normalized;
    save();
  } else {
    cached = defaultConfig();
    save();
  }
  return cached;
}

function save(): void {
  if (!cached) return;
  cached.layoutVersion = DEFAULT_LAYOUT_VERSION;
  cached.updatedAt = Date.now();
  storage.set(STORAGE_KEY, cached);
}

export function getTileIds(): string[] {
  const config = load();
  return config.rows.flat();
}

export function getTileRows(): string[][] {
  return load().rows.map(row => [...row]);
}

export function addTile(id: string): void {
  const config = load();
  if (config.rows.some(row => row.includes(id))) return;
  config.rows.push([id]);
  save();
}

export function removeTile(id: string): void {
  const config = load();
  config.rows = config.rows
    .map(row => row.filter(tileId => tileId !== id))
    .filter(row => row.length > 0);
  save();
}

export function reorderTiles(orderedIds: string[]): void {
  const config = load();
  config.rows = pairIds(orderedIds);
  save();
}

export function isTileAdded(id: string): boolean {
  return load().rows.some(row => row.includes(id));
}

export function resetTilesToDefault(): void {
  cached = defaultConfig();
  save();
}

export type TileDropTarget =
  | { kind: 'tile'; targetId: string; side: 'before' | 'after' }
  | { kind: 'row'; anchorId: string | null; side: 'before' | 'after' };

function splitOverflow(rows: string[][], rowIndex: number): void {
  while (rows[rowIndex] && rows[rowIndex]!.length > 2) {
    const overflow = rows[rowIndex]!.splice(2);
    rows.splice(rowIndex + 1, 0, overflow);
    rowIndex += 1;
  }
}

export function moveTile(id: string, target: TileDropTarget): void {
  const config = load();
  if (!config.rows.some(row => row.includes(id))) return;

  let rows = config.rows
    .map(row => row.filter(tileId => tileId !== id))
    .filter(row => row.length > 0);

  if (target.kind === 'row') {
    const anchorIndex = target.anchorId
      ? rows.findIndex(row => row.includes(target.anchorId as string))
      : -1;
    const insertIndex = anchorIndex < 0
      ? rows.length
      : target.side === 'before'
        ? anchorIndex
        : anchorIndex + 1;
    rows.splice(insertIndex, 0, [id]);
    config.rows = rows;
    save();
    return;
  }

  const rowIndex = rows.findIndex(row => row.includes(target.targetId));
  if (rowIndex < 0) {
    rows.push([id]);
    config.rows = rows;
    save();
    return;
  }

  const row = rows[rowIndex]!;
  const slotIndex = row.indexOf(target.targetId);
  const insertIndex = target.side === 'before' ? slotIndex : slotIndex + 1;
  row.splice(insertIndex, 0, id);
  splitOverflow(rows, rowIndex);
  config.rows = rows;
  save();
}
