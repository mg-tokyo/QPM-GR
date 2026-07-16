import { renderBySpriteKey } from '../../sprite-v2/compat';
import { getAllInstances } from '../../rive-engine';
import { getRiveRules, type RiveRuleTarget } from '../../features/standalone/riveControl';

const SPRITE_SIZE = 64;

const KNOWN_DECOR_CLASSES = [
  'WoodWindmill', 'MarbleFountain', 'StoneBirdBath',
  'WindSpinner', 'WindTurner', 'Cauldron', 'WeatherStation',
];

export interface DecorCardsOptions {
  onPick: (target: RiveRuleTarget, label: string) => void;
}

export interface DecorCardsHandle {
  element: HTMLElement;
  cleanup: () => void;
}

export function renderDecorCards(opts: DecorCardsOptions): DecorCardsHandle {
  const root = document.createElement('div');
  root.style.cssText = 'display:flex;flex-direction:column;gap:var(--qpm-space-2);padding:var(--qpm-space-2);';

  const warn = document.createElement('div');
  warn.textContent = 'Decor rules affect every copy in the room, including other players\' gardens in view.';
  warn.style.cssText = 'padding:var(--qpm-space-2);background:var(--qpm-warning-subtle,rgba(255,183,77,0.15));color:var(--qpm-warning,#ffb74d);border-radius:var(--qpm-radius-sm);font-size:var(--qpm-font-caption);line-height:1.4;';
  root.appendChild(warn);

  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill, minmax(140px, 1fr));gap:var(--qpm-space-3);';
  root.appendChild(grid);

  const live = new Set<string>();
  for (const inst of getAllInstances()) {
    if (inst.tags.includes('decor')) live.add(inst.artboardName);
  }
  const rules = getRiveRules();
  const scopedClasses = new Set<string>(
    rules.filter((r) => r.target.kind === 'decorClass').map((r) => (r.target as { decorClass: string }).decorClass.toLowerCase()),
  );

  for (const decorClass of KNOWN_DECOR_CLASSES) {
    const isLive = live.has(decorClass);
    const scoped = scopedClasses.has(decorClass.toLowerCase());
    grid.appendChild(buildDecorCard(decorClass, isLive, scoped, opts.onPick));
  }

  return { element: root, cleanup: () => {} };
}

function buildDecorCard(
  decorClass: string,
  isLive: boolean,
  scoped: boolean,
  onPick: (target: RiveRuleTarget, label: string) => void,
): HTMLElement {
  const card = document.createElement('button');
  card.type = 'button';
  card.disabled = !isLive;
  card.style.cssText = [
    'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:var(--qpm-space-2);',
    'padding:var(--qpm-space-3);',
    'background:var(--qpm-surface-2);',
    `border:1px solid ${scoped ? 'var(--qpm-accent)' : 'var(--qpm-accent-border)'};`,
    `box-shadow:${scoped ? '0 0 8px var(--qpm-accent-subtle)' : 'none'};`,
    'border-radius:var(--qpm-radius-md);',
    `cursor:${isLive ? 'pointer' : 'not-allowed'};`,
    `opacity:${isLive ? '1' : '0.5'};`,
    'transition:background 0.15s ease,border-color 0.15s ease;',
    'font-family:var(--qpm-font);color:var(--qpm-text);',
    'min-height:120px;',
  ].join('');

  if (isLive) {
    card.addEventListener('mouseover', () => {
      if (!scoped) card.style.borderColor = 'var(--qpm-accent-focus)';
      card.style.background = 'var(--qpm-accent-subtle)';
    });
    card.addEventListener('mouseout', () => {
      card.style.borderColor = scoped ? 'var(--qpm-accent)' : 'var(--qpm-accent-border)';
      card.style.background = 'var(--qpm-surface-2)';
    });
  }

  const sprite = renderBySpriteKey(`sprite/decor/${decorClass}`) as HTMLCanvasElement | null;
  if (sprite) {
    const c = document.createElement('canvas');
    c.width = sprite.width;
    c.height = sprite.height;
    c.getContext('2d')?.drawImage(sprite, 0, 0);
    c.style.cssText = `width:${SPRITE_SIZE}px;height:${SPRITE_SIZE}px;image-rendering:pixelated;object-fit:contain;`;
    card.appendChild(c);
  } else {
    const ph = document.createElement('div');
    ph.style.cssText = `width:${SPRITE_SIZE}px;height:${SPRITE_SIZE}px;background:var(--qpm-surface-3);border-radius:var(--qpm-radius-sm);`;
    card.appendChild(ph);
  }

  const label = document.createElement('div');
  label.style.cssText = 'font-size:var(--qpm-font-caption);text-align:center;line-height:1.3;';
  label.innerHTML = `<div style="font-weight:var(--qpm-weight-semibold)">${decorClass}</div><div style="color:var(--qpm-text-muted);font-size:9px">${isLive ? 'placed' : 'not placed'}</div>`;
  card.appendChild(label);

  if (isLive) {
    card.addEventListener('click', () => onPick({ kind: 'decorClass', decorClass }, `Decor — ${decorClass}`));
  }
  return card;
}
