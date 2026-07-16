import { TOKENS_CSS } from './tokens';
import { PANEL_CSS } from './panel';
import { NAV_CSS } from './nav';
import { CARD_CSS } from './card';
import { BUTTON_CSS } from './button';
import { TOAST_MAIN_CSS } from './toast';
import { TILE_CSS } from './tile';
import { FOOTER_CSS } from './footer';
import { ABOUT_CSS } from './about';
import { MOTION_CSS } from './motion';

let qpmPanelStylesInjected = false;

export function ensurePanelStyles(): void {
  if (qpmPanelStylesInjected) {
    return;
  }
  const style = document.createElement('style');
  style.id = 'qpm-panel-styles';
  style.textContent = `${TOKENS_CSS}

  ${PANEL_CSS}

  ${NAV_CSS}

  ${CARD_CSS}

  ${BUTTON_CSS}

  ${TOAST_MAIN_CSS}

  ${TILE_CSS}

  ${FOOTER_CSS}

  ${ABOUT_CSS}

  ${MOTION_CSS}
  `;
  document.head.appendChild(style);
  qpmPanelStylesInjected = true;
}
