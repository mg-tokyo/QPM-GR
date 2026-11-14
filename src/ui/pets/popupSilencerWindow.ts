import { getPopupSilencerSettings, setAbilitySilenced, setLevelUpsSilenced } from '../../features/popupSilencer';
import { t } from '../../i18n';
import { onActivePetInfos } from '../../store/pets';
import { getAbilitiesSafe, getAbilityName } from '../../utils/game/catalogHelpers';
import { createEmptyState, createSearchInput, createSectionHeader, createToggle } from '../components';
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
  root.style.cssText = 'display:flex;flex-direction:column;gap:8px;flex:1;min-height:0;overflow-y:auto;padding:12px;';
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
      },
    });
    toggle.input.setAttribute('aria-label', t('feature.popupSilencer.abilityAria', { name }));
    own.set(id, toggle.setChecked);
    row.append(toggle.root, el('span', NAME_CSS, name));
    return row;
  };

  const fill = (list: HTMLElement, own: Setters, ids: readonly string[], emptyKey: string): void => {
    own.clear();
    list.replaceChildren(...(ids.length ? ids.map((id) => abilityRow(id, own)) : [createEmptyState(t(emptyKey))]));
  };

  root.append(el('div', NOTE_CSS, t('feature.popupSilencer.note')));
  root.append(createSectionHeader(t('feature.popupSilencer.levelUpHeader'), { size: 'compact' }).root);
  const levelUp = createToggle({
    checked: !getPopupSilencerSettings().levelUps,
    label: t('feature.popupSilencer.levelUp'),
    onChange: (shown) => { setLevelUpsSilenced(!shown); },
  });
  root.append(levelUp.root, el('div', NOTE_CSS, t('feature.popupSilencer.levelUpNote')));

  root.append(createSectionHeader(t('feature.popupSilencer.teamHeader'), { size: 'compact' }).root);
  const team = el('div', 'display:flex;flex-direction:column;');
  root.append(team);
  let teamKey: string | null = null;
  const stopPets = onActivePetInfos((infos) => {
    const ids = [...new Set(infos.flatMap((p) => p.abilities))].sort(byName);
    const key = ids.join('|');
    if (key === teamKey) return;
    teamKey = key;
    fill(team, teamSetters, ids, 'feature.popupSilencer.noTeam');
  }, true);

  root.append(createSectionHeader(t('feature.popupSilencer.allHeader'), { size: 'compact' }).root);
  const all = el('div', 'display:flex;flex-direction:column;');
  const renderAll = (query: string): void => {
    const q = query.trim().toLowerCase();
    const ids = getAbilitiesSafe().filter((id) => !q || getAbilityName(id).toLowerCase().includes(q)).sort(byName);
    fill(all, allSetters, ids, 'feature.popupSilencer.noMatch');
  };
  const search = createSearchInput({ placeholder: t('feature.popupSilencer.search'), onInput: renderAll });
  search.input.setAttribute('aria-label', t('feature.popupSilencer.search'));
  root.append(search.root, all);
  renderAll('');

  return () => {
    stopPets();
    search.destroy();
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
