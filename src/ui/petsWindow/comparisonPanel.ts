// 3v3 team comparison panel (rendered inside the Manager tab).

import { getAbilityDefinition } from '../../data/petAbilities';
import { buildAbilityValuationContext, type AbilityValuationContext } from '../../features/abilityValuation';
import { formatCoinsAbbreviated } from '../../features/economy/valueCalculator';
import {
  buildTeamCompareProfile,
  captureProgressionStage,
  getAbilityFamilyKey,
  getOptimizerAbilityFamilyInfo,
  type ComparePetInput,
  type TeamCompareProfile,
} from '../../features/petCompareEngine';
import { buildCompareCardViewModel } from '../comparePresentation';
import { getTeamsConfig } from '../../store/petTeams';
import { getPetSpriteDataUrlWithMutations, isSpritesReady } from '../../sprite-v2/compat';
import { calculateMaxStrength } from '../../store/xpTracker';
import { getAbilityColor } from '../../utils/petCardRenderer';
import type { PooledPet } from '../../types/petTeams';
import type { CompareStage } from '../../data/petCompareRules';
import type { CompareUiState, ComparePanelHandle } from './types';
import { loadPetTeamsUiState, saveCompareUiState, saveCompareAbilityForPair, getCompareAbilityForPair } from './state';
import { getCoinSpriteUrl } from './helpers';
import { t } from '../../i18n';

// ---------------------------------------------------------------------------
// Helper types from comparePresentation
// ---------------------------------------------------------------------------

type CompareSideData = NonNullable<ReturnType<typeof buildCompareCardViewModel>>['sideA'];
type CompareRowData = NonNullable<ReturnType<typeof buildCompareCardViewModel>>['ledgerRows'][number];

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function toCompareInput(pet: PooledPet | null): ComparePetInput | null {
  if (!pet) return null;
  return {
    id: pet.id,
    species: pet.species,
    strength: pet.strength,
    targetScale: pet.targetScale,
    abilities: pet.abilities,
    mutations: pet.mutations,
  };
}

function deriveCompareStage(pool: PooledPet[]): ReturnType<typeof captureProgressionStage> {
  const inputs = pool.map((pet) => toCompareInput(pet)).filter((pet): pet is ComparePetInput => !!pet);
  return captureProgressionStage(inputs);
}

function formatActionExpectedValue(profile: TeamCompareProfile, key: 'harvest' | 'sell' | 'hatch'): string {
  const bucket = profile.actionBuckets[key];
  const value = bucket.expectedValuePerTrigger;
  const unit = bucket.entries.find((entry) => entry.unit !== 'none')?.unit ?? 'none';
  if (unit === 'coins') return formatCoinsAbbreviated(Math.max(0, Math.round(value)));
  if (unit === 'minutes') return value.toFixed(1);
  if (unit === 'xp') return formatCoinsAbbreviated(Math.max(0, Math.round(value)));
  if (Math.abs(value) >= 1000) return formatCoinsAbbreviated(Math.max(0, Math.round(value)));
  return value.toFixed(value >= 10 ? 1 : 2);
}

function formatTeamScoreCompact(score: number): string {
  if (!Number.isFinite(score)) return '0';
  const absScore = Math.abs(score);
  if (absScore >= 1000) return formatCoinsAbbreviated(score);
  if (absScore >= 100) return score.toFixed(1);
  return score.toFixed(2);
}

function isCurrencyMetric(metricLabel: string): boolean {
  return metricLabel.includes('$');
}

const WINNER_HIGHLIGHT_MODE: 'full' | 'metric' = 'full';

function applyImpactEmphasis(el: HTMLElement, abilityId: string | null): void {
  el.classList.remove('qpm-tcmp-metric-val--rainbow', 'qpm-tcmp-metric-val--gold');
  if (!abilityId) return;
  if (abilityId === 'RainbowGranter') {
    el.classList.add('qpm-tcmp-metric-val--rainbow');
    return;
  }
  if (abilityId === 'GoldGranter') {
    el.classList.add('qpm-tcmp-metric-val--gold');
    return;
  }
  el.style.color = getAbilityColor(abilityId).base;
}

function formatAbilityNamesForCompare(abilityIds: string[]): string {
  if (abilityIds.length === 0) return t('feature.petsWindow.noAbilities');

  const names = abilityIds.map((abilityId) => getAbilityDefinition(abilityId)?.name ?? abilityId);
  const maxVisible = 3;
  if (names.length <= maxVisible) return names.join(', ');
  return `${names.slice(0, maxVisible).join(', ')} +${names.length - maxVisible}`;
}

// ---------------------------------------------------------------------------
// Team summary compare
// ---------------------------------------------------------------------------

function renderTeamSummaryCompare(params: {
  teamAName: string;
  teamBName: string;
  profileA: TeamCompareProfile;
  profileB: TeamCompareProfile;
  stage: CompareStage;
  stageScore: number;
}): HTMLElement {
  const { teamAName, teamBName, profileA, profileB, stage, stageScore } = params;
  const wrap = document.createElement('div');
  wrap.className = 'qpm-tcmp-team-summary';

  const head = document.createElement('div');
  head.className = 'qpm-tcmp-team-head';
  const title = document.createElement('div');
  title.className = 'qpm-tcmp-team-title';
  title.textContent = t('feature.petsWindow.teamSummary');
  const stageEl = document.createElement('div');
  stageEl.className = 'qpm-tcmp-stage';
  stageEl.style.borderTop = 'none';
  stageEl.style.paddingTop = '0';
  stageEl.textContent = t('feature.petsWindow.stageLabel', { stage: stage.toUpperCase(), score: stageScore.toFixed(1) });
  head.append(title, stageEl);
  wrap.appendChild(head);

  const table = document.createElement('div');
  table.className = 'qpm-tcmp-team-table';

  const hA = document.createElement('div');
  hA.className = 'qpm-tcmp-team-table-head qpm-tcmp-team-table-head--a';
  hA.textContent = teamAName;
  const hMid = document.createElement('div');
  hMid.className = 'qpm-tcmp-team-table-head qpm-tcmp-team-table-head--mid';
  hMid.textContent = t('feature.petsWindow.metric');
  const hB = document.createElement('div');
  hB.className = 'qpm-tcmp-team-table-head qpm-tcmp-team-table-head--b';
  hB.textContent = teamBName;
  table.append(hA, hMid, hB);

  const hasMagnitude = (aRaw: number, bRaw: number): boolean => {
    const EPS = 0.0001;
    return Math.abs(aRaw) > EPS || Math.abs(bRaw) > EPS;
  };

  const addRow = (label: string, aRaw: number, bRaw: number, aText: string, bText: string): void => {
    if (!hasMagnitude(aRaw, bRaw)) return;

    const a = document.createElement('div');
    a.className = 'qpm-tcmp-team-a';
    a.textContent = aText;
    const mid = document.createElement('div');
    mid.className = 'qpm-tcmp-team-mid';
    mid.textContent = label;
    const b = document.createElement('div');
    b.className = 'qpm-tcmp-team-b';
    b.textContent = bText;

    if (aRaw > bRaw) a.classList.add('qpm-tcmp-team-win');
    else if (bRaw > aRaw) b.classList.add('qpm-tcmp-team-win');

    table.append(a, mid, b);
  };

  addRow(
    t('feature.petsWindow.coinsPerHr'),
    profileA.totals.coinsPerHour,
    profileB.totals.coinsPerHour,
    formatCoinsAbbreviated(Math.max(0, Math.round(profileA.totals.coinsPerHour))),
    formatCoinsAbbreviated(Math.max(0, Math.round(profileB.totals.coinsPerHour))),
  );
  addRow(
    t('feature.petsWindow.plantMinPerHr'),
    profileA.totals.plantMinutesPerHour,
    profileB.totals.plantMinutesPerHour,
    profileA.totals.plantMinutesPerHour.toFixed(1),
    profileB.totals.plantMinutesPerHour.toFixed(1),
  );
  addRow(
    t('feature.petsWindow.eggMinPerHr'),
    profileA.totals.eggMinutesPerHour,
    profileB.totals.eggMinutesPerHour,
    profileA.totals.eggMinutesPerHour.toFixed(1),
    profileB.totals.eggMinutesPerHour.toFixed(1),
  );
  addRow(
    t('feature.petsWindow.xpPerHr'),
    profileA.totals.xpPerHour,
    profileB.totals.xpPerHour,
    formatCoinsAbbreviated(Math.max(0, Math.round(profileA.totals.xpPerHour))),
    formatCoinsAbbreviated(Math.max(0, Math.round(profileB.totals.xpPerHour))),
  );

  const actionKeys: Array<'harvest' | 'sell' | 'hatch'> = ['harvest', 'sell', 'hatch'];
  for (const key of actionKeys) {
    const bucketA = profileA.actionBuckets[key];
    const bucketB = profileB.actionBuckets[key];
    const hasActionAbility = bucketA.entries.length > 0 || bucketB.entries.length > 0;
    if (!hasActionAbility) continue;

    const titleCase = key.charAt(0).toUpperCase() + key.slice(1);
    addRow(
      t('feature.petsWindow.chancePerMin', { action: titleCase }),
      bucketA.combinedChancePercent,
      bucketB.combinedChancePercent,
      `${bucketA.combinedChancePercent.toFixed(1)}%`,
      `${bucketB.combinedChancePercent.toFixed(1)}%`,
    );
    if (hasMagnitude(bucketA.expectedValuePerTrigger, bucketB.expectedValuePerTrigger)) {
      addRow(
        t('feature.petsWindow.valuePerTrigger', { action: titleCase }),
        bucketA.expectedValuePerTrigger,
        bucketB.expectedValuePerTrigger,
        formatActionExpectedValue(profileA, key),
        formatActionExpectedValue(profileB, key),
      );
    }
  }

  const scoreA = document.createElement('div');
  scoreA.className = 'qpm-tcmp-team-score';
  scoreA.textContent = formatTeamScoreCompact(profileA.score);
  const scoreMid = document.createElement('div');
  scoreMid.className = 'qpm-tcmp-team-mid';
  scoreMid.textContent = t('feature.petsWindow.teamScoreLabel');
  const scoreB = document.createElement('div');
  scoreB.className = 'qpm-tcmp-team-score qpm-tcmp-team-score--right';
  scoreB.textContent = formatTeamScoreCompact(profileB.score);
  if (profileA.score > profileB.score) scoreA.classList.add('qpm-tcmp-team-score--win');
  else if (profileB.score > profileA.score) scoreB.classList.add('qpm-tcmp-team-score--win');
  else {
    scoreA.classList.add('qpm-tcmp-team-score--lose');
    scoreB.classList.add('qpm-tcmp-team-score--lose');
  }
  table.append(scoreA, scoreMid, scoreB);

  wrap.appendChild(table);
  return wrap;
}

// ---------------------------------------------------------------------------
// Per-slot pet column
// ---------------------------------------------------------------------------

function renderComparePetColumn(params: {
  pet: PooledPet | null;
  side: 'left' | 'right';
  metrics: CompareSideData;
  rows: CompareRowData[];
  verdict: 'a' | 'b' | 'tie' | 'review';
}): HTMLElement {
  const { pet, side, metrics, rows, verdict } = params;
  const root = document.createElement('div');
  root.className = `qpm-tcmp-pet${side === 'right' ? ' qpm-tcmp-pet--right' : ''}`;
  const sideKey = side === 'left' ? 'a' : 'b';
  if (WINNER_HIGHLIGHT_MODE === 'full') {
    if (verdict === sideKey) {
      root.classList.add('qpm-tcmp-pet--winner');
    } else if (verdict === 'a' || verdict === 'b') {
      root.classList.add('qpm-tcmp-pet--loser');
    }
  }

  if (!pet) {
    root.textContent = t('feature.petsWindow.emptySlot');
    root.style.color = 'rgba(224,224,224,0.35)';
    root.style.fontSize = '13px';
    root.style.justifyContent = 'center';
    return root;
  }

  const header = document.createElement('div');
  header.className = 'qpm-tcmp-head';

  const sprite = document.createElement('div');
  sprite.className = 'qpm-tcmp-sprite';
  if (pet.species && isSpritesReady()) {
    const src = getPetSpriteDataUrlWithMutations(pet.species, pet.mutations ?? []);
    if (src) {
      const img = document.createElement('img');
      img.src = src;
      img.alt = pet.species;
      sprite.appendChild(img);
    } else {
      sprite.textContent = '\uD83D\uDC3E';
    }
  } else {
    sprite.textContent = '\uD83D\uDC3E';
  }
  header.appendChild(sprite);

  const text = document.createElement('div');
  text.style.minWidth = '0';
  text.style.width = '100%';
  const idLine = document.createElement('div');
  idLine.className = `qpm-tcmp-idline${side === 'right' ? ' qpm-tcmp-idline--right' : ''}`;
  const idCopy = document.createElement('div');
  idCopy.className = 'qpm-tcmp-idcopy';
  const name = document.createElement('div');
  name.className = 'qpm-tcmp-name';
  name.textContent = pet.name || pet.species;
  const maxStr = calculateMaxStrength(pet.targetScale, pet.species);
  const str = document.createElement('div');
  str.className = 'qpm-tcmp-str';
  str.textContent = pet.strength != null && maxStr != null
    ? `STR ${pet.strength} / ${maxStr}`
    : pet.strength != null ? `STR ${pet.strength}` : 'STR ?';
  idCopy.append(name, str);
  const abilityDots = document.createElement('div');
  abilityDots.className = `qpm-tcmp-adots${side === 'right' ? ' qpm-tcmp-adots--right' : ''}`;
  for (const abilityId of pet.abilities.slice(0, 4)) {
    const dot = document.createElement('span');
    dot.className = 'qpm-tcmp-adot';
    dot.title = getAbilityDefinition(abilityId)?.name ?? abilityId;
    dot.style.background = getAbilityColor(abilityId).base;
    abilityDots.appendChild(dot);
  }
  idLine.append(idCopy, abilityDots);
  text.append(idLine);
  header.appendChild(text);
  root.appendChild(header);

  const ability = document.createElement('div');
  ability.className = 'qpm-tcmp-ab';
  const abilityMain = document.createElement('div');
  abilityMain.className = 'qpm-tcmp-ab-main';
  abilityMain.textContent = metrics.hasData ? t('feature.petsWindow.focusAbility', { name: metrics.abilityName }) : t('feature.petsWindow.noComparableAbility');
  const abilityAll = document.createElement('div');
  abilityAll.className = 'qpm-tcmp-ab-all';
  abilityAll.textContent = t('feature.petsWindow.allAbilitiesPrefix', { list: formatAbilityNamesForCompare(pet.abilities) });
  ability.append(abilityMain, abilityAll);
  root.appendChild(ability);

  const metricRows = document.createElement('div');
  metricRows.className = 'qpm-tcmp-metrics';
  const getMetricValue = (rowId: CompareRowData['id']): string => {
    if (rowId === 'value_per_proc') return metrics.valuePerProc;
    if (rowId === 'impact_per_hour') return metrics.impactPerHour;
    if (rowId === 'procs_per_hour') return metrics.procsPerHour;
    return metrics.triggerPercent;
  };

  const renderMetric = (rowData: CompareRowData): void => {
    const row = document.createElement('div');
    row.className = `qpm-tcmp-metric${side === 'right' ? ' qpm-tcmp-metric--right' : ''}`;
    const vWrap = document.createElement('span');
    vWrap.style.cssText = 'display:inline-flex;align-items:center;gap:6px;';
    const v = document.createElement('span');
    v.className = 'qpm-tcmp-metric-val';
    v.textContent = getMetricValue(rowData.id);

    if (rowData.winner === sideKey && rowData.id !== 'impact_per_hour') {
      v.classList.add('qpm-tcmp-metric-val--winner');
    }
    if (rowData.id === 'impact_per_hour') {
      applyImpactEmphasis(v, metrics.abilityId);
    }
    if (rowData.id === 'value_per_proc' && isCurrencyMetric(metrics.metricLabel)) {
      const coinUrl = getCoinSpriteUrl();
      if (coinUrl) {
        const coin = document.createElement('img');
        coin.className = 'qpm-tcmp-coin';
        coin.src = coinUrl;
        coin.alt = '$';
        vWrap.appendChild(coin);
      }
    }
    vWrap.appendChild(v);
    row.append(vWrap);
    metricRows.appendChild(row);
  };

  for (const rowData of rows) {
    renderMetric(rowData);
  }
  root.appendChild(metricRows);

  return root;
}

// ---------------------------------------------------------------------------
// Per-slot compare row (left pet | center verdict | right pet)
// ---------------------------------------------------------------------------

function buildSlotCompareRow(params: {
  petA: PooledPet | null;
  petB: PooledPet | null;
  slotIndex: number;
  abilityFilter: string;
  valuationContext: AbilityValuationContext | null;
  pool: PooledPet[];
  stage: CompareStage;
}): HTMLElement {
  const { petA, petB, slotIndex, abilityFilter, valuationContext, pool, stage } = params;
  const row = document.createElement('div');
  row.className = 'qpm-tcmp-row';

  const model = buildCompareCardViewModel({
    petA,
    petB,
    abilityFilter,
    valuationContext,
    stage,
    poolForRank: pool,
  });
  const verdictKey = model?.verdict ?? 'review';
  const sideA = model?.sideA ?? {
    hasData: false,
    abilityId: null,
    abilityName: t('feature.petsWindow.noComparableAbility'),
    metricLabel: 'Metric',
    valuePerProc: '\u2014',
    impactPerHour: '\u2014',
    procsPerHour: '\u2014',
    triggerPercent: '\u2014',
    rawValuePerProc: 0,
    rawImpactPerHour: 0,
    rawProcsPerHour: 0,
    rawTriggerPercent: 0,
  };
  const sideB = model?.sideB ?? {
    hasData: false,
    abilityId: null,
    abilityName: t('feature.petsWindow.noComparableAbility'),
    metricLabel: 'Metric',
    valuePerProc: '\u2014',
    impactPerHour: '\u2014',
    procsPerHour: '\u2014',
    triggerPercent: '\u2014',
    rawValuePerProc: 0,
    rawImpactPerHour: 0,
    rawProcsPerHour: 0,
    rawTriggerPercent: 0,
  };
  const rows: CompareRowData[] = model?.ledgerRows ?? [
    { id: 'value_per_proc', label: t('feature.petsWindow.valuePerProc'), a: '\u2014', b: '\u2014', winner: 'review' as const },
    { id: 'impact_per_hour', label: t('feature.petsWindow.impactPerHr'), a: '\u2014', b: '\u2014', winner: 'review' as const },
    { id: 'procs_per_hour', label: t('feature.petsWindow.ratePerHr'), a: '\u2014', b: '\u2014', winner: 'review' as const },
    { id: 'trigger_percent', label: t('feature.petsWindow.chanceMin'), a: '\u2014', b: '\u2014', winner: 'review' as const },
  ];

  const left = renderComparePetColumn({ pet: petA, side: 'left', metrics: sideA, rows, verdict: verdictKey });
  const right = renderComparePetColumn({ pet: petB, side: 'right', metrics: sideB, rows, verdict: verdictKey });

  const center = document.createElement('div');
  center.className = 'qpm-tcmp-center';
  const centerTop = document.createElement('div');
  centerTop.className = 'qpm-tcmp-center-top';
  const slot = document.createElement('div');
  slot.className = 'qpm-tcmp-slot';
  slot.textContent = t('feature.petsWindow.slotN', { n: String(slotIndex + 1) });
  centerTop.appendChild(slot);

  const verdict = document.createElement('div');
  verdict.className = `qpm-tcmp-verdict qpm-tcmp-verdict--${verdictKey}`;
  verdict.textContent =
    verdictKey === 'a' ? t('feature.petsWindow.aWins')
      : verdictKey === 'b' ? t('feature.petsWindow.bWins')
        : verdictKey === 'tie' ? t('feature.petsWindow.tie')
          : t('feature.petsWindow.review');
  centerTop.appendChild(verdict);
  center.appendChild(centerTop);

  const legend = document.createElement('div');
  legend.className = 'qpm-tcmp-legend';
  for (const rowData of rows) {
    const legendRow = document.createElement('div');
    legendRow.className = 'qpm-tcmp-legend-row';
    legendRow.textContent = rowData.label;
    legend.appendChild(legendRow);
  }
  center.appendChild(legend);

  const stageBadge = document.createElement('div');
  stageBadge.className = 'qpm-tcmp-stage';
  stageBadge.textContent = t('feature.petsWindow.stageOnly', { stage: model?.stageBadge ?? stage.toUpperCase() });
  center.appendChild(stageBadge);

  row.append(left, center, right);
  return row;
}

// ---------------------------------------------------------------------------
// Main exported builder
// ---------------------------------------------------------------------------

export function buildCompareTeamsPanel(
  getPetPool: () => PooledPet[],
  onStageChange?: (stage: CompareStage) => void,
): ComparePanelHandle {
  const panel = document.createElement('div');
  panel.style.cssText = 'display:flex;flex-direction:column;gap:10px;padding:12px 14px 14px;flex:1;overflow-y:auto;';
  const compareState = loadPetTeamsUiState().compare ?? {};
  let teamAId: string | null = compareState.selectedTeamAId ?? null;
  let teamBId: string | null = compareState.selectedTeamBId ?? null;

  const hdr = document.createElement('div');
  hdr.style.cssText = 'font-size:11px;font-weight:700;color:rgba(143,130,255,0.8);text-transform:uppercase;letter-spacing:0.06em;';
  hdr.textContent = t('feature.petsWindow.teamComparison');
  panel.appendChild(hdr);

  const selectionHint = document.createElement('div');
  selectionHint.style.cssText = 'font-size:11px;color:rgba(224,224,224,0.5);';
  panel.appendChild(selectionHint);

  const filterRow = document.createElement('div');
  filterRow.className = 'qpm-tcmp-filter-row';
  const filterLbl = document.createElement('span');
  filterLbl.style.cssText = 'font-size:11px;color:rgba(224,224,224,0.4);flex-shrink:0;';
  filterLbl.textContent = t('feature.petsWindow.abilitiesLabel');
  const filterSel = document.createElement('select');
  filterSel.className = 'qpm-select';
  filterSel.style.cssText = 'flex:1;cursor:pointer;';
  const allOption = document.createElement('option');
  allOption.value = 'all';
  allOption.textContent = t('feature.petsWindow.all');
  filterSel.appendChild(allOption);
  const abilityFilterLabels = new Map<string, string>([['all', t('feature.petsWindow.allAbilities')]]);
  const activeFilterChip = document.createElement('span');
  activeFilterChip.className = 'qpm-tcmp-filter-chip';
  activeFilterChip.textContent = t('feature.petsWindow.allAbilities');
  filterRow.append(filterLbl, filterSel, activeFilterChip);
  panel.appendChild(filterRow);

  const grid = document.createElement('div');
  panel.appendChild(grid);

  function getPairKey(aId: string | null, bId: string | null): string {
    return aId && bId ? `${aId}|${bId}` : '';
  }

  function resolveTeamPets(targetTeamId: string): (PooledPet | null)[] {
    const pool = getPetPool();
    const team = getTeamsConfig().teams.find((entry) => entry.id === targetTeamId);
    if (!team) return [null, null, null];
    return team.slots.map((slotId) => (slotId ? (pool.find((pet) => pet.id === slotId) ?? null) : null));
  }

  function resolveCompareFamilyFilterValue(rawAbilityId: string): { value: string; label: string } | null {
    const raw = String(rawAbilityId || '').trim();
    if (!raw) return null;

    const canonicalId = getAbilityDefinition(raw)?.id ?? raw;
    const displayName = getAbilityDefinition(raw)?.name ?? raw;
    const info = getOptimizerAbilityFamilyInfo(canonicalId, displayName);
    const fallbackFamilyKey = getAbilityFamilyKey(canonicalId).trim().toLowerCase();
    const value = (info?.exactFamilyKey ?? fallbackFamilyKey).trim().toLowerCase();
    if (!value) return null;
    const label = (info?.exactFamilyLabel ?? displayName).trim() || canonicalId;
    return { value, label };
  }

  function resolvePreferredAbilityFilterValue(preferredAbility: string, validValues: Set<string>): string {
    const raw = String(preferredAbility || '').trim();
    if (!raw) return 'all';
    if (validValues.has(raw)) return raw;

    const family = resolveCompareFamilyFilterValue(raw);
    if (family && validValues.has(family.value)) {
      return family.value;
    }
    return 'all';
  }

  function updateAbilityFilter(allPets: (PooledPet | null)[], preferredAbility: string): void {
    const grouped = new Map<string, { label: string; abilityIds: Set<string> }>();
    allPets.forEach((pet) => {
      if (!pet) return;
      pet.abilities.forEach((abilityId) => {
        const family = resolveCompareFamilyFilterValue(abilityId);
        const canonicalId = getAbilityDefinition(abilityId)?.id ?? abilityId;
        if (!family || !canonicalId) return;

        const existing = grouped.get(family.value);
        if (existing) {
          existing.abilityIds.add(canonicalId);
          return;
        }
        grouped.set(family.value, {
          label: family.label,
          abilityIds: new Set<string>([canonicalId]),
        });
      });
    });

    const sortedGroups = [...grouped.entries()].sort((a, b) => a[1].label.localeCompare(b[1].label));
    const validValues = new Set<string>(['all', ...sortedGroups.map(([value]) => value)]);

    filterSel.innerHTML = '';
    abilityFilterLabels.clear();
    abilityFilterLabels.set('all', t('feature.petsWindow.allAbilities'));
    const all = document.createElement('option');
    all.value = 'all';
    all.textContent = t('feature.petsWindow.all');
    filterSel.appendChild(all);

    for (const [value, group] of sortedGroups) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = group.label;
      filterSel.appendChild(option);
      abilityFilterLabels.set(value, group.label);
    }
    filterSel.value = resolvePreferredAbilityFilterValue(preferredAbility, validValues);
  }

  function normalizePair(): void {
    const allTeamIds = new Set(getTeamsConfig().teams.map((team) => team.id));
    if (teamAId && !allTeamIds.has(teamAId)) teamAId = null;
    if (teamBId && !allTeamIds.has(teamBId)) teamBId = null;
    if (teamAId && teamBId && teamAId === teamBId) teamBId = null;
  }

  function setPlaceholder(text: string): void {
    grid.innerHTML = '';
    grid.style.cssText = 'font-size:12px;color:rgba(224,224,224,0.3);text-align:center;padding:16px 0;';
    grid.textContent = text;
  }

  function renderComparison(): void {
    normalizePair();
    const pool = getPetPool();
    const stageSnapshot = deriveCompareStage(pool);
    const stage = stageSnapshot.stage;
    onStageChange?.(stage);

    const comparePatch: Partial<CompareUiState> = {};
    if (teamAId) comparePatch.selectedTeamAId = teamAId;
    if (teamBId) comparePatch.selectedTeamBId = teamBId;
    saveCompareUiState(comparePatch);

    if (!teamAId && !teamBId) {
      selectionHint.textContent = t('feature.petsWindow.compareModeHint');
      filterSel.disabled = true;
      filterSel.value = 'all';
      activeFilterChip.textContent = t('feature.petsWindow.allAbilities');
      setPlaceholder(t('feature.petsWindow.selectTeamAB'));
      return;
    }

    if (teamAId && !teamBId) {
      const teamAName = getTeamsConfig().teams.find((team) => team.id === teamAId)?.name ?? 'Team A';
      selectionHint.textContent = t('feature.petsWindow.teamASelected', { name: teamAName });
      filterSel.disabled = true;
      filterSel.value = 'all';
      activeFilterChip.textContent = t('feature.petsWindow.allAbilities');
      setPlaceholder(t('feature.petsWindow.waitingTeamB'));
      return;
    }

    if (!teamAId || !teamBId) return;

    const teamAName = getTeamsConfig().teams.find((team) => team.id === teamAId)?.name ?? 'Team A';
    const teamBName = getTeamsConfig().teams.find((team) => team.id === teamBId)?.name ?? 'Team B';
    selectionHint.textContent = t('feature.petsWindow.comparingTeams', { nameA: teamAName, nameB: teamBName });
    filterSel.disabled = false;

    const pairKey = getPairKey(teamAId, teamBId);
    const petsA = resolveTeamPets(teamAId);
    const petsB = resolveTeamPets(teamBId);
    const preferredAbility = getCompareAbilityForPair(pairKey) ?? filterSel.value;
    updateAbilityFilter([...petsA, ...petsB], preferredAbility);
    saveCompareAbilityForPair(pairKey, filterSel.value);
    activeFilterChip.textContent = abilityFilterLabels.get(filterSel.value) ?? t('feature.petsWindow.allAbilities');

    let valuationContext: AbilityValuationContext | null = null;
    try {
      valuationContext = buildAbilityValuationContext();
    } catch {
      valuationContext = null;
    }
    grid.innerHTML = '';
    grid.className = 'qpm-tcmp-grid';

    const teamProfileA = buildTeamCompareProfile(
      petsA.map((pet) => toCompareInput(pet)),
      stageSnapshot,
      valuationContext,
    );
    const teamProfileB = buildTeamCompareProfile(
      petsB.map((pet) => toCompareInput(pet)),
      stageSnapshot,
      valuationContext,
    );
    grid.appendChild(renderTeamSummaryCompare({
      teamAName,
      teamBName,
      profileA: teamProfileA,
      profileB: teamProfileB,
      stage,
      stageScore: stageSnapshot.score,
    }));

    for (let i = 0; i < 3; i += 1) {
      grid.appendChild(buildSlotCompareRow({
        petA: petsA[i] ?? null,
        petB: petsB[i] ?? null,
        slotIndex: i,
        abilityFilter: filterSel.value,
        valuationContext,
        pool,
        stage,
      }));
    }
  }

  filterSel.addEventListener('change', () => {
    const pairKey = getPairKey(teamAId, teamBId);
    if (pairKey) saveCompareAbilityForPair(pairKey, filterSel.value);
    renderComparison();
  });

  renderComparison();

  return {
    root: panel,
    setPair(nextTeamAId: string | null, nextTeamBId: string | null): void {
      teamAId = nextTeamAId;
      teamBId = nextTeamBId;
      renderComparison();
    },
    refresh(): void {
      renderComparison();
    },
  };
}
