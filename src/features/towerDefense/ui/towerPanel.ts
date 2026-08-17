import { t } from '../../../i18n';
import { SELL_REFUND_RATIO } from '../constants';
import { getTowerDef } from '../data/towerDefs';
import type { TowerStats, UpgradeDef } from '../data/towerDefs';
import {
  buyUpgrade,
  getEffectiveStats,
  getUpgradeCost,
  isPathLocked,
  selectTower,
  sellTower,
  setTargetPriority,
} from '../engine/tower';
import { getMatchSnapshot, onMatchChange } from '../state';
import type { MatchSnapshot, TargetPriority, Tower, UpgradePath } from '../types';

const PRIORITY_ORDER: readonly TargetPriority[] = [
  'first',
  'last',
  'close',
  'strong',
  'lastTrack',
];

const PRIORITY_LABEL_KEYS: Record<TargetPriority, string> = {
  first: 'feature.towerDefense.targetPriority.first',
  last: 'feature.towerDefense.targetPriority.last',
  close: 'feature.towerDefense.targetPriority.close',
  strong: 'feature.towerDefense.targetPriority.strong',
  lastTrack: 'feature.towerDefense.targetPriority.lastTrack',
};

interface PathRefs {
  block: HTMLElement;
  currentEl: HTMLElement;
  btn: HTMLButtonElement;
  nameEl: HTMLSpanElement;
  costEl: HTMLSpanElement;
  maxedEl: HTMLElement;
}

interface PanelRefs {
  root: HTMLElement;
  title: HTMLElement;
  statRange: HTMLElement;
  statDamage: HTMLElement;
  statDps: HTMLElement;
  statPierce: HTMLElement;
  statType: HTMLElement;
  priorityValue: HTMLElement;
  priorityPrev: HTMLButtonElement;
  priorityNext: HTMLButtonElement;
  pathA: PathRefs;
  pathB: PathRefs;
  sellBtn: HTMLButtonElement;
}

export function mountTowerPanel(host: HTMLElement): () => void {
  const cleanups: Array<() => void> = [];

  const root = document.createElement('div');
  root.className = 'qpm-td-tower-panel';
  root.hidden = true;

  const header = document.createElement('div');
  header.className = 'qpm-td-panel-header';
  const title = document.createElement('div');
  title.className = 'qpm-td-panel-title';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'qpm-td-panel-close';
  closeBtn.textContent = '×';
  closeBtn.title = t('feature.towerDefense.closePanel');
  closeBtn.addEventListener('click', () => selectTower(null));
  header.append(title, closeBtn);

  const stats = document.createElement('div');
  stats.className = 'qpm-td-panel-stats';
  const statRange = buildStatRow(stats, t('feature.towerDefense.stat.range'));
  const statDamage = buildStatRow(stats, t('feature.towerDefense.stat.damage'));
  const statDps = buildStatRow(stats, t('feature.towerDefense.stat.dps'));
  const statPierce = buildStatRow(stats, t('feature.towerDefense.stat.pierce'));
  const statType = buildStatRow(stats, t('feature.towerDefense.stat.type'));

  const priorityRow = document.createElement('div');
  priorityRow.className = 'qpm-td-panel-priority';
  const priorityPrev = document.createElement('button');
  priorityPrev.type = 'button';
  priorityPrev.className = 'qpm-td-panel-priority-arrow';
  priorityPrev.textContent = '‹';
  const priorityValue = document.createElement('span');
  priorityValue.className = 'qpm-td-panel-priority-value';
  const priorityNext = document.createElement('button');
  priorityNext.type = 'button';
  priorityNext.className = 'qpm-td-panel-priority-arrow';
  priorityNext.textContent = '›';
  priorityRow.append(priorityPrev, priorityValue, priorityNext);

  // Panel-scoped mutable current-tower id so persistent button click handlers
  // can dispatch against the right tower without being re-bound each render.
  // A stable button element is required — otherwise the round-loop's ~60Hz
  // notify() would rebuild the button between mousedown and mouseup and drop
  // the click.
  let currentTowerId: string | null = null;

  const pathA = buildPathBlock('a', t('feature.towerDefense.upgradePathA'), () => currentTowerId);
  const pathB = buildPathBlock('b', t('feature.towerDefense.upgradePathB'), () => currentTowerId);

  const sellBtn = document.createElement('button');
  sellBtn.type = 'button';
  sellBtn.className = 'qpm-td-panel-sell';

  root.append(header, stats, priorityRow, pathA.block, pathB.block, sellBtn);
  host.appendChild(root);

  const refs: PanelRefs = {
    root,
    title,
    statRange,
    statDamage,
    statDps,
    statPierce,
    statType,
    priorityValue,
    priorityPrev,
    priorityNext,
    pathA,
    pathB,
    sellBtn,
  };

  function findSelected(snap: MatchSnapshot): Tower | null {
    const id = snap.selectedTowerId;
    if (id === null) return null;
    return snap.towers.find((tw) => tw.id === id) ?? null;
  }

  function render(snap: MatchSnapshot): void {
    const tower = findSelected(snap);
    if (!tower) {
      currentTowerId = null;
      root.hidden = true;
      return;
    }
    currentTowerId = tower.id;
    root.hidden = false;
    renderTower(refs, tower, snap);
  }

  priorityPrev.addEventListener('click', () => {
    const snap = getMatchSnapshot();
    const tower = findSelected(snap);
    if (!tower) return;
    setTargetPriority(tower.id, cyclePriority(tower.targetPriority, -1));
  });
  priorityNext.addEventListener('click', () => {
    const snap = getMatchSnapshot();
    const tower = findSelected(snap);
    if (!tower) return;
    setTargetPriority(tower.id, cyclePriority(tower.targetPriority, +1));
  });

  sellBtn.addEventListener('click', () => {
    const snap = getMatchSnapshot();
    const tower = findSelected(snap);
    if (!tower) return;
    sellTower(tower.id);
  });

  render(getMatchSnapshot());
  cleanups.push(onMatchChange(render));

  return () => {
    for (const c of cleanups.splice(0)) {
      try { c(); } catch { /* teardown must not throw */ }
    }
    try { root.remove(); } catch { /* already gone */ }
  };
}

function buildStatRow(host: HTMLElement, label: string): HTMLElement {
  const l = document.createElement('div');
  l.className = 'qpm-td-panel-stat-label';
  l.textContent = label;
  const v = document.createElement('div');
  v.className = 'qpm-td-panel-stat-value';
  v.textContent = '—';
  host.append(l, v);
  return v;
}

function renderTower(refs: PanelRefs, tower: Tower, snap: MatchSnapshot): void {
  const def = getTowerDef(tower.kind);
  const stats = getEffectiveStats(tower);

  refs.title.textContent = def.displayName;

  refs.statRange.textContent = formatRange(stats.range);
  refs.statDamage.textContent = String(stats.damage);
  refs.statDps.textContent = formatDps(stats);
  refs.statPierce.textContent = String(stats.pierce);
  refs.statType.textContent = formatDamageType(stats.damageType);

  refs.priorityValue.textContent = t(PRIORITY_LABEL_KEYS[tower.targetPriority]);

  updateUpgradePath(refs.pathA, tower, 'a', snap.cash);
  updateUpgradePath(refs.pathB, tower, 'b', snap.cash);

  const refund = Math.floor(tower.totalSpent * SELL_REFUND_RATIO);
  const hasT3 = tower.upgradesA >= 3 || tower.upgradesB >= 3;
  refs.sellBtn.textContent = hasT3
    ? t('feature.towerDefense.sellWithLockReset', { amount: refund })
    : t('feature.towerDefense.sell', { amount: refund });
}

function buildPathBlock(
  path: UpgradePath,
  headerLabel: string,
  getTowerId: () => string | null,
): PathRefs {
  const block = document.createElement('div');
  block.className = 'qpm-td-panel-upgrade';

  const header = document.createElement('div');
  header.className = 'qpm-td-panel-upgrade-header';
  header.textContent = headerLabel;

  const currentEl = document.createElement('div');
  currentEl.className = 'qpm-td-panel-upgrade-current';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'qpm-td-panel-upgrade-btn';
  const nameEl = document.createElement('span');
  const costEl = document.createElement('span');
  costEl.className = 'qpm-td-panel-upgrade-cost';
  btn.append(nameEl, costEl);
  btn.addEventListener('click', () => {
    const id = getTowerId();
    if (id !== null) buyUpgrade(id, path);
  });

  const maxedEl = document.createElement('div');
  maxedEl.className = 'qpm-td-panel-upgrade-maxed';
  maxedEl.textContent = t('feature.towerDefense.upgradeMaxed');
  maxedEl.hidden = true;

  block.append(header, currentEl, btn, maxedEl);
  return { block, currentEl, btn, nameEl, costEl, maxedEl };
}

function updateUpgradePath(
  refs: PathRefs,
  tower: Tower,
  path: UpgradePath,
  cash: number,
): void {
  const def = getTowerDef(tower.kind);
  const list = path === 'a' ? def.pathA : def.pathB;
  const tier = path === 'a' ? tower.upgradesA : tower.upgradesB;

  const currentUpgrade: UpgradeDef | undefined = tier > 0 ? list[tier - 1] : undefined;
  refs.currentEl.textContent = currentUpgrade ? currentUpgrade.name : t('feature.towerDefense.upgradeNone');

  const next = list[tier];
  if (!next) {
    refs.btn.hidden = true;
    refs.btn.disabled = true;
    refs.maxedEl.hidden = false;
    refs.maxedEl.textContent = t('feature.towerDefense.upgradeMaxed');
    refs.btn.classList.remove('qpm-td-panel-upgrade-locked');
    return;
  }

  // Path-lock: buying `next` would be T3 on this side, but the other path
  // has already committed to T3. Show the button as locked (spec §6.1).
  if (isPathLocked(tower, path)) {
    refs.btn.hidden = false;
    refs.btn.disabled = true;
    refs.btn.title = t('feature.towerDefense.pathLocked.tooltip');
    refs.nameEl.textContent = t('feature.towerDefense.pathLocked.label');
    refs.costEl.textContent = '';
    refs.btn.classList.add('qpm-td-panel-upgrade-locked');
    refs.maxedEl.hidden = true;
    return;
  }
  refs.btn.classList.remove('qpm-td-panel-upgrade-locked');

  refs.maxedEl.hidden = true;
  refs.btn.hidden = false;
  refs.btn.title = next.description;
  refs.nameEl.textContent = next.name;

  const cost = getUpgradeCost(tower, path);
  refs.costEl.textContent = cost !== null ? `$${cost}` : '';
  refs.btn.disabled = cost === null || cash < cost;
}

function cyclePriority(current: TargetPriority, delta: number): TargetPriority {
  const idx = PRIORITY_ORDER.indexOf(current);
  const safeIdx = idx < 0 ? 0 : idx;
  const nextIdx = (safeIdx + delta + PRIORITY_ORDER.length) % PRIORITY_ORDER.length;
  return PRIORITY_ORDER[nextIdx] ?? 'first';
}

function formatRange(range: number): string {
  if (!Number.isFinite(range)) return '∞';
  return range.toFixed(1);
}

function formatDps(stats: TowerStats): string {
  if (!Number.isFinite(stats.fireIntervalMs) || stats.fireIntervalMs <= 0) {
    if (stats.incomePerRound > 0) {
      return t('feature.towerDefense.incomePerRound', { amount: stats.incomePerRound });
    }
    return '—';
  }
  const shotsPerSec = 1000 / stats.fireIntervalMs;
  const dps = stats.damage * shotsPerSec * Math.max(1, stats.pierce);
  return dps.toFixed(1);
}

function formatDamageType(kind: TowerStats['damageType']): string {
  switch (kind) {
    case 'standard': return t('feature.towerDefense.damageType.standard');
    case 'explosive': return t('feature.towerDefense.damageType.explosive');
    case 'cold': return t('feature.towerDefense.damageType.cold');
    default: return String(kind);
  }
}
