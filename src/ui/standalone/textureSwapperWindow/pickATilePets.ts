import { getActivePetInfos } from '../../../store/pets';
import { getPetSpriteCanvas } from '../../../sprite-v2/compat';
import { getTextureSwapperState } from '../../../features/standalone/textureSwapper';
import { t } from '../../../i18n';

const SPRITE_SIZE = 48;

export function renderPickATilePets(opts: {
  onPick: (slotIndex: 0 | 1 | 2, species: string) => void;
  highlightSpecies?: string;
}): HTMLElement {
  const root = document.createElement('div');
  root.style.cssText = 'display:flex;gap:8px;padding:12px;justify-content:center;';

  const active = getActivePetInfos();
  const rules = getTextureSwapperState().rules;

  for (const slotIndex of [0, 1, 2] as const) {
    const card = document.createElement('div');
    card.style.cssText = 'width:140px;height:80px;border-radius:var(--qpm-radius-lg);background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;';

    const pet = active[slotIndex];
    if (!pet?.species) {
      card.textContent = t('feature.gardenPainter.pickATile.slotEmpty');
      card.style.opacity = '0.4';
      card.style.cursor = 'default';
      root.appendChild(card);
      continue;
    }

    const species = pet.species;
    const sprite = getPetSpriteCanvas(species);
    if (sprite) {
      const c = document.createElement('canvas');
      c.width = sprite.width;
      c.height = sprite.height;
      c.getContext('2d')?.drawImage(sprite, 0, 0);
      c.style.cssText = `width:${SPRITE_SIZE}px;height:${SPRITE_SIZE}px;image-rendering:pixelated;`;
      card.appendChild(c);
    }

    const label = document.createElement('div');
    label.style.cssText = 'font-size:10px;color:var(--qpm-text);';
    label.textContent = `${t('feature.gardenPainter.pickATile.slotN', { n: slotIndex })} · ${species}`;
    card.appendChild(label);

    const isScoped = rules.some(
      r => r.scope?.kind === 'petSlot' && r.scope.slotIndex === slotIndex && r.scope.species === species,
    );
    if (isScoped) {
      card.style.border = '1px solid var(--qpm-accent)';
      card.style.boxShadow = '0 0 8px rgba(143,130,255,0.5)';
    }

    if (opts.highlightSpecies && opts.highlightSpecies !== species) {
      card.style.opacity = '0.4';
      card.style.cursor = 'default';
    } else {
      card.style.cursor = 'pointer';
      card.addEventListener('click', () => opts.onPick(slotIndex, species));
    }

    root.appendChild(card);
  }
  return root;
}
