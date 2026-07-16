// User X-close sets a session-only flag (cleared on reload); auto-open is hardcoded ON in Phase 1.
// Body refresh: keep a ref to the body element and wipe+repaint its children directly —
// shell owns mounting/clamping, consumer owns body content (see shell.ts).

import {
  openFloatingCard,
  closeFloatingCard,
  hasFloatingCard,
} from '../components/floatingCard';
import {
  subscribeAbilityTargets,
  getCachedPlayerTile,
} from '../../features/chargedAbilities/selector';
import { renderPetCard } from './petCard';
import { injectChargedAbilitiesStyles } from './styles';
import {
  getExpandedPetIds,
  setPetExpanded,
  getAutoOpenOverlay,
} from '../../features/chargedAbilities/storage';
import { PANEL_POSITION_STORAGE_KEY } from '../../features/chargedAbilities/constants';
import { groupSnapshots } from '../../features/chargedAbilities/grouping';
import { t } from '../../i18n';
import { showToast } from '../components/toast';
import type { PetAbilityTargetSnapshot } from '../../features/chargedAbilities/types';
import type { SnapshotGroup } from '../../features/chargedAbilities/grouping';

function groupExpandKey(group: SnapshotGroup): string {
  // Expansion state persists per (species + ability), independent of which
  // specific pet slot is the current group representative.
  return `g:${group.rep.petSpecies}|${group.rep.abilityId}`;
}

const PANEL_KEY = 'charged-abilities';
const DEFAULT_POSITION = { xPct: 0.78, yPct: 0.18 };

let userClosedThisSession = false;
let manuallyOpened = false;
let unsubscribe: (() => void) | null = null;
let latestSnapshots: readonly PetAbilityTargetSnapshot[] = [];
let bodyElement: HTMLDivElement | null = null;

function buildHeader(onClose: () => void): HTMLDivElement {
  const header = document.createElement('div');
  header.className = 'qpm-charged-abilities__header';
  const title = document.createElement('div');
  title.className = 'qpm-charged-abilities__title';
  title.textContent = t('feature.chargedAbilities.title');
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'qpm-charged-abilities__close';
  close.textContent = '×';
  close.title = t('feature.chargedAbilities.close');
  close.addEventListener('click', (e) => {
    e.stopPropagation();
    onClose();
  });
  header.append(title, close);
  return header;
}

function paintBody(body: HTMLElement, snapshots: readonly PetAbilityTargetSnapshot[]): void {
  body.replaceChildren();

  if (snapshots.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'qpm-charged-abilities__empty';
    empty.textContent = t('feature.chargedAbilities.noActivePets');
    body.appendChild(empty);
    return;
  }

  const allGroups = groupSnapshots(snapshots);
  const ready: SnapshotGroup[] = [];
  const others: SnapshotGroup[] = [];
  for (const g of allGroups) {
    if (g.rep.ready && g.rep.qualifyingCount > 0) ready.push(g);
    else others.push(g);
  }

  const expanded = getExpandedPetIds();
  const playerPos = getCachedPlayerTile();

  const renderSection = (label: string, items: SnapshotGroup[], autoExpand: boolean): void => {
    if (items.length === 0) return;
    const totalPets = items.reduce((sum, g) => sum + g.count, 0);
    const groupLabel = document.createElement('div');
    groupLabel.className = 'qpm-charged-abilities__group-label';
    groupLabel.textContent = `${label} · ${totalPets}`;
    body.appendChild(groupLabel);
    for (const group of items) {
      // Ready group cards are always expanded and not clickable. "Others"
      // cards track expand state in persistent storage and toggle on click.
      const expandKey = groupExpandKey(group);
      const isExpanded = autoExpand || expanded.has(expandKey);
      const card = renderPetCard(group, autoExpand
        ? { expanded: true, playerPos }
        : {
            expanded: isExpanded,
            onToggleExpand: () => {
              setPetExpanded(expandKey, !isExpanded);
              paintBody(body, latestSnapshots);
            },
            playerPos,
          });
      body.appendChild(card);
    }
  };

  renderSection(t('feature.chargedAbilities.group.ready'), ready, true);
  renderSection(t('feature.chargedAbilities.group.others'), others, false);
}

function ensurePanelOpen(): void {
  if (hasFloatingCard(PANEL_KEY)) {
    if (bodyElement) paintBody(bodyElement, latestSnapshots);
    return;
  }
  injectChargedAbilitiesStyles();
  const header = buildHeader(() => {
    userClosedThisSession = true;
    manuallyOpened = false;
    closeFloatingCard(PANEL_KEY);
  });
  const body = document.createElement('div');
  body.className = 'qpm-charged-abilities__body';
  bodyElement = body;

  openFloatingCard({
    key: PANEL_KEY,
    className: 'qpm-charged-abilities',
    header,
    body,
    persistKey: PANEL_POSITION_STORAGE_KEY,
    defaultPosition: DEFAULT_POSITION,
    baseWidth: 280,
    dragExcludeSelectors: ['.qpm-charged-abilities__close'],
    onDestroy: () => {
      bodyElement = null;
    },
  });

  paintBody(body, latestSnapshots);
}

function ensurePanelClosed(): void {
  if (hasFloatingCard(PANEL_KEY)) closeFloatingCard(PANEL_KEY);
}

function onSelectorEmit(snapshots: readonly PetAbilityTargetSnapshot[]): void {
  latestSnapshots = snapshots;
  if (snapshots.length === 0) {
    // Keep a manually-opened panel alive with an empty-state body; only the
    // reactive auto-open path is allowed to auto-close on empty.
    if (manuallyOpened && hasFloatingCard(PANEL_KEY)) {
      if (bodyElement) paintBody(bodyElement, snapshots);
      return;
    }
    ensurePanelClosed();
    return;
  }
  // Repaint an already-open panel so live changes show even when auto-open
  // is disabled; only the reactive auto-OPEN path is gated by the toggle.
  if (hasFloatingCard(PANEL_KEY)) {
    if (bodyElement) paintBody(bodyElement, snapshots);
    return;
  }
  if (userClosedThisSession) return;
  if (!getAutoOpenOverlay()) return;
  ensurePanelOpen();
}

export function startChargedAbilitiesPanel(): void {
  if (unsubscribe) return;
  unsubscribe = subscribeAbilityTargets(onSelectorEmit);
}

export function stopChargedAbilitiesPanel(): void {
  unsubscribe?.();
  unsubscribe = null;
  ensurePanelClosed();
  userClosedThisSession = false;
  manuallyOpened = false;
  latestSnapshots = [];
}

/** Force-open from a launch button; `manuallyOpened` prevents reactive auto-close from tearing it back down when empty. */
export function openChargedAbilitiesPanel(): void {
  userClosedThisSession = false;
  manuallyOpened = true;
  ensurePanelOpen();
  if (latestSnapshots.length === 0) {
    showToast(t('feature.chargedAbilities.noActivePets'), { variant: 'info' });
  }
}
