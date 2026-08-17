import { t } from '../../../i18n';
import { renderBySpriteKey } from '../../../sprite-v2/compat';
import { stitchPlantSprite } from '../../../sprite-v2/stitcher';
import { ALL_TOWER_IDS, getTowerDef } from '../data/towerDefs';
import { beginPlacement, cancelPlacement } from '../engine/tower';
import { startRound } from '../engine/waves';
import { getMatchSnapshot, onMatchChange } from '../state';
import { tdPlay } from '../sounds';
import type { MatchSnapshot, TowerId } from '../types';
import { getDesign, onBindingsChanged, onLibraryChanged } from '../customDesigns/store';
import { renderDesignCanvas } from '../customDesigns/thumbnail';

const COIN_SPRITE_KEY = 'sprite/ui/Coin';
const HOTBAR_ICON_SIZE = 128;
// Must match .qpm-td-tower-icon width/height in ui/styles.ts.
const HOTBAR_ICON_BOX_PX = 64;

interface TowerButtonRefs {
  kind: TowerId;
  root: HTMLButtonElement;
  costValue: HTMLSpanElement;
  refreshIcon: () => void;
}

export function mountTowerBar(host: HTMLElement): () => void {
  const cleanups: Array<() => void> = [];

  const bar = document.createElement('div');
  bar.className = 'qpm-td-bar';

  const buttons: TowerButtonRefs[] = [];

  for (const kind of ALL_TOWER_IDS) {
    const refs = buildTowerButton(kind);
    buttons.push(refs);
    bar.appendChild(refs.root);
  }

  const spacer = document.createElement('div');
  spacer.className = 'qpm-td-bar-spacer';
  bar.appendChild(spacer);

  const nextRoundBtn = document.createElement('button');
  nextRoundBtn.type = 'button';
  nextRoundBtn.className = 'qpm-td-next-round';
  nextRoundBtn.textContent = t('feature.towerDefense.startNextRound');
  nextRoundBtn.addEventListener('click', () => { tdPlay('uiClick'); startRound(); });
  bar.appendChild(nextRoundBtn);

  host.appendChild(bar);

  function render(snap: MatchSnapshot): void {
    const pendingKind = snap.pendingPlacement?.kind ?? null;
    for (const b of buttons) {
      const def = getTowerDef(b.kind);
      const unaffordable = snap.cash < def.baseCost;
      b.root.disabled = unaffordable;
      b.root.classList.toggle('qpm-td-active', pendingKind === b.kind);
    }
    nextRoundBtn.hidden = snap.phase !== 'preRound';
  }

  render(getMatchSnapshot());
  const unsub = onMatchChange(render);
  cleanups.push(unsub);

  const refreshAllIcons = (): void => {
    for (const b of buttons) b.refreshIcon();
  };
  cleanups.push(onBindingsChanged((cell) => {
    if (!cell) { refreshAllIcons(); return; }
    if (cell.slot !== 'base') return;
    const target = buttons.find(b => b.kind === cell.kind);
    target?.refreshIcon();
  }));
  cleanups.push(onLibraryChanged(refreshAllIcons));

  return () => {
    for (const c of cleanups.splice(0)) {
      try { c(); } catch { /* teardown must not throw */ }
    }
    try { bar.remove(); } catch { /* already gone */ }
  };
}

function buildTowerButton(kind: TowerId): TowerButtonRefs {
  const def = getTowerDef(kind);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'qpm-td-tower-btn';

  const icon = buildIconSlot(kind);
  const name = document.createElement('span');
  name.className = 'qpm-td-tower-name';
  name.textContent = def.displayName;

  const cost = document.createElement('span');
  cost.className = 'qpm-td-tower-cost';
  const coinIcon = buildCoinIcon();
  if (coinIcon) cost.appendChild(coinIcon);
  const costValue = document.createElement('span');
  costValue.textContent = String(def.baseCost);
  cost.appendChild(costValue);

  const tip = buildTowerTip(kind);
  btn.append(icon.root, name, cost, tip);

  btn.addEventListener('click', () => {
    const snap = getMatchSnapshot();
    if (snap.pendingPlacement?.kind === kind) {
      cancelPlacement();
      return;
    }
    beginPlacement(kind);
  });

  attachTipClamp(btn, tip);

  return { kind, root: btn, costValue, refreshIcon: icon.refresh };
}

// Tip is CSS-positioned centered above its button; leftmost/rightmost buttons
// push it off-screen. Measure after CSS displays it (rAF), then shift the
// transform horizontally to keep it within an 8px viewport margin.
function attachTipClamp(btn: HTMLElement, tip: HTMLElement): void {
  const show = (): void => {
    requestAnimationFrame(() => {
      const rect = tip.getBoundingClientRect();
      if (rect.width === 0) return;
      const margin = 8;
      const vw = window.innerWidth;
      let shift = 0;
      if (rect.left < margin) shift = margin - rect.left;
      else if (rect.right > vw - margin) shift = (vw - margin) - rect.right;
      tip.style.transform = `translateX(calc(-50% + ${shift}px))`;
    });
  };
  const reset = (): void => { tip.style.removeProperty('transform'); };
  btn.addEventListener('mouseenter', show);
  btn.addEventListener('focus', show);
  btn.addEventListener('mouseleave', reset);
  btn.addEventListener('blur', reset);
}

function buildIconSlot(kind: TowerId): { root: HTMLElement; refresh: () => void } {
  const wrap = document.createElement('div');
  wrap.className = 'qpm-td-tower-icon';
  const refresh = (): void => {
    wrap.textContent = '';
    const canvas = buildTowerIconCanvas(kind);
    if (!canvas) return;
    canvas.className = 'qpm-td-tower-icon-canvas';
    fitCanvasToBox(canvas, HOTBAR_ICON_BOX_PX);
    wrap.appendChild(canvas);
  };
  refresh();
  return { root: wrap, refresh };
}

// Sprite canvases from sprite-v2 are sized to the UNTRIMMED atlas frame — often
// with transparent padding around the visible pixels (see drawSubRegion in
// src/sprite-v2/renderer.ts:339). CSS object-fit on <canvas> is unreliable
// across browsers, so we set display size explicitly in JS to preserve aspect.
function fitCanvasToBox(canvas: HTMLCanvasElement, box: number): void {
  const w = canvas.width || 1;
  const h = canvas.height || 1;
  const scale = Math.min(box / w, box / h);
  canvas.style.width = `${w * scale}px`;
  canvas.style.height = `${h * scale}px`;
}

function buildTowerIconCanvas(kind: TowerId): HTMLCanvasElement | null {
  const design = getDesign(kind, 0, 0);
  if (design) {
    const c = renderDesignCanvas(design.scene, HOTBAR_ICON_SIZE);
    if (c) return c;
  }
  const def = getTowerDef(kind);
  if (def.baseSprite.kind === 'plant') {
    const result = stitchPlantSprite({ species: def.baseSprite.key, fullGrowth: true });
    return result?.canvas ?? null;
  }
  return renderBySpriteKey(def.baseSprite.key);
}

function buildCoinIcon(): HTMLCanvasElement | null {
  const canvas = renderBySpriteKey(COIN_SPRITE_KEY);
  if (!canvas) return null;
  canvas.className = 'qpm-td-tower-cost-icon';
  return canvas;
}

function buildTowerTip(kind: TowerId): HTMLElement {
  const def = getTowerDef(kind);
  const stats = def.baseStats;

  const tip = document.createElement('div');
  tip.className = 'qpm-td-tower-tip';

  const title = document.createElement('div');
  title.className = 'qpm-td-tip-title';
  title.textContent = def.displayName;

  const desc = document.createElement('div');
  desc.className = 'qpm-td-tip-desc';
  desc.textContent = def.description;

  const grid = document.createElement('div');
  grid.className = 'qpm-td-tip-stats';

  addStatRow(grid, t('feature.towerDefense.stat.type'), damageTypeLabel(stats.damageType));

  if (Number.isFinite(stats.fireIntervalMs)) {
    addStatRow(grid, t('feature.towerDefense.stat.damage'), String(stats.damage));
    const shotsPerSec = 1000 / stats.fireIntervalMs;
    addStatRow(grid, 'Fire rate', `${shotsPerSec.toFixed(2)}/s`);
    addStatRow(grid, t('feature.towerDefense.stat.range'), formatRange(stats.range));
    addStatRow(grid, t('feature.towerDefense.stat.pierce'), String(stats.pierce));
    if (stats.splashRadius > 0) {
      addStatRow(grid, 'Splash', `${stats.splashRadius.toFixed(1)} tiles`);
    }
  }
  if (stats.incomePerRound > 0) {
    addStatRow(grid, 'Income', t('feature.towerDefense.incomePerRound', { amount: stats.incomePerRound }));
  }

  const cost = document.createElement('div');
  cost.className = 'qpm-td-tip-cost';
  cost.textContent = `$${def.baseCost}`;

  tip.append(title, desc, grid, cost);
  return tip;
}

function addStatRow(grid: HTMLElement, label: string, value: string): void {
  const l = document.createElement('span');
  l.className = 'qpm-td-tip-stat-label';
  l.textContent = label;
  const v = document.createElement('span');
  v.className = 'qpm-td-tip-stat-value';
  v.textContent = value;
  grid.append(l, v);
}

function formatRange(range: number): string {
  if (range >= 100) return 'Global';
  return `${range.toFixed(1)} tiles`;
}

function damageTypeLabel(type: string): string {
  switch (type) {
    case 'standard': return t('feature.towerDefense.damageType.standard');
    case 'explosive': return t('feature.towerDefense.damageType.explosive');
    case 'cold': return t('feature.towerDefense.damageType.cold');
    default: return type;
  }
}
