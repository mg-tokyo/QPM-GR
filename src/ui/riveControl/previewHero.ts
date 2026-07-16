import { renderBySpriteKey, getPetSpriteWithMutations } from '../../sprite-v2/compat';
import { selectSync } from '../../core/stateTree';
import { getActivePetInfos } from '../../store/pets';
import type { RiveRuleTarget } from '../../features/standalone/riveControl';
import { buildAvatarComposite } from './avatarCards';

export interface PreviewHeroHandle {
  element: HTMLElement;
  cleanup: () => void;
}

const HERO_SIZE = 128;

/**
 * 128×128 preview hero. Static images only — never allocates a Rive/WebGL
 * context. Chrome caps total WebGL contexts (~16 globally) and the game
 * already uses several; putting live Rive canvases in QPM UI cascade-crashes
 * the game renderer. Users see live animation in-world; this panel is for
 * target identification and rule editing.
 */
export function renderPreviewHero(target: RiveRuleTarget, hasActiveRule: boolean): PreviewHeroHandle {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;align-items:center;justify-content:center;padding:var(--qpm-space-2) 0;';

  const frame = document.createElement('div');
  frame.style.cssText = [
    `width:${HERO_SIZE}px;height:${HERO_SIZE}px;`,
    'background:rgba(0,0,0,0.35);',
    'border-radius:var(--qpm-radius-lg,12px);',
    `border:1px solid ${hasActiveRule ? 'var(--qpm-accent-focus)' : 'var(--qpm-accent-subtle)'};`,
    'display:flex;align-items:center;justify-content:center;overflow:hidden;',
    hasActiveRule ? 'box-shadow:0 0 24px var(--qpm-accent-subtle);' : '',
  ].join('');
  wrap.appendChild(frame);

  mount(target, frame);

  return {
    element: wrap,
    cleanup: () => { /* static, nothing to tear down */ },
  };
}

interface PlayerRec { id: string; cosmetic?: { color?: string; avatar?: readonly string[] } }

function mount(target: RiveRuleTarget, frame: HTMLElement): void {
  switch (target.kind) {
    case 'avatar': return mountAvatar(target.playerId, frame);
    case 'pet': return mountPet(target.petId, target.species, frame);
    case 'decorClass': return mountDecor(target.decorClass, frame);
    case 'artboard': return setText(frame, target.artboardNameLower);
  }
}

function mountAvatar(playerId: string, frame: HTMLElement): void {
  const players = (selectSync((s) => s.data.players ?? []) ?? []) as PlayerRec[];
  const player = players.find((p) => p?.id === playerId);
  const cosmetic = player?.cosmetic ?? {};
  frame.innerHTML = '';
  frame.appendChild(buildAvatarComposite(cosmetic, HERO_SIZE - 4));
}

function mountPet(petId: string, species: string | undefined, frame: HTMLElement): void {
  const resolvedSpecies = species ?? getActivePetInfos().find((p) => p.petId === petId)?.species;
  if (!resolvedSpecies) { setText(frame, 'Unknown species'); return; }
  const pet = getActivePetInfos().find((p) => p.petId === petId);
  const mutations = pet?.mutations ?? [];
  const sprite = getPetSpriteWithMutations(resolvedSpecies, mutations);
  setImage(frame, sprite, resolvedSpecies);
}

function mountDecor(decorClass: string, frame: HTMLElement): void {
  const sprite = renderBySpriteKey(`sprite/decor/${decorClass}`) as HTMLCanvasElement | null;
  setImage(frame, sprite, decorClass);
}

function setImage(frame: HTMLElement, sprite: HTMLCanvasElement | null, fallback: string): void {
  frame.innerHTML = '';
  if (sprite) {
    const c = document.createElement('canvas');
    c.width = sprite.width;
    c.height = sprite.height;
    c.getContext('2d')?.drawImage(sprite, 0, 0);
    c.style.cssText = 'max-width:calc(100% - 12px);max-height:calc(100% - 12px);image-rendering:pixelated;object-fit:contain;';
    frame.appendChild(c);
    return;
  }
  setText(frame, fallback);
}

function setText(frame: HTMLElement, text: string): void {
  frame.innerHTML = '';
  const na = document.createElement('div');
  na.style.cssText = 'font-size:var(--qpm-font-caption);color:var(--qpm-text-muted);text-align:center;padding:var(--qpm-space-2);';
  na.textContent = text;
  frame.appendChild(na);
}
