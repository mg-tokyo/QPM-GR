import { readAtomValue } from '../../../core/atomRegistry';
import { getMyUserSlotIdx } from '../../../core/playerContext';
import { getTextureSwapperState } from '../../../features/standalone/textureSwapper';
import {
  buildPlayerTileMap,
  buildPlayerBoardwalkTileMap,
} from '../../../features/standalone/textureSwapper/pixi-walk';
import { stitchPlantSpriteDataUrl } from '../../../sprite-v2/stitcher';
import { getPetSpriteDataUrl, getAnySpriteDataUrl } from '../../../sprite-v2/compat';
import { t } from '../../../i18n';

const TILE_SIZE = 24;

interface TileInfo {
  species: string;
  objectType: string;
  slotCount: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function extractTileInfo(payload: unknown): TileInfo | null {
  if (!isRecord(payload)) return null;
  const objectType = typeof payload.objectType === 'string' ? payload.objectType : '';
  if (!objectType) return null;

  if (objectType === 'egg') {
    const eggId = typeof payload.eggId === 'string' ? payload.eggId : '';
    return eggId ? { species: eggId, objectType, slotCount: 0 } : null;
  }

  if (objectType === 'decor') {
    const decorId = typeof payload.decorId === 'string' ? payload.decorId : '';
    return decorId ? { species: decorId, objectType, slotCount: 0 } : null;
  }

  const slots = Array.isArray(payload.slots) ? payload.slots : [];
  const primary = isRecord(slots[0]) ? slots[0] : null;
  const species = typeof primary?.species === 'string' ? primary.species
    : typeof primary?.plant === 'string' ? primary.plant
    : '';
  return species ? { species, objectType, slotCount: slots.length } : null;
}

const spriteUrlCache = new Map<string, string>();

function getTileSpriteUrl(info: TileInfo): string {
  const cacheKey = `${info.objectType}:${info.species}`;
  const cached = spriteUrlCache.get(cacheKey);
  if (cached != null) return cached;

  let url = '';
  if (info.objectType === 'plant') {
    url = stitchPlantSpriteDataUrl({ species: info.species, fullGrowth: true, size: 48 });
  } else if (info.objectType === 'egg') {
    url = getPetSpriteDataUrl(info.species);
  } else if (info.objectType === 'decor') {
    url = getAnySpriteDataUrl(`sprite/decor/${info.species}`);
  }
  spriteUrlCache.set(cacheKey, url);
  return url;
}

function tileColor(objectType: string): string {
  switch (objectType) {
    case 'egg': return 'rgba(255,200,100,0.15)';
    case 'plant': return 'rgba(100,200,100,0.12)';
    case 'decor': return 'rgba(180,140,255,0.12)';
    default: return 'rgba(150,150,200,0.1)';
  }
}

interface BuildCellOpts {
  info: TileInfo | null;
  worldKey: string;
  isScoped: boolean;
  titleLabel: string;
  highlightSpecies: string | undefined;
  onPick: (tileKey: string, species: string, objectType: string, liveSlotCount: number) => void;
}

function buildTileCell(opts: BuildCellOpts): HTMLDivElement {
  const cell = document.createElement('div');
  cell.style.cssText = `width:${TILE_SIZE}px;height:${TILE_SIZE}px;border-radius:3px;border:1px solid rgba(255,255,255,0.04);position:relative;background-size:contain;background-position:center;background-repeat:no-repeat;`;

  const info = opts.info;
  if (!info) {
    cell.style.background = 'rgba(255,255,255,0.03)';
    return cell;
  }

  cell.style.backgroundColor = tileColor(info.objectType);

  const spriteUrl = getTileSpriteUrl(info);
  if (spriteUrl) {
    cell.style.backgroundImage = `url(${spriteUrl})`;
  }

  if (opts.isScoped) {
    cell.style.border = '1px solid var(--qpm-accent)';
    cell.style.boxShadow = '0 0 4px rgba(143,130,255,0.5)';
  }

  if (opts.highlightSpecies && opts.highlightSpecies !== info.species) {
    cell.style.opacity = '0.25';
    cell.style.pointerEvents = 'none';
  } else {
    cell.style.cursor = 'pointer';
    const { species, objectType, slotCount } = info;
    const worldKey = opts.worldKey;
    const onPick = opts.onPick;
    cell.addEventListener('click', () => onPick(worldKey, species, objectType, slotCount));
  }

  cell.title = `${opts.titleLabel} · ${info.species}`;
  return cell;
}

function buildEmptySpacer(): HTMLDivElement {
  const cell = document.createElement('div');
  cell.style.cssText = `width:${TILE_SIZE}px;height:${TILE_SIZE}px;`;
  return cell;
}

interface ReverseEntry {
  kind: 'dirt' | 'boardwalk';
  idx: string;
}

function parseWorldKey(worldKey: string): { x: number; y: number } | null {
  const comma = worldKey.indexOf(',');
  if (comma < 0) return null;
  const x = Number(worldKey.slice(0, comma));
  const y = Number(worldKey.slice(comma + 1));
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

export async function renderPickATileGarden(opts: {
  onPick: (tileKey: string, species: string, objectType: string, liveSlotCount: number) => void;
  highlightSpecies?: string;
}): Promise<HTMLElement> {
  const root = document.createElement('div');
  root.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:8px;padding:8px;';

  const myData = await readAtomValue('myData');
  const garden = isRecord(myData) && isRecord(myData.garden) ? myData.garden : null;
  const tileObjects = garden && isRecord(garden.tileObjects) ? garden.tileObjects : null;
  const boardwalkTileObjects = garden && isRecord(garden.boardwalkTileObjects)
    ? garden.boardwalkTileObjects : null;

  if (!tileObjects && !boardwalkTileObjects) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:16px;font-size:12px;opacity:0.6;text-align:center;';
    empty.textContent = t('feature.gardenPainter.pickATile.emptyGarden');
    root.appendChild(empty);
    return root;
  }

  const mySlotIdx = await getMyUserSlotIdx();
  const dirtWorldKeys = mySlotIdx != null ? buildPlayerTileMap(mySlotIdx) : new Map<string, string>();
  const boardwalkWorldKeys = mySlotIdx != null
    ? buildPlayerBoardwalkTileMap(mySlotIdx) : new Map<string, string>();

  const reverse = new Map<string, ReverseEntry>();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const consider = (worldKey: string) => {
    const p = parseWorldKey(worldKey);
    if (!p) return;
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  };
  for (const [idx, worldKey] of dirtWorldKeys) {
    reverse.set(worldKey, { kind: 'dirt', idx });
    consider(worldKey);
  }
  for (const [idx, worldKey] of boardwalkWorldKeys) {
    if (reverse.has(worldKey)) continue;
    reverse.set(worldKey, { kind: 'boardwalk', idx });
    consider(worldKey);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:16px;font-size:12px;opacity:0.6;text-align:center;';
    empty.textContent = t('feature.gardenPainter.pickATile.emptyGarden');
    root.appendChild(empty);
    return root;
  }

  const cols = maxX - minX + 1;
  const rows = maxY - minY + 1;

  const scopedTileKeys = new Set<string>();
  for (const r of getTextureSwapperState().rules) {
    if (r.scope?.kind === 'tile') scopedTileKeys.add(r.scope.tileKey);
  }

  const grid = document.createElement('div');
  grid.style.cssText = `display:grid;grid-template-columns:repeat(${cols}, ${TILE_SIZE}px);gap:1px;padding:4px;background:rgba(0,0,0,0.25);border-radius:var(--qpm-radius-md);`;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const worldKey = `${minX + col},${minY + row}`;
      const entry = reverse.get(worldKey);
      if (!entry) {
        grid.appendChild(buildEmptySpacer());
        continue;
      }
      const store = entry.kind === 'dirt' ? tileObjects : boardwalkTileObjects;
      const info = store ? extractTileInfo(store[entry.idx]) : null;
      const cell = buildTileCell({
        info,
        worldKey,
        isScoped: scopedTileKeys.has(worldKey),
        titleLabel: `#${entry.idx}`,
        highlightSpecies: opts.highlightSpecies,
        onPick: opts.onPick,
      });
      grid.appendChild(cell);
    }
  }

  root.appendChild(grid);
  return root;
}
