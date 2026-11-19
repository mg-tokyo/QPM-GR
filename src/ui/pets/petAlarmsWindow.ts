import { getAlertRow } from '../../features/alertHub';
import {
  getHungerAlarmSettings,
  HUNGER_ALARM_ROW,
  petIcon,
  petName,
  setHungerAlarmDefault,
  setPetHungerThreshold,
} from '../../features/pets/hungerAlarm';
import { getTroughAlarmSettings, setTroughLowAt, TROUGH_ALARM_ROW } from '../../features/pets/troughAlarm';
import { t } from '../../i18n';
import { onActivePetInfos, type ActivePetInfo } from '../../store/pets';
import { mountAlertSettings } from '../alertCentre/settingsShell';
import { createButton, createEmptyState, createNumberInput } from '../components';
import { closeWindow, destroyWindow, isWindowOpen, openWindow } from '../core/modalWindow';
import { createIconBox } from '../shop/restockAlerts/cardShell';

export const PET_ALARMS_WINDOW_ID = 'qpm-pet-alarms';

const ROW_CSS = 'display:flex;align-items:center;gap:8px;padding:6px 0;min-height:36px;';
const NOTE_CSS = 'font-size:var(--qpm-font-caption);color:var(--qpm-text-muted);';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, css: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.style.cssText = css;
  if (text !== undefined) node.textContent = text;
  return node;
}

function hungerText(p: ActivePetInfo): string {
  return p.hungerPct == null ? '' : t('feature.petAlarms.hungerNow', { pct: Math.floor(p.hungerPct) });
}

interface PetRow {
  root: HTMLElement;
  hunger: HTMLElement;
  setThreshold: (v: number) => void;
}

function petRow(p: ActivePetInfo, petId: string): PetRow {
  const root = el('div', ROW_CSS);
  root.dataset.qpmPetAlarmRow = petId;
  const icon = petIcon(p);
  root.append(icon ? createIconBox(icon, '', 'sm') : el('span', 'width:28px;flex:none;'));
  const name = petName(p);
  const text = el('div', 'flex:1;min-width:0;display:flex;flex-direction:column;');
  const hunger = el('span', NOTE_CSS, hungerText(p));
  text.append(el('span', 'font-size:var(--qpm-font-body);color:var(--qpm-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;', name), hunger);

  const settings = getHungerAlarmSettings();
  const override = settings.perPet[petId];
  const input = createNumberInput({
    min: 0,
    max: 100,
    value: override ?? settings.defaultPct,
    suffix: '%',
    onChange: (v) => {
      setPetHungerThreshold(petId, v);
      resetWrap.style.visibility = '';
    },
  });
  input.input.setAttribute('aria-label', t('feature.petAlarms.petAria', { name }));
  // createButton rewrites its own cssText on hover/press (button.ts:88-99), so visibility lives on a wrapper.
  const resetWrap = el('span', 'flex:none;');
  resetWrap.append(createButton(t('feature.petAlarms.useDefault'), {
    variant: 'ghost',
    size: 'sm',
    onClick: () => {
      setPetHungerThreshold(petId, null);
      input.setValue(getHungerAlarmSettings().defaultPct);
      resetWrap.style.visibility = 'hidden';
    },
  }));
  resetWrap.style.visibility = override === undefined ? 'hidden' : '';
  root.append(text, input.root, resetWrap);
  return { root, hunger, setThreshold: input.setValue };
}

function renderPetAlarms(root: HTMLElement): () => void {
  const hungerLook = getAlertRow(HUNGER_ALARM_ROW);
  const shell = mountAlertSettings(root, t('feature.petAlarms.title'), hungerLook);
  const rows = new Map<string, PetRow>();

  const hunger = shell.addSection(t('feature.petAlarms.hungerHeader'), hungerLook);
  const defaultRow = el('div', ROW_CSS);
  const defaultInput = createNumberInput({
    min: 0,
    max: 100,
    value: getHungerAlarmSettings().defaultPct,
    suffix: '%',
    label: t('feature.petAlarms.defaultLabel'),
    onChange: (v) => {
      setHungerAlarmDefault(v);
      const perPet = getHungerAlarmSettings().perPet;
      for (const [id, row] of rows) if (perPet[id] === undefined) row.setThreshold(v);
      shell.refresh();
    },
  });
  // The component's <label> is not tied to its input.
  defaultInput.input.setAttribute('aria-label', t('feature.petAlarms.defaultLabel'));
  defaultRow.append(defaultInput.root);
  hunger.append(defaultRow, el('div', NOTE_CSS, t('feature.petAlarms.perPetNote')));

  const list = el('div', 'display:flex;flex-direction:column;');
  hunger.append(list);
  let idsKey: string | null = null;

  const stopPets = onActivePetInfos((infos) => {
    const pets = infos.filter((p): p is ActivePetInfo & { petId: string } => !!p.petId);
    const nextKey = pets.map((p) => p.petId).join('|');
    if (nextKey !== idsKey) {
      // The header and hunger icons show the first active pet.
      shell.refresh();
      // Rebuild only when the team changes, so an input being edited keeps its focus.
      idsKey = nextKey;
      rows.clear();
      if (pets.length === 0) {
        list.replaceChildren(createEmptyState(t('feature.petAlarms.noPets')));
        return;
      }
      list.replaceChildren(...pets.map((p) => {
        const row = petRow(p, p.petId);
        rows.set(p.petId, row);
        return row.root;
      }));
      return;
    }
    for (const p of pets) {
      const row = rows.get(p.petId);
      if (row) row.hunger.textContent = hungerText(p);
    }
  }, true);

  const trough = shell.addSection(t('feature.petAlarms.troughHeader'), getAlertRow(TROUGH_ALARM_ROW));
  const troughRow = el('div', ROW_CSS);
  const troughInput = createNumberInput({
    min: 0,
    max: 99,
    value: getTroughAlarmSettings().lowAt,
    label: t('feature.petAlarms.troughLabel'),
    suffix: t('feature.petAlarms.troughSuffix'),
    onChange: (v) => { setTroughLowAt(Math.round(v)); },
  });
  troughInput.input.setAttribute('aria-label', t('feature.petAlarms.troughAria'));
  troughRow.append(troughInput.root);
  trough.append(troughRow);

  return () => {
    stopPets();
    shell.destroy();
  };
}

export function openPetAlarmsWindow(): void {
  if (isWindowOpen(PET_ALARMS_WINDOW_ID)) {
    closeWindow(PET_ALARMS_WINDOW_ID);
    return;
  }
  // Close ran the content cleanup; re-showing the hidden window would keep a dead pet subscription.
  destroyWindow(PET_ALARMS_WINDOW_ID);
  openWindow(PET_ALARMS_WINDOW_ID, t('feature.petAlarms.title'), renderPetAlarms, '440px', '75vh');
}
