// src/ui/turtleTimerWindow.ts - Turtle Timer (renders inside modalWindow or hub card)

import {
  onTurtleTimerState,
  getTurtleTimerState,
  configureTurtleTimer,
  type TurtleTimerState,
  type TurtleTimerChannel,
  type TurtleContribution,
  type TurtleFocusOption,
  type TurtleTimerFocus,
} from '../../features/pets/turtleTimer';
import { getPetSpriteDataUrlWithMutations } from '../../sprite-v2/compat';
import { createTabBar } from '../components';
import { throttle } from '../../utils/scheduling';
import { storage } from '../../utils/storage';
import { t } from '../../i18n';
import { log } from '../../utils/logger';

// ============================================================================
// UTILITY HELPERS
// ============================================================================

function formatMs(ms: number | null | undefined): string {
  if (ms == null || ms < 0) return '—';
  const totalSecs = Math.floor(ms / 1000);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s.toString().padStart(2, '0')}s`;
  return `${s}s`;
}

/** Format a raw minutes value into Xh Ym or Xm */
function formatMinutes(mins: number): string {
  if (mins <= 0) return '0m';
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function makeSelect(style: string): HTMLSelectElement {
  const sel = document.createElement('select');
  sel.style.cssText = [
    'background:var(--qpm-surface-2)',
    'color:var(--qpm-text)',
    'border:1px solid var(--qpm-border)',
    'border-radius:4px',
    'font-size:12px',
    'padding:3px 6px',
    'cursor:pointer',
    'outline:none',
    style,
  ].join(';');
  return sel;
}

// ============================================================================
// TURTLE ROW
// ============================================================================

function buildTurtleRow(contribution: TurtleContribution): HTMLElement {
  const row = document.createElement('div');
  row.style.cssText = [
    'display:flex',
    'align-items:center',
    'gap:8px',
    'padding:7px 0',
    'border-top:1px solid rgba(255,255,255,0.05)',
  ].join(';');

  // Sprite
  const spriteUrl = contribution.species
    ? getPetSpriteDataUrlWithMutations(contribution.species, contribution.mutations ?? [])
    : null;
  if (spriteUrl) {
    const img = document.createElement('img');
    img.src = spriteUrl;
    img.style.cssText = 'width:22px;height:22px;object-fit:contain;image-rendering:pixelated;flex-shrink:0;';
    img.alt = contribution.species ?? '';
    row.appendChild(img);
  } else {
    const ph = document.createElement('div');
    ph.style.cssText = 'width:22px;height:22px;background:rgba(255,255,255,0.05);border-radius:3px;flex-shrink:0;';
    row.appendChild(ph);
  }

  // Name
  const nameEl = document.createElement('span');
  nameEl.textContent = contribution.name ?? contribution.species ?? t('feature.turtleTimer.slotFallback', { index: String(contribution.slotIndex + 1) });
  nameEl.style.cssText = 'font-size:12px;font-weight:600;color:var(--qpm-text);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  row.appendChild(nameEl);

  // Stats columns — fixed widths to align with column headers
  if (contribution.missingStats) {
    const pendingEl = document.createElement('span');
    pendingEl.textContent = t('feature.turtleTimer.dataPending');
    pendingEl.style.cssText = 'font-size:10px;color:#ffa500;font-style:italic;flex-shrink:0;margin-left:auto;';
    row.appendChild(pendingEl);
  } else {
    // Rate column (52px)
    const rateEl = document.createElement('span');
    if (contribution.perHourReduction > 0) {
      rateEl.textContent = `−${contribution.perHourReduction.toFixed(1)}`;
      rateEl.title = t('feature.turtleTimer.rateTooltip', { rate: contribution.perHourReduction.toFixed(1) });
      rateEl.style.cssText = 'font-size:10px;font-family:monospace;color:var(--qpm-accent);flex-shrink:0;width:52px;text-align:right;';
    } else {
      rateEl.style.cssText = 'flex-shrink:0;width:52px;';
    }
    row.appendChild(rateEl);

    // Hunger column (44px)
    const hungerEl = document.createElement('span');
    if (contribution.hungerPct != null) {
      const hPct = Math.round(contribution.hungerPct);
      const hColor = hPct < 20 ? 'var(--qpm-hunger-low)' : hPct < 50 ? 'var(--qpm-hunger-mid)' : 'var(--qpm-text-muted)';

      hungerEl.textContent = `${hPct}%`;
      hungerEl.title = t('feature.turtleTimer.hungerTooltip');
      hungerEl.style.cssText = `font-size:10px;color:${hColor};flex-shrink:0;width:44px;text-align:right;`;
    } else {
      hungerEl.style.cssText = 'flex-shrink:0;width:44px;';
    }
    row.appendChild(hungerEl);
  }

  return row;
}

// ============================================================================
// TAB CONTENT RENDERING
// ============================================================================

function buildFocusControls(
  isPlant: boolean,
  focusMode: TurtleTimerFocus,
  focusTargetKey: string | null,
  targets: TurtleFocusOption[],
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 12px;background:var(--qpm-surface-2);border-radius:6px;border:1px solid var(--qpm-border);';

  const modeLabel = document.createElement('span');
  modeLabel.textContent = t('feature.turtleTimer.trackLabel');
  modeLabel.style.cssText = 'font-size:12px;color:var(--qpm-text-muted);flex-shrink:0;';
  wrap.appendChild(modeLabel);

  // Focus mode selector
  const modeSelect = makeSelect('flex-shrink:0;');
  const modes: { value: TurtleTimerFocus; label: string }[] = [
    { value: 'latest', label: t('feature.turtleTimer.latestFinishing') },
    { value: 'earliest', label: t('feature.turtleTimer.earliestFinishing') },
    { value: 'specific', label: t('feature.turtleTimer.specificSlot') },
  ];
  for (const { value, label } of modes) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    if (value === focusMode) opt.selected = true;
    modeSelect.appendChild(opt);
  }
  wrap.appendChild(modeSelect);

  // Specific slot selector (shown when mode === 'specific')
  const targetSelect = makeSelect('flex:1;min-width:0;');
  const noTargetOpt = document.createElement('option');
  noTargetOpt.value = '';
  noTargetOpt.textContent = targets.length ? t('feature.turtleTimer.chooseSlot') : t('feature.turtleTimer.noSlotsAvailable');
  targetSelect.appendChild(noTargetOpt);

  for (const target of targets) {
    const opt = document.createElement('option');
    opt.value = target.key;
    const speciesLabel = target.species ?? t('feature.turtleTimer.unknownSpecies');
    const etaLabel = target.remainingMs != null ? ` (${formatMs(target.remainingMs)})` : '';
    opt.textContent = `${speciesLabel}${etaLabel}`;
    if (target.key === focusTargetKey) opt.selected = true;
    targetSelect.appendChild(opt);
  }

  targetSelect.style.display = focusMode === 'specific' ? '' : 'none';
  wrap.appendChild(targetSelect);

  // Event: mode change
  modeSelect.addEventListener('change', () => {
    const newMode = modeSelect.value as TurtleTimerFocus;
    targetSelect.style.display = newMode === 'specific' ? '' : 'none';
    if (newMode !== 'specific') {
      if (isPlant) {
        configureTurtleTimer({ focus: newMode, focusTargetTileId: null, focusTargetSlotIndex: null });
      } else {
        configureTurtleTimer({ eggFocus: newMode, eggFocusTargetTileId: null, eggFocusTargetSlotIndex: null });
      }
    }
  });

  // Event: specific target change
  targetSelect.addEventListener('change', () => {
    const key = targetSelect.value;
    const target = targets.find(t => t.key === key);
    if (!target) return;
    if (isPlant) {
      configureTurtleTimer({ focus: 'specific', focusTargetTileId: target.tileId, focusTargetSlotIndex: target.slotIndex });
    } else {
      configureTurtleTimer({ eggFocus: 'specific', eggFocusTargetTileId: target.tileId, eggFocusTargetSlotIndex: target.slotIndex });
    }
  });

  return wrap;
}

function buildSlotCountsRow(channel: TurtleTimerChannel): HTMLElement | null {
  if (channel.trackedSlots === 0) return null;

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:12px;font-size:12px;';

  const total = document.createElement('span');
  total.style.color = 'var(--qpm-text-muted)';
  total.textContent = t('feature.turtleTimer.tracked', { count: String(channel.trackedSlots) });
  row.appendChild(total);

  if (channel.growingSlots > 0) {
    const growing = document.createElement('span');
    growing.style.color = 'var(--qpm-text)';
    growing.textContent = t('feature.turtleTimer.growing', { count: String(channel.growingSlots) });
    row.appendChild(growing);
  }

  if (channel.maturedSlots > 0) {
    const ready = document.createElement('span');
    ready.style.color = 'var(--qpm-accent)';
    ready.textContent = t('feature.turtleTimer.ready', { count: String(channel.maturedSlots) });
    row.appendChild(ready);
  }

  return row;
}

function buildEtaBlock(channel: TurtleTimerChannel): HTMLElement {
  const block = document.createElement('div');
  block.style.cssText = [
    'background:var(--qpm-accent-tint)',
    'border:1px solid var(--qpm-accent-border)',
    'border-radius:5px',
    'padding:10px 12px',
    'display:flex',
    'flex-direction:column',
    'gap:4px',
  ].join(';');

  const hasTurtleBoost = channel.minutesSaved != null && channel.minutesSaved > 0;

  // Adjusted ETA (or natural if no turtles)
  const mainRow = document.createElement('div');
  mainRow.style.cssText = 'display:flex;align-items:baseline;gap:8px;';

  const icon = document.createElement('span');
  icon.textContent = '⏱';
  icon.style.cssText = 'font-size:14px;';
  mainRow.appendChild(icon);

  const timeVal = document.createElement('span');
  const displayMs = channel.adjustedMsRemaining ?? channel.naturalMsRemaining;
  timeVal.textContent = formatMs(displayMs);
  timeVal.style.cssText = `font-size:24px;font-weight:700;color:${hasTurtleBoost ? 'var(--qpm-accent)' : 'var(--qpm-text-muted)'};font-family:monospace;`;
  mainRow.appendChild(timeVal);

  if (hasTurtleBoost) {
    const badge = document.createElement('span');
    badge.textContent = t('feature.turtleTimer.timeSaved', { time: formatMinutes(channel.minutesSaved!) });
    badge.style.cssText = 'font-size:12px;color:var(--qpm-accent);opacity:0.8;';
    mainRow.appendChild(badge);
  }

  block.appendChild(mainRow);

  // Detail row
  if (hasTurtleBoost && channel.naturalMsRemaining != null) {
    const detail = document.createElement('div');
    detail.style.cssText = 'font-size:10px;color:var(--qpm-text-muted);';
    detail.textContent = t('feature.turtleTimer.withoutTurtles', { time: formatMs(channel.naturalMsRemaining) });
    block.appendChild(detail);
  } else if (!hasTurtleBoost && channel.status === 'no-turtles') {
    const note = document.createElement('div');
    note.style.cssText = 'font-size:10px;color:var(--qpm-text-muted);';
    note.textContent = t('feature.turtleTimer.noTurtlesAssigned');
    block.appendChild(note);
  }

  // Tracked species
  if (channel.focusSlot?.species) {
    const focusEl = document.createElement('div');
    focusEl.style.cssText = 'font-size:10px;color:var(--qpm-text-muted);';
    focusEl.textContent = t('feature.turtleTimer.tracking', { species: channel.focusSlot.species });
    block.appendChild(focusEl);
  }

  return block;
}

function getFocusSignature(
  tab: 'plant' | 'egg',
  focusMode: TurtleTimerFocus,
  focusTargetKey: string | null,
  targets: TurtleFocusOption[],
): string {
  return `${tab}:${focusMode}:${focusTargetKey ?? ''}:${targets.map(t => t.key).join(',')}`;
}

function updateDynamicZone(
  dynamicZone: HTMLElement,
  channel: TurtleTimerChannel,
): void {
  dynamicZone.innerHTML = '';

  const sections: HTMLElement[] = [];

  // Slot counts row
  const countsRow = buildSlotCountsRow(channel);
  if (countsRow) sections.push(countsRow);

  // ETA block or status message
  if (channel.status === 'estimating' || (channel.status === 'no-turtles' && channel.naturalMsRemaining != null)) {
    sections.push(buildEtaBlock(channel));
  } else {
    const statusMessages: Record<string, string> = {
      'disabled': t('feature.turtleTimer.statusDisabled'),
      'no-data': t('feature.turtleTimer.statusNoData'),
      'no-crops': t('feature.turtleTimer.statusNoCrops'),
      'no-eggs': t('feature.turtleTimer.statusNoEggs'),
      'no-turtles': t('feature.turtleTimer.statusNoTurtles'),
    };
    const msg = statusMessages[channel.status] ?? t('feature.turtleTimer.statusUnknown');
    const statusEl = document.createElement('div');
    statusEl.style.cssText = 'padding:16px;text-align:center;color:var(--qpm-text-muted);font-size:12px;font-style:italic;';
    statusEl.textContent = msg;
    sections.push(statusEl);
  }

  // Turtle contribution list
  if (channel.contributions.length > 0) {
    const contribCard = document.createElement('div');
    contribCard.style.cssText = [
      'background:var(--qpm-surface-2)',
      'border:1px solid var(--qpm-border)',
      'border-radius:6px',
      'padding:8px 12px',
    ].join(';');

    const contribHeader = document.createElement('div');
    contribHeader.style.cssText = 'font-size:12px;font-weight:600;color:var(--qpm-text-muted);margin-bottom:2px;';
    contribHeader.textContent = channel.contributions.length === 1
      ? t('feature.turtleTimer.turtleContributing', { count: '1' })
      : t('feature.turtleTimer.turtlesContributing', { count: String(channel.contributions.length) });
    contribCard.appendChild(contribHeader);

    if (channel.effectiveRate != null && channel.effectiveRate > 1) {
      const rateTotal = document.createElement('div');
      rateTotal.style.cssText = 'font-size:10px;color:var(--qpm-accent);margin-bottom:4px;';
      rateTotal.textContent = t('feature.turtleTimer.combinedGrowthSpeed', { rate: channel.effectiveRate.toFixed(1) });
      contribCard.appendChild(rateTotal);
    }

    // Column header row
    const colHeader = document.createElement('div');
    colHeader.style.cssText = 'display:flex;align-items:center;gap:8px;padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.06);margin-bottom:2px;';
    const chSpacer = document.createElement('div');
    chSpacer.style.cssText = 'width:22px;flex-shrink:0;';
    const chName = document.createElement('span');
    chName.textContent = t('feature.turtleTimer.colTurtle');
    chName.style.cssText = 'flex:1;font-size:9px;color:var(--qpm-text-muted);';
    const chRate = document.createElement('span');
    chRate.textContent = t('feature.turtleTimer.colRate');
    chRate.style.cssText = 'width:52px;text-align:right;font-size:9px;color:var(--qpm-text-muted);flex-shrink:0;';
    const chHunger = document.createElement('span');
    chHunger.textContent = t('feature.turtleTimer.colHunger');
    chHunger.style.cssText = 'width:44px;text-align:right;font-size:9px;color:var(--qpm-text-muted);flex-shrink:0;';
    colHeader.append(chSpacer, chName, chRate, chHunger);
    contribCard.appendChild(colHeader);

    for (const contrib of channel.contributions) {
      contribCard.appendChild(buildTurtleRow(contrib));
    }

    sections.push(contribCard);
  } else if (channel.status === 'estimating') {
    const noTurtles = document.createElement('div');
    noTurtles.style.cssText = 'font-size:12px;color:var(--qpm-text-muted);text-align:center;padding:8px;';
    noTurtles.textContent = t('feature.turtleTimer.noTurtlesActive');
    sections.push(noTurtles);
  }

  for (const section of sections) {
    dynamicZone.appendChild(section);
  }
}

// ============================================================================
// RENDER CONTENT (embeddable — no window chrome)
// ============================================================================

const TURTLE_TAB_KEY = 'qpm.turtleTimer.activeTab';

/**
 * Builds turtle timer content inside the given container.
 * Sets up subscriptions for live updates and returns an idempotent cleanup function.
 */
export function renderTurtleTimerContent(container: HTMLElement): () => void {
  let cleaned = false;
  const cleanups: Array<() => void> = [];

  // -- Internal state (closure variables) --
  let activeTab: 'plant' | 'egg' = storage.get<string>(TURTLE_TAB_KEY, 'plant') === 'egg' ? 'egg' : 'plant';
  let lastFocusSignature = '';
  let latestTimerState: TurtleTimerState | null = null;

  // -- DOM structure --
  // Summary strip
  const summaryStrip = document.createElement('div');
  summaryStrip.style.cssText = [
    'padding:5px 14px',
    'font-size:12px',
    'color:var(--qpm-text-muted)',
    'border-bottom:1px solid var(--qpm-border)',
    'flex-shrink:0',
    'white-space:nowrap',
    'overflow:hidden',
    'text-overflow:ellipsis',
  ].join(';');
  summaryStrip.textContent = t('common.loading');
  container.appendChild(summaryStrip);

  // Tab bar
  const { root: tabBarRoot } = createTabBar(
    [
      { id: 'plant', label: `🌱 ${t('feature.turtleTimer.tabPlants')}` },
      { id: 'egg', label: `🥚 ${t('feature.turtleTimer.tabEggs')}` },
    ],
    {
      persistKey: TURTLE_TAB_KEY,
      defaultTab: activeTab,
      onChange: (tabId) => {
        activeTab = tabId as 'plant' | 'egg';
        lastFocusSignature = '';
        if (latestTimerState) renderActiveTab(latestTimerState);
      },
    },
  );
  container.appendChild(tabBarRoot);

  // Scroll wrapper with focus + dynamic zones
  const scrollWrapper = document.createElement('div');
  scrollWrapper.style.cssText = 'flex:1;overflow-y:auto;overflow-x:hidden;';

  const contentWrap = document.createElement('div');
  contentWrap.style.cssText = 'padding:10px;display:flex;flex-direction:column;gap:8px;';

  const focusZone = document.createElement('div');
  focusZone.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
  contentWrap.appendChild(focusZone);

  const dynamicZone = document.createElement('div');
  dynamicZone.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
  contentWrap.appendChild(dynamicZone);

  scrollWrapper.appendChild(contentWrap);
  container.appendChild(scrollWrapper);

  // -- Render functions --
  const renderActiveTab = (timerState: TurtleTimerState): void => {
    const isPlant = activeTab === 'plant';
    const channel = isPlant ? timerState.plant : timerState.egg;
    const targets = isPlant ? timerState.plantTargets : timerState.eggTargets;
    const focusMode = isPlant ? timerState.focus : timerState.eggFocus;
    const focusTargetKey = isPlant ? timerState.focusTargetKey : timerState.eggFocusTargetKey;

    const sig = getFocusSignature(activeTab, focusMode, focusTargetKey, targets);
    if (sig !== lastFocusSignature) {
      lastFocusSignature = sig;
      focusZone.innerHTML = '';
      focusZone.appendChild(buildFocusControls(isPlant, focusMode, focusTargetKey, targets));
    }

    updateDynamicZone(dynamicZone, channel);
  };

  const renderTimerState = (timerState: TurtleTimerState): void => {
    latestTimerState = timerState;

    // Summary strip
    const summaryParts: string[] = [];
    summaryParts.push(timerState.availableTurtles === 1
      ? t('feature.turtleTimer.summaryTurtle', { count: '1' })
      : t('feature.turtleTimer.summaryTurtles', { count: String(timerState.availableTurtles) }));
    if (timerState.hungerFilteredCount > 0) summaryParts.push(t('feature.turtleTimer.summaryHungry', { count: String(timerState.hungerFilteredCount) }));
    if (timerState.turtlesMissingStats > 0) summaryParts.push(t('feature.turtleTimer.summaryDataPending', { count: String(timerState.turtlesMissingStats) }));
    summaryStrip.textContent = summaryParts.join(' · ');

    renderActiveTab(timerState);
  };

  // -- Subscription --
  const throttledRender = throttle((timerState: TurtleTimerState) => {
    renderTimerState(timerState);
  }, 500);

  const unsubTimer = onTurtleTimerState((timerState) => {
    throttledRender(timerState);
  }, false);
  cleanups.push(unsubTimer);

  // Initial render with current state
  try {
    renderTimerState(getTurtleTimerState());
  } catch (error) {
    log('⚠️ Failed to render turtle timer state', error);
  }

  // -- Idempotent cleanup --
  return () => {
    if (cleaned) return;
    cleaned = true;
    for (const fn of cleanups) fn();
    cleanups.length = 0;
  };
}
