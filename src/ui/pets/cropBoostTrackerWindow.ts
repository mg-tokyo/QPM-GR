/**
 * Crop Size Boost Tracker Window
 * Simple, turtle-timer-style tracker for crop size boost progress
 */

import { t } from '../../i18n';
import { toggleWindow } from '../core/modalWindow';
import {
  getCurrentAnalysis,
  getConfig,
  setSelectedSpecies,
  onAnalysisChange,
  formatTimeEstimate,
  formatTimeRange,
  getAvailableSpecies,
} from '../../features/pets/cropBoostTracker';
import { getCropSpriteCanvas, getCropSpriteWithMutations } from '../../sprite-v2/compat';
import { canvasToDataUrl } from '../../utils/dom/canvasHelpers';
import { createButton, createEmptyState } from '../components';

// ============================================================================
// Helper Functions
// ============================================================================

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function formatNumber(num: number): string {
  return num.toFixed(1);
}

function isWindowBodyVisible(root: HTMLElement | null): boolean {
  if (!root) return false;
  const host = root.closest('.qpm-window') as HTMLElement | null;
  if (!host) return root.isConnected;
  return host.isConnected && host.style.display !== 'none';
}

// ============================================================================
// Render Function
// ============================================================================

function renderCropBoostSection(root: HTMLElement, options?: { preserveScroll?: boolean }): void {
  const preserveScroll = options?.preserveScroll === true;
  const previousScrollTop = preserveScroll ? root.scrollTop : 0;
  const previousScrollLeft = preserveScroll ? root.scrollLeft : 0;

  root.innerHTML = '';
  root.style.cssText = `
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
    box-sizing: border-box;
    overflow-y: auto;
    overflow-x: hidden;
    overscroll-behavior: contain;
    padding: 20px;
    gap: 16px;
    font-family: var(--qpm-font);
  `;

  const analysis = getCurrentAnalysis();
  const config = getConfig();

  if (!analysis) {
    const empty = createEmptyState(`${t('feature.cropBoost.emptyTitle')} — ${t('feature.cropBoost.emptyHint')}`);
    root.appendChild(empty);
    return;
  }

  // Summary Header
  const header = document.createElement('div');
  header.style.cssText = `
    padding: 16px;
    background: linear-gradient(135deg, var(--qpm-accent-tint), transparent);
    border: 1px solid var(--qpm-accent-border);
    border-radius: 8px;
  `;

  header.dataset.tour = 'cropboost-pets';

  const petSummary = document.createElement('div');
  petSummary.style.cssText = 'font-size: 14px; font-weight: 600; color: var(--qpm-accent); margin-bottom: 8px;';
  petSummary.textContent = `🐾 ${analysis.totalBoostPets !== 1 ? t('feature.cropBoost.activeBoostPets', { count: String(analysis.totalBoostPets) }) : t('feature.cropBoost.activeBoostPet', { count: String(analysis.totalBoostPets) })}`;
  header.appendChild(petSummary);

  const petsList = document.createElement('div');
  petsList.style.cssText = 'display: flex; flex-direction: column; gap: 6px; font-size: 12px;';
  analysis.boostPets.forEach(pet => {
    const petRow = document.createElement('div');
    petRow.style.cssText = 'color: var(--qpm-text);';
    const nameStrong = document.createElement('strong');
    nameStrong.textContent = pet.displayName;
    const boostSpan = document.createElement('span');
    boostSpan.style.cssText = 'color: var(--qpm-positive); font-weight: 600;';
    boostSpan.textContent = ` (+${formatNumber(pet.effectiveBoostPercent)}% ${t('feature.cropBoost.perProc')})`;
    petRow.append(`• `, nameStrong, `: ${pet.abilityName} `, boostSpan);
    petsList.appendChild(petRow);
  });
  header.appendChild(petsList);

  // Add disclaimer
  const disclaimer = document.createElement('div');
  disclaimer.style.cssText = 'margin-top: 12px; padding: 8px; background: color-mix(in srgb, var(--qpm-warning) 10%, transparent); border: 1px solid color-mix(in srgb, var(--qpm-warning) 30%, transparent); border-radius: 4px; font-size: 12px; color: var(--qpm-text-muted);';
  const disclaimerTitle = document.createElement('div');
  disclaimerTitle.style.cssText = 'font-weight: 600; color: var(--qpm-warning); margin-bottom: 4px;';
  disclaimerTitle.textContent = `⚠️ ${t('feature.cropBoost.importantNotes')}`;
  const note1 = document.createElement('div');
  note1.textContent = `• ${t('feature.cropBoost.noStackNote')}`;
  const note2 = document.createElement('div');
  note2.textContent = `• ${t('feature.cropBoost.rngNote')}`;
  disclaimer.append(disclaimerTitle, note1, note2);
  header.appendChild(disclaimer);

  root.appendChild(header);

  // Legend Section
  const legendCard = document.createElement('div');
  legendCard.style.cssText = `
    padding: 16px;
    background: linear-gradient(135deg, var(--qpm-accent-tint), transparent);
    border: 1px solid var(--qpm-accent-focus);
    border-radius: 8px;
    margin-bottom: 16px;
  `;

  const legendTitle = document.createElement('div');
  legendTitle.style.cssText = 'font-size: 12px; font-weight: 700; color: var(--qpm-accent); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.8px; display: flex; align-items: center; gap: 6px;';
  const legendIcon = document.createTextNode('📖 ');
  const legendSpan = document.createElement('span');
  legendSpan.textContent = t('feature.cropBoost.legendTitle');
  legendTitle.append(legendIcon, legendSpan);
  legendCard.appendChild(legendTitle);

  const legendContent = document.createElement('div');
  legendContent.style.cssText = 'display: flex; gap: 24px; font-size: 12px; color: var(--qpm-text);';
  for (const [emoji, label] of [['🌱', t('feature.cropBoost.stillGrowing')], ['🌾', t('feature.cropBoost.fullyGrown')]] as const) {
    const item = document.createElement('div');
    item.style.cssText = 'display: flex; align-items: center; gap: 8px; padding: 6px 12px; background: var(--qpm-surface-3); border-radius: 8px;';
    const emojiSpan = document.createElement('span');
    emojiSpan.style.fontSize = '24px';
    emojiSpan.textContent = emoji;
    const labelSpan = document.createElement('span');
    labelSpan.style.fontWeight = '600';
    labelSpan.textContent = label;
    item.append(emojiSpan, labelSpan);
    legendContent.appendChild(item);
  }
  legendCard.appendChild(legendContent);
  root.appendChild(legendCard);

  // Detail Toggle Button
  const toggleCard = document.createElement('div');
  toggleCard.style.cssText = `
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  `;

  const toggleBtn = createButton(
    showDetailedView ? `📊 ${t('feature.cropBoost.simpleView')}` : `📈 ${t('feature.cropBoost.detailedView')}`,
    {
      variant: 'secondary',
      size: 'sm',
      onClick: () => {
        showDetailedView = !showDetailedView;
        if (windowRoot) {
          renderCropBoostSection(windowRoot, { preserveScroll: true });
        }
      },
    },
  );
  toggleBtn.dataset.tour = 'cropboost-toggle';

  toggleCard.appendChild(toggleBtn);
  root.appendChild(toggleCard);

  // Overall Stats Card
  const statsCard = document.createElement('div');
  statsCard.style.cssText = `
    padding: 16px;
    background: var(--qpm-surface-2);
    border: 1px solid var(--qpm-border);
    border-radius: 8px;
  `;

  statsCard.dataset.tour = 'cropboost-stats';

  const statsTitle = document.createElement('div');
  statsTitle.style.cssText = 'font-size: 14px; font-weight: 600; color: var(--qpm-text-muted); margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.5px;';
  statsTitle.textContent = `📊 ${t('feature.cropBoost.overallProgress')}`;
  statsCard.appendChild(statsTitle);

  const statsGrid = document.createElement('div');
  statsGrid.style.cssText = `
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 12px;
  `;

  const stats = [
    { label: t('feature.cropBoost.totalCrops'), value: analysis.crops.length, color: 'var(--qpm-text)' },
    { label: t('feature.cropBoost.atMaxSize'), value: analysis.totalCropsAtMax, color: 'var(--qpm-positive)' },
    { label: t('feature.cropBoost.cropsNeedingBoost'), value: analysis.totalCropsNeedingBoost, color: 'var(--qpm-warning)' },
    { label: t('feature.cropBoost.progress'), value: `${analysis.crops.length > 0 ? Math.round((analysis.totalCropsAtMax / analysis.crops.length) * 100) : 0}%`, color: 'var(--qpm-info)' },
  ];

  stats.forEach(({ label, value, color }) => {
    const statDiv = document.createElement('div');
    const labelDiv = document.createElement('div');
    labelDiv.style.cssText = 'font-size: 12px; color: var(--qpm-text-muted); margin-bottom: 4px;';
    labelDiv.textContent = label;
    const valueDiv = document.createElement('div');
    valueDiv.style.cssText = `font-size: 24px; font-weight: 600; color: ${color};`;
    valueDiv.textContent = String(value);
    statDiv.append(labelDiv, valueDiv);
    statsGrid.appendChild(statDiv);
  });

  statsCard.appendChild(statsGrid);
  root.appendChild(statsCard);

  // All Crops Estimate Card
  if (analysis.totalCropsNeedingBoost > 0) {
    const allCropsCard = document.createElement('div');
    allCropsCard.style.cssText = `
      padding: 16px;
      background: linear-gradient(135deg, color-mix(in srgb, var(--qpm-gold) 15%, transparent), transparent);
      border: 1px solid color-mix(in srgb, var(--qpm-gold) 40%, transparent);
      border-radius: 8px;
    `;
    allCropsCard.setAttribute('data-countdown-section', 'overall');
    allCropsCard.dataset.tour = 'cropboost-estimate';

    const allCropsTitle = document.createElement('div');
    allCropsTitle.style.cssText = 'font-size: 14px; font-weight: 600; color: var(--qpm-gold); margin-bottom: 12px;';
    allCropsTitle.textContent = `🎯 ${t('feature.cropBoost.timeUntilMax')}`;
    allCropsCard.appendChild(allCropsTitle);

    const boostsRow = document.createElement('div');
    boostsRow.style.cssText = 'font-size: 12px; color: var(--qpm-text); margin-bottom: 8px;';
    const boostsLabel = document.createElement('strong');
    boostsLabel.textContent = t('feature.cropBoost.boostsNeeded');
    boostsRow.append(boostsLabel, ` ${analysis.overallEstimate.boostsNeeded}`);
    allCropsCard.appendChild(boostsRow);

    // Simple view: Show next boost time range
    if (!showDetailedView) {
      const nextBoostRow = document.createElement('div');
      nextBoostRow.style.cssText = 'font-size: 18px; font-weight: 600; color: var(--qpm-gold);';
      nextBoostRow.setAttribute('data-next-boost-range', 'true');

      // Show time range for next expected boost across all crops
      // We'll calculate a realistic range based on combined pet probabilities
      if (analysis.boostPets.length > 0) {
        // Calculate probability per second for combined pets
        const probPerSecond = analysis.boostPets.map(pet => pet.effectiveProcChance / 60 / 100);
        const probNoneProc = probPerSecond.reduce((acc, p) => acc * (1 - p), 1);
        const probAtLeastOne = 1 - probNoneProc;

        if (probAtLeastOne > 0) {
          const logOneMinusP = Math.log(1 - probAtLeastOne);
          const secondsP10 = Math.log(0.90) / logOneMinusP;
          const secondsP90 = Math.log(0.10) / logOneMinusP;

          const minTime = formatTimeEstimate(secondsP10 / 60);
          const maxTime = formatTimeEstimate(secondsP90 / 60);
          const rangeSpan = document.createElement('span');
          rangeSpan.style.color = 'var(--qpm-gold)';
          rangeSpan.textContent = `${minTime} - ${maxTime}`;
          nextBoostRow.append(`⏰ ${t('feature.cropBoost.nextBoost')} `, rangeSpan);
        }
      } else {
        const noPetsSpan = document.createElement('span');
        noPetsSpan.style.color = 'var(--qpm-text-muted)';
        noPetsSpan.textContent = t('feature.cropBoost.noBoostPets');
        nextBoostRow.append(`⏰ ${t('feature.cropBoost.nextBoost')} `, noPetsSpan);
      }

      allCropsCard.appendChild(nextBoostRow);
    } else {
      // Detailed view: Show full time range with percentiles
      const timeRow = document.createElement('div');
      timeRow.style.cssText = 'font-size: 18px; font-weight: 600; color: var(--qpm-gold); margin-bottom: 8px;';
      const timeRangeStr = formatTimeRange(
        analysis.overallEstimate.timeEstimateP10,
        analysis.overallEstimate.timeEstimateP50,
        analysis.overallEstimate.timeEstimateP90
      );
      timeRow.innerHTML = `⏰ ${timeRangeStr}`;
      allCropsCard.appendChild(timeRow);

      const note = document.createElement('div');
      note.style.cssText = 'font-size: 12px; color: var(--qpm-text-muted); margin-top: 4px; font-style: italic;';
      note.textContent = t('feature.cropBoost.timeEstimateNote');
      allCropsCard.appendChild(note);
    }

    root.appendChild(allCropsCard);
  }

  // Species Selection Dropdown
  const selectionCard = document.createElement('div');
  selectionCard.style.cssText = `
    padding: 16px;
    background: var(--qpm-surface-2);
    border: 1px solid var(--qpm-border);
    border-radius: 8px;
  `;

  selectionCard.dataset.tour = 'cropboost-filter';

  const selectionTitle = document.createElement('div');
  selectionTitle.style.cssText = 'font-size: 14px; font-weight: 600; color: var(--qpm-text-muted); margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.5px;';
  selectionTitle.textContent = `🌱 ${t('feature.cropBoost.viewSpecificCrop')}`;
  selectionCard.appendChild(selectionTitle);

  const selectRow = document.createElement('div');
  selectRow.style.cssText = 'display: flex; gap: 12px; align-items: center;';

  const speciesSelect = document.createElement('select');
  speciesSelect.className = 'qpm-select';
  speciesSelect.style.flex = '1';

  // Add "All Crops" option
  const allOption = document.createElement('option');
  allOption.value = '';
  allOption.textContent = t('feature.cropBoost.allCrops');
  speciesSelect.appendChild(allOption);

  // Add species options
  const availableSpecies = getAvailableSpecies();
  availableSpecies.forEach(species => {
    const option = document.createElement('option');
    option.value = species;
    option.textContent = capitalize(species);
    speciesSelect.appendChild(option);
  });

  speciesSelect.value = config.selectedSpecies ?? '';
  speciesSelect.addEventListener('change', () => {
    const selected = speciesSelect.value || null;
    setSelectedSpecies(selected);

    // Auto-refresh view immediately when dropdown changes
    if (windowRoot) {
      renderCropBoostSection(windowRoot, { preserveScroll: true });
    }
  });

  selectRow.appendChild(speciesSelect);
  selectionCard.appendChild(selectRow);
  root.appendChild(selectionCard);

  // Filtered Crops Table
  const selectedSpecies = config.selectedSpecies;
  const filteredCrops = selectedSpecies
    ? analysis.crops.filter(c => c.species === selectedSpecies)
    : analysis.crops;

  const cropsNeedingBoost = filteredCrops.filter(c => c.sizeRemaining > 0);

  // Sort by boosts needed (descending) - most boosts needed first
  cropsNeedingBoost.sort((a, b) => {
    const cropKeyA = `${a.tileKey}-${a.slotIndex}`;
    const cropKeyB = `${b.tileKey}-${b.slotIndex}`;
    const estimateA = analysis.cropEstimates.get(cropKeyA);
    const estimateB = analysis.cropEstimates.get(cropKeyB);
    const boostsA = estimateA?.boostsNeeded ?? 0;
    const boostsB = estimateB?.boostsNeeded ?? 0;
    return boostsB - boostsA; // Descending order
  });

  if (cropsNeedingBoost.length > 0) {
    const tableCard = document.createElement('div');
    tableCard.style.cssText = `
      padding: 16px;
      background: var(--qpm-surface-2);
      border: 1px solid var(--qpm-border);
      border-radius: 8px;
    `;

    const tableTitle = document.createElement('div');
    tableTitle.style.cssText = 'font-size: 14px; font-weight: 600; color: var(--qpm-text-muted); margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.5px;';
    tableTitle.textContent = selectedSpecies
      ? `🌾 ${t('feature.cropBoost.speciesCrops', { species: capitalize(selectedSpecies), count: String(cropsNeedingBoost.length) })}`
      : `🌾 ${t('feature.cropBoost.allCropsNeedingBoosts', { count: String(cropsNeedingBoost.length) })}`;
    tableCard.appendChild(tableTitle);

    const table = document.createElement('table');
    table.style.cssText = `
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    `;

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    const thStyle = 'padding: 8px; border-bottom: 1px solid var(--qpm-divider); color: var(--qpm-text-muted); font-weight: 600; text-transform: uppercase; font-size: 12px;';
    for (const [text, align] of [
      [t('feature.cropBoost.colCrop'), 'left'],
      [t('feature.cropBoost.colSize'), 'right'],
      [t('feature.cropBoost.colBoosts'), 'right'],
      [showDetailedView ? t('feature.cropBoost.colTimeEstimate') : t('feature.cropBoost.colNextBoost'), 'right'],
    ] as const) {
      const th = document.createElement('th');
      th.style.cssText = `text-align: ${align}; ${thStyle}`;
      th.textContent = text;
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    cropsNeedingBoost.forEach((crop) => {
      const key = `${crop.tileKey}-${crop.slotIndex}`;
      const estimate = analysis.cropEstimates.get(key);

      const row = document.createElement('tr');
      row.style.cssText = `
        border-bottom: 1px solid var(--qpm-divider);
        transition: background 0.15s ease;
      `;
      row.addEventListener('mouseenter', () => {
        row.style.background = 'var(--qpm-accent-tint)';
      });
      row.addEventListener('mouseleave', () => {
        row.style.background = 'transparent';
      });

      const nameCell = document.createElement('td');
      nameCell.style.cssText = 'padding: 12px 8px; display: flex; align-items: center; gap: 8px;';

      // Status emoji
      const statusEmoji = document.createElement('span');
      statusEmoji.textContent = crop.isMature ? '🌾' : '🌱';
      statusEmoji.style.cssText = 'font-size: 14px; flex-shrink: 0;';

      // Crop image sprite (if available from game)
      const cropImage = document.createElement('div');
      cropImage.style.cssText = `
        width: 24px;
        height: 24px;
        background-size: contain;
        background-repeat: no-repeat;
        background-position: center;
        flex-shrink: 0;
        image-rendering: pixelated;
      `;

      // Get BASE species by removing mutation prefixes (Rainbow, Gold, Frozen, etc.)
      // E.g., "Rainbow Sunflower" -> "Sunflower"
      // FIXME: hardcoded mutation prefix list violates architecture "no hardcoded game data".
      //        Missing Thunderstruck/Dawncharged/Ambercharged/Ambershine. Fix upstream or use normalizer.
      let baseSpecies = crop.species;
      const detectedMutations: string[] = [...(crop.mutations || [])];
      const mutationPrefixes = ['Rainbow', 'Gold', 'Golden', 'Frozen', 'Amber', 'Wet', 'Chilled', 'Dawnlit'];
      for (const prefix of mutationPrefixes) {
        if (baseSpecies.startsWith(prefix + ' ')) {
          baseSpecies = baseSpecies.substring(prefix.length + 1);
          // Add to mutations if not already present
          if (!detectedMutations.includes(prefix)) {
            detectedMutations.push(prefix === 'Golden' ? 'Gold' : prefix);
          }
          break;
        }
      }
      const speciesKey = baseSpecies.charAt(0).toUpperCase() + baseSpecies.slice(1).toLowerCase();

      // Try to get sprite with mutations applied, fallback to base sprite
      let spriteDataUrl: string | null = null;
      if (detectedMutations.length > 0) {
        spriteDataUrl = canvasToDataUrl(getCropSpriteWithMutations(speciesKey, detectedMutations));
      }
      if (!spriteDataUrl) {
        spriteDataUrl = canvasToDataUrl(getCropSpriteCanvas(speciesKey));
      }

      if (spriteDataUrl) {
        cropImage.style.backgroundImage = `url(${spriteDataUrl})`;
        cropImage.setAttribute('data-qpm-sprite', `crop:${speciesKey}${detectedMutations.length > 0 ? ':' + detectedMutations.join(',') : ''}`);
      } else {
        cropImage.style.background = 'linear-gradient(135deg, var(--qpm-positive), var(--qpm-accent))';
        cropImage.setAttribute('data-qpm-sprite', `crop:${speciesKey}`);
      }

      // Text content
      const textSpan = document.createElement('span');
      textSpan.textContent = capitalize(crop.species);
      if (crop.mutations.length > 0) {
        const mutSpan = document.createElement('span');
        mutSpan.style.color = 'var(--qpm-gold)';
        mutSpan.textContent = ` (${crop.mutations.join(', ')})`;
        textSpan.appendChild(mutSpan);
      }

      nameCell.appendChild(statusEmoji);
      nameCell.appendChild(cropImage);
      nameCell.appendChild(textSpan);
      row.appendChild(nameCell);

      const sizeCell = document.createElement('td');
      sizeCell.style.cssText = 'padding: 12px 8px; text-align: right;';
      const sizePercent = crop.currentSizePercent.toFixed(1);
      const sizeSpan = document.createElement('span');
      const sizeColor = crop.currentSizePercent >= 90
        ? 'var(--qpm-positive)'
        : crop.currentSizePercent >= 70
          ? 'var(--qpm-warning)'
          : 'var(--qpm-text)';
      sizeSpan.style.cssText = `color: ${sizeColor}; font-weight: 600;`;
      sizeSpan.textContent = `${sizePercent}%`;
      sizeCell.appendChild(sizeSpan);
      row.appendChild(sizeCell);

      const boostsCell = document.createElement('td');
      boostsCell.style.cssText = 'padding: 12px 8px; text-align: right;';
      if (estimate && showDetailedView) {
        const bSpan = document.createElement('span');
        bSpan.style.cssText = 'color: var(--qpm-info); font-weight: 600;';
        bSpan.textContent = `${estimate.boostsReceived}/${estimate.boostsNeeded}`;
        boostsCell.appendChild(bSpan);
      } else if (estimate) {
        const bSpan = document.createElement('span');
        bSpan.style.cssText = 'color: var(--qpm-info); font-weight: 600;';
        bSpan.textContent = String(estimate.boostsNeeded);
        boostsCell.appendChild(bSpan);
      } else {
        boostsCell.textContent = t('feature.cropBoost.na');
      }
      row.appendChild(boostsCell);

      const timeCell = document.createElement('td');
      timeCell.style.cssText = 'padding: 12px 8px; text-align: right; color: var(--qpm-gold); font-weight: 500;';

      if (estimate) {
        if (!showDetailedView) {
          // Simple view: Show time range for next boost
          const minTime = formatTimeEstimate(estimate.timeEstimateP10);
          const maxTime = formatTimeEstimate(estimate.timeEstimateP90);
          const timeSpan = document.createElement('span');
          timeSpan.style.color = 'var(--qpm-gold)';
          timeSpan.textContent = `${minTime} - ${maxTime}`;
          timeCell.appendChild(timeSpan);
        } else {
          // Detailed view: Show full percentile range with median
          const timeRangeStr = formatTimeRange(estimate.timeEstimateP10, estimate.timeEstimateP50, estimate.timeEstimateP90);
          timeCell.textContent = timeRangeStr;
        }
      } else {
        timeCell.textContent = t('feature.cropBoost.na');
      }
      row.appendChild(timeCell);

      tbody.appendChild(row);
    });

    table.appendChild(tbody);
    tableCard.appendChild(table);
    root.appendChild(tableCard);
  } else {
    const allMaxCard = createEmptyState(
      selectedSpecies
        ? `${t('feature.cropBoost.allAtMaxSpecies', { species: capitalize(selectedSpecies) })} — ${t('feature.cropBoost.doingGreat')} 🎉`
        : `${t('feature.cropBoost.allAtMax')} — ${t('feature.cropBoost.doingGreat')} 🎉`
    );
    root.appendChild(allMaxCard);
  }

  if (preserveScroll) {
    requestAnimationFrame(() => {
      if (!root.isConnected) return;
      const maxScrollTop = Math.max(0, root.scrollHeight - root.clientHeight);
      const maxScrollLeft = Math.max(0, root.scrollWidth - root.clientWidth);
      root.scrollTop = Math.min(Math.max(0, previousScrollTop), maxScrollTop);
      root.scrollLeft = Math.min(Math.max(0, previousScrollLeft), maxScrollLeft);
    });
  }
}

// ============================================================================
// Public API
// ============================================================================

let windowRoot: HTMLElement | null = null;
let showDetailedView = false; // Toggle for simple/detailed view

/**
 * Embed crop boost content directly into a container (for hub tabs).
 * Registers the onAnalysisChange callback once.
 */
export function renderCropBoostContent(container: HTMLElement): () => void {
  let renderTimeout: number | null = null;
  renderCropBoostSection(container, { preserveScroll: false });
  const unsub = onAnalysisChange(() => {
    if (renderTimeout) clearTimeout(renderTimeout);
    renderTimeout = window.setTimeout(() => {
      const active = document.activeElement;
      if (active && active.tagName === 'SELECT') return;
      if (container.isConnected && isWindowBodyVisible(container)) {
        renderCropBoostSection(container, { preserveScroll: true });
      }
    }, 100);
  });
  return () => {
    unsub();
    if (renderTimeout) { clearTimeout(renderTimeout); renderTimeout = null; }
  };
}

export function openCropBoostTrackerWindow(): void {
  toggleWindow(
    'crop-boost-tracker',
    `🌱 ${t('feature.cropBoost.windowTitle')}`,
    (root: HTMLElement) => {
      windowRoot = root;

      let renderTimeout: number | null = null;
      const unsub = onAnalysisChange(() => {
        if (renderTimeout) clearTimeout(renderTimeout);
        renderTimeout = window.setTimeout(() => {
          const activeElement = document.activeElement;
          if (activeElement && activeElement.tagName === 'SELECT') return;
          if (windowRoot && isWindowBodyVisible(windowRoot)) {
            renderCropBoostSection(windowRoot, { preserveScroll: true });
          }
        }, 100);
      });

      renderCropBoostSection(root, { preserveScroll: false });

      // Tour system — auto-fire on first open + inject help button
      import('../tour').then(({ checkTour, injectReplayButton }) => {
        checkTour('crop-boost-tracker', root);
        injectReplayButton('crop-boost-tracker');
      });

      return () => {
        unsub();
        if (renderTimeout) { clearTimeout(renderTimeout); renderTimeout = null; }
        if (windowRoot === root) windowRoot = null;
      };
    },
    '650px',
    '75vh'
  );
}
