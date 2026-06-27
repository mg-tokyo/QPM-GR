// src/ui/chargedAbilities/window.ts
// Full "Charged Abilities" window — opened from the hub tile. Renders large
// per-pet cards plus a hutch sidebar listing other charged-ability pets.
//
// Lifecycle:
//   - openChargedAbilitiesWindow toggles a window via toggleWindow.
//   - On open we subscribe to the selector + hutch atom and repaint in place.
//   - The window owns its subscriptions; closeChargedAbilitiesWindow tears
//     them down. The floating overlay is independent.

import { toggleWindow, isWindowOpen, closeWindow } from '../core/modalWindow';
import { t } from '../../i18n';
import {
  subscribeAbilityTargets,
  getCachedPlayerTile,
} from '../../features/chargedAbilities/selector';
import { subscribeAtomValue } from '../../core/atomRegistry';
import { injectChargedAbilitiesStyles } from './styles';
import { renderWindowPetCard } from './windowCard';
import { renderHutchSidebar } from './hutchSidebar';
import { renderGardenTotals } from './gardenTotals';
import { groupSnapshots } from '../../features/chargedAbilities/grouping';
import {
  getAutoOpenOverlay,
  setAutoOpenOverlay,
} from '../../features/chargedAbilities/storage';
import type { PetAbilityTargetSnapshot } from '../../features/chargedAbilities/types';
import type { SnapshotGroup } from '../../features/chargedAbilities/grouping';

const WINDOW_ID = 'charged-abilities-window';
const WINDOW_WIDTH = '640px';
const WINDOW_HEIGHT = '80vh';

let latestSnapshots: readonly PetAbilityTargetSnapshot[] = [];
let bodyRef: HTMLElement | null = null;
let unsubSelector: (() => void) | null = null;
let unsubHutch: (() => void) | null = null;

function buildEmptyState(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'qpm-charged-abilities__wempty';
  const heading = document.createElement('div');
  heading.className = 'qpm-charged-abilities__wempty-heading';
  heading.textContent = t('feature.chargedAbilities.window.emptyHeading');
  const body = document.createElement('div');
  body.className = 'qpm-charged-abilities__wempty-body';
  body.textContent = t('feature.chargedAbilities.window.emptyBody');
  wrap.append(heading, body);
  return wrap;
}

function paintRoster(target: HTMLElement, snapshots: readonly PetAbilityTargetSnapshot[]): void {
  target.replaceChildren();
  if (snapshots.length === 0) {
    target.appendChild(buildEmptyState());
    return;
  }
  const allGroups = groupSnapshots(snapshots);
  const ready: SnapshotGroup[] = [];
  const others: SnapshotGroup[] = [];
  for (const g of allGroups) {
    if (g.rep.ready && g.rep.qualifyingCount > 0) ready.push(g);
    else others.push(g);
  }
  const playerPos = getCachedPlayerTile();
  appendGroupSection(target, t('feature.chargedAbilities.group.ready'), ready, playerPos);
  appendGroupSection(target, t('feature.chargedAbilities.group.others'), others, playerPos);
}

function appendGroupSection(
  target: HTMLElement,
  label: string,
  groups: SnapshotGroup[],
  playerPos: ReturnType<typeof getCachedPlayerTile>,
): void {
  if (groups.length === 0) return;
  // Section header count = total pets across groups (not group count).
  const totalPets = groups.reduce((sum, g) => sum + g.count, 0);
  const heading = document.createElement('div');
  heading.className = 'qpm-charged-abilities__group-label';
  heading.textContent = `${label} · ${totalPets}`;
  target.appendChild(heading);
  for (const group of groups) target.appendChild(renderWindowPetCard(group, playerPos));
}

function repaint(): void {
  if (!bodyRef) return;
  const totals = bodyRef.querySelector<HTMLElement>('.qpm-charged-abilities__gtotals-slot');
  const roster = bodyRef.querySelector<HTMLElement>('.qpm-charged-abilities__wroster');
  const sidebar = bodyRef.querySelector<HTMLElement>('.qpm-charged-abilities__wsidebar');
  if (totals) totals.replaceChildren(renderGardenTotals());
  if (roster) paintRoster(roster, latestSnapshots);
  if (sidebar) sidebar.replaceChildren(renderHutchSidebar());
}

function buildAutoOpenToggle(): HTMLElement {
  const wrap = document.createElement('label');
  wrap.className = 'qpm-charged-abilities__autotoggle';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'qpm-charged-abilities__autotoggle-input';
  checkbox.checked = getAutoOpenOverlay();
  checkbox.addEventListener('change', () => {
    setAutoOpenOverlay(checkbox.checked);
  });
  const text = document.createElement('span');
  text.className = 'qpm-charged-abilities__autotoggle-label';
  text.textContent = t('feature.chargedAbilities.window.autoOpenOverlay');
  wrap.append(checkbox, text);
  return wrap;
}

function renderShell(root: HTMLElement): void {
  injectChargedAbilitiesStyles();
  root.classList.add('qpm-charged-abilities__wroot');

  const toolbar = document.createElement('div');
  toolbar.className = 'qpm-charged-abilities__wtoolbar';
  toolbar.appendChild(buildAutoOpenToggle());
  root.appendChild(toolbar);

  const totalsSlot = document.createElement('div');
  totalsSlot.className = 'qpm-charged-abilities__gtotals-slot';
  root.appendChild(totalsSlot);

  const layout = document.createElement('div');
  layout.className = 'qpm-charged-abilities__wlayout';

  const roster = document.createElement('div');
  roster.className = 'qpm-charged-abilities__wroster';
  layout.appendChild(roster);

  const sidebar = document.createElement('div');
  sidebar.className = 'qpm-charged-abilities__wsidebar';
  layout.appendChild(sidebar);

  root.appendChild(layout);
  bodyRef = root;
  repaint();

  if (!unsubSelector) {
    unsubSelector = subscribeAbilityTargets((snaps) => {
      latestSnapshots = snaps;
      if (bodyRef) repaint();
    });
  }
  if (!unsubHutch) {
    void subscribeAtomValue('hutchPets', () => {
      if (bodyRef) repaint();
    }).then((unsub) => {
      if (unsub) unsubHutch = unsub;
    });
  }
}

function teardown(): void {
  unsubSelector?.();
  unsubSelector = null;
  unsubHutch?.();
  unsubHutch = null;
  bodyRef = null;
}

export function openChargedAbilitiesWindow(): void {
  toggleWindow(
    WINDOW_ID,
    t('feature.chargedAbilities.window.title'),
    (root) => {
      root.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden;';
      renderShell(root);
    },
    WINDOW_WIDTH,
    WINDOW_HEIGHT,
  );
  // Subscriptions intentionally outlive close/hide. `closeWindow` only hides
  // the DOM; the cached `bodyRef` stays valid so the next reopen shows fresh
  // data. Full teardown happens in `closeChargedAbilitiesWindow` (called from
  // stopChargedAbilities).
}

export function closeChargedAbilitiesWindow(): void {
  if (isWindowOpen(WINDOW_ID)) closeWindow(WINDOW_ID);
  teardown();
}
