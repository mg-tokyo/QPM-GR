import { t } from '../../../i18n';
import { buildBalloonIconCanvas } from './balloonIcon';
import { getBalloonDef } from '../data/balloonDefs';
import { isBossRound } from '../data/waveDefs';
import { getWaveFor } from '../engine/waves';
import { onMatchChange, getMatchSnapshot } from '../state';
import type { BalloonId, BalloonModifier, MatchSnapshot, SpawnGroup, WaveDef } from '../types';

interface TallyRow {
  readonly count: number;
  readonly hasCamo: boolean;
  readonly hasRegen: boolean;
}

export function mountNextRoundPanel(host: HTMLElement): () => void {
  const cleanups: Array<() => void> = [];

  const root = document.createElement('div');
  root.className = 'qpm-td-next-round-panel';
  root.hidden = true;

  const titleEl = document.createElement('div');
  titleEl.className = 'qpm-td-next-round-title';
  const list = document.createElement('div');
  list.className = 'qpm-td-next-round-list';
  const warningsHost = document.createElement('div');
  warningsHost.className = 'qpm-td-next-round-warnings';
  warningsHost.hidden = true;
  root.append(titleEl, list, warningsHost);
  host.appendChild(root);

  function render(snap: MatchSnapshot): void {
    const round = upcomingRound(snap);
    if (round <= 0) {
      root.hidden = true;
      return;
    }
    const wave = getWaveFor(round);
    const totals = tallyGroups(wave.groups);
    if (totals.size === 0) {
      root.hidden = true;
      return;
    }
    root.hidden = false;
    titleEl.textContent = t('feature.towerDefense.nextRoundPreview', { round });
    list.replaceChildren();
    for (const [kind, row] of totals) {
      list.appendChild(buildRow(kind, row));
    }
    const warnings = deriveWarnings(round, wave);
    warningsHost.replaceChildren();
    warningsHost.hidden = warnings.length === 0;
    for (const w of warnings) {
      const line = document.createElement('div');
      line.className = 'qpm-td-next-round-warning';
      line.textContent = w;
      warningsHost.appendChild(line);
    }
  }

  render(getMatchSnapshot());
  cleanups.push(onMatchChange(render));

  return () => {
    for (const c of cleanups.splice(0)) {
      try { c(); } catch { /* teardown must not throw */ }
    }
    try { root.remove(); } catch { /* already gone */ }
  };
}

function upcomingRound(snap: MatchSnapshot): number {
  switch (snap.phase) {
    case 'idle':
      return 1;
    case 'preRound':
      return snap.round;
    case 'inRound':
      return snap.round + 1;
    default:
      return 0;
  }
}

function tallyGroups(groups: readonly SpawnGroup[]): Map<BalloonId, TallyRow> {
  const totals = new Map<BalloonId, TallyRow>();
  for (const g of groups) {
    const existing = totals.get(g.kind) ?? { count: 0, hasCamo: false, hasRegen: false };
    const hasCamo = existing.hasCamo || (g.modifiers?.includes('camo') ?? false);
    const hasRegen = existing.hasRegen || (g.modifiers?.includes('regen') ?? false);
    totals.set(g.kind, { count: existing.count + g.count, hasCamo, hasRegen });
  }
  return totals;
}

// Teaching warnings fire only when a balloon kind or modifier DEBUTS relative
// to the immediately prior round — keeps preview signal fresh instead of a
// lifetime tutorial. Skipped for round 1 (no prior round to compare against).
function deriveWarnings(round: number, wave: WaveDef): readonly string[] {
  if (round < 2) return [];
  const prevWave = getWaveFor(round - 1);
  const prevKinds = new Set(prevWave.groups.map((g) => g.kind));
  const prevMods = new Set<BalloonModifier>();
  for (const g of prevWave.groups) for (const m of g.modifiers ?? []) prevMods.add(m);

  const warnings: string[] = [];
  const newKinds = new Set<BalloonId>();
  const newMods = new Set<BalloonModifier>();
  for (const g of wave.groups) {
    if (!prevKinds.has(g.kind)) newKinds.add(g.kind);
    for (const m of g.modifiers ?? []) if (!prevMods.has(m)) newMods.add(m);
  }
  if (newKinds.has('stoneTurtle'))     warnings.push(t('feature.towerDefense.warning.armorDebut'));
  if (newKinds.has('bronzeCapybara'))  warnings.push(t('feature.towerDefense.warning.miniBossDebut'));
  if (newKinds.has('goldMoab'))        warnings.push(t('feature.towerDefense.warning.bossDebut'));
  if (newKinds.has('rainbowTurtle') || newKinds.has('rainbowCapybara')) warnings.push(t('feature.towerDefense.warning.rainbowEliteDebut'));
  if (newKinds.has('goldTurtle') || newKinds.has('goldCapybara'))       warnings.push(t('feature.towerDefense.warning.goldEliteDebut'));
  if (newMods.has('camo'))             warnings.push(t('feature.towerDefense.warning.camoDebut'));
  if (newMods.has('regen'))            warnings.push(t('feature.towerDefense.warning.regenDebut'));
  if (isBossRound(round))              warnings.push(t('feature.towerDefense.warning.bossRound'));
  return warnings;
}

function buildRow(kind: BalloonId, row: TallyRow): HTMLElement {
  const rowEl = document.createElement('div');
  rowEl.className = 'qpm-td-next-round-row';

  const def = getBalloonDef(kind);
  const iconSlot = buildIcon(kind);
  rowEl.appendChild(iconSlot);

  const name = document.createElement('span');
  name.className = 'qpm-td-next-round-name';
  name.textContent = def.displayName;
  if (def.tint) name.style.color = def.tint;

  const countEl = document.createElement('span');
  countEl.className = 'qpm-td-next-round-count';
  countEl.textContent = `×${row.count}`;

  rowEl.append(name, countEl);
  if (row.hasCamo) {
    const badge = document.createElement('span');
    badge.className = 'qpm-td-next-round-badge';
    badge.textContent = t('feature.towerDefense.badge.camo');
    rowEl.appendChild(badge);
  }
  if (row.hasRegen) {
    const badge = document.createElement('span');
    badge.className = 'qpm-td-next-round-badge';
    badge.textContent = t('feature.towerDefense.badge.regen');
    rowEl.appendChild(badge);
  }
  return rowEl;
}

function buildIcon(kind: BalloonId): HTMLElement {
  const canvas = buildBalloonIconCanvas(kind, 'qpm-td-next-round-icon');
  if (canvas) return canvas;
  const fallback = document.createElement('div');
  fallback.className = 'qpm-td-next-round-icon';
  return fallback;
}
