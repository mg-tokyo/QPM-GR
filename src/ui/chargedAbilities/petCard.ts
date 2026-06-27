// src/ui/chargedAbilities/petCard.ts
// Per-pet card renderer for the Charged Abilities floating overlay.
// Renders one SnapshotGroup at a time — multiple pets that share species +
// ability + state collapse into a single "Ostrich × N" card.
// Two modes: collapsed (compact row) and expanded (full card with mount button).

import { t } from '../../i18n';
import { renderOptimalityIndicator } from './optimalityIndicator';
import {
  buildMountButton,
  buildPetIcon,
  buildProjectedGainEl,
  buildSpeciesCountList,
  formatCooldown,
} from './cardHelpers';
import type { PetAbilityTargetSnapshot } from '../../features/chargedAbilities/types';
import type { SnapshotGroup } from '../../features/chargedAbilities/grouping';
import type { TilePosition } from '../../features/garden/tileRadius';

export interface RenderPetCardOptions {
  expanded: boolean;
  /** When omitted, the card is non-clickable (used for Ready-group cards that
   *  are auto-expanded and shouldn't collapse on click). */
  onToggleExpand?: () => void;
  playerPos: TilePosition | null;
}

const OVERLAY_PET_ICON_SM = 18;
const OVERLAY_PET_ICON_LG = 32;

function describeSubstateText(snap: PetAbilityTargetSnapshot): string {
  if (snap.ready) {
    if (snap.qualifyingCount > 0) {
      return t('feature.chargedAbilities.inRange', {
        summary: snap.qualifyingSpeciesSummary,
      });
    }
    return `${t('feature.chargedAbilities.state.ready')} · ${t('feature.chargedAbilities.noneInRange')}`;
  }
  return t('feature.chargedAbilities.cooldownLabel', { time: formatCooldown(snap.cdRemainingMs) });
}

function buildNameRow(group: SnapshotGroup, big: boolean): HTMLElement {
  const snap = group.rep;
  const row = document.createElement('div');
  if (big) {
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '6px';
  }
  const name = document.createElement(big ? 'span' : 'div');
  name.className = big ? 'qpm-charged-abilities__pet-name' : 'qpm-charged-abilities__card-name';
  name.textContent = snap.petSpecies || snap.petName;
  row.appendChild(name);
  if (group.count > 1) {
    const count = document.createElement('span');
    count.className = 'qpm-charged-abilities__card-count';
    count.textContent = `× ${group.count}`;
    row.appendChild(count);
  }
  if (snap.isMounted) {
    const pill = document.createElement('span');
    pill.className = 'qpm-charged-abilities__mounted-pill';
    const dot = document.createElement('span');
    dot.className = 'qpm-charged-abilities__mounted-dot';
    pill.appendChild(dot);
    const pillLabel = document.createElement('span');
    pillLabel.textContent = t('feature.chargedAbilities.state.mounted');
    pill.appendChild(pillLabel);
    row.appendChild(pill);
  }
  return row;
}

function renderCollapsed(group: SnapshotGroup, opts: RenderPetCardOptions): HTMLElement {
  const snap = group.rep;
  const row = document.createElement('div');
  row.className = 'qpm-charged-abilities__card-collapsed';
  if (opts.onToggleExpand) {
    row.addEventListener('click', opts.onToggleExpand);
  } else {
    row.style.cursor = 'default';
  }

  row.appendChild(buildPetIcon(snap.petSpecies, snap.ability.accentColor, OVERLAY_PET_ICON_SM));

  const text = document.createElement('div');
  text.className = 'qpm-charged-abilities__id-block';
  text.appendChild(buildNameRow(group, false));
  const sub = document.createElement('div');
  sub.className = 'qpm-charged-abilities__card-substate';
  sub.textContent = describeSubstateText(snap);
  text.appendChild(sub);
  row.appendChild(text);

  const chev = document.createElement('span');
  chev.className = 'qpm-charged-abilities__chevron';
  chev.textContent = '▾';
  row.appendChild(chev);

  return row;
}

function renderExpanded(group: SnapshotGroup, opts: RenderPetCardOptions): HTMLElement {
  const snap = group.rep;
  const card = document.createElement('div');
  card.className = 'qpm-charged-abilities__card';
  if (snap.ready && snap.qualifyingCount > 0) {
    card.classList.add('qpm-charged-abilities__card--ready');
  } else if (!snap.ready) {
    card.classList.add('qpm-charged-abilities__card--cooling');
  }
  if (snap.isMounted) card.classList.add('qpm-charged-abilities__card--mounted');

  const topRow = document.createElement('div');
  topRow.className = 'qpm-charged-abilities__top-row';

  topRow.appendChild(buildPetIcon(snap.petSpecies, snap.ability.accentColor, OVERLAY_PET_ICON_LG));

  const idBlock = document.createElement('div');
  idBlock.className = 'qpm-charged-abilities__id-block';
  idBlock.appendChild(buildNameRow(group, true));

  const abilityName = document.createElement('div');
  abilityName.className = 'qpm-charged-abilities__ability-name';
  abilityName.textContent = snap.ability.abilityName;
  idBlock.appendChild(abilityName);

  if (snap.ready && snap.qualifyingCount > 0) {
    idBlock.appendChild(
      buildSpeciesCountList(snap.qualifyingSlots, 'qpm-charged-abilities__species-list'),
    );
  } else {
    const subState = document.createElement('div');
    subState.className = 'qpm-charged-abilities__in-range';
    subState.textContent = describeSubstateText(snap);
    idBlock.appendChild(subState);
  }

  topRow.appendChild(idBlock);

  const projection = document.createElement('div');
  projection.className = 'qpm-charged-abilities__projection';
  if (snap.ready && snap.qualifyingCount > 0 && snap.optimality.bestPatch) {
    projection.appendChild(renderOptimalityIndicator(snap.optimality, snap.ability, opts.playerPos));
  }
  projection.appendChild(buildProjectedGainEl(snap));
  topRow.appendChild(projection);

  card.appendChild(topRow);

  if (snap.ready) {
    card.appendChild(buildMountButton(snap, group.unmountedSlotIds[0]));
  }

  // The card itself is clickable to collapse only when a toggle is provided
  // (i.e. for "Others" cards). Ready-group cards are auto-expanded and pass no
  // onToggleExpand, so they stay open until the pet leaves the Ready criteria.
  if (opts.onToggleExpand) {
    const toggle = opts.onToggleExpand;
    card.style.cursor = 'pointer';
    card.addEventListener('click', (e) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest('.qpm-charged-abilities__mount-btn')) return;
      if (target && target.closest('.qpm-charged-abilities__optimal-partial')) return;
      toggle();
    });
  }

  return card;
}

export function renderPetCard(
  group: SnapshotGroup,
  opts: RenderPetCardOptions,
): HTMLElement {
  return opts.expanded ? renderExpanded(group, opts) : renderCollapsed(group, opts);
}
