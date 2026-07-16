import { selectSync } from '../../core/stateTree';
import { getCosmeticCdnUrl } from '../../features/bloblingCustomiser/cosmeticApi';
import { SLOT_CONFIG, COLOR_HEX, type CosmeticColor } from '../../features/bloblingCustomiser/types';
import { getRiveRules, type RiveRuleTarget } from '../../features/standalone/riveControl';

const CARD_ART = 96;

interface PlayerInfo {
  id: string;
  name: string;
  cosmetic: { color?: string; avatar?: readonly string[] };
}

function listPlayers(): PlayerInfo[] {
  const snap = selectSync((s) => s.data.players ?? []);
  if (!snap || !Array.isArray(snap)) return [];
  const out: PlayerInfo[] = [];
  for (const p of snap) {
    if (!p || typeof p.id !== 'string') continue;
    out.push({
      id: p.id,
      name: typeof p.name === 'string' && p.name.length > 0 ? p.name : p.id,
      cosmetic: (p.cosmetic as PlayerInfo['cosmetic']) ?? {},
    });
  }
  return out;
}

export interface AvatarCardsHandle {
  element: HTMLElement;
  cleanup: () => void;
}

export interface AvatarCardsOptions {
  onPick: (target: RiveRuleTarget, label: string) => void;
}

export function renderAvatarCards(opts: AvatarCardsOptions): AvatarCardsHandle {
  const root = document.createElement('div');
  root.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill, minmax(140px, 1fr));gap:var(--qpm-space-3);padding:var(--qpm-space-2);';

  const players = listPlayers();
  if (players.length === 0) {
    const empty = document.createElement('div');
    empty.textContent = 'No players in room.';
    empty.style.cssText = 'padding:var(--qpm-space-4);color:var(--qpm-text-muted);font-size:var(--qpm-font-body);grid-column:1/-1;';
    root.appendChild(empty);
    return { element: root, cleanup: () => {} };
  }

  const scopedIds = new Set(
    getRiveRules().filter((r) => r.target.kind === 'avatar').map((r) => (r.target as { playerId: string }).playerId),
  );

  for (const player of players) {
    root.appendChild(buildCard(player, scopedIds.has(player.id), opts.onPick));
  }

  return { element: root, cleanup: () => {} };
}

/**
 * Static avatar card. Renders the equipped cosmetic PNGs stacked (bottom/mid/top)
 * as plain <img> elements. No WebGL, no Rive context — each Rive canvas would
 * eat one of Chrome's ~16 total WebGL contexts and with multiple players in
 * the room this cascade-crashed the game's own renderer.
 */
function buildCard(player: PlayerInfo, scoped: boolean, onPick: (target: RiveRuleTarget, label: string) => void): HTMLElement {
  const wrap = document.createElement('button');
  wrap.type = 'button';
  wrap.style.cssText = [
    'display:flex;flex-direction:column;align-items:center;gap:var(--qpm-space-2);',
    'padding:var(--qpm-space-3);',
    'background:var(--qpm-surface-2);',
    `border:1px solid ${scoped ? 'var(--qpm-accent)' : 'var(--qpm-accent-border)'};`,
    `box-shadow:${scoped ? '0 0 8px var(--qpm-accent-subtle)' : 'none'};`,
    'border-radius:var(--qpm-radius-md);',
    'cursor:pointer;transition:background 0.15s ease,border-color 0.15s ease;',
    'font-family:var(--qpm-font);color:var(--qpm-text);',
    'min-height:140px;',
  ].join('');

  wrap.addEventListener('mouseover', () => {
    if (!scoped) wrap.style.borderColor = 'var(--qpm-accent-focus)';
    wrap.style.background = 'var(--qpm-accent-subtle)';
  });
  wrap.addEventListener('mouseout', () => {
    wrap.style.borderColor = scoped ? 'var(--qpm-accent)' : 'var(--qpm-accent-border)';
    wrap.style.background = 'var(--qpm-surface-2)';
  });
  wrap.addEventListener('click', () => onPick({ kind: 'avatar', playerId: player.id, playerName: player.name }, `Avatar — ${player.name}`));

  wrap.appendChild(buildAvatarComposite(player.cosmetic, CARD_ART));

  const name = document.createElement('div');
  name.style.cssText = 'font-size:var(--qpm-font-caption);text-align:center;font-weight:var(--qpm-weight-semibold);max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  name.textContent = player.name;
  wrap.appendChild(name);

  return wrap;
}

/**
 * Compose an avatar preview by stacking the equipped cosmetic PNGs. Bottom
 * behind, mid middle, top front. Color chip is rendered as a small dot in
 * the corner since the cosmetic PNGs don't carry the color tint.
 */
export function buildAvatarComposite(
  cosmetic: { color?: string; avatar?: readonly string[] },
  size: number,
): HTMLElement {
  const box = document.createElement('div');
  box.style.cssText = [
    `width:${size}px;height:${size}px;`,
    'position:relative;',
    'background:var(--qpm-surface-3);',
    'border-radius:var(--qpm-radius-sm);',
    'overflow:hidden;',
    'display:flex;align-items:center;justify-content:center;',
  ].join('');

  const avatar = cosmetic.avatar ?? [];
  const slotOrder = ['Bottom', 'Mid', 'Top'] as const;
  let hasAny = false;
  for (const slotType of slotOrder) {
    const cfg = SLOT_CONFIG.find((c) => c.type === slotType);
    if (!cfg) continue;
    const filename = avatar[cfg.avatarIndex];
    if (typeof filename !== 'string' || filename.length === 0) continue;
    hasAny = true;
    const img = document.createElement('img');
    img.src = getCosmeticCdnUrl(filename);
    img.alt = slotType;
    img.style.cssText = [
      'position:absolute;top:0;left:0;',
      `width:${size}px;height:${size}px;`,
      'object-fit:contain;',
      'image-rendering:pixelated;',
      'pointer-events:none;',
    ].join('');
    box.appendChild(img);
  }

  if (!hasAny) {
    const empty = document.createElement('div');
    empty.textContent = '?';
    empty.style.cssText = 'font-size:24px;color:var(--qpm-text-muted);';
    box.appendChild(empty);
  }

  const colorHex = COLOR_HEX[(cosmetic.color as CosmeticColor) ?? 'Red'] ?? '#ef4444';
  const chip = document.createElement('div');
  chip.title = cosmetic.color ?? 'Red';
  chip.style.cssText = [
    'position:absolute;bottom:4px;right:4px;',
    'width:14px;height:14px;border-radius:50%;',
    `background:${colorHex};`,
    'border:2px solid var(--qpm-surface-2);',
    'box-shadow:0 0 4px rgba(0,0,0,0.4);',
  ].join('');
  box.appendChild(chip);

  return box;
}
