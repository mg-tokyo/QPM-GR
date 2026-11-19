import { getPopupSilencerSettings, setAbilitySilenced, setLevelUpsSilenced } from '../../features/popupSilencer';
import { t } from '../../i18n';
import { onActivePetInfos } from '../../store/pets';
import { getAbilitiesSafe, getAbilityName } from '../../utils/game/catalogHelpers';
import { getAbilityColor } from '../../utils/rendering/petCardRenderer';
import { POPUPS_LOOK } from '../alertCentre/popupsLook';
import { createColorDot, mountAlertSettings } from '../alertCentre/settingsShell';
import { createEmptyState, createSearchInput, createToggle } from '../components';
import { closeWindow, destroyWindow, isWindowOpen, openWindow } from '../core/modalWindow';

export const POPUP_SILENCER_WINDOW_ID = 'qpm-popup-silencer';

const ROW_CSS = 'display:flex;align-items:center;gap:8px;padding:4px 0;min-height:28px;';
const NAME_CSS = 'flex:1;min-width:0;font-size:var(--qpm-font-body);color:var(--qpm-text);';
const NOTE_CSS = 'font-size:var(--qpm-font-caption);color:var(--qpm-text-muted);';

type Setters = Map<string, (shown: boolean) => void>;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, css: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.style.cssText = css;
  if (text !== undefined) node.textContent = text;
  return node;
}

const byName = (a: string, b: string): number => getAbilityName(a).localeCompare(getAbilityName(b));

/** A switch per ability, on = the popup shows. An ability can sit in both lists; its two switches stay in step. */
function renderPopupSilencer(root: HTMLElement): () => void {
  const shell = mountAlertSettings(root, t('feature.popupSilencer.title'), POPUPS_LOOK);
  const teamSetters: Setters = new Map();
  const allSetters: Setters = new Map();

  const abilityRow = (id: string, own: Setters): HTMLElement => {
    const row = el('div', ROW_CSS);
    row.dataset.qpmPopupRow = id;
    const name = getAbilityName(id);
    const toggle = createToggle({
      size: 'compact',
      checked: !getPopupSilencerSettings().abilities.includes(id),
      onChange: (shown) => {
        setAbilitySilenced(id, !shown);
        teamSetters.get(id)?.(shown);
        allSetters.get(id)?.(shown);
        shell.refresh();
      },
    });
    toggle.input.setAttribute('aria-label', t('feature.popupSilencer.abilityAria', { name }));
    own.set(id, toggle.setChecked);
    row.append(toggle.root, createColorDot(getAbilityColor(id).base), el('span', NAME_CSS, name));
    return row;
  };

  const fill = (list: HTMLElement, own: Setters, ids: readonly string[], emptyKey: string): void => {
    own.clear();
    list.replaceChildren(...(ids.length ? ids.map((id) => abilityRow(id, own)) : [createEmptyState(t(emptyKey))]));
  };

  root.append(el('div', NOTE_CSS, t('feature.popupSilencer.note')));
  const levelUpBody = shell.addSection(t('feature.popupSilencer.levelUpHeader'));
  const levelUp = createToggle({
    checked: !getPopupSilencerSettings().levelUps,
    label: t('feature.popupSilencer.levelUp'),
    onChange: (shown) => {
      setLevelUpsSilenced(!shown);
      shell.refresh();
    },
  });
  levelUpBody.append(levelUp.root, el('div', NOTE_CSS, t('feature.popupSilencer.levelUpNote')));

  const team = shell.addSection(t('feature.popupSilencer.teamHeader'));
  let teamKey: string | null = null;
  const stopPets = onActivePetInfos((infos) => {
    const ids = [...new Set(infos.flatMap((p) => p.abilities))].sort(byName);
    const key = ids.join('|');
    if (key === teamKey) return;
    teamKey = key;
    fill(team, teamSetters, ids, 'feature.popupSilencer.noTeam');
  }, true);

  const allBody = shell.addSection(t('feature.popupSilencer.allHeader'));
  const all = el('div', 'display:flex;flex-direction:column;');
  const renderAll = (query: string): void => {
    const q = query.trim().toLowerCase();
    const ids = getAbilitiesSafe().filter((id) => !q || getAbilityName(id).toLowerCase().includes(q)).sort(byName);
    fill(all, allSetters, ids, 'feature.popupSilencer.noMatch');
  };
  const search = createSearchInput({ placeholder: t('feature.popupSilencer.search'), onInput: renderAll });
  search.input.setAttribute('aria-label', t('feature.popupSilencer.search'));
  allBody.append(search.root, all);
  renderAll('');

  return () => {
    stopPets();
    search.destroy();
    shell.destroy();
  };
}

export function openPopupSilencerWindow(): void {
  if (isWindowOpen(POPUP_SILENCER_WINDOW_ID)) {
    closeWindow(POPUP_SILENCER_WINDOW_ID);
    return;
  }
  // Close ran the content cleanup; re-showing the hidden window would keep a dead pet subscription.
  destroyWindow(POPUP_SILENCER_WINDOW_ID);
  openWindow(POPUP_SILENCER_WINDOW_ID, t('feature.popupSilencer.title'), renderPopupSilencer, '420px', '80vh');
}
