// Team list rendering for the manager tab — team rows, drag-drop, delete.

import {
  getTeamsConfig,
  detectCurrentTeam,
  getKeybinds,
  reorderTeams,
  deleteTeam,
} from '../../../store/petTeams';
import { getActivePetInfos } from '../../../store/pets';
import { getPetSpriteDataUrlWithMutations, isSpritesReady } from '../../../sprite-v2/compat';
import { getAbilityColor } from '../../../utils/rendering/petCardRenderer';
import { openFloatingCardForSlot, closeFloatingCardForSlot, hasFloatingCardForSlot } from '../floatingCard';
import { formatNumber } from '../../../utils/formatters';
import { computeTeamAbilityPills } from './teamSummary';
import { btn, formatKeybind, getCoinSpriteUrl, getAgeSpriteUrl, computeTeamScore } from './helpers';
import { t } from '../../../i18n';
import type { ManagerContext } from './types';

// ---------------------------------------------------------------------------
// Dominant metric (coins/hr or xp/hr) shown on each team row
// ---------------------------------------------------------------------------

function computeTeamDominantMetric(
  teamSlots: Array<string | null>,
  ctx: ManagerContext,
): { type: 'coin' | 'xp'; value: number; formatted: string } | null {
  const slotData: Array<{ abilities: string[]; strength: number | null; targetScale: number | null; species: string }> = [];
  for (const slotId of teamSlots) {
    if (!slotId) continue;
    const pooledPet = ctx.petPool.find(p => p.id === slotId);
    const activePet = getActivePetInfos().find(p => p.slotId === slotId);
    const species = pooledPet?.species ?? activePet?.species ?? '';
    if (!species) continue;
    slotData.push({
      abilities: pooledPet?.abilities ?? activePet?.abilities ?? [],
      strength: pooledPet?.strength ?? activePet?.strength ?? null,
      targetScale: pooledPet?.targetScale ?? activePet?.targetScale ?? null,
      species,
    });
  }
  if (slotData.length === 0) return null;

  const pills = computeTeamAbilityPills(slotData);
  let coinTotal = 0;
  let xpTotal = 0;
  for (const pill of pills) {
    if (pill.unit === 'coins') coinTotal += pill.sortValue;
    if (pill.unit === 'xp') xpTotal += pill.sortValue;
  }

  if (coinTotal === 0 && xpTotal === 0) return null;
  const formatMetricValue = (value: number): string => {
    const v = Math.round(value);
    if (!Number.isFinite(v)) return '0';
    if (Math.abs(v) >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(2)}B`;
    if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
    if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(2)}k`;
    return String(v);
  };
  if (coinTotal >= xpTotal) {
    return { type: 'coin', value: coinTotal, formatted: `${formatMetricValue(coinTotal)}/hr` };
  }
  return { type: 'xp', value: xpTotal, formatted: `${formatMetricValue(xpTotal)} XP/hr` };
}

// ---------------------------------------------------------------------------
// renderTeamList
// ---------------------------------------------------------------------------

export function renderTeamList(ctx: ManagerContext): void {
  const config = getTeamsConfig();
  const term = ctx.state.searchTerm.toLowerCase();
  const detectedId = detectCurrentTeam();
  const keybinds = getKeybinds();
  const keyByTeamId: Record<string, string> = {};
  for (const [combo, teamId] of Object.entries(keybinds)) {
    if (!teamId || keyByTeamId[teamId]) continue;
    keyByTeamId[teamId] = combo;
  }

  const reorderEnabled = !ctx.compareOpen && term.length === 0;
  ctx.normalizeComparePair();

  ctx.teamsContainer.innerHTML = '';

  const filtered = config.teams.filter((team) => !term || team.name.toLowerCase().includes(term));

  // Pin active team to top for quick access
  if (detectedId) {
    const activeIdx = filtered.findIndex((t) => t.id === detectedId);
    if (activeIdx > 0) {
      const active = filtered.splice(activeIdx, 1)[0];
      if (active) filtered.unshift(active);
    }
  }

  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:20px;text-align:center;color:rgba(224,224,224,0.3);font-size:12px;';
    empty.textContent = config.teams.length === 0 ? t('feature.petsWindow.noTeamsYet') : t('feature.petsWindow.noResults');
    ctx.teamsContainer.appendChild(empty);
    return;
  }

  filtered.forEach((team) => {
    const row = document.createElement('div');
    row.className = 'qpm-team-row';
    const isActive = team.id === detectedId;
    if (!ctx.compareOpen && ctx.state.selectedTeamId === team.id) row.classList.add('qpm-team-row--selected');
    if (isActive) row.classList.add('qpm-team-row--active');
    if (ctx.compareOpen && ctx.compareTeamAId === team.id) row.classList.add('qpm-team-row--compare-a');
    if (ctx.compareOpen && ctx.compareTeamBId === team.id) row.classList.add('qpm-team-row--compare-b');
    if (reorderEnabled) row.classList.add('qpm-team-row--draggable');

    // --- Name line ---
    const nameLine = document.createElement('div');
    nameLine.className = 'qpm-team-row__name-line';

    const name = document.createElement('div');
    name.className = 'qpm-team-row__name';
    name.textContent = team.name;
    nameLine.appendChild(name);

    const keyLabel = keyByTeamId[team.id];
    if (keyLabel) {
      const keyEl = document.createElement('span');
      keyEl.className = 'qpm-team-row__key';
      keyEl.textContent = formatKeybind(keyLabel);
      nameLine.appendChild(keyEl);
    }

    if (isActive) {
      const activeBadge = document.createElement('span');
      activeBadge.className = 'qpm-team-row__active-badge';
      activeBadge.textContent = `\u25CF ${t('feature.petsWindow.activeBadge')}`;
      nameLine.appendChild(activeBadge);
    }

    if (ctx.compareOpen && ctx.compareTeamAId === team.id) {
      const badgeA = document.createElement('span');
      badgeA.className = 'qpm-team-row__cmp-badge qpm-team-row__cmp-badge--a';
      badgeA.textContent = 'A';
      nameLine.appendChild(badgeA);
    }
    if (ctx.compareOpen && ctx.compareTeamBId === team.id) {
      const badgeB = document.createElement('span');
      badgeB.className = 'qpm-team-row__cmp-badge qpm-team-row__cmp-badge--b';
      badgeB.textContent = 'B';
      nameLine.appendChild(badgeB);
    }

    row.appendChild(nameLine);

    // --- Metrics line ---
    const topLine = document.createElement('div');
    topLine.className = 'qpm-team-row__top';

    const metric = computeTeamDominantMetric(team.slots, ctx);
    if (metric) {
      const metricEl = document.createElement('div');
      metricEl.className = 'qpm-team-row__metric';
      const spriteUrl = metric.type === 'coin' ? getCoinSpriteUrl() : getAgeSpriteUrl();
      if (spriteUrl) {
        const metricImg = document.createElement('img');
        metricImg.src = spriteUrl;
        metricImg.alt = metric.type === 'coin' ? '$' : 'XP';
        metricEl.appendChild(metricImg);
      }
      const metricText = document.createElement('span');
      metricText.className = `qpm-team-row__metric-text qpm-team-row__metric-text--${metric.type}`;
      metricText.textContent = metric.formatted;
      metricEl.appendChild(metricText);
      topLine.appendChild(metricEl);
    }

    const teamScore = computeTeamScore(team.slots, ctx.petPool);
    if (teamScore > 0) {
      const scoreWrap = document.createElement('div');
      scoreWrap.className = 'qpm-team-row__score';
      const scoreLbl = document.createElement('span');
      scoreLbl.className = 'qpm-team-row__score-label';
      scoreLbl.textContent = t('feature.petsWindow.scoreColon');
      const scoreVal = document.createElement('span');
      scoreVal.className = 'qpm-team-row__score-value';
      scoreVal.textContent = String(Math.round(teamScore));
      scoreWrap.appendChild(scoreLbl);
      scoreWrap.appendChild(scoreVal);
      topLine.appendChild(scoreWrap);
    }

    row.appendChild(topLine);

    // --- Bottom line ---
    const bottomLine = document.createElement('div');
    bottomLine.className = 'qpm-team-row__bottom';

    // Sprite cluster
    const spritesWrap = document.createElement('div');
    spritesWrap.className = 'qpm-team-row__sprites';
    for (let i = 0; i < 3; i++) {
      const slotId = team.slots[i as 0 | 1 | 2];
      if (slotId) {
        const pooledPet = ctx.petPool.find(p => p.id === slotId);
        const activePet = getActivePetInfos().find(p => p.slotId === slotId);
        const species = pooledPet?.species ?? activePet?.species ?? '';
        const mutations = pooledPet?.mutations ?? activePet?.mutations ?? [];
        if (species && isSpritesReady()) {
          const src = getPetSpriteDataUrlWithMutations(species, mutations);
          if (src) {
            const img = document.createElement('img');
            img.src = src;
            img.alt = species;
            spritesWrap.appendChild(img);
            continue;
          }
        }
      }
      const emptySlot = document.createElement('div');
      emptySlot.className = 'qpm-team-row__sprites-empty';
      emptySlot.textContent = '+';
      spritesWrap.appendChild(emptySlot);
    }
    bottomLine.appendChild(spritesWrap);

    // Ability pills (top 2)
    const slotData: Array<{ abilities: string[]; strength: number | null; targetScale: number | null; species: string }> = [];
    for (let i = 0; i < 3; i++) {
      const slotId = team.slots[i as 0 | 1 | 2];
      if (!slotId) continue;
      const pooledPet = ctx.petPool.find(p => p.id === slotId);
      const activePet = getActivePetInfos().find(p => p.slotId === slotId);
      const species = pooledPet?.species ?? activePet?.species ?? '';
      if (species) {
        slotData.push({
          abilities: pooledPet?.abilities ?? activePet?.abilities ?? [],
          strength: pooledPet?.strength ?? activePet?.strength ?? null,
          targetScale: pooledPet?.targetScale ?? activePet?.targetScale ?? null,
          species,
        });
      }
    }
    if (slotData.length > 0) {
      const pills = computeTeamAbilityPills(slotData).slice(0, 2);
      if (pills.length > 0) {
        const pillsWrap = document.createElement('div');
        pillsWrap.className = 'qpm-team-row__pills';
        for (const pill of pills) {
          const p = document.createElement('span');
          p.className = 'qpm-team-row__pill';
          const colors = getAbilityColor(pill.abilityId);
          p.style.background = colors.base;
          p.style.color = colors.text;
          p.title = pill.hoverTitle || pill.abilityName;
          p.textContent = pill.abilityName;
          pillsWrap.appendChild(p);
        }
        bottomLine.appendChild(pillsWrap);
      }
    }

    // Feed popout toggle (active team only)
    if (isActive) {
      const feedToggle = document.createElement('button');
      feedToggle.className = 'qpm-team-row__feed-toggle';
      const allOpen = [0, 1, 2].every(idx => hasFloatingCardForSlot(idx));
      if (allOpen) feedToggle.classList.add('qpm-team-row__feed-toggle--active');
      feedToggle.textContent = '\uD83C\uDF56';
      feedToggle.title = allOpen ? t('feature.petsWindow.closeFeedCards') : t('feature.petsWindow.openFeedCards');
      feedToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        if (allOpen) {
          for (let idx = 0; idx < 3; idx++) closeFloatingCardForSlot(idx);
        } else {
          for (let idx = 0; idx < 3; idx++) openFloatingCardForSlot(idx);
        }
        ctx.renderTeamList();
      });
      bottomLine.appendChild(feedToggle);
    }

    // Delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'qpm-team-row__delete-btn';
    deleteBtn.textContent = '\uD83D\uDDD1';
    deleteBtn.title = t('feature.petsWindow.deleteTooltip', { name: team.name });
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // Replace row content with confirmation strip
      row.innerHTML = '';
      row.className = 'qpm-team-row qpm-team-row--confirm';
      const strip = document.createElement('div');
      strip.className = 'qpm-team-row__confirm-strip';
      const label = document.createElement('span');
      label.textContent = t('feature.petsWindow.deleteConfirm', { name: team.name });
      const yesBtn = btn(t('feature.petsWindow.confirm'), 'danger');
      const noBtn = btn(t('feature.petsWindow.cancel'), 'default');
      yesBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        deleteTeam(team.id);
        if (ctx.state.selectedTeamId === team.id) ctx.state.selectedTeamId = null;
        ctx.renderTeamList();
        ctx.renderEditor();
      });
      noBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        ctx.renderTeamList();
      });
      strip.appendChild(label);
      strip.appendChild(yesBtn);
      strip.appendChild(noBtn);
      row.appendChild(strip);
    });
    bottomLine.appendChild(deleteBtn);

    row.appendChild(bottomLine);

    // Click handler
    row.addEventListener('click', () => {
      if (ctx.compareOpen) {
        if (!ctx.compareTeamAId) {
          ctx.compareTeamAId = team.id;
          ctx.compareTeamBId = null;
        } else if (!ctx.compareTeamBId) {
          if (team.id !== ctx.compareTeamAId) ctx.compareTeamBId = team.id;
        } else {
          ctx.compareTeamAId = team.id;
          ctx.compareTeamBId = null;
        }
        ctx.comparePanel.setPair(ctx.compareTeamAId, ctx.compareTeamBId);
        ctx.renderTeamList();
        return;
      }
      ctx.state.selectedTeamId = team.id;
      ctx.renderTeamList();
      ctx.renderEditor();
    });

    // Drag-drop reordering
    if (reorderEnabled) {
      row.draggable = true;
      row.addEventListener('dragstart', (event) => {
        ctx.dragTeamId = team.id;
        row.classList.add('qpm-team-row--dragging');
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', team.id);
        }
      });
      row.addEventListener('dragend', () => {
        ctx.dragTeamId = null;
        row.classList.remove('qpm-team-row--dragging');
      });
      row.addEventListener('dragover', (event) => {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      });
      row.addEventListener('drop', (event) => {
        event.preventDefault();
        const fromId = ctx.dragTeamId || event.dataTransfer?.getData('text/plain') || null;
        ctx.dragTeamId = null;
        if (!fromId || fromId === team.id) return;
        const liveTeams = getTeamsConfig().teams;
        const fromIndex = liveTeams.findIndex((entry) => entry.id === fromId);
        const toIndex = liveTeams.findIndex((entry) => entry.id === team.id);
        if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
        reorderTeams(fromIndex, toIndex);
        ctx.comparePanel.refresh();
      });
    }

    ctx.teamsContainer.appendChild(row);
  });
}
