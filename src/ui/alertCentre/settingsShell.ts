import { resolveRowAccent, resolveRowIcon, resolveRowSummary, type AlertRowDef } from '../../features/alertHub';
import { onSpritesReady } from '../../sprite-v2/compat';
import { HYDRATION_EVENT } from '../../sprite-v2/service/constants';
import { createIconBox } from '../shop/restockAlerts/cardShell';
import { ensureCentreStyles, letterBox } from './rowCard';

/** The registered alert row's look, or a matching one for a producer outside the hub. */
export type AlertLook = Pick<AlertRowDef, 'icon' | 'summary' | 'accent'>;

const STYLE_ID = 'qpm-alert-settings-style';
const DEFAULT_COLOR = 'var(--qpm-accent)';

const CSS = [
  '.qpm-alert-settings{display:flex;flex-direction:column;gap:8px;flex:1;min-height:0;overflow-y:auto;padding:12px;box-sizing:border-box;}',
  '.qpm-alert-settings .qpm-alert-centre-card{margin-top:0;}',
  '.qpm-alert-settings__head{padding:12px;}',
  '.qpm-alert-settings__section{flex-direction:column;align-items:stretch;gap:6px;}',
  '.qpm-alert-settings__section-head{display:flex;align-items:center;gap:8px;}',
  '.qpm-alert-settings__body{display:flex;flex-direction:column;gap:4px;}',
  '.qpm-alert-settings__dot{width:8px;height:8px;border-radius:9999px;flex-shrink:0;}',
].join('');

function ensureStyles(): void {
  ensureCentreStyles();
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

function div(className: string, text?: string): HTMLDivElement {
  const node = document.createElement('div');
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Repaints an icon slot only when the sprite changed, so late hydration does not flicker. */
function iconPainter(slot: HTMLElement, name: string, size: 'lg' | 'sm'): (url: string | null) => void {
  let shown: string | null | undefined;
  return (url) => {
    if (url === shown) return;
    shown = url;
    slot.replaceChildren(url ? createIconBox(url, '', size) : letterBox(name));
  };
}

/** A round swatch in a catalog colour (ability, mutation). */
export function createColorDot(color: string): HTMLSpanElement {
  const dot = document.createElement('span');
  dot.className = 'qpm-alert-settings__dot';
  dot.style.background = color;
  return dot;
}

export interface AlertSettingsShell {
  /** A card for one group of controls; with a look it carries that alert's sprite and colour. Returns its body. */
  addSection(title: string, look?: AlertLook | null): HTMLElement;
  /** Re-reads every look (sprite, colour, summary); call after a setting changes. */
  refresh(): void;
  destroy(): void;
}

/** Turns a settings window's root into the alert settings layout: header card, then section cards. */
export function mountAlertSettings(root: HTMLElement, title: string, look: AlertLook | null): AlertSettingsShell {
  ensureStyles();
  root.style.cssText = '';
  root.classList.add('qpm-alert-settings');

  const head = div('qpm-alert-centre-card qpm-alert-centre-card--on qpm-alert-settings__head');
  head.dataset.qpmAlertSettingsHead = '';
  const headIcon = div('qpm-alert-centre-card__icon');
  const summary = div('qpm-alert-centre-card__summary');
  const text = div('qpm-alert-centre-card__text');
  text.append(div('qpm-alert-centre-card__name', title), summary);
  head.append(headIcon, text);
  root.append(head);
  const paintHeadIcon = iconPainter(headIcon, title, 'lg');

  const painters: Array<() => void> = [];
  const paintHead = (): void => {
    const color = resolveRowAccent(look) ?? DEFAULT_COLOR;
    root.style.setProperty('--qpm-alert-color', color);
    head.style.setProperty('--qpm-alert-color', color);
    const next = resolveRowSummary(look) ?? '';
    if (summary.textContent !== next) summary.textContent = next;
    summary.style.display = next ? '' : 'none';
    paintHeadIcon(resolveRowIcon(look));
  };
  painters.push(paintHead);

  const refresh = (): void => { for (const paint of painters) paint(); };
  const stopSprites = onSpritesReady(refresh);
  window.addEventListener(HYDRATION_EVENT, refresh);

  refresh();
  return {
    addSection(sectionTitle, sectionLook) {
      const card = div('qpm-alert-centre-card qpm-alert-settings__section');
      const sectionHead = div('qpm-alert-settings__section-head');
      const body = div('qpm-alert-settings__body');
      if (sectionLook) {
        card.classList.add('qpm-alert-centre-card--on');
        const slot = div('qpm-alert-centre-card__icon');
        sectionHead.append(slot);
        const paintIcon = iconPainter(slot, sectionTitle, 'sm');
        const paint = (): void => {
          card.style.setProperty('--qpm-alert-color', resolveRowAccent(sectionLook) ?? DEFAULT_COLOR);
          paintIcon(resolveRowIcon(sectionLook));
        };
        painters.push(paint);
        paint();
      }
      sectionHead.append(div('qpm-alert-centre-card__name', sectionTitle));
      card.append(sectionHead, body);
      root.append(card);
      return body;
    },
    refresh,
    destroy() {
      stopSprites();
      window.removeEventListener(HYDRATION_EVENT, refresh);
    },
  };
}
