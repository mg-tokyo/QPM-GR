import { t } from '../../i18n';
import { formatCoins } from '../../utils/formatters';
import {
  getAnySpriteDataUrl,
  getCropSpriteCanvas,
  getPetSpriteCanvas,
} from '../../sprite-v2/compat';
import { canvasToDataUrl } from '../../utils/dom/canvasHelpers';
import { ridePet, dismountPet } from '../../store/mountState';
import type { PetAbilityTargetSnapshot } from '../../features/chargedAbilities/types';
import type { PlantSlotMinimal } from '../../features/chargedAbilities/abilities/types';
import type { TilePosition } from '../../features/garden/tileRadius';

export const CAPSULE_SPRITE_KEY = 'sprite/item/DawnCapsule';
export const COIN_SPRITE_KEY = 'sprite/ui/Coin';

export function formatCooldown(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function countBySpecies(slots: readonly PlantSlotMinimal[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const s of slots) counts.set(s.species, (counts.get(s.species) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

export function buildCropSpriteImg(species: string, pixelSize = 18): HTMLElement {
  const url = canvasToDataUrl(getCropSpriteCanvas(species));
  if (!url) {
    const span = document.createElement('span');
    span.className = 'qpm-charged-abilities__species-fallback';
    span.textContent = species;
    return span;
  }
  const img = document.createElement('img');
  img.className = 'qpm-charged-abilities__species-sprite';
  img.src = url;
  img.alt = species;
  img.title = species;
  img.style.width = `${pixelSize}px`;
  img.style.height = `${pixelSize}px`;
  return img;
}

export function buildSpeciesCountList(
  slots: readonly PlantSlotMinimal[],
  className: string,
  spriteSize?: number,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = className;
  for (const [species, count] of countBySpecies(slots)) {
    const item = document.createElement('span');
    item.className = 'qpm-charged-abilities__species-item';
    const countSpan = document.createElement('span');
    countSpan.className = 'qpm-charged-abilities__species-count';
    countSpan.textContent = `${count}×`;
    item.append(countSpan, buildCropSpriteImg(species, spriteSize));
    wrap.appendChild(item);
  }
  return wrap;
}

export function buildProjectedGainEl(snap: PetAbilityTargetSnapshot): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = 'qpm-charged-abilities__projection-value';
  wrap.classList.add(
    snap.ability.yieldKind === 'coin'
      ? 'qpm-charged-abilities__projection-value--coin'
      : 'qpm-charged-abilities__projection-value--capsule',
  );

  const valueText = document.createElement('span');
  if (snap.ability.yieldKind === 'coin') {
    valueText.textContent = t('feature.chargedAbilities.gainCoin', {
      value: formatCoins(snap.projectedGain.coin),
    });
  } else {
    valueText.textContent = `+${snap.projectedGain.capsule}`;
  }
  wrap.appendChild(valueText);

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

export function buildPetIcon(
  species: string,
  accentFallbackColor: string,
  pixelSize: number,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'qpm-charged-abilities__icon';
  wrap.style.width = `${pixelSize}px`;
  wrap.style.height = `${pixelSize}px`;
  const url = canvasToDataUrl(getPetSpriteCanvas(species));
  if (url) {
    const img = document.createElement('img');
    img.className = 'qpm-charged-abilities__icon-img';
    img.src = url;
    img.alt = species;
    wrap.appendChild(img);
  } else {
    wrap.style.background = accentFallbackColor;
    wrap.style.opacity = '0.4';
  }
  return wrap;
}

export function buildMountButton(
  snap: PetAbilityTargetSnapshot,
  /** When provided, the button mounts this slot instead of snap.petSlotId.
   *  Used by grouped cards to mount the first unmounted member. */
  mountTargetSlotId?: string,
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'qpm-charged-abilities__mount-btn';
  if (snap.isMounted) btn.classList.add('qpm-charged-abilities__mount-btn--dismount');

  const spriteKey = snap.isMounted ? 'sprite/ui/DismountPin' : 'sprite/ui/MountPin';
  const src = getAnySpriteDataUrl(spriteKey);
  if (src) {
    const img = document.createElement('img');
    img.className = 'qpm-charged-abilities__mount-icon';
    img.src = src;
    img.alt = '';
    btn.appendChild(img);
  }

  const label = document.createElement('span');
  label.textContent = snap.isMounted
    ? t('feature.chargedAbilities.dismountAction')
    : t('feature.chargedAbilities.mountAction', { name: snap.petSpecies || snap.petName });
  btn.appendChild(label);

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (snap.isMounted) {
      dismountPet();
      return;
    }
    const id = mountTargetSlotId ?? snap.petSlotId;
    if (id) ridePet(id);
  });

  return btn;
}

export function buildChargeBar(snap: PetAbilityTargetSnapshot): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'qpm-charged-abilities__charge';
  if (snap.ready) {
    wrap.classList.add('qpm-charged-abilities__charge--ready');
    const label = document.createElement('span');
    label.className = 'qpm-charged-abilities__charge-label';
    label.textContent = `⚡ ${t('feature.chargedAbilities.state.ready').toUpperCase()}`;
    wrap.appendChild(label);
    return wrap;
  }
  const track = document.createElement('div');
  track.className = 'qpm-charged-abilities__charge-track';
  const fill = document.createElement('div');
  fill.className = 'qpm-charged-abilities__charge-fill';
  const pct = snap.ability.cooldownMs > 0
    ? Math.max(0, Math.min(100, ((snap.ability.cooldownMs - snap.cdRemainingMs) / snap.ability.cooldownMs) * 100))
    : 0;
  fill.style.width = `${pct.toFixed(1)}%`;
  track.appendChild(fill);
  const label = document.createElement('span');
  label.className = 'qpm-charged-abilities__charge-label';
  label.textContent = formatCooldown(snap.cdRemainingMs);
  wrap.append(track, label);
  return wrap;
}

export function buildDirectionWidget(
  snap: PetAbilityTargetSnapshot,
  playerPos: TilePosition | null,
): HTMLElement | null {
  if (!snap.optimality.bestPatch || !playerPos) return null;
  const target = snap.optimality.bestPatch.center;
  const dx = target.x - playerPos.x;
  const dy = target.y - playerPos.y;
  const distance = Math.max(Math.abs(dx), Math.abs(dy));

  const wrap = document.createElement('div');
  wrap.className = 'qpm-charged-abilities__direction';

  const labelEl = document.createElement('span');
  labelEl.className = 'qpm-charged-abilities__direction-label';
  labelEl.textContent = t('feature.chargedAbilities.window.bestPatch');
  wrap.appendChild(labelEl);

  if (distance === 0) {
    const here = document.createElement('span');
    here.className = 'qpm-charged-abilities__direction-here';
    here.textContent = t('feature.chargedAbilities.window.atPlayer');
    wrap.appendChild(here);
    return wrap;
  }

  const ns = dy < 0 ? 'N' : dy > 0 ? 'S' : '';
  const ew = dx < 0 ? 'W' : dx > 0 ? 'E' : '';
  const direction = `${ns}${ew}`;
  const angleDeg = Math.atan2(dy, dx) * (180 / Math.PI) + 90; // 0deg = North

  const arrow = document.createElement('span');
  arrow.className = 'qpm-charged-abilities__direction-arrow';
  arrow.style.transform = `rotate(${angleDeg.toFixed(1)}deg)`;
  arrow.textContent = '↑';
  wrap.appendChild(arrow);

  const text = document.createElement('span');
  text.className = 'qpm-charged-abilities__direction-text';
  text.textContent = t('feature.chargedAbilities.window.atDistance', {
    distance,
    direction,
  });
  wrap.appendChild(text);

  return wrap;
}
