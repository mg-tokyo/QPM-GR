import type { MatchSnapshot, Tower, TowerId, UpgradeTier } from '../types';
import { getMatchSnapshot, onMatchChange } from '../state';
import { getEffectiveStats } from '../engine/tower';
import { getTowerDef } from '../data/towerDefs';
import { getEffectiveRenderScale, resolveUpgradeSlot, type UpgradeSlot } from '../data/tierSlots';
import { stitchPlantSprite } from '../../../sprite-v2/stitcher';
import { renderBySpriteKey } from '../../../sprite-v2/compat';
import { createNamedLogger } from '../../../diagnostics/logger';
import { getDesign, onBindingsChanged, onLibraryChanged } from '../customDesigns/store';
import { buildCustomTowerContainer, type CustomTowerSpriteRecord } from '../customDesigns/mount/composite';
import { resolveTowerAnchor, resolveTowerSprite } from './towerAnchor';
import {
  getStageContainer,
  getStageGraphicsCtor,
  getStageSpriteCtor,
  getWorldPxPerTile,
  onStageContainerRecreated,
  tileToPixel,
  TD_Z_TOWER,
  TD_Z_UI,
} from './stage';
import { getSharedTexture } from './textureCache';

const log = createNamedLogger('td');

type PixiNode = Record<string, unknown>;
type ContainerNode = PixiNode & {
  addChild?: (child: PixiNode) => void;
  removeChild?: (child: PixiNode) => void;
};
type SpriteNode = PixiNode & {
  anchor?: { set: (x: number, y: number) => void };
  scale?: { set: (x: number, y: number) => void };
  position?: { set: (x: number, y: number) => void };
  tint?: number;
  alpha?: number;
  zIndex?: number;
  destroy?: (opts?: { children?: boolean; texture?: boolean }) => void;
};
type GraphicsNode = PixiNode & {
  rect?: (x: number, y: number, w: number, h: number) => GraphicsNode;
  circle?: (x: number, y: number, r: number) => GraphicsNode;
  fill?: (opts: { color: number; alpha?: number }) => GraphicsNode;
  stroke?: (opts: { color: number; alpha?: number; width: number }) => GraphicsNode;
  clear?: () => GraphicsNode;
  zIndex?: number;
  destroy?: (opts?: { children?: boolean; texture?: boolean }) => void;
};

const RANGE_STROKE_WIDTH = 4;
const RANGE_COLOR_NEUTRAL = 0xffffff;
const RANGE_COLOR_VALID = 0x4fd57c;
const RANGE_COLOR_INVALID = 0xff5a5a;
const GHOST_ALPHA = 0.55;

interface TowerSpriteRecord {
  sprite: SpriteNode;
  kind: TowerId;
  upgradesA: number;
  upgradesB: number;
}

type AnyTowerRecord = TowerSpriteRecord | CustomTowerSpriteRecord;

function isCustomRecord(r: AnyTowerRecord): r is CustomTowerSpriteRecord {
  return 'unmount' in r;
}

interface RenderState {
  unsubscribe: (() => void) | null;
  unsubscribeStage: (() => void) | null;
  unsubscribeBindings: (() => void) | null;
  unsubscribeLibrary: (() => void) | null;
  towerSprites: Map<string, AnyTowerRecord>;
  rangeCircle: GraphicsNode | null;
  // Exactly one of ghostSprite / ghostCustom is live while placing.
  ghostSprite: SpriteNode | null;
  ghostCustom: CustomTowerSpriteRecord | null;
  ghostKind: TowerId | null;
  ghostTileKey: string | null;
  ghostIsValid: boolean | null;
  ghostRangeCircle: GraphicsNode | null;
  lastSelectedId: string | null;
  lastContainer: ContainerNode | null;
}

let state: RenderState | null = null;

function buildTowerCanvas(kind: TowerId, upgradesA: number, upgradesB: number): HTMLCanvasElement | null {
  const sprite = resolveTowerSprite(kind, upgradesA, upgradesB);
  const mutations = sprite.mutations ? [...sprite.mutations] : [];
  if (sprite.kind === 'plant') {
    // Banana Grove grows visually with upgrades (plan T12 §1).
    // Cap raised to 8 for T4A Diamond Grove (extraLeafCountBonus).
    const activeSlotCount =
      kind === 'bananaGrove' ? Math.min(8, 3 + upgradesA + upgradesB) : undefined;
    // Banana Grove: T2A "Rainbow Grove" tints fruits rainbow (persists at higher A tiers).
    // T3+ swells fruits; T4+ swells them further (Diamond Grove / Grove Godhead payoff).
    let slotScaleMultiplier: number | undefined;
    if (kind === 'bananaGrove') {
      if (upgradesA >= 2 && !mutations.includes('Rainbow')) mutations.push('Rainbow');
      const topTier = Math.max(upgradesA, upgradesB);
      if (topTier >= 4) slotScaleMultiplier = 1.8;
      else if (topTier >= 3) slotScaleMultiplier = 1.4;
    }
    const base = { species: sprite.key, fullGrowth: true as const };
    const withSlots = activeSlotCount !== undefined ? { ...base, activeSlotCount } : base;
    const withMuts = mutations.length > 0 ? { ...withSlots, slotMutations: mutations } : withSlots;
    const withScale = slotScaleMultiplier !== undefined
      ? { ...withMuts, slotScaleMultiplier }
      : withMuts;
    const result = stitchPlantSprite(withScale);
    return result?.canvas ?? null;
  }
  return renderBySpriteKey(sprite.key, mutations);
}

function createSprite(texture: unknown, anchor: { x: number; y: number }): SpriteNode | null {
  const SpriteCtor = getStageSpriteCtor();
  if (!SpriteCtor) return null;
  let sprite: SpriteNode;
  try {
    sprite = new SpriteCtor(texture) as SpriteNode;
  } catch (err) {
    log.warn('QPM-TD-TOWER-002', { reason: 'sprite_ctor_failed' }, err);
    return null;
  }
  sprite.anchor?.set?.(anchor.x, anchor.y);
  return sprite;
}

function positionSprite(sprite: SpriteNode, tile: { x: number; y: number }): void {
  const p = tileToPixel(tile);
  sprite.position?.set?.(p.x, p.y);
}

function addTowerSprite(container: ContainerNode, tower: Tower): TowerSpriteRecord | null {
  const tex = getSharedTexture(
    `tower:${tower.kind}:${tower.upgradesA}:${tower.upgradesB}`,
    () => buildTowerCanvas(tower.kind, tower.upgradesA, tower.upgradesB),
  );
  if (!tex) return null;
  const sprite = createSprite(tex.texture, resolveTowerAnchor(tower.kind, tower.upgradesA, tower.upgradesB));
  if (!sprite) return null;
  const scale = getEffectiveRenderScale(tower.kind, tower.upgradesA, tower.upgradesB);
  sprite.scale?.set?.(scale, scale);
  positionSprite(sprite, tower.tile);
  // Y-sort within the tower tier: front-row towers (larger tile.y) draw above
  // back-row ones so neighbour overlap has a consistent front-to-back stacking
  // instead of arbitrary spawn-order stacking.
  sprite.zIndex = TD_Z_TOWER + tower.tile.y * 0.001;
  container.addChild?.(sprite);
  return { sprite, kind: tower.kind, upgradesA: tower.upgradesA, upgradesB: tower.upgradesB };
}

// Unbound towers MUST route through addTowerSprite unchanged so the vanilla
// render stays pixel-identical to pre-T15 behavior.
function addTowerRecord(container: ContainerNode, tower: Tower): AnyTowerRecord | null {
  const design = getDesign(tower.kind, tower.upgradesA as UpgradeTier, tower.upgradesB as UpgradeTier);
  if (design) return buildCustomTowerContainer(design, tower, container);
  return addTowerSprite(container, tower);
}

function destroyRecord(container: ContainerNode, record: TowerSpriteRecord): void {
  try {
    container.removeChild?.(record.sprite);
    record.sprite.destroy?.({ children: false, texture: false });
  } catch { /* ignore */ }
}

function destroyAnyRecord(container: ContainerNode, record: AnyTowerRecord): void {
  if (isCustomRecord(record)) { record.unmount(); return; }
  destroyRecord(container, record);
}

function repositionRecord(record: AnyTowerRecord, tile: { x: number; y: number }): void {
  if (isCustomRecord(record)) {
    const p = tileToPixel(tile);
    record.container.position?.set?.(p.x, p.y);
    return;
  }
  positionSprite(record.sprite, tile);
}

function findTowerById(id: string): Tower | null {
  return getMatchSnapshot().towers.find((t) => t.id === id) ?? null;
}

function drawRangeCircle(
  graphic: GraphicsNode,
  centerWorldPx: { x: number; y: number },
  rangeTiles: number,
  color: number,
): void {
  graphic.clear?.();
  const worldPx = getWorldPxPerTile();
  const radius = rangeTiles * worldPx;
  graphic.circle?.(centerWorldPx.x, centerWorldPx.y, radius)
    .stroke?.({ color, alpha: 0.85, width: RANGE_STROKE_WIDTH });
}

function ensureRangeCircle(container: ContainerNode): GraphicsNode | null {
  const s = state;
  if (!s) return null;
  if (s.rangeCircle) return s.rangeCircle;
  const GraphicsCtor = getStageGraphicsCtor();
  if (!GraphicsCtor) return null;
  let g: GraphicsNode;
  try {
    g = new GraphicsCtor();
  } catch {
    return null;
  }
  g.zIndex = TD_Z_UI;
  container.addChild?.(g);
  s.rangeCircle = g;
  return g;
}

function ensureGhostRangeCircle(container: ContainerNode): GraphicsNode | null {
  const s = state;
  if (!s) return null;
  if (s.ghostRangeCircle) return s.ghostRangeCircle;
  const GraphicsCtor = getStageGraphicsCtor();
  if (!GraphicsCtor) return null;
  let g: GraphicsNode;
  try {
    g = new GraphicsCtor();
  } catch {
    return null;
  }
  g.zIndex = TD_Z_UI;
  container.addChild?.(g);
  s.ghostRangeCircle = g;
  return g;
}

function hideRangeCircle(): void {
  const s = state;
  if (!s?.rangeCircle) return;
  s.rangeCircle.clear?.();
}

function hideGhostRangeCircle(): void {
  const s = state;
  if (!s?.ghostRangeCircle) return;
  s.ghostRangeCircle.clear?.();
}

function destroyGhostSprite(container: ContainerNode): void {
  const s = state;
  if (!s) return;
  if (!s.ghostSprite && !s.ghostCustom) return;
  if (s.ghostSprite) {
    try {
      container.removeChild?.(s.ghostSprite);
      s.ghostSprite.destroy?.({ children: false, texture: false });
    } catch { /* ignore */ }
  }
  s.ghostCustom?.unmount();
  s.ghostSprite = null;
  s.ghostCustom = null;
  s.ghostKind = null;
  s.ghostTileKey = null;
  s.ghostIsValid = null;
}

// Ghost mirrors addTowerRecord: bound design → same custom container the
// placed tower will use (so the preview IS the swapped asset), else vanilla.
function buildGhost(container: ContainerNode, kind: TowerId, tile: { x: number; y: number }): boolean {
  const s = state;
  if (!s) return false;
  const design = getDesign(kind, 0, 0);
  if (design) {
    const rec = buildCustomTowerContainer(
      design,
      { id: 'ghost', kind, tile, upgradesA: 0, upgradesB: 0 },
      container,
    );
    if (!rec) return false;
    rec.container.alpha = GHOST_ALPHA;
    s.ghostCustom = rec;
    return true;
  }
  const tex = getSharedTexture(
    `tower:${kind}:0:0`,
    () => buildTowerCanvas(kind, 0, 0),
  );
  if (!tex) return false;
  const sprite = createSprite(tex.texture, resolveTowerAnchor(kind, 0, 0));
  if (!sprite) return false;
  const scale = getTowerDef(kind).renderScale;
  if (scale !== undefined) sprite.scale?.set?.(scale, scale);
  sprite.alpha = GHOST_ALPHA;
  sprite.zIndex = TD_Z_TOWER + tile.y * 0.001;
  container.addChild?.(sprite);
  s.ghostSprite = sprite;
  return true;
}

function positionGhost(tile: { x: number; y: number }): void {
  const s = state;
  if (!s) return;
  if (s.ghostCustom) {
    const p = tileToPixel(tile);
    s.ghostCustom.container.position?.set?.(p.x, p.y);
  } else if (s.ghostSprite) {
    positionSprite(s.ghostSprite, tile);
  }
}

// Bindings/library changed while placing: drop the ghost so the next sync
// rebuilds it against the new design immediately (no stale-preview lag).
function refreshGhost(): void {
  const s = state;
  if (!s?.lastContainer || s.ghostKind === null) return;
  destroyGhostSprite(s.lastContainer);
  handleSnapshot(getMatchSnapshot());
}

function syncTowers(snap: MatchSnapshot, container: ContainerNode): void {
  const s = state;
  if (!s) return;
  const seen = new Set<string>();
  for (const tower of snap.towers) {
    seen.add(tower.id);
    const existing = s.towerSprites.get(tower.id);
    if (!existing) {
      const rec = addTowerRecord(container, tower);
      if (rec) s.towerSprites.set(tower.id, rec);
      continue;
    }
    if (existing.upgradesA !== tower.upgradesA || existing.upgradesB !== tower.upgradesB) {
      destroyAnyRecord(container, existing);
      s.towerSprites.delete(tower.id);
      const rec = addTowerRecord(container, tower);
      if (rec) s.towerSprites.set(tower.id, rec);
      continue;
    }
    // Defensive reposition every snapshot — protects against silent
    // position drift if any external transform changes under our container.
    repositionRecord(existing, tower.tile);
  }
  for (const [id, rec] of s.towerSprites) {
    if (!seen.has(id)) {
      destroyAnyRecord(container, rec);
      s.towerSprites.delete(id);
    }
  }
}

// Stage container was recreated (game rebuilt Camera subtree): our tracked
// sprites AND custom-tower containers live on the dead subtree. Drop map
// references WITHOUT removeChild (touching the dead container is pointless
// and can throw); syncTowers rebuilds on the fresh container next tick.
function resetSpritesAfterContainerRecreate(): void {
  const s = state;
  if (!s) return;
  log.warn('QPM-TD-TOWER-003', {
    reason: 'container_recreated_reset_sprites',
    towerCount: s.towerSprites.size,
  });
  s.towerSprites.clear();
  s.rangeCircle = null;
  s.ghostSprite = null;
  s.ghostCustom = null;
  s.ghostKind = null;
  s.ghostTileKey = null;
  s.ghostIsValid = null;
  s.ghostRangeCircle = null;
  s.lastSelectedId = null;
}

function syncSelected(snap: MatchSnapshot, container: ContainerNode): void {
  const s = state;
  if (!s) return;
  const id = snap.selectedTowerId;
  if (!id) {
    hideRangeCircle();
    s.lastSelectedId = null;
    return;
  }
  const tower = snap.towers.find((t) => t.id === id);
  if (!tower) {
    hideRangeCircle();
    s.lastSelectedId = null;
    return;
  }
  const g = ensureRangeCircle(container);
  if (!g) return;
  const stats = getEffectiveStats(tower);
  const centerPx = tileToPixel(tower.tile);
  drawRangeCircle(g, centerPx, stats.range, RANGE_COLOR_NEUTRAL);
  s.lastSelectedId = id;
}

function syncPending(snap: MatchSnapshot, container: ContainerNode): void {
  const s = state;
  if (!s) return;
  const p = snap.pendingPlacement;
  if (!p || !p.hoverTile) {
    destroyGhostSprite(container);
    hideGhostRangeCircle();
    return;
  }

  const tileKey = `${p.hoverTile.x},${p.hoverTile.y}`;
  // Ghost sprite: rebuild only on kind change. Reposition on tile change.
  // The pending tile changes at ~60Hz as the player walks; rebuilding a
  // stitched plant canvas every tick visibly lagged the ghost behind the
  // player (QPM-TD-TOWER-004, 2026-08-13).
  if (s.ghostKind !== p.kind || (!s.ghostSprite && !s.ghostCustom)) {
    destroyGhostSprite(container);
    if (!buildGhost(container, p.kind, p.hoverTile)) {
      hideGhostRangeCircle();
      return;
    }
    s.ghostKind = p.kind;
    s.ghostTileKey = null;
    s.ghostIsValid = null;
  }

  const tileChanged = s.ghostTileKey !== tileKey;
  if (tileChanged) {
    positionGhost(p.hoverTile);
    s.ghostTileKey = tileKey;
  }

  const validityChanged = s.ghostIsValid !== p.isValid;
  if (!tileChanged && !validityChanged && s.ghostRangeCircle) return;
  const g = ensureGhostRangeCircle(container);
  if (g) {
    const def = getTowerDef(p.kind);
    const centerPx = tileToPixel(p.hoverTile);
    const color = p.isValid ? RANGE_COLOR_VALID : RANGE_COLOR_INVALID;
    drawRangeCircle(g, centerPx, def.baseStats.range, color);
  }
  s.ghostIsValid = p.isValid;
}

function handleSnapshot(snap: MatchSnapshot): void {
  const s = state;
  if (!s) return;
  const container = getStageContainer() as ContainerNode | null;
  if (!container) return;
  if (s.lastContainer !== null && s.lastContainer !== container) {
    resetSpritesAfterContainerRecreate();
  }
  s.lastContainer = container;
  syncTowers(snap, container);
  syncSelected(snap, container);
  syncPending(snap, container);
}

function rebuildTower(container: ContainerNode, id: string, rec: AnyTowerRecord): void {
  const s = state;
  if (!s) return;
  const tower = findTowerById(id);
  destroyAnyRecord(container, rec);
  s.towerSprites.delete(id);
  if (!tower) return;
  const fresh = addTowerRecord(container, tower);
  if (fresh) s.towerSprites.set(id, fresh);
}

function rebuildAllTowers(): void {
  const s = state;
  if (!s?.lastContainer) return;
  for (const [id, rec] of Array.from(s.towerSprites.entries())) {
    rebuildTower(s.lastContainer, id, rec);
  }
}

function rebuildTowersMatching(cell: { kind: TowerId; slot: UpgradeSlot }): void {
  const s = state;
  if (!s?.lastContainer) return;
  for (const [id, rec] of Array.from(s.towerSprites.entries())) {
    const tower = findTowerById(id);
    if (!tower || tower.kind !== cell.kind) continue;
    const slot = resolveUpgradeSlot(tower.upgradesA as UpgradeTier, tower.upgradesB as UpgradeTier);
    if (slot !== cell.slot) continue;
    rebuildTower(s.lastContainer, id, rec);
  }
}

export function initTowerRender(): void {
  if (state) return;
  state = {
    unsubscribe: null,
    unsubscribeStage: null,
    unsubscribeBindings: null,
    unsubscribeLibrary: null,
    towerSprites: new Map(),
    rangeCircle: null,
    ghostSprite: null,
    ghostCustom: null,
    ghostKind: null,
    ghostTileKey: null,
    ghostIsValid: null,
    ghostRangeCircle: null,
    lastSelectedId: null,
    lastContainer: null,
  };
  state.unsubscribe = onMatchChange(handleSnapshot);
  // Rebuild sprites promptly on container recreation instead of waiting for
  // the next match-change snapshot.
  state.unsubscribeStage = onStageContainerRecreated(() => {
    handleSnapshot(getMatchSnapshot());
  });
  state.unsubscribeBindings = onBindingsChanged((cell) => {
    if (!cell) { rebuildAllTowers(); refreshGhost(); return; }
    rebuildTowersMatching(cell);
    if (cell.slot === 'base' && cell.kind === state?.ghostKind) refreshGhost();
  });
  state.unsubscribeLibrary = onLibraryChanged(() => { rebuildAllTowers(); refreshGhost(); });
  handleSnapshot(getMatchSnapshot());
}

export function stopTowerRender(): void {
  const s = state;
  if (!s) return;
  state = null;
  s.unsubscribe?.();
  s.unsubscribeStage?.();
  s.unsubscribeBindings?.();
  s.unsubscribeLibrary?.();
  const container = getStageContainer() as ContainerNode | null;
  if (container) {
    for (const rec of s.towerSprites.values()) destroyAnyRecord(container, rec);
    if (s.ghostSprite) {
      try {
        container.removeChild?.(s.ghostSprite);
        s.ghostSprite.destroy?.({ children: false, texture: false });
      } catch { /* ignore */ }
    }
    s.ghostCustom?.unmount();
    if (s.rangeCircle) {
      try {
        container.removeChild?.(s.rangeCircle);
        s.rangeCircle.destroy?.({ children: false, texture: false });
      } catch { /* ignore */ }
    }
    if (s.ghostRangeCircle) {
      try {
        container.removeChild?.(s.ghostRangeCircle);
        s.ghostRangeCircle.destroy?.({ children: false, texture: false });
      } catch { /* ignore */ }
    }
  }
  s.towerSprites.clear();
}
