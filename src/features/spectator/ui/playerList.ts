import { formatRelativeTime, t } from '../../../i18n';
import { createEmptyState } from '../../../ui/components';
import { COLOR_HEX } from '../../bloblingCustomiser';
import type { SeatedPlayer } from '../players';
import { agoParts, humanizeAction } from './barModel';

const COSMETIC_HEX: Readonly<Partial<Record<string, string>>> = COLOR_HEX;

const span = (cls: string, text = ''): HTMLSpanElement => {
  const el = document.createElement('span');
  el.className = cls;
  el.textContent = text;
  return el;
};

/** The Discord picture, else the cosmetic colour; a picture that fails to load (Discord's CSP, a dead link) falls back too. */
export function playerAvatar(p: Pick<SeatedPlayer, 'colour' | 'discordAvatarUrl'>): HTMLElement {
  const dot = (): HTMLElement => {
    const el = document.createElement('span');
    el.className = 'qpm-spec-av';
    const hex = p.colour ? COSMETIC_HEX[p.colour] : undefined;
    if (hex) el.style.background = hex;
    return el;
  };
  if (!p.discordAvatarUrl) return dot();
  const img = document.createElement('img');
  img.className = 'qpm-spec-av';
  img.alt = '';
  img.draggable = false;
  img.referrerPolicy = 'no-referrer';
  img.addEventListener('error', () => { img.replaceWith(dot()); }, { once: true });
  img.src = p.discordAvatarUrl;
  return img;
}

// Times are taken when the list renders (open, roster or last-action change); nothing ticks while it is open.
export function activityText(p: SeatedPlayer, now: number): string {
  if (!p.online) return t('feature.spectator.list.offline');
  if (!p.lastAction) return t('feature.spectator.list.noActivity');
  const { value, unit } = agoParts(p.lastAction.at, now);
  const ago = formatRelativeTime(value, unit, { numeric: 'auto', style: 'narrow' });
  const action = humanizeAction(p.lastAction.action);
  return action ? t('feature.spectator.list.activity', { action, ago }) : ago;
}

export interface PlayerListSource {
  players(): readonly SeatedPlayer[];
  targetId(): string | null;
  follow(id: string): void;
}

function createRow(id: string, follow: (id: string) => void): HTMLButtonElement {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'qpm-spec-row';
  row.dataset.playerId = id;
  const text = document.createElement('span');
  text.className = 'qpm-spec-row-text';
  text.append(span('qpm-spec-row-name'), span('qpm-spec-row-sub'));
  row.append(span('qpm-spec-av'), text, span('qpm-spec-row-seat'));
  row.addEventListener('click', () => { follow(id); });
  return row;
}

const setText = (el: Element | null | undefined, text: string): void => { if (el && el.textContent !== text) el.textContent = text; };

function updateRow(row: HTMLButtonElement, p: SeatedPlayer, current: boolean, now: number): void {
  row.disabled = !p.online;
  row.setAttribute('aria-current', String(current));
  const avKey = `${p.discordAvatarUrl ?? ''}|${p.colour ?? ''}`;
  if (row.dataset.av !== avKey) {
    row.dataset.av = avKey;
    row.firstElementChild?.replaceWith(playerAvatar(p));
  }
  setText(row.querySelector('.qpm-spec-row-name'), p.name);
  setText(row.querySelector('.qpm-spec-row-sub'), activityText(p, now));
  setText(row.querySelector('.qpm-spec-row-seat'), t('feature.spectator.list.seat', { n: p.seat }));
}

/** Rows are kept per player and updated in place: every action anyone takes re-emits the roster, and a row rebuilt
 * between a press and its release would lose the click. */
export function renderPlayerList(host: HTMLElement, src: PlayerListSource, now = Date.now()): void {
  const list = src.players();
  if (list.length === 0) {
    host.replaceChildren(createEmptyState(t('feature.spectator.list.empty')));
    return;
  }
  const target = src.targetId();
  const kept = new Map<string, HTMLButtonElement>();
  for (const r of host.querySelectorAll<HTMLButtonElement>('.qpm-spec-row')) if (r.dataset.playerId) kept.set(r.dataset.playerId, r);
  const rows = list.map((p) => {
    const row = kept.get(p.id) ?? createRow(p.id, src.follow);
    updateRow(row, p, p.id === target, now);
    return row;
  });
  if (rows.length !== host.children.length || rows.some((r, i) => host.children[i] !== r)) host.replaceChildren(...rows);
}
