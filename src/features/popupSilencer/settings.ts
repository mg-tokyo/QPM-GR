import { storage } from '../../utils/storage';
import { isRecord } from '../../utils/typeGuards';

const SETTINGS_KEY = 'qpm.popupSilencer.v1';

export interface PopupSilencerSettings {
  /** Ability ids whose popup is hidden. */
  abilities: string[];
  /** Hide "Level up!" toasts ("Fully grown!" always shows). */
  levelUps: boolean;
}

export function getPopupSilencerSettings(): PopupSilencerSettings {
  const raw = storage.get<unknown>(SETTINGS_KEY, null);
  const r = isRecord(raw) ? raw : {};
  const abilities = Array.isArray(r.abilities) ? r.abilities.filter((a): a is string => typeof a === 'string') : [];
  return { abilities: [...new Set(abilities)], levelUps: r.levelUps === true };
}

export function setSilencedAbilities(abilityIds: readonly string[]): void {
  storage.set(SETTINGS_KEY, { ...getPopupSilencerSettings(), abilities: [...new Set(abilityIds)] });
}

export function setAbilitySilenced(abilityId: string, silenced: boolean): void {
  const rest = getPopupSilencerSettings().abilities.filter((a) => a !== abilityId);
  setSilencedAbilities(silenced ? [...rest, abilityId] : rest);
}

export function setLevelUpsSilenced(silenced: boolean): void {
  storage.set(SETTINGS_KEY, { ...getPopupSilencerSettings(), levelUps: silenced });
}
