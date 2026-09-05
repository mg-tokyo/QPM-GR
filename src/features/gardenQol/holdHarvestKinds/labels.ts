import { t, hasKey } from '../../../i18n';
import type { I18nKey } from '../../../i18n';

export function labelFor(actionType: string): string {
  const overrideKey = `feature.instaHarvest.action.${actionType}`;
  if (hasKey(overrideKey)) return t(overrideKey as I18nKey);
  const stripped = actionType.replace(/[Hh]arvest$/, '');
  if (stripped.length === 0) return actionType;
  const spaced = stripped.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
