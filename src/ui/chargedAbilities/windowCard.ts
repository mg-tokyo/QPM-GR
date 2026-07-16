// Larger per-pet card for the full window — pets of the same species+ability+state collapse into one "Ostrich × N" card.

import { t } from '../../i18n';
import { formatCoins } from '../../utils/formatters';
import { getAnySpriteDataUrl } from '../../sprite-v2/compat';
import { renderOptimalityIndicator } from './optimalityIndicator';
import {
  CAPSULE_SPRITE_KEY,
  COIN_SPRITE_KEY,
  buildChargeBar,
  buildDirectionWidget,
  buildMountButton,
  buildPetIcon,
  buildProjectedGainEl,
  buildSpeciesCountList,
} from './cardHelpers';
import type { PetAbilityTargetSnapshot } from '../../features/chargedAbilities/types';
import type { SnapshotGroup } from '../../features/chargedAbilities/grouping';
import type { TilePosition } from '../../features/garden/tileRadius';

const WINDOW_PET_ICON_SIZE = 64;
const WINDOW_CROP_SPRITE_SIZE = 22;

export function renderWindowPetCard(
  group: SnapshotGroup,
  playerPos: TilePosition | null,
): HTMLElement {
  const snap = group.rep;
  const card = document.createElement('div');
  card.className = 'qpm-charged-abilities__wcard';
  if (snap.ready && snap.qualifyingCount > 0) {
    card.classList.add('qpm-charged-abilities__wcard--ready');
  } else if (!snap.ready) {
    card.classList.add('qpm-charged-abilities__wcard--cooling');
  }
  if (snap.isMounted) card.classList.add('qpm-charged-abilities__wcard--mounted');

  card.appendChild(buildHeader(group));
  card.appendChild(buildChargeBar(snap));
  card.appendChild(buildBody(snap, playerPos));
  card.appendChild(buildMountButton(snap, group.unmountedSlotIds[0]));

  return card;
}

function buildHeader(group: SnapshotGroup): HTMLElement {
  const snap = group.rep;
  const header = document.createElement('div');
  header.className = 'qpm-charged-abilities__wcard-header';

  header.appendChild(buildPetIcon(snap.petSpecies, snap.ability.accentColor, WINDOW_PET_ICON_SIZE));

  const idBlock = document.createElement('div');
  idBlock.className = 'qpm-charged-abilities__wcard-id';

  const nameRow = document.createElement('div');
  nameRow.className = 'qpm-charged-abilities__wcard-name-row';
  const name = document.createElement('span');
  name.className = 'qpm-charged-abilities__wcard-name';
  name.textContent = snap.petSpecies || snap.petName;
  nameRow.appendChild(name);
  if (group.count > 1) {
    const count = document.createElement('span');
    count.className = 'qpm-charged-abilities__wcard-count';
    count.textContent = `× ${group.count}`;
    nameRow.appendChild(count);
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
    nameRow.appendChild(pill);
  }
  idBlock.appendChild(nameRow);

  const abilityName = document.createElement('div');
  abilityName.className = 'qpm-charged-abilities__wcard-ability-name';
  abilityName.textContent = snap.ability.abilityName;
  idBlock.appendChild(abilityName);

  header.appendChild(idBlock);
  return header;
}

function buildBody(snap: PetAbilityTargetSnapshot, playerPos: TilePosition | null): HTMLElement {
  const body = document.createElement('div');
  body.className = 'qpm-charged-abilities__wcard-body';

  if (snap.ready && snap.qualifyingCount > 0) {
    const row = document.createElement('div');
    row.className = 'qpm-charged-abilities__wcard-row';
    row.appendChild(
      buildSpeciesCountList(
        snap.qualifyingSlots,
        'qpm-charged-abilities__species-list qpm-charged-abilities__species-list--inline',
        WINDOW_CROP_SPRITE_SIZE,
      ),
    );
    if (snap.optimality.bestPatch) {
      const optimal = renderOptimalityIndicator(snap.optimality, snap.ability, playerPos);
      optimal.classList.add('qpm-charged-abilities__wcard-optimal');
      row.appendChild(optimal);
    }
    const spacer = document.createElement('span');
    spacer.className = 'qpm-charged-abilities__wcard-spacer';
    row.appendChild(spacer);
    row.appendChild(buildProjectedGainEl(snap));
    body.appendChild(row);
  } else if (snap.ready) {
    const row = document.createElement('div');
    row.className = 'qpm-charged-abilities__wcard-row qpm-charged-abilities__wcard-row--empty';
    row.textContent = '—';
    body.appendChild(row);
  } else if (snap.optimality.bestPatch) {
    // Cooling, but we know the best patch. Show a single compact preview.
    const row = document.createElement('div');
    row.className = 'qpm-charged-abilities__wcard-row';
    row.appendChild(
      buildSpeciesCountList(
        snap.optimality.bestPatch.slots,
        'qpm-charged-abilities__species-list qpm-charged-abilities__species-list--inline',
        WINDOW_CROP_SPRITE_SIZE,
      ),
    );
    const spacer = document.createElement('span');
    spacer.className = 'qpm-charged-abilities__wcard-spacer';
    row.appendChild(spacer);
    row.appendChild(buildBestPatchGain(snap));
    body.appendChild(row);
  }

  const dir = buildDirectionWidget(snap, playerPos);
  if (dir) body.appendChild(dir);

  return body;
}

function buildBestPatchGain(snap: PetAbilityTargetSnapshot): HTMLElement {
  if (!snap.optimality.bestPatch) {
    const span = document.createElement('span');
    span.textContent = '—';
    return span;
  }
  const wrap = document.createElement('span');
  wrap.className = 'qpm-charged-abilities__projection-value';
  wrap.classList.add(
    snap.ability.yieldKind === 'coin'
      ? 'qpm-charged-abilities__projection-value--coin'
      : 'qpm-charged-abilities__projection-value--capsule',
  );
  const text = document.createElement('span');
  if (snap.ability.yieldKind === 'coin') {
    text.textContent = t('feature.chargedAbilities.gainCoin', {
      value: formatCoins(snap.optimality.bestPatch.gain.coin),
    });
  } else {
    text.textContent = `+${snap.optimality.bestPatch.gain.capsule}`;
  }
  wrap.appendChild(text);
  const iconKey = snap.ability.yieldKind === 'coin' ? COIN_SPRITE_KEY : CAPSULE_SPRITE_KEY;
  const iconSrc = getAnySpriteDataUrl(iconKey);
  if (iconSrc) {
    const img = document.createElement('img');
    img.className = 'qpm-charged-abilities__projection-icon';
    img.src = iconSrc;
    img.alt = '';
    wrap.appendChild(img);
  }
  return wrap;
}
