import { t } from '../../i18n';
import { formatCoins } from '../../utils/formatters';
import { getAnySpriteDataUrl } from '../../sprite-v2/compat';
import { canvasToDataUrl } from '../../utils/dom/canvasHelpers';
import { getPetSpriteCanvas } from '../../sprite-v2/compat';
import { getAllAbilityProjections } from '../../features/chargedAbilities/abilities';
import { scanGardenForAbility } from '../../features/chargedAbilities/footprintScan';
import { getActivePetInfos } from '../../store/pets';
import {
  CAPSULE_SPRITE_KEY,
  COIN_SPRITE_KEY,
  buildSpeciesCountList,
} from './cardHelpers';
import type { AbilityProjection, PlantSlotMinimal } from '../../features/chargedAbilities/abilities/types';

const CROP_SPRITE_SIZE = 18;
const NEED_SPRITE_SIZE = 20;

function equippedSpeciesSet(): Set<string> {
  const set = new Set<string>();
  for (const pet of getActivePetInfos()) {
    if (pet.species) set.add(pet.species);
  }
  return set;
}

function isAbilityAvailable(ability: AbilityProjection, equipped: Set<string>): boolean {
  if (ability.requiredSpecies.length === 0) return true;
  for (const s of ability.requiredSpecies) if (equipped.has(s)) return true;
  return false;
}

export function renderGardenTotals(): HTMLElement {
  const root = document.createElement('div');
  root.className = 'qpm-charged-abilities__gtotals';

  const heading = document.createElement('div');
  heading.className = 'qpm-charged-abilities__gtotals-heading';
  heading.textContent = t('feature.chargedAbilities.window.gardenTotalsHeading');
  root.appendChild(heading);

  const equipped = equippedSpeciesSet();
  const rows: HTMLElement[] = [];
  for (const ability of getAllAbilityProjections()) {
    const result = scanGardenForAbility(ability);
    if (result.slots.length === 0) continue;
    rows.push(buildRow(ability, result.slots, result.totalGain, equipped));
  }

  if (rows.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'qpm-charged-abilities__gtotals-empty';
    empty.textContent = t('feature.chargedAbilities.window.gardenTotalsEmpty');
    root.appendChild(empty);
    return root;
  }

  const list = document.createElement('div');
  list.className = 'qpm-charged-abilities__gtotals-list';
  for (const row of rows) list.appendChild(row);
  root.appendChild(list);
  return root;
}

function buildRow(
  ability: AbilityProjection,
  slots: readonly PlantSlotMinimal[],
  totalGain: { coin: number; capsule: number },
  equipped: Set<string>,
): HTMLElement {
  const available = isAbilityAvailable(ability, equipped);
  const row = document.createElement('div');
  row.className = 'qpm-charged-abilities__gtotals-row';
  if (!available) row.classList.add('qpm-charged-abilities__gtotals-row--unavailable');
  row.style.borderLeftColor = ability.accentColor;

  const top = document.createElement('div');
  top.className = 'qpm-charged-abilities__gtotals-top';

  const name = document.createElement('span');
  name.className = 'qpm-charged-abilities__gtotals-ability';
  name.textContent = ability.abilityName;
  top.appendChild(name);

  if (!available) top.appendChild(buildNeedIndicator(ability));

  const gain = document.createElement('span');
  gain.className = 'qpm-charged-abilities__gtotals-gain';
  gain.classList.add(
    ability.yieldKind === 'coin'
      ? 'qpm-charged-abilities__projection-value--coin'
      : 'qpm-charged-abilities__projection-value--capsule',
  );
  const value = document.createElement('span');
  value.textContent = ability.yieldKind === 'coin'
    ? t('feature.chargedAbilities.gainCoin', { value: formatCoins(totalGain.coin) })
    : `+${totalGain.capsule}`;
  gain.appendChild(value);
  const iconKey = ability.yieldKind === 'coin' ? COIN_SPRITE_KEY : CAPSULE_SPRITE_KEY;
  const iconSrc = getAnySpriteDataUrl(iconKey);
  if (iconSrc) {
    const img = document.createElement('img');
    img.className = 'qpm-charged-abilities__projection-icon';
    img.src = iconSrc;
    img.alt = '';
    gain.appendChild(img);
  }
  top.appendChild(gain);

  row.appendChild(top);

  row.appendChild(
    buildSpeciesCountList(
      slots,
      'qpm-charged-abilities__species-list qpm-charged-abilities__species-list--inline',
      CROP_SPRITE_SIZE,
    ),
  );

  return row;
}

function buildNeedIndicator(ability: AbilityProjection): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = 'qpm-charged-abilities__gtotals-need';
  const label = document.createElement('span');
  label.className = 'qpm-charged-abilities__gtotals-need-label';
  label.textContent = t('feature.chargedAbilities.window.needPet');
  wrap.appendChild(label);
  for (const species of ability.requiredSpecies) {
    const url = canvasToDataUrl(getPetSpriteCanvas(species));
    if (!url) continue;
    const img = document.createElement('img');
    img.className = 'qpm-charged-abilities__gtotals-need-sprite';
    img.src = url;
    img.alt = species;
    img.title = species;
    img.style.width = `${NEED_SPRITE_SIZE}px`;
    img.style.height = `${NEED_SPRITE_SIZE}px`;
    wrap.appendChild(img);
  }
  return wrap;
}

