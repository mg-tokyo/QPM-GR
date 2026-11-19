import type { AlertRowDef } from '../../features/alertHub';
import { getPopupSilencerSettings } from '../../features/popupSilencer';
import { t } from '../../i18n';
import { getAnySpriteDataUrl, isSpritesReady } from '../../sprite-v2/compat';

// Key checked in the live atlas 2026-11-15 (ALR-17 PD1).
const SPRITE_POPUPS = 'sprite/ui/PetIconColor';

function popupsSummary(): string {
  const { abilities, levelUps } = getPopupSilencerSettings();
  if (abilities.length === 0) return t(levelUps ? 'feature.alertCentre.linked.popupsSummaryLevelUpsOnly' : 'feature.alertCentre.linked.popupsSummaryNone');
  return t(levelUps ? 'feature.alertCentre.linked.popupsSummaryLevelUps' : 'feature.alertCentre.linked.popupsSummary', { count: abilities.length });
}

/** Shared by the centre's linked row and the Game popups window header. */
export const POPUPS_LOOK: Pick<AlertRowDef, 'icon' | 'summary' | 'accent'> = {
  icon: () => (isSpritesReady() ? getAnySpriteDataUrl(SPRITE_POPUPS) || null : null),
  summary: popupsSummary,
  accent: 'var(--qpm-accent)',
};
