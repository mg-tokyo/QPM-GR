import type { TurtleTimerState, TurtleTimerChannel, TurtleContribution } from '../../features/pets/turtleTimer';
import type { UIState } from '../core/panelState';
import { formatDurationPretty, formatRatePretty, formatHungerPretty, createEditablePetValue, formatPercentPretty, formatFeedsPerHour, formatMinutesWithUnit, formatMinutesPerHour, formatCompletionTime } from '../core/panelHelpers';
import { renderCompactPetSprite } from '../../utils/rendering/petCardRenderer';

export interface TurtleTimerUIConfig {
  enabled: boolean;
  includeBoardwalk: boolean;
  focus: TurtleTimerState['focus'];
  focusTargetTileId: string | null;
  focusTargetSlotIndex: number | null;
  eggFocus: TurtleTimerState['eggFocus'];
  eggFocusTargetTileId: string | null;
  eggFocusTargetSlotIndex: number | null;
}

export function ensureTurtleTimerConfig(cfg: any): TurtleTimerUIConfig {
  const current = cfg.turtleTimer ?? {};
  const resolved: TurtleTimerUIConfig = {
    enabled: current.enabled ?? true,
    includeBoardwalk: current.includeBoardwalk ?? false,
    focus: current.focus === 'earliest' || current.focus === 'specific' ? current.focus : 'latest',
    focusTargetTileId: typeof current.focusTargetTileId === 'string' ? current.focusTargetTileId : null,
    focusTargetSlotIndex:
      typeof current.focusTargetSlotIndex === 'number' && Number.isFinite(current.focusTargetSlotIndex)
        ? Math.max(0, Math.round(current.focusTargetSlotIndex))
        : null,
    eggFocus: current.eggFocus === 'earliest' || current.eggFocus === 'specific' ? current.eggFocus : 'latest',
    eggFocusTargetTileId: typeof current.eggFocusTargetTileId === 'string' ? current.eggFocusTargetTileId : null,
    eggFocusTargetSlotIndex:
      typeof current.eggFocusTargetSlotIndex === 'number' && Number.isFinite(current.eggFocusTargetSlotIndex)
        ? Math.max(0, Math.round(current.eggFocusTargetSlotIndex))
        : null,
  };

  cfg.turtleTimer = resolved;
  return resolved;
}

export function computeTimingSpread(channel: TurtleTimerChannel): {
  luckyMs: number | null;
  unluckyMs: number | null;
  stdMinutes: number | null;
} {
  if (
    channel.status !== 'estimating' ||
    channel.naturalMsRemaining == null ||
    channel.adjustedMsRemaining == null ||
    !Number.isFinite(channel.adjustedMsRemaining)
  ) {
    return { luckyMs: null, unluckyMs: null, stdMinutes: null };
  }

  const adjustedMinutes = Math.max(0, channel.adjustedMsRemaining / 60000);
  const runtimeMinutes = Math.max(1, adjustedMinutes);
  let varianceMinutes = 0;

  for (const entry of channel.contributions) {
    const reductionPerProc = entry.reductionPerProc;
    if (!Number.isFinite(reductionPerProc) || reductionPerProc <= 0) {
      continue;
    }
    const ratePerMinute = entry.rateContribution;
    if (!Number.isFinite(ratePerMinute) || ratePerMinute <= 0) {
      continue;
    }
    const probability = Math.min(0.99, Math.max(0, ratePerMinute / Math.max(reductionPerProc, 0.0001)));
    if (probability <= 0) {
      continue;
    }
    const variance = runtimeMinutes * probability * (1 - probability) * reductionPerProc * reductionPerProc;
    varianceMinutes += variance;
  }

  if (varianceMinutes <= 0) {
    return {
      luckyMs: channel.adjustedMsRemaining,
      unluckyMs: channel.adjustedMsRemaining,
      stdMinutes: 0,
    };
  }

  const stdMinutes = Math.sqrt(varianceMinutes);
  const luckyMinutes = Math.max(0, adjustedMinutes - stdMinutes);
  const unluckyMinutes = adjustedMinutes + stdMinutes;

  return {
    luckyMs: luckyMinutes * 60000,
    unluckyMs: unluckyMinutes * 60000,
    stdMinutes,
  };
}

function buildContributionTable(
  container: HTMLElement,
  contributions: TurtleContribution[],
  enabled: boolean,
  emptyText: string,
  minActiveHungerPct: number,
): void {
  container.textContent = '';
  const placeholderText = !enabled ? 'Timer disabled.' : contributions.length === 0 ? emptyText : null;
  if (placeholderText) {
    const el = document.createElement('div');
    el.textContent = placeholderText;
    el.style.cssText = 'font-size:10px;color:#90a4ae;font-style:italic;';
    container.appendChild(el);
    return;
  }
  for (const entry of contributions) {
    const row = document.createElement('div');
    row.style.cssText = 'display:grid;grid-template-columns:1.4fr 0.7fr 0.6fr 0.8fr;gap:6px;font-size:10px;padding:2px 0;';

    const nameCell = document.createElement('div');
    nameCell.textContent = (entry.name && entry.name.trim()) || entry.species || `Slot ${entry.slotIndex + 1}`;
    nameCell.style.color = entry.missingStats ? '#ffcc80' : '#e0f2f1';

    const hungerCell = document.createElement('div');
    hungerCell.textContent = formatHungerPretty(entry.hungerPct);
    hungerCell.style.color = entry.hungerPct != null && entry.hungerPct < minActiveHungerPct ? '#ff8a80' : '#b2dfdb';

    const rateCell = document.createElement('div');
    rateCell.textContent = `${entry.perHourReduction.toFixed(1)} min/hr`;
    rateCell.style.color = '#aed581';

    const xpCell = document.createElement('div');
    xpCell.style.color = entry.missingStats ? '#ffcc80' : '#c5cae9';
    const xpEditableValue = createEditablePetValue(
      { species: entry.species, slotIndex: entry.slotIndex },
      'xp',
      entry.xp,
      (val) => val != null ? `${Math.round(val / 1000)}k xp` : '—'
    );
    xpCell.appendChild(xpEditableValue);

    row.append(nameCell, hungerCell, rateCell, xpCell);
    container.appendChild(row);
  }
}

export function updateTurtleTimerViews(uiState: UIState, snapshot: TurtleTimerState): void {
  const plant = snapshot.plant;
  const egg = snapshot.egg;
  const support = snapshot.support;

  const plantPerHourReduction = plant.contributions.reduce((sum, entry) => sum + (entry.perHourReduction ?? 0), 0);
  const plantNaturalMinutes = plant.naturalMsRemaining != null ? plant.naturalMsRemaining / 60000 : null;
  const plantAdjustedMinutes = plant.adjustedMsRemaining != null ? plant.adjustedMsRemaining / 60000 : null;
  const plantMinutesSaved = plant.minutesSaved ?? null;
  const plantTiming = computeTimingSpread(plant);

  const eggPerHourReduction = egg.contributions.reduce((sum, entry) => sum + (entry.perHourReduction ?? 0), 0);
  const eggNaturalMinutes = egg.naturalMsRemaining != null ? egg.naturalMsRemaining / 60000 : null;
  const eggAdjustedMinutes = egg.adjustedMsRemaining != null ? egg.adjustedMsRemaining / 60000 : null;
  const eggMinutesSaved = egg.minutesSaved ?? null;
  const eggTiming = computeTimingSpread(egg);

  const restorePerProcActive = support.restorePctActive;
  const restorePerProcTotal = support.restorePctTotal;
  const restoreFeedsPerHourActive = support.restorePctPerHourActive;
  const restoreFeedsPerHourTotal = support.restorePctPerHourTotal;
  const restoreTriggersPerHourActive = support.restoreTriggersPerHourActive;
  const restoreTriggersPerHourTotal = support.restoreTriggersPerHourTotal;
  const slowPctActive = support.slowPctActive;
  const slowPctTotal = support.slowPctTotal;

  const createPlaceholder = (text: string): HTMLDivElement => {
    const el = document.createElement('div');
    el.textContent = text;
    el.style.cssText = 'font-size:10px;color:#90a4ae;font-style:italic;';
    return el;
  };

  const enableButtons = uiState.turtleEnableButtons;
  if (enableButtons.length === 0) {
    uiState.turtleEnableButtons = enableButtons;
  }
  for (const button of enableButtons) {
    if (!button) continue;
    if (snapshot.enabled) {
      button.textContent = 'Enabled';
      button.style.background = 'rgba(79, 209, 139, 0.2)';
      button.style.borderColor = 'rgba(79, 209, 139, 0.4)';
      button.style.color = '#e8f5e9';
    } else {
      button.textContent = 'Disabled';
      button.style.background = 'rgba(158, 158, 158, 0.22)';
      button.style.borderColor = 'rgba(158, 158, 158, 0.35)';
      button.style.color = '#eceff1';
    }
  }

  // Boardwalk toggles removed

  for (const select of uiState.turtleFocusSelects) {
    if (!select) continue;
    if (select.value !== snapshot.focus) {
      select.value = snapshot.focus;
    }
  }

  for (const select of uiState.turtleEggFocusSelects) {
    if (!select) continue;
    if (select.value !== snapshot.eggFocus) {
      select.value = snapshot.eggFocus;
    }
  }

  const plantFocusTargetKey = snapshot.focusTargetKey;
  const plantFocusOptions = snapshot.plantTargets ?? [];
  const plantFocusEnabled = snapshot.focus === 'specific';
  const hasPlantTargets = plantFocusOptions.length > 0;

  uiState.turtleFocusTargetSelects.forEach((select, index) => {
    if (!select) {
      return;
    }
    const container = uiState.turtleFocusTargetContainers[index];
    if (container) {
      container.style.display = plantFocusEnabled ? 'inline-flex' : 'none';
    }

    const previousKeys = Array.from(select.options).map((option) => option.value);
    const nextKeys = plantFocusOptions.map((option) => option.key);
    const needsRebuild =
      previousKeys.length !== nextKeys.length + 1 ||
      previousKeys.slice(1).some((key, idx) => key !== nextKeys[idx]);

    if (needsRebuild) {
      select.textContent = '';
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = plantFocusOptions.length
        ? 'Pick a plant...'
        : 'No plants detected yet';
      placeholder.disabled = plantFocusOptions.length > 0;
      placeholder.hidden = plantFocusOptions.length > 0;
      select.appendChild(placeholder);

      for (const option of plantFocusOptions) {
        const opt = document.createElement('option');
        opt.value = option.key;
        const speciesLabel = option.species ?? 'Unknown plant';
        const timingLabel = option.remainingMs != null ? formatDurationPretty(option.remainingMs) : 'Ready';
        const boardwalkBadge = option.boardwalk ? ' (boardwalk)' : '';
        opt.textContent = `${speciesLabel} - ${timingLabel}${boardwalkBadge}`;
        select.appendChild(opt);
      }
    }

    const desiredValue = plantFocusEnabled && snapshot.focusTargetAvailable && plantFocusTargetKey ? plantFocusTargetKey : '';
    if (select.value !== desiredValue) {
      select.value = desiredValue;
    }
    select.disabled = !plantFocusEnabled || plantFocusOptions.length === 0;
  });

  const eggFocusTargetKey = snapshot.eggFocusTargetKey;
  const eggFocusOptions = snapshot.eggTargets ?? [];
  const eggFocusEnabled = snapshot.eggFocus === 'specific';
  const hasEggTargets = eggFocusOptions.length > 0;

  uiState.turtleEggFocusTargetSelects.forEach((select, index) => {
    if (!select) {
      return;
    }
    const container = uiState.turtleEggFocusTargetContainers[index];
    if (container) {
      container.style.display = eggFocusEnabled ? 'inline-flex' : 'none';
    }

    const previousKeys = Array.from(select.options).map((option) => option.value);
    const nextKeys = eggFocusOptions.map((option) => option.key);
    const needsRebuild =
      previousKeys.length !== nextKeys.length + 1 ||
      previousKeys.slice(1).some((key, idx) => key !== nextKeys[idx]);

    if (needsRebuild) {
      select.textContent = '';
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = eggFocusOptions.length
        ? 'Pick an egg...'
        : 'No eggs detected yet';
      placeholder.disabled = eggFocusOptions.length > 0;
      placeholder.hidden = eggFocusOptions.length > 0;
      select.appendChild(placeholder);

      for (const option of eggFocusOptions) {
        const opt = document.createElement('option');
        opt.value = option.key;
        const speciesLabel = option.species ?? 'Unknown egg';
        const timingLabel = option.remainingMs != null ? formatDurationPretty(option.remainingMs) : 'Ready';
        const boardwalkBadge = option.boardwalk ? ' (boardwalk)' : '';
        opt.textContent = `${speciesLabel} - ${timingLabel}${boardwalkBadge}`;
        select.appendChild(opt);
      }
    }

    const desiredValue = eggFocusEnabled && snapshot.eggFocusTargetAvailable && eggFocusTargetKey ? eggFocusTargetKey : '';
    if (select.value !== desiredValue) {
      select.value = desiredValue;
    }
    select.disabled = !eggFocusEnabled || eggFocusOptions.length === 0;
  });

  const hintParts: string[] = [];
  if (snapshot.hungerFilteredCount > 0) {
    hintParts.push(`${snapshot.hungerFilteredCount} need feeding`);
  }
  if (snapshot.turtlesMissingStats > 0) {
    hintParts.push(`${snapshot.turtlesMissingStats} missing stats`);
  }
  const hintLabel = hintParts.length ? hintParts.join(' • ') : null;
  const boardwalkLabel = snapshot.includeBoardwalk ? 'Boardwalk on' : null;

  const statusEl = uiState.turtleStatus;
  const detailEl = uiState.turtleDetail;
  const footerEl = uiState.turtleFooter;

  const setSummary = (status: string, detail: string, footer: string, detailIsHTML = false): void => {
    if (statusEl) statusEl.textContent = status;
    if (detailEl) {
      if (detailIsHTML) {
        detailEl.innerHTML = detail;
      } else {
        detailEl.textContent = detail;
      }
    }
    if (footerEl) footerEl.textContent = footer;
  };

  // Update plant name header
  const plantNameTextEl = uiState.turtlePlantNameText;

  if (!snapshot.enabled) {
    if (plantNameTextEl) plantNameTextEl.textContent = 'Timer Disabled';
    setSummary('Timer disabled', 'Enable to track crops and eggs', '');
  } else if (plant.status === 'no-data') {
    if (plantNameTextEl) plantNameTextEl.textContent = 'Waiting...';
    setSummary('Waiting for garden data…', 'Move camera or interact with garden', '');
  } else if (plant.status === 'no-crops') {
    if (plantNameTextEl) plantNameTextEl.textContent = 'No Crops';
    setSummary('No crops growing', 'Plant seeds to start tracking', '');
  } else if (plant.status === 'no-turtles') {
    const cropName = plant.focusSlot?.species || 'Crop';
    if (plantNameTextEl) plantNameTextEl.textContent = cropName;
    const etaText = plant.naturalMsRemaining ? formatDurationPretty(plant.naturalMsRemaining) : '—';
    const cropsText = `${plant.growingSlots}/${plant.trackedSlots} crops`;
    setSummary(`${cropName} • ${etaText}`, `No plant boost • ${cropsText}`, '');
  } else if (plant.status === 'estimating') {
    const cropName = plant.focusSlot?.species || 'Crop';
    if (plantNameTextEl) plantNameTextEl.textContent = cropName;
    const etaText = formatDurationPretty(plant.adjustedMsRemaining);
    const finishTime = formatCompletionTime(plant.adjustedMsRemaining);
    const speedText = formatRatePretty(plant.effectiveRate);

    // Calculate unlucky time
    const timing = computeTimingSpread(plant);
    const unluckyText = timing.unluckyMs != null ? formatDurationPretty(timing.unluckyMs) : '';

    // Build turtle booster summary with growth rates
    const turtleParts: string[] = [];
    if (plant.contributions.length > 0) {
      turtleParts.push(`🌱 ${speedText} plant`);
    }
    if (egg.contributions.length > 0 && egg.status === 'estimating' && egg.effectiveRate != null) {
      const eggSpeed = formatRatePretty(egg.effectiveRate);
      turtleParts.push(`🥚 ${eggSpeed} egg`);
    } else if (egg.contributions.length > 0) {
      turtleParts.push(`🥚 ${egg.contributions.length} egg`);
    }
    const totalFoodTurtles = support.restoreCount + support.slowCount;
    if (totalFoodTurtles > 0) {
      turtleParts.push(`🍽️ ${totalFoodTurtles} food`);
    }

    const turtleSummary = turtleParts.length > 0 ? turtleParts.join(' • ') : 'No turtles';
    const cropsText = `${plant.growingSlots}/${plant.trackedSlots} crops`;

    // Create detailed second line with unlucky time in red
    let detailHTML = `${turtleSummary} • ${cropsText}`;
    if (unluckyText) {
      detailHTML += ` • <span style="color:var(--qpm-danger);font-size:9px;">(${unluckyText})</span>`;
    }

    setSummary(`${cropName} • ${etaText}${finishTime}`, detailHTML, '', true);
  } else {
    if (plantNameTextEl) plantNameTextEl.textContent = 'Idle';
    setSummary('Turtle timer idle', '', '');
  }

  const plantSummary = uiState.turtlePlantSummary;
  if (plantSummary) {
    if (!snapshot.enabled) {
      plantSummary.innerHTML = '<div style="font-size:12px;color:var(--qpm-danger);">⏸️ Timer disabled</div>';
    } else if (plant.status === 'no-data') {
      plantSummary.innerHTML = plantFocusEnabled && !snapshot.focusTargetAvailable && hasPlantTargets
        ? '<div style="font-size:12px;color:var(--qpm-warning);">🎯 Select target plant</div>'
        : '<div style="font-size:12px;color:#9E9E9E;">⏳ Waiting...</div>';
    } else if (plant.status === 'no-crops') {
      plantSummary.innerHTML = '<div style="font-size:12px;color:#9E9E9E;">🌾 No crops</div>';
    } else {
      const cropName = plant.focusSlot?.species || 'Unknown';
      const boosterCount = plant.contributions.length;
      plantSummary.innerHTML = `<div style="font-size:12px;font-weight:600;color:var(--qpm-positive);">🌱 ${cropName}</div><div style="font-size:10px;color:#81C784;">⚡ ${boosterCount} booster${boosterCount === 1 ? '' : 's'}</div>`;
    }
  }

  const plantEta = uiState.turtlePlantEta;
  if (plantEta) {
    if (!snapshot.enabled) {
      plantEta.textContent = '—';
    } else if (plant.status === 'estimating') {
      const completionTime = formatCompletionTime(plant.adjustedMsRemaining);
      plantEta.innerHTML = `⏱️ ${formatDurationPretty(plant.adjustedMsRemaining)}<span style="font-size:10px;color:#81C784;margin-left:6px;">${completionTime}</span>`;
    } else if (plant.status === 'no-turtles') {
      if (plant.naturalMsRemaining != null) {
        const completionTime = formatCompletionTime(plant.naturalMsRemaining);
        plantEta.innerHTML = `⏱️ ${formatDurationPretty(plant.naturalMsRemaining)}<span style="font-size:10px;color:#9E9E9E;margin-left:6px;">(no boost)</span>`;
      } else {
        plantEta.textContent = '—';
      }
    } else {
      plantEta.textContent = '—';
    }
  }

  const plantTotals = uiState.turtlePlantTotals;
  if (plantTotals) {
    if (!snapshot.enabled) {
      plantTotals.innerHTML = '<div style="font-size:10px;color:#9E9E9E;">⏸️ Paused</div>';
    } else if (plantFocusEnabled && !snapshot.focusTargetAvailable) {
      plantTotals.innerHTML = hasPlantTargets
        ? '<div style="font-size:10px;color:#9E9E9E;">🎯 Select focus plant</div>'
        : '<div style="font-size:10px;color:#9E9E9E;">⏳ Loading...</div>';
    } else if (plant.status === 'no-data') {
      plantTotals.innerHTML = '<div style="font-size:10px;color:#9E9E9E;">⏳ Loading...</div>';
    } else if (plant.status === 'no-crops') {
      plantTotals.innerHTML = '<div style="font-size:10px;color:#9E9E9E;">🌾 No crops</div>';
    } else if (plant.status === 'no-turtles') {
      const naturalText = plantNaturalMinutes != null ? formatMinutesWithUnit(plantNaturalMinutes) : '—';
      plantTotals.innerHTML = `<div style="font-size:10px;font-weight:600;color:var(--qpm-warning);">⚠️ No boost</div><div style="font-size:9px;color:#BDBDBD;">Normal: ${naturalText}</div>`;
    } else {
      const naturalText = plantNaturalMinutes != null ? formatMinutesWithUnit(plantNaturalMinutes) : '—';
      const savedText = plantMinutesSaved != null ? formatMinutesWithUnit(plantMinutesSaved) : '—';
      plantTotals.innerHTML = `<div style="font-size:10px;font-weight:600;color:var(--qpm-positive);">⚡ Boost: ${formatMinutesPerHour(plantPerHourReduction)}</div><div style="font-size:9px;color:#81C784;">✂️ Cut: ${savedText}</div><div style="font-size:9px;color:#BDBDBD;">📅 Normal: ${naturalText}</div>`;
    }
  }

  const plantSimple = uiState.turtlePlantSimple;
  if (plantSimple) {
    if (!snapshot.enabled) {
      plantSimple.innerHTML = '<span style="font-size:16px;">⏸️</span><span>Enable temple to track</span>';
    } else if (plantFocusEnabled && !snapshot.focusTargetAvailable) {
      plantSimple.innerHTML = hasPlantTargets
        ? '<span style="font-size:16px;">🎯</span><span>Select a focus plant</span>'
        : '<span style="font-size:16px;">⏳</span><span>Loading garden data...</span>';
    } else if (plant.status === 'no-data') {
      plantSimple.innerHTML = '<span style="font-size:16px;">⏳</span><span>Loading garden data...</span>';
    } else if (plant.status === 'no-crops') {
      plantSimple.innerHTML = '<span style="font-size:16px;">🌾</span><span>No crops growing</span>';
    } else if (plant.status === 'no-turtles') {
      plantSimple.innerHTML = `<span style="font-size:16px;">⏱️</span><span>Matures in ${formatDurationPretty(plant.naturalMsRemaining)} <span style="color:#9E9E9E;">(no boost)</span></span>`;
    } else {
      const savedText = plantMinutesSaved != null ? formatMinutesWithUnit(plantMinutesSaved) : '—';
      plantSimple.innerHTML = `<span style="font-size:16px;">✨</span><span>Matures in <strong>${formatDurationPretty(plant.adjustedMsRemaining)}</strong> • <span style="color:var(--qpm-positive);font-weight:600;">✂️ ${savedText} saved</span></span>`;
    }
  }

  const plantLuck = uiState.turtlePlantLuck;
  if (plantLuck) {
    if (!snapshot.enabled || plant.status !== 'estimating') {
      plantLuck.textContent = '';
    } else {
      const luckyText = plantTiming.luckyMs != null ? formatDurationPretty(plantTiming.luckyMs) : '—';
      const unluckyText = plantTiming.unluckyMs != null ? formatDurationPretty(plantTiming.unluckyMs) : '—';
      const stdText = plantTiming.stdMinutes != null ? formatMinutesWithUnit(plantTiming.stdMinutes) : '—';
      plantLuck.innerHTML = `<span style="font-size:14px;">🎲</span><span>🍀 ${luckyText} • 😐 ${unluckyText} <span style="color:#80CBC4;">(±${stdText})</span></span>`;
    }
  }

  const eggSummary = uiState.turtleEggSummary;
  if (eggSummary) {
    if (!snapshot.enabled) {
      eggSummary.textContent = 'Timer disabled';
    } else if (egg.status === 'no-data') {
      eggSummary.textContent = eggFocusEnabled && !snapshot.eggFocusTargetAvailable && hasEggTargets
        ? 'Select a target egg with Egg focus to track hatching.'
        : 'Waiting for garden snapshot…';
    } else if (egg.status === 'no-eggs') {
      eggSummary.textContent = 'No eggs incubating.';
    } else {
  eggSummary.textContent = `${egg.growingSlots}/${egg.trackedSlots} growing eggs • ${egg.contributions.length} booster${egg.contributions.length === 1 ? '' : 's'}`;
    }
  }

  const eggEta = uiState.turtleEggEta;
  if (eggEta) {
    if (!snapshot.enabled) {
      eggEta.textContent = '—';
    } else if (egg.status === 'estimating') {
      const completionTime = formatCompletionTime(egg.adjustedMsRemaining);
      eggEta.textContent = `${formatDurationPretty(egg.adjustedMsRemaining)} (${formatRatePretty(egg.effectiveRate)})${completionTime}`;
    } else if (egg.status === 'no-turtles') {
      if (egg.naturalMsRemaining != null) {
        const completionTime = formatCompletionTime(egg.naturalMsRemaining);
        eggEta.textContent = `${formatDurationPretty(egg.naturalMsRemaining)} (no turtle boost)${completionTime}`;
      } else {
        eggEta.textContent = '—';
      }
    } else {
      eggEta.textContent = '—';
    }
  }

  const eggTotals = uiState.turtleEggTotals;
  if (eggTotals) {
    if (!snapshot.enabled) {
      eggTotals.textContent = 'Totals paused while the temple is disabled.';
    } else if (eggFocusEnabled && !snapshot.eggFocusTargetAvailable) {
      eggTotals.textContent = hasEggTargets
        ? 'Total Hatch Boost will appear once a target egg is selected.'
        : 'Waiting for a fresh egg snapshot...';
    } else if (egg.status === 'no-eggs') {
      eggTotals.textContent = 'No incubating eggs detected yet – hatchery estimates will appear here.';
    } else if (egg.status === 'no-turtles') {
      const naturalText = eggNaturalMinutes != null ? formatMinutesWithUnit(eggNaturalMinutes) : '—';
      eggTotals.textContent = `No hatch turtles boosting yet. Normal ETA: ${naturalText}. Assign turtles to speed this up.`;
    } else if (egg.status === 'estimating') {
      eggTotals.textContent = `Total Growth Boost: ${formatMinutesPerHour(eggPerHourReduction)} • Normal ETA: ${
        eggNaturalMinutes != null ? formatMinutesWithUnit(eggNaturalMinutes) : '—'
      } • Estimated Time Cut: ${eggMinutesSaved != null ? formatMinutesWithUnit(eggMinutesSaved) : '—'}`;
    } else {
      eggTotals.textContent = 'Waiting for an egg snapshot…';
    }
  }

  const eggSimple = uiState.turtleEggSimple;
  if (eggSimple) {
    if (!snapshot.enabled) {
      eggSimple.textContent = 'Enable the temple to see egg hatching boosts too.';
    } else if (egg.status === 'no-eggs') {
      eggSimple.textContent = 'No eggs on the boardwalk or garden right now. Drop an egg to start tracking.';
    } else if (eggFocusEnabled && !snapshot.eggFocusTargetAvailable) {
      eggSimple.textContent = hasEggTargets
        ? 'Pick a target egg with Egg focus to show its hatch ETA and boost cut.'
        : 'Waiting on egg snapshots – try moving the camera or drop an egg to refresh.';
    } else if (egg.status === 'no-data') {
      eggSimple.textContent = 'Waiting on egg snapshots – try moving the camera or interacting with the garden.';
    } else if (egg.status === 'no-turtles') {
      const naturalText = eggNaturalMinutes != null ? formatMinutesWithUnit(eggNaturalMinutes) : '—';
      eggSimple.textContent = `Focused egg hatches in ${formatDurationPretty(egg.naturalMsRemaining)} (no turtle boost active). Normal ETA: ${naturalText}.`;
    } else if (egg.status === 'estimating') {
      const naturalText = eggNaturalMinutes != null ? formatMinutesWithUnit(eggNaturalMinutes) : '—';
      const savedText = eggMinutesSaved != null ? formatMinutesWithUnit(eggMinutesSaved) : '—';
      eggSimple.textContent = `Focused egg hatches in ${formatDurationPretty(egg.adjustedMsRemaining)} (Normal ETA: ${naturalText}); Estimated Time Cut: ${savedText}.`;
    } else {
      eggSimple.textContent = '';
    }
  }

  const eggLuck = uiState.turtleEggLuck;
  if (eggLuck) {
    if (!snapshot.enabled) {
      eggLuck.textContent = '';
    } else if (egg.status === 'estimating') {
      const luckyText = eggTiming.luckyMs != null ? formatDurationPretty(eggTiming.luckyMs) : '—';
      const unluckyText = eggTiming.unluckyMs != null ? formatDurationPretty(eggTiming.unluckyMs) : '—';
      const stdText = eggTiming.stdMinutes != null ? formatMinutesWithUnit(eggTiming.stdMinutes) : '—';
      eggLuck.textContent = `Lucky ≈ ${luckyText} • Unlucky ≈ ${unluckyText} (±${stdText})`;
    } else if (egg.status === 'no-turtles') {
      eggLuck.textContent = 'No turtle boosts active for eggs right now.';
    } else {
      eggLuck.textContent = '';
    }
  }

  const supportSummary = uiState.turtleSupportSummary;
  const supportTotalsEl = uiState.turtleSupportTotals;
  const supportSimple = uiState.turtleSupportSimple;
  const supportList = uiState.turtleSupportList;

  if (supportSummary) {
    if (!snapshot.enabled) {
      supportSummary.textContent = 'Food buffs paused while the temple is disabled.';
    } else if (support.entries.length === 0) {
      supportSummary.textContent = 'No food turtles detected – add Hunger Restore or Hunger Boost companions.';
    } else {
      supportSummary.textContent = `Restore turtles active ${support.restoreActiveCount}/${support.restoreCount} • Slow drain turtles active ${support.slowActiveCount}/${support.slowCount}`;
    }
  }

  if (supportTotalsEl) {
    if (!snapshot.enabled || support.entries.length === 0) {
      supportTotalsEl.textContent = '';
    } else {
      const activeRestoreFeeds = restoreFeedsPerHourActive > 0 ? formatFeedsPerHour(restoreFeedsPerHourActive, 1) : '0.0 feeds/hr';
      const maxRestoreFeeds = restoreFeedsPerHourTotal > 0 ? formatFeedsPerHour(restoreFeedsPerHourTotal, 1) : '0.0 feeds/hr';
      const restoreLine = support.restoreCount > 0
        ? `Restore: ~${activeRestoreFeeds} (max ${maxRestoreFeeds})`
        : 'Restore: none yet';
      const slowLine = support.slowCount > 0
        ? `Slow drain: ${formatPercentPretty(slowPctActive, 0)} active (${formatPercentPretty(slowPctTotal, 0)} possible)`
        : 'Slow drain: none yet';
      supportTotalsEl.textContent = `${restoreLine} • ${slowLine}`;
    }
  }

  if (supportSimple) {
    if (!snapshot.enabled) {
      supportSimple.textContent = 'Enable the turtle temple and keep turtles fed to maintain hunger buffs.';
    } else if (support.entries.length === 0) {
      supportSimple.textContent = 'Assign turtles with Hunger Restore (refills) or Hunger Boost (slow drain) abilities to see food support stats.';
    } else {
      const hasRestoreTurtles = support.restoreCount > 0;
      const activeRestore = restorePerProcActive > 0 && support.restoreActiveCount > 0;
      const hasSlowBuff = support.slowActiveCount > 0 && slowPctActive > 0;

      if (activeRestore && restoreTriggersPerHourActive > 0) {
        const feedsPerHour = restoreFeedsPerHourActive / 100;
        supportSimple.textContent = `Restore turtles are covering ~${feedsPerHour.toFixed(1)} feeds/hr and slow drain buffs are cutting hunger by ${formatPercentPretty(slowPctActive, 0)} while they stay fed.`;
      } else if (hasRestoreTurtles && support.restoreActiveCount === 0) {
        supportSimple.textContent = 'Your restore turtles need food before their hourly refills kick back in.';
      } else if (hasSlowBuff) {
        supportSimple.textContent = `Slow drain buffs are active, trimming hunger by ${formatPercentPretty(slowPctActive, 0)} as long as the turtles stay full.`;
      } else if (hasRestoreTurtles) {
        supportSimple.textContent = 'Restore turtles are present but idle—feed them to start the hourly refills.';
      } else {
        supportSimple.textContent = 'Add food turtles with Hunger Restore or Hunger Boost abilities to see refills and slowdown buffs here.';
      }
    }
  }

  if (supportList) {
    supportList.textContent = '';
    if (!snapshot.enabled) {
      supportList.appendChild(createPlaceholder('Timer disabled.'));
    } else if (support.entries.length === 0) {
      supportList.appendChild(createPlaceholder('No food turtles detected.'));
    } else {
      for (const entry of support.entries) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;flex-direction:column;gap:3px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.05);font-size:10px;';

  const headerLine = document.createElement('div');
  headerLine.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:12px;color:#ffe9a6;';

  const nameLabel = document.createElement('span');
  nameLabel.style.cssText = 'display:flex;align-items:center;gap:6px;';
  const turtleSprite = renderCompactPetSprite({
    species: 'Turtle'
  });
  nameLabel.innerHTML = `${turtleSprite}<span>${entry.name ?? 'Unknown'} • ${entry.abilityNames.join(', ')}</span>`;

  const statusBadge = document.createElement('span');
        statusBadge.textContent = entry.active ? 'Active' : 'Needs feed';
        statusBadge.style.cssText = `padding:1px 6px;border-radius:12px;font-size:9px;background:${entry.active ? 'rgba(129,199,132,0.25)' : 'rgba(255,138,128,0.25)'};color:${entry.active ? '#c8e6c9' : '#ffab91'};`; 
  headerLine.append(nameLabel, statusBadge);

        const infoLines = document.createElement('div');
        infoLines.style.cssText = 'display:flex;flex-direction:column;gap:2px;color:#ffecb3;';

        const perHourFeeds = entry.totalRestorePerHourPct > 0 ? entry.totalRestorePerHourPct / 100 : 0;
        if (entry.totalRestorePerHourPct > 0) {
          const restoreLine = document.createElement('div');
          restoreLine.textContent = `Restore: ${perHourFeeds.toFixed(1)} feeds/hr (${formatPercentPretty(entry.totalRestorePerTriggerPct, 0)} per proc, ~${entry.totalTriggersPerHour.toFixed(1)} procs/hr)`;
          infoLines.appendChild(restoreLine);
        }
        if (entry.totalSlowPct > 0) {
          const slowLine = document.createElement('div');
          slowLine.textContent = `Slow drain: ${formatPercentPretty(entry.totalSlowPct, 0)} less hunger/hr while active`;
          infoLines.appendChild(slowLine);
        }
        if (perHourFeeds > 0 || entry.totalSlowPct > 0) {
          const reliefLine = document.createElement('div');
          if (perHourFeeds > 0 && entry.totalSlowPct > 0) {
            reliefLine.textContent = `Turtle effect: ~${perHourFeeds.toFixed(1)} fewer feeds/hr and pets eat ~${formatPercentPretty(entry.totalSlowPct, 0)} less often.`;
          } else if (perHourFeeds > 0) {
            reliefLine.textContent = `Turtle effect: ~${perHourFeeds.toFixed(1)} fewer feeds/hr thanks to this turtle.`;
          } else {
            reliefLine.textContent = `Turtle effect: pets eat ~${formatPercentPretty(entry.totalSlowPct, 0)} less often.`;
          }
          infoLines.appendChild(reliefLine);
        }
        if (!infoLines.hasChildNodes()) {
          const placeholderLine = document.createElement('div');
          placeholderLine.textContent = 'No active food effects yet.';
          infoLines.appendChild(placeholderLine);
        }

        const metaLine = document.createElement('div');
        metaLine.style.cssText = 'font-size:9px;color:#ffdd99;display:flex;flex-wrap:wrap;gap:8px;';
        const hungerText = `Hunger ${formatHungerPretty(entry.hungerPct)}`;
        const scoreText = `Score ${Math.round(entry.baseScore)}`;

        // Create editable XP field
        const xpLabel = document.createElement('span');
        xpLabel.textContent = 'xp: ';
        const xpValue = createEditablePetValue(
          { species: entry.species, slotIndex: entry.slotIndex },
          'xp',
          entry.xp,
          (val) => val != null ? `${Math.round(val / 1000)}k` : '?'
        );

        // Create editable Scale field
        const scaleLabel = document.createElement('span');
        scaleLabel.textContent = ' • Scale: ';
        const scaleValue = createEditablePetValue(
          { species: entry.species, slotIndex: entry.slotIndex },
          'targetScale',
          entry.targetScale,
          (val) => val != null && Number.isFinite(val) ? `${val.toFixed(2)}×` : '?'
        );

        metaLine.textContent = `${hungerText} • ${scoreText} • `;
        metaLine.appendChild(xpLabel);
        metaLine.appendChild(xpValue);
        metaLine.appendChild(scaleLabel);
        metaLine.appendChild(scaleValue);

        row.append(headerLine, infoLines, metaLine);
        supportList.appendChild(row);
      }

      const rows = supportList.querySelectorAll(':scope > div');
      if (rows.length > 0) {
        (rows[rows.length - 1] as HTMLElement).style.borderBottom = 'none';
      }
    }
  }

  const plantTable = uiState.turtlePlantTable;
  if (plantTable) {
    buildContributionTable(plantTable, plant.contributions, snapshot.enabled,
      'No growth turtles contributing yet.', snapshot.minActiveHungerPct);
  }

  const eggTable = uiState.turtleEggTable;
  if (eggTable) {
    buildContributionTable(eggTable, egg.contributions, snapshot.enabled,
      'No egg boosters contributing yet.', snapshot.minActiveHungerPct);
  }
}
