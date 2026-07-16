import { getActivePetInfos } from '../../store/pets';
import { getPetSpriteWithMutations } from '../../sprite-v2/compat';
import { getRiveRules, type RiveRuleTarget } from '../../features/standalone/riveControl';

const SPRITE_SIZE = 56;

export interface PetCardsOptions {
  onPick: (target: RiveRuleTarget, label: string) => void;
}

export interface PetCardsHandle {
  element: HTMLElement;
  cleanup: () => void;
}

export function renderPetCards(opts: PetCardsOptions): PetCardsHandle {
  const root = document.createElement('div');
  root.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill, minmax(140px, 1fr));gap:var(--qpm-space-3);padding:var(--qpm-space-2);';

  const active = getActivePetInfos();
  const rules = getRiveRules();

  if (active.length === 0) {
    const empty = document.createElement('div');
    empty.textContent = 'No active pets.';
    empty.style.cssText = 'padding:var(--qpm-space-4);color:var(--qpm-text-muted);font-size:var(--qpm-font-body);grid-column:1/-1;';
    root.appendChild(empty);
    return { element: root, cleanup: () => {} };
  }

  for (const pet of active) {
    if (!pet.petId || !pet.species) continue;
    const scoped = rules.some((r) => r.target.kind === 'pet' && r.target.petId === pet.petId);
    root.appendChild(buildPetCard(pet.petId, pet.species, pet.mutations, pet.slotIndex, pet.name, scoped, opts.onPick));
  }

  return { element: root, cleanup: () => {} };
}

function buildPetCard(
  petId: string,
  species: string,
  mutations: string[],
  slotIndex: number,
  name: string | null,
  scoped: boolean,
  onPick: (target: RiveRuleTarget, label: string) => void,
): HTMLElement {
  const card = document.createElement('button');
  card.type = 'button';
  card.style.cssText = [
    'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:var(--qpm-space-2);',
    'padding:var(--qpm-space-3);',
    'background:var(--qpm-surface-2);',
    `border:1px solid ${scoped ? 'var(--qpm-accent)' : 'var(--qpm-accent-border)'};`,
    `box-shadow:${scoped ? '0 0 8px var(--qpm-accent-subtle)' : 'none'};`,
    'border-radius:var(--qpm-radius-md);',
    'cursor:pointer;transition:background 0.15s ease,border-color 0.15s ease;',
    'font-family:var(--qpm-font);color:var(--qpm-text);',
    'min-height:110px;',
  ].join('');

  card.addEventListener('mouseover', () => {
    if (!scoped) card.style.borderColor = 'var(--qpm-accent-focus)';
    card.style.background = 'var(--qpm-accent-subtle)';
  });
  card.addEventListener('mouseout', () => {
    card.style.borderColor = scoped ? 'var(--qpm-accent)' : 'var(--qpm-accent-border)';
    card.style.background = 'var(--qpm-surface-2)';
  });

  const sprite = getPetSpriteWithMutations(species, mutations);
  if (sprite) {
    const c = document.createElement('canvas');
    c.width = sprite.width;
    c.height = sprite.height;
    c.getContext('2d')?.drawImage(sprite, 0, 0);
    c.style.cssText = `width:${SPRITE_SIZE}px;height:${SPRITE_SIZE}px;image-rendering:pixelated;object-fit:contain;`;
    card.appendChild(c);
  }

  const label = document.createElement('div');
  label.style.cssText = 'font-size:var(--qpm-font-caption);text-align:center;line-height:1.3;';
  const displayName = name ?? species;
  label.innerHTML = `<div style="font-weight:var(--qpm-weight-semibold)">${escapeHtml(displayName)}</div><div style="color:var(--qpm-text-muted);font-size:9px">Slot ${slotIndex}${name && name !== species ? ' · ' + escapeHtml(species) : ''}</div>`;
  card.appendChild(label);

  card.addEventListener('click', () =>
    onPick({ kind: 'pet', petId, species }, `Pet — ${displayName}`),
  );
  return card;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
}
