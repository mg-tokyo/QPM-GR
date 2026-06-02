// src/ui/petPickerModal/petCard.ts
// Pet card rendering for the picker grid.

import { getAbilityColor } from '../../../utils/rendering/petCardRenderer';
import { calculateMaxStrength } from '../../../store/xpTracker';
import type { PooledPet } from '../../../types/petTeams';
import type { MutationTier } from './types';
import { getMutationTier, getSpriteSrc, getAbilityDisplayName } from './helpers';

// ---------------------------------------------------------------------------
// Card rendering
// ---------------------------------------------------------------------------

function renderBadge(location: PooledPet['location']): HTMLElement {
  const badge = document.createElement('span');
  badge.className = `qpm-pet-card__badge qpm-pet-card__badge--${location}`;
  badge.textContent = location === 'active' ? 'Active' : location === 'hutch' ? 'Hutch' : 'Bag';
  return badge;
}

function applyMutationTierStyle(card: HTMLElement, tier: MutationTier): void {
  if (tier === 'rainbow') {
    card.style.border = '2px solid transparent';
    card.style.background = [
      'linear-gradient(rgba(18,20,26,0.97),rgba(18,20,26,0.97)) padding-box',
      'linear-gradient(135deg,#f00,#f70,#ff0,#0f0,#00f,#808,#90d) border-box',
    ].join(',');
    card.style.boxShadow = '0 0 10px rgba(180,100,255,0.35)';
  } else if (tier === 'gold') {
    card.style.border = '2px solid transparent';
    card.style.background = [
      'linear-gradient(rgba(18,20,26,0.97),rgba(18,20,26,0.97)) padding-box',
      'linear-gradient(135deg,#FFD700,#FFA500,#FFD700) border-box',
    ].join(',');
    card.style.boxShadow = '0 0 10px rgba(255,215,0,0.25)';
  } else if (tier === 'mutated') {
    card.style.border = '2px solid rgba(143,130,255,0.35)';
  }
}

export function renderPetCard(
  pet: PooledPet,
  onClick: () => void,
  onHover: (pet: PooledPet | null) => void,
): HTMLElement {
  const tier = getMutationTier(pet.mutations);

  const card = document.createElement('div');
  card.className = `qpm-pet-card${pet.location === 'active' ? ' qpm-pet-card--active' : ''}`;
  card.dataset.petId = pet.id;
  applyMutationTierStyle(card, tier);

  const mutNames = pet.mutations.join(', ') || 'No mutations';
  const abilNames = pet.abilities.map((abilityId) => getAbilityDisplayName(abilityId)).join(', ') || 'None';
  card.title = `${pet.name || pet.species}\nSTR ${pet.strength ?? '?'}\nMutations: ${mutNames}\nAbilities: ${abilNames}`;
  card.addEventListener('click', onClick);
  card.addEventListener('mouseenter', () => onHover(pet));
  card.addEventListener('mouseleave', () => onHover(null));

  card.appendChild(renderBadge(pet.location));

  // Sprite
  const placeholder = document.createElement('div');
  placeholder.className = 'qpm-pet-card__sprite--placeholder';
  placeholder.textContent = '🐾';
  card.appendChild(placeholder);

  // Name
  const name = document.createElement('div');
  name.className = 'qpm-pet-card__name';
  name.textContent = pet.name || pet.species;
  card.appendChild(name);

  // STR / Max STR
  const maxStr = calculateMaxStrength(pet.targetScale, pet.species);
  const str = document.createElement('div');
  str.className = 'qpm-pet-card__str';
  if (pet.strength != null && maxStr != null) {
    str.textContent = `STR ${pet.strength} / ${maxStr}`;
  } else if (pet.strength != null) {
    str.textContent = `STR ${pet.strength}`;
  } else {
    str.textContent = 'STR ?';
    str.style.opacity = '0.4';
  }
  card.appendChild(str);

  // Ability dots
  if (pet.abilities.length > 0) {
    const dotsWrap = document.createElement('div');
    dotsWrap.className = 'qpm-pet-card__ability-dots';
    for (const abilityId of pet.abilities.slice(0, 4)) {
      const color = getAbilityColor(abilityId);
      const dot = document.createElement('div');
      dot.className = 'qpm-pet-card__dot';
      dot.style.background = color.base;
      dot.title = getAbilityDisplayName(abilityId);
      dotsWrap.appendChild(dot);
    }
    card.appendChild(dotsWrap);
  }

  // Synchronous mutation-aware sprite
  const spriteSrc = getSpriteSrc(pet.species, pet.mutations);
  if (spriteSrc) {
    const img = document.createElement('img');
    img.className = 'qpm-pet-card__sprite';
    img.src = spriteSrc;
    img.alt = pet.species;
    card.replaceChild(img, placeholder);
  }

  return card;
}
