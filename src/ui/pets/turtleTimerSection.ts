// src/ui/sections/turtleTimerSection.ts — Turtle Timer section (plant/egg/support breakdown)
import { t } from '../../i18n';
import { type UIState } from '../panelState';
import { type TurtleTimerUIConfig, ensureTurtleTimerConfig, updateTurtleTimerViews } from './turtleTimerLogic';
import { createCard, parseFocusTargetKey, formatDurationPretty, formatCompletionTime } from '../panelHelpers';
import {
  onTurtleTimerState,
  setTurtleTimerEnabled,
  configureTurtleTimer,
  getTurtleTimerState,
} from '../../features/pets/turtleTimer';
import type { TurtleTimerState } from '../../features/pets/turtleTimer';

export function createTurtleTimerSection(uiState: UIState, cfg: any, saveCfg: () => void): HTMLElement {
  const { root, body } = createCard(`🐢 ${t('feature.turtleSection.title')}`, {
    subtitle: t('feature.turtleSection.subtitle'),
  });
  root.dataset.qpmSection = 'turtle-timer';

  const turtleCfg = ensureTurtleTimerConfig(cfg);

  const controls = document.createElement('div');
  controls.style.cssText = 'display:flex;flex-wrap:wrap;gap:10px;align-items:center;';

  const enableButton = document.createElement('button');
  enableButton.type = 'button';
  enableButton.className = 'qpm-chip';
  enableButton.style.cssText = 'cursor:pointer;user-select:none;min-width:84px;text-align:center;';
  enableButton.addEventListener('click', () => {
    const nextEnabled = !(cfg.turtleTimer?.enabled ?? true);
    cfg.turtleTimer = {
      ...ensureTurtleTimerConfig(cfg),
      enabled: nextEnabled,
    } satisfies TurtleTimerUIConfig;
    saveCfg();
    setTurtleTimerEnabled(nextEnabled);
  });
  controls.appendChild(enableButton);
  uiState.turtleEnableButtons.push(enableButton);

  // Boardwalk checkbox removed (no longer needed)

  const focusLabel = document.createElement('label');
  focusLabel.style.cssText = 'display:inline-flex;align-items:center;gap:6px;font-size:11px;color:#b2dfdb;';

  const focusSelect = document.createElement('select');
  focusSelect.className = 'qpm-select';
  focusSelect.style.cssText = 'min-width:120px;padding:4px 8px;font-size:11px;';
  focusSelect.addEventListener('click', (event) => event.stopPropagation());

  const latestOption = document.createElement('option');
  latestOption.value = 'latest';
  latestOption.textContent = t('feature.turtleSection.latestFinish');
  const earliestOption = document.createElement('option');
  earliestOption.value = 'earliest';
  earliestOption.textContent = t('feature.turtleSection.earliestFinish');
  const specificOption = document.createElement('option');
  specificOption.value = 'specific';
  specificOption.textContent = t('feature.turtleSection.specificPlant');
  focusSelect.append(latestOption, earliestOption, specificOption);
  focusSelect.value = turtleCfg.focus;

  const targetLabel = document.createElement('label');
  targetLabel.style.cssText = 'display:inline-flex;align-items:center;gap:6px;font-size:11px;color:#b2dfdb;';
  targetLabel.style.display = turtleCfg.focus === 'specific' ? 'inline-flex' : 'none';

  const targetSelect = document.createElement('select');
  targetSelect.className = 'qpm-select';
  targetSelect.style.cssText = 'min-width:180px;padding:4px 8px;font-size:11px;';
  targetSelect.addEventListener('click', (event) => event.stopPropagation());

  focusSelect.addEventListener('change', () => {
    const raw = focusSelect.value;
    const value: TurtleTimerState['focus'] = raw === 'earliest' ? 'earliest' : raw === 'specific' ? 'specific' : 'latest';
    const base = ensureTurtleTimerConfig(cfg);
    const nextConfig: TurtleTimerUIConfig = {
      ...base,
      focus: value,
    } satisfies TurtleTimerUIConfig;
    cfg.turtleTimer = nextConfig;
    saveCfg();
    const payload: Parameters<typeof configureTurtleTimer>[0] = { focus: value };
    if (value === 'specific') {
      payload.focusTargetTileId = nextConfig.focusTargetTileId;
      payload.focusTargetSlotIndex = nextConfig.focusTargetSlotIndex;
    }
    configureTurtleTimer(payload);
    targetLabel.style.display = value === 'specific' ? 'inline-flex' : 'none';
  });

  const focusText = document.createElement('span');
  focusText.textContent = t('feature.turtleSection.focus');
  focusLabel.append(focusText, focusSelect);
  controls.appendChild(focusLabel);
  uiState.turtleFocusSelects.push(focusSelect);
  const targetText = document.createElement('span');
  targetText.textContent = t('feature.turtleSection.targetPlant');
  targetLabel.append(targetText, targetSelect);
  controls.appendChild(targetLabel);
  uiState.turtleFocusTargetContainers.push(targetLabel);
  uiState.turtleFocusTargetSelects.push(targetSelect);

  targetSelect.addEventListener('change', () => {
    const { tileId, slotIndex } = parseFocusTargetKey(targetSelect.value);
    const base = ensureTurtleTimerConfig(cfg);
    const nextConfig: TurtleTimerUIConfig = {
      ...base,
      focus: 'specific',
      focusTargetTileId: tileId,
      focusTargetSlotIndex: slotIndex,
    } satisfies TurtleTimerUIConfig;
    cfg.turtleTimer = nextConfig;
    saveCfg();
    configureTurtleTimer({
      focus: 'specific',
      focusTargetTileId: tileId,
      focusTargetSlotIndex: slotIndex,
    });
  });

  const eggFocusLabel = document.createElement('label');
  eggFocusLabel.style.cssText = 'display:inline-flex;align-items:center;gap:6px;font-size:11px;color:#bda7f5;';

  const eggFocusSelect = document.createElement('select');
  eggFocusSelect.className = 'qpm-select';
  eggFocusSelect.style.cssText = 'min-width:120px;padding:4px 8px;font-size:11px;';
  eggFocusSelect.addEventListener('click', (event) => event.stopPropagation());

  const eggLatestOption = document.createElement('option');
  eggLatestOption.value = 'latest';
  eggLatestOption.textContent = t('feature.turtleSection.latestHatch');
  const eggEarliestOption = document.createElement('option');
  eggEarliestOption.value = 'earliest';
  eggEarliestOption.textContent = t('feature.turtleSection.earliestHatch');
  const eggSpecificOption = document.createElement('option');
  eggSpecificOption.value = 'specific';
  eggSpecificOption.textContent = t('feature.turtleSection.specificEgg');
  eggFocusSelect.append(eggLatestOption, eggEarliestOption, eggSpecificOption);
  eggFocusSelect.value = turtleCfg.eggFocus;

  const eggTargetLabel = document.createElement('label');
  eggTargetLabel.style.cssText = 'display:inline-flex;align-items:center;gap:6px;font-size:11px;color:#bda7f5;';
  eggTargetLabel.style.display = turtleCfg.eggFocus === 'specific' ? 'inline-flex' : 'none';

  const eggTargetSelect = document.createElement('select');
  eggTargetSelect.className = 'qpm-select';
  eggTargetSelect.style.cssText = 'min-width:180px;padding:4px 8px;font-size:11px;';
  eggTargetSelect.addEventListener('click', (event) => event.stopPropagation());

  eggFocusSelect.addEventListener('change', () => {
    const raw = eggFocusSelect.value;
    const value: TurtleTimerState['eggFocus'] = raw === 'earliest' ? 'earliest' : raw === 'specific' ? 'specific' : 'latest';
    const base = ensureTurtleTimerConfig(cfg);
    const nextConfig: TurtleTimerUIConfig = {
      ...base,
      eggFocus: value,
    } satisfies TurtleTimerUIConfig;
    cfg.turtleTimer = nextConfig;
    saveCfg();
    const payload: Parameters<typeof configureTurtleTimer>[0] = { eggFocus: value };
    if (value === 'specific') {
      payload.eggFocusTargetTileId = nextConfig.eggFocusTargetTileId;
      payload.eggFocusTargetSlotIndex = nextConfig.eggFocusTargetSlotIndex;
    }
    configureTurtleTimer(payload);
    eggTargetLabel.style.display = value === 'specific' ? 'inline-flex' : 'none';
  });

  const eggFocusText = document.createElement('span');
  eggFocusText.textContent = t('feature.turtleSection.eggFocus');
  eggFocusLabel.append(eggFocusText, eggFocusSelect);
  controls.appendChild(eggFocusLabel);
  uiState.turtleEggFocusSelects.push(eggFocusSelect);

  const eggTargetText = document.createElement('span');
  eggTargetText.textContent = t('feature.turtleSection.targetEgg');
  eggTargetLabel.append(eggTargetText, eggTargetSelect);
  controls.appendChild(eggTargetLabel);
  uiState.turtleEggFocusTargetContainers.push(eggTargetLabel);
  uiState.turtleEggFocusTargetSelects.push(eggTargetSelect);

  eggTargetSelect.addEventListener('change', () => {
    const { tileId, slotIndex } = parseFocusTargetKey(eggTargetSelect.value);
    const base = ensureTurtleTimerConfig(cfg);
    const nextConfig: TurtleTimerUIConfig = {
      ...base,
      eggFocus: 'specific',
      eggFocusTargetTileId: tileId,
      eggFocusTargetSlotIndex: slotIndex,
    } satisfies TurtleTimerUIConfig;
    cfg.turtleTimer = nextConfig;
    saveCfg();
    configureTurtleTimer({
      eggFocus: 'specific',
      eggFocusTargetTileId: tileId,
      eggFocusTargetSlotIndex: slotIndex,
    });
  });

  body.appendChild(controls);

  const hint = document.createElement('div');
  hint.style.cssText = 'font-size:10px;color:#9acccc;line-height:1.4;';
  hint.textContent = t('feature.turtleSection.hint');
  body.appendChild(hint);

  const createSectionCard = (title: string, accentColor: string, icon: string) => {
    const card = document.createElement('div');
    card.style.cssText = `padding:14px;border-radius:12px;border:2px solid ${accentColor};background:linear-gradient(135deg, rgba(10,20,20,0.6), rgba(10,20,20,0.3));display:flex;flex-direction:column;gap:10px;box-shadow: 0 4px 12px rgba(0,0,0,0.3);`;

    // Visual header with progress indicator
    const headerRow = document.createElement('div');
    headerRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:12px;';

    const headerLeft = document.createElement('div');
    headerLeft.style.cssText = 'display:flex;align-items:center;gap:10px;';

    const iconEl = document.createElement('span');
    iconEl.style.cssText = 'font-size:24px;';
    iconEl.textContent = icon;

    const header = document.createElement('div');
    header.style.cssText = 'font-weight:700;font-size:14px;color:#e0f7fa;letter-spacing:0.3px;';
    header.textContent = title;

    headerLeft.append(iconEl, header);

    const etaEl = document.createElement('div');
    etaEl.style.cssText = 'font-size:14px;font-weight:700;color:#4CAF50;background:rgba(76,175,80,0.15);padding:6px 12px;border-radius:8px;border:1px solid rgba(76,175,80,0.3);';
    headerRow.append(headerLeft, etaEl);
    card.appendChild(headerRow);

    // Stats grid (visual, icon-based)
    const statsGrid = document.createElement('div');
    statsGrid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;';

    const summaryEl = document.createElement('div');
    summaryEl.style.cssText = 'display:flex;flex-direction:column;gap:4px;padding:8px;background:rgba(255,255,255,0.05);border-radius:6px;';
    statsGrid.appendChild(summaryEl);

    const totalsEl = document.createElement('div');
    totalsEl.style.cssText = 'display:flex;flex-direction:column;gap:4px;padding:8px;background:rgba(255,255,255,0.05);border-radius:6px;';
    statsGrid.appendChild(totalsEl);

    card.appendChild(statsGrid);

    // Simple status line with visual indicators
    const simpleEl = document.createElement('div');
    simpleEl.style.cssText = 'font-size:12px;color:#b2dfdb;line-height:1.6;padding:8px;background:rgba(178,223,219,0.1);border-radius:6px;border-left:3px solid #4CAF50;display:flex;align-items:center;gap:8px;';
    card.appendChild(simpleEl);

    // Luck range (compact visual)
    const luckEl = document.createElement('div');
    luckEl.style.cssText = 'font-size:11px;color:#80CBC4;padding:6px 10px;background:rgba(128,203,196,0.08);border-radius:6px;display:flex;align-items:center;gap:6px;';
    card.appendChild(luckEl);

    // Pets table (cleaner header)
    const tableHeader = document.createElement('div');
    tableHeader.style.cssText = 'display:grid;grid-template-columns:1.4fr 0.7fr 0.6fr 0.8fr;gap:8px;font-size:11px;color:#4CAF50;text-transform:uppercase;letter-spacing:0.6px;font-weight:700;padding:6px 8px;background:rgba(76,175,80,0.1);border-radius:6px;';
    for (const text of [`🐾 ${t('feature.turtleSection.colPet')}`, `🍖 ${t('feature.turtleSection.colHunger')}`, `⚡ ${t('feature.turtleSection.colBoost')}`, `✨ ${t('feature.turtleSection.colXp')}`]) {
      const span = document.createElement('span');
      span.textContent = text;
      tableHeader.appendChild(span);
    }
    card.appendChild(tableHeader);

    const tableBody = document.createElement('div');
    tableBody.style.cssText = 'display:flex;flex-direction:column;gap:3px;min-height:18px;max-height:200px;overflow-y:auto;';
    card.appendChild(tableBody);

    return { card, etaEl, summaryEl, totalsEl, simpleEl, luckEl, tableBody } as const;
  };

  const plantCard = createSectionCard(t('feature.turtleSection.plantGrowth'), 'rgba(76,175,80,0.6)', '🌱');
  body.appendChild(plantCard.card);
  uiState.turtlePlantEta = plantCard.etaEl;
  uiState.turtlePlantSummary = plantCard.summaryEl;
  uiState.turtlePlantTotals = plantCard.totalsEl;
  uiState.turtlePlantSimple = plantCard.simpleEl;
  uiState.turtlePlantLuck = plantCard.luckEl;
  uiState.turtlePlantTable = plantCard.tableBody;

  const eggCard = createSectionCard(t('feature.turtleSection.eggHatching'), 'rgba(156,39,176,0.6)', '🥚');
  body.appendChild(eggCard.card);
  uiState.turtleEggEta = eggCard.etaEl;
  uiState.turtleEggSummary = eggCard.summaryEl;
  uiState.turtleEggTotals = eggCard.totalsEl;
  uiState.turtleEggSimple = eggCard.simpleEl;
  uiState.turtleEggLuck = eggCard.luckEl;
  uiState.turtleEggTable = eggCard.tableBody;

  const supportCard = document.createElement('div');
  supportCard.style.cssText = 'padding:14px;border-radius:12px;border:2px solid rgba(255,152,0,0.6);background:linear-gradient(135deg, rgba(30,24,12,0.6), rgba(30,24,12,0.3));display:flex;flex-direction:column;gap:10px;box-shadow: 0 4px 12px rgba(0,0,0,0.3);';

  const supportHeaderRow = document.createElement('div');
  supportHeaderRow.style.cssText = 'display:flex;align-items:center;gap:10px;';

  const supportIcon = document.createElement('span');
  supportIcon.style.cssText = 'font-size:24px;';
  supportIcon.textContent = '🍽️';

  const supportHeader = document.createElement('div');
  supportHeader.style.cssText = 'font-weight:700;font-size:14px;color:#FFB74D;letter-spacing:0.3px;';
  supportHeader.textContent = t('feature.turtleSection.foodTurtles');

  supportHeaderRow.append(supportIcon, supportHeader);
  supportCard.appendChild(supportHeaderRow);

  const supportStatsGrid = document.createElement('div');
  supportStatsGrid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;';

  const supportSummary = document.createElement('div');
  supportSummary.style.cssText = 'padding:8px;background:rgba(255,255,255,0.05);border-radius:6px;font-size:11px;color:#FFE082;';
  supportStatsGrid.appendChild(supportSummary);

  const supportTotals = document.createElement('div');
  supportTotals.style.cssText = 'padding:8px;background:rgba(255,255,255,0.05);border-radius:6px;font-size:11px;color:#FFE082;';
  supportStatsGrid.appendChild(supportTotals);

  supportCard.appendChild(supportStatsGrid);

  const supportSimple = document.createElement('div');
  supportSimple.style.cssText = 'font-size:12px;color:#FFECB3;line-height:1.6;padding:8px;background:rgba(255,236,179,0.1);border-radius:6px;border-left:3px solid #FFB74D;';
  supportCard.appendChild(supportSimple);

  const supportList = document.createElement('div');
  supportList.style.cssText = 'display:flex;flex-direction:column;gap:4px;max-height:180px;overflow-y:auto;';
  supportCard.appendChild(supportList);

  body.appendChild(supportCard);
  uiState.turtleSupportSummary = supportSummary;
  uiState.turtleSupportTotals = supportTotals;
  uiState.turtleSupportSimple = supportSimple;
  uiState.turtleSupportList = supportList;

  // ETA Helper Tool
  const etaHelperCard = document.createElement('div');
  etaHelperCard.style.cssText = 'padding:12px;border-radius:10px;border:1px solid rgba(100,181,246,0.45);background:linear-gradient(135deg, rgba(100,181,246,0.08), rgba(100,181,246,0.03));display:flex;flex-direction:column;gap:10px;';

  const etaHelperHeader = document.createElement('div');
  etaHelperHeader.style.cssText = 'font-weight:700;font-size:13px;color:#64b5f6;letter-spacing:0.3px;';
  etaHelperHeader.textContent = `⏰ ${t('feature.turtleSection.etaHelper')}`;
  etaHelperCard.appendChild(etaHelperHeader);

  const etaHelperHint = document.createElement('div');
  etaHelperHint.style.cssText = 'font-size:10px;color:#90caf9;line-height:1.5;';
  etaHelperHint.textContent = t('feature.turtleSection.etaHint');
  etaHelperCard.appendChild(etaHelperHint);

  const turtleWarning = document.createElement('div');
  turtleWarning.style.cssText = 'font-size:10px;color:#ffb74d;line-height:1.5;padding:6px;background:rgba(255,152,0,0.1);border-radius:4px;border-left:3px solid #ffb74d;margin-top:6px;';
  turtleWarning.textContent = `⚠️ ${t('feature.turtleSection.etaWarning')}`;
  turtleWarning.title = t('feature.turtleSection.etaWarningTooltip');
  etaHelperCard.appendChild(turtleWarning);

  const etaHelperInputs = document.createElement('div');
  etaHelperInputs.style.cssText = 'display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;';
  etaHelperCard.appendChild(etaHelperInputs);

  const dateInputWrapper = document.createElement('div');
  dateInputWrapper.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
  const dateLabel = document.createElement('label');
  dateLabel.style.cssText = 'font-size:10px;color:#b3e5fc;font-weight:600;';
  dateLabel.textContent = t('feature.turtleSection.targetDate');
  const dateInput = document.createElement('input');
  dateInput.type = 'text';
  dateInput.className = 'qpm-input';
  dateInput.placeholder = 'DD/MM';
  dateInput.style.cssText = 'padding:6px 10px;font-size:11px;min-width:80px;max-width:80px;';
  dateInput.addEventListener('keydown', e => e.stopPropagation());
  // Auto-format as user types
  dateInput.addEventListener('input', () => {
    let value = dateInput.value.replace(/\D/g, ''); // Remove non-digits
    if (value.length >= 2) {
      value = value.slice(0, 2) + '/' + value.slice(2, 4);
    }
    dateInput.value = value;
  });
  dateInputWrapper.append(dateLabel, dateInput);
  etaHelperInputs.appendChild(dateInputWrapper);

  const timeInputWrapper = document.createElement('div');
  timeInputWrapper.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
  const timeLabel = document.createElement('label');
  timeLabel.style.cssText = 'font-size:10px;color:#b3e5fc;font-weight:600;';
  timeLabel.textContent = t('feature.turtleSection.targetTime');
  const timeInput = document.createElement('input');
  timeInput.type = 'time';
  timeInput.className = 'qpm-input';
  timeInput.style.cssText = 'padding:6px 10px;font-size:11px;min-width:120px;';
  timeInput.addEventListener('keydown', e => e.stopPropagation());
  timeInputWrapper.append(timeLabel, timeInput);
  etaHelperInputs.appendChild(timeInputWrapper);

  const plantSelectWrapper = document.createElement('div');
  plantSelectWrapper.style.cssText = 'display:flex;flex-direction:column;gap:4px;flex:1;min-width:180px;';
  const plantLabel = document.createElement('label');
  plantLabel.style.cssText = 'font-size:10px;color:#b3e5fc;font-weight:600;';
  plantLabel.textContent = t('feature.turtleSection.selectPlant');
  const plantSelect = document.createElement('select');
  plantSelect.className = 'qpm-select';
  plantSelect.style.cssText = 'padding:6px 10px;font-size:11px;';
  plantSelect.addEventListener('click', e => e.stopPropagation());
  const placeholderOption = document.createElement('option');
  placeholderOption.value = '';
  placeholderOption.textContent = t('feature.turtleSection.choosePlant');
  placeholderOption.disabled = true;
  placeholderOption.selected = true;
  plantSelect.appendChild(placeholderOption);
  plantSelectWrapper.append(plantLabel, plantSelect);
  etaHelperInputs.appendChild(plantSelectWrapper);

  const calculateButton = document.createElement('button');
  calculateButton.type = 'button';
  calculateButton.className = 'qpm-button qpm-button--accent';
  calculateButton.textContent = t('feature.turtleSection.calculate');
  calculateButton.style.cssText = 'padding:6px 16px;font-size:11px;font-weight:600;align-self:flex-end;';
  etaHelperInputs.appendChild(calculateButton);

  const etaHelperResults = document.createElement('div');
  etaHelperResults.style.cssText = 'display:none;flex-direction:column;gap:6px;padding:10px;background:rgba(10,20,30,0.5);border-radius:8px;border:1px solid rgba(100,181,246,0.2);';
  etaHelperCard.appendChild(etaHelperResults);

  const updatePlantOptions = () => {
    const state = getTurtleTimerState();
    const now = Date.now();

    // Save current selection
    const currentValue = plantSelect.value;

    // Clear existing options except placeholder
    while (plantSelect.options.length > 1) {
      plantSelect.remove(1);
    }

    // Add plant options from plant targets
    let addedCount = 0;
    for (const target of state.plantTargets) {
      if (target.endTime && target.endTime > now) {
        const option = document.createElement('option');
        option.value = target.key;
        const speciesName = target.species || t('feature.turtleTimer.unknownSpecies');
        option.textContent = `${speciesName} - ${formatDurationPretty(target.remainingMs || 0)}`;
        option.dataset.endTime = String(target.endTime);
        option.dataset.species = speciesName;
        plantSelect.appendChild(option);
        addedCount++;
      }
    }

    // Show message if no plants available
    if (addedCount === 0) {
      const noPlants = document.createElement('option');
      noPlants.value = '';
      noPlants.textContent = t('feature.turtleSection.noGrowingPlants');
      noPlants.disabled = true;
      plantSelect.appendChild(noPlants);
    }

    // Restore selection if the plant still exists
    if (currentValue) {
      const matchingOption = Array.from(plantSelect.options).find(opt => opt.value === currentValue);
      if (matchingOption) {
        plantSelect.value = currentValue;
      }
    }
  };

  calculateButton.addEventListener('click', () => {
    const selectedOption = plantSelect.selectedOptions[0];
    if (!selectedOption || !timeInput.value || !dateInput.value) {
      etaHelperResults.style.display = 'none';
      return;
    }

    const endTime = Number(selectedOption.dataset.endTime);
    const species = selectedOption.dataset.species || t('feature.turtleTimer.unknownSpecies');
    const now = Date.now();

    // Parse target date (DD/MM format)
    const dateParts = dateInput.value.split('/').map(Number);
    const day = dateParts[0];
    const month = dateParts[1];

    if (!day || !month || day < 1 || day > 31 || month < 1 || month > 12) {
      etaHelperResults.textContent = '';
      const errDiv = document.createElement('div');
      errDiv.style.cssText = 'color:#ef5350;font-size:11px;';
      errDiv.textContent = t('feature.turtleSection.invalidDate');
      etaHelperResults.appendChild(errDiv);
      etaHelperResults.style.display = 'flex';
      return;
    }

    // Parse target time
    const timeParts = timeInput.value.split(':').map(Number);
    const hours = timeParts[0] ?? 0;
    const minutes = timeParts[1] ?? 0;

    // Calculate natural completion in days
    const naturalMsRemaining = endTime - now;

    // Build target date from user input
    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();

    // Try current year first, then next year if needed
    let targetDate = new Date(currentYear, month - 1, day, hours, minutes, 0, 0);

    // If the date is in the past, try next year
    if (targetDate.getTime() < now) {
      targetDate = new Date(currentYear + 1, month - 1, day, hours, minutes, 0, 0);
    }

    const targetMs = targetDate.getTime();
    const daysAhead = Math.floor((targetMs - now) / (24 * 60 * 60 * 1000));

    const targetMsRemaining = targetMs - now;

    if (targetMsRemaining <= 0) {
      etaHelperResults.textContent = '';
      const pastDiv = document.createElement('div');
      pastDiv.style.cssText = 'color:#ef5350;font-size:11px;';
      pastDiv.textContent = t('feature.turtleSection.targetInPast');
      etaHelperResults.appendChild(pastDiv);
      etaHelperResults.style.display = 'flex';
      return;
    }

    // Get current turtle state
    const state = getTurtleTimerState();
    const turtleRate = state.plant.effectiveRate || 0;
    const adjustedMsRemaining = state.plant.adjustedMsRemaining;

    // Use CURRENT turtle state: if turtles active, use boosted time; otherwise use natural time
    const currentTimeRemaining = (turtleRate > 0 && adjustedMsRemaining) ? adjustedMsRemaining : naturalMsRemaining;
    const hasTurtles = turtleRate > 0 && !!adjustedMsRemaining && adjustedMsRemaining > 0;

    // Calculate watering cans needed (each watering can reduces time by 5 minutes = 300000ms)
    const wateringCanReduction = 5 * 60 * 1000; // 5 minutes per watering can
    const msToSave = Math.max(0, currentTimeRemaining - targetMsRemaining);
    const wateringCansNeeded = Math.ceil(msToSave / wateringCanReduction);

    etaHelperResults.textContent = '';

    const resultTitle = document.createElement('div');
    resultTitle.style.cssText = 'font-weight:700;font-size:11px;color:#64b5f6;margin-bottom:4px;';
    resultTitle.textContent = t('feature.turtleSection.resultsFor', { species });
    etaHelperResults.appendChild(resultTitle);

    // Show current state info
    const currentStateRow = document.createElement('div');
    currentStateRow.style.cssText = 'font-size:10px;color:#e0e0e0;line-height:1.6;padding:6px;background:rgba(255,255,255,0.05);border-radius:4px;margin-bottom:4px;';
    const stateStrong = document.createElement('strong');
    if (hasTurtles) {
      stateStrong.style.color = '#81c784';
      stateStrong.textContent = `🐢 ${t('feature.turtleSection.stateWithTurtles')}`;
    } else {
      stateStrong.style.color = '#90caf9';
      stateStrong.textContent = t('feature.turtleSection.stateNoTurtles');
    }
    currentStateRow.appendChild(stateStrong);
    currentStateRow.append(` ${formatDurationPretty(currentTimeRemaining)} • ${formatCompletionTime(currentTimeRemaining)}`);
    etaHelperResults.appendChild(currentStateRow);

    const targetRow = document.createElement('div');
    targetRow.style.cssText = 'font-size:10px;color:#e0e0e0;line-height:1.6;';
    const dateLabelStr = daysAhead === 0 ? t('feature.turtleSection.today') : daysAhead === 1 ? t('feature.turtleSection.tomorrow') : t('feature.turtleSection.inDays', { days: String(daysAhead) });
    const targetDateStr = `${dateInput.value} ${timeInput.value}`;
    const targetStrong = document.createElement('strong');
    targetStrong.style.color = '#ffb74d';
    targetStrong.textContent = t('feature.turtleSection.targetLabel');
    targetRow.appendChild(targetStrong);
    targetRow.append(` ${targetDateStr} (${dateLabelStr}) • ${t('feature.turtleSection.fromNow', { time: formatDurationPretty(targetMsRemaining) })}`);
    etaHelperResults.appendChild(targetRow);

    const wateringRow = document.createElement('div');
    wateringRow.style.cssText = 'font-size:11px;color:#fff;font-weight:700;padding:8px;background:rgba(100,181,246,0.15);border-radius:6px;margin-top:4px;';

    if (wateringCansNeeded === 0) {
      const checkSpan = document.createElement('span');
      checkSpan.style.color = '#81c784';
      checkSpan.textContent = t('feature.turtleSection.noWateringNeeded');
      wateringRow.append('✅ ');
      wateringRow.appendChild(checkSpan);
      const detailSpan = document.createElement('div');
      detailSpan.style.cssText = 'font-size:10px;font-weight:400;color:#b0b0b0;';
      detailSpan.textContent = t('feature.turtleSection.finishBefore', { time: formatDurationPretty(Math.abs(msToSave)) });
      wateringRow.appendChild(detailSpan);
    } else {
      const stateNote = hasTurtles ? t('feature.turtleSection.withTurtleBoost') : t('feature.turtleSection.noTurtleBoost');
      const countSpan = document.createElement('span');
      countSpan.style.color = '#64b5f6';
      countSpan.textContent = t('feature.turtleSection.wateringNeeded', { count: String(wateringCansNeeded) });
      wateringRow.append('💧 ');
      wateringRow.appendChild(countSpan);
      const noteSpan = document.createElement('div');
      noteSpan.style.cssText = 'font-size:10px;font-weight:400;color:#b0b0b0;';
      noteSpan.textContent = `${t('feature.turtleSection.wateringNote')} ${stateNote}`;
      wateringRow.appendChild(noteSpan);
    }
    etaHelperResults.appendChild(wateringRow);

    etaHelperResults.style.display = 'flex';
  });

  // Update plant options when turtle timer state changes
  if (uiState.turtleUnsubscribe) {
    uiState.turtleUnsubscribe();
  }
  uiState.turtleUnsubscribe = onTurtleTimerState(() => {
    updatePlantOptions();
  });

  // Initial update
  updatePlantOptions();

  body.appendChild(etaHelperCard);

  updateTurtleTimerViews(uiState, getTurtleTimerState());

  return root;
}
