// src/ui/cardImportWindow/index.ts
//
// Custom Cards window — single-column rewrite that uses the texture-swapper
// visual idiom via extended shared components. Storage + bridge code is
// unchanged; this file is render-only.

import { toggleWindow } from '../core/modalWindow';
import { createButton } from '../components/button';
import { createToggle } from '../components/toggle';
import { createSectionHeader } from '../components/sectionHeader';
import { createSelect } from '../components/select';
import { notify } from '../../core/notifications';
import { storage } from '../../utils/storage';
import { watchDetach } from '../../utils/dom/dom';
import {
  openNativeCard,
  type OpenNativeCardOptions,
  type PhantomInventoryItem,
} from '../../integrations/nativeCardView';
import {
  addUserPreset,
  updateUserPreset,
  removeUserPreset,
  loadUserPresets,
  BUILT_IN_PRESETS,
  type CustomCardPreset,
} from '../../data/customCardPresets';
import { createItemForm, type ItemFormHandle } from './itemForm';
import {
  createImportInputs,
  type ImportInputsHandle,
  type PortraitImportResult,
} from './importInputs';

const WINDOW_ID = 'qpm-card-import';
const WINDOW_TITLE = 'Custom Cards';
const NEW_BLANK_VALUE = '';

export function openCardImportWindow(): void {
  toggleWindow(WINDOW_ID, WINDOW_TITLE, renderWindow, '520px', '640px');
}

function renderWindow(root: HTMLElement): void {
  root.style.cssText = 'display:flex;flex-direction:column;gap:14px;padding:14px;flex:1;min-height:0;overflow-y:auto;';
  const cleanups: Array<() => void> = [];

  let loadedUserPresetId: string | null = null;
  let takeoverState = false;

  // ── Preset row ──
  const presetWrap = document.createElement('div');
  presetWrap.style.cssText = 'display:flex;flex-direction:column;gap:6px;';
  presetWrap.appendChild(createSectionHeader('Preset', { size: 'compact' }).root);
  const presetRow = document.createElement('div');
  presetRow.style.cssText = 'display:flex;gap:6px;align-items:center;';
  let presetSelect: HTMLSelectElement | null = null;
  const deleteBtn = createButton('×', {
    variant: 'ghost',
    size: 'sm',
    onClick: () => {
      if (!loadedUserPresetId) return;
      const preset = loadUserPresets().find((p) => p.id === loadedUserPresetId);
      if (!preset) return;
      if (!confirm(`Delete preset "${preset.name}"?`)) return;
      removeUserPreset(loadedUserPresetId);
      loadedUserPresetId = null;
      clearForm();
      rebuildPresetSelect();
      notify({ feature: 'customCards', level: 'info', message: `Deleted "${preset.name}".` });
    },
  });
  deleteBtn.disabled = true;
  deleteBtn.title = 'Delete user preset';

  function rebuildPresetSelect(): void {
    const options: Array<{ value: string; label: string }> = [
      { value: NEW_BLANK_VALUE, label: '+ New blank' },
    ];
    for (const b of BUILT_IN_PRESETS) {
      options.push({ value: b.id, label: `${b.name}  (built-in)` });
    }
    const users = loadUserPresets();
    for (const u of users) {
      options.push({ value: u.id, label: u.name });
    }
    const selected = loadedUserPresetId ? loadedUserPresetId : NEW_BLANK_VALUE;
    const newSel = createSelect(options, selected, onPresetChange);
    newSel.style.flex = '1';
    if (presetSelect) presetSelect.replaceWith(newSel);
    else presetRow.appendChild(newSel);
    presetSelect = newSel;
  }

  function onPresetChange(value: string): void {
    if (value === NEW_BLANK_VALUE) {
      loadedUserPresetId = null;
      clearForm();
      deleteBtn.disabled = true;
      return;
    }
    const builtin = BUILT_IN_PRESETS.find((p) => p.id === value);
    if (builtin) {
      loadedUserPresetId = null;
      loadPreset(builtin);
      deleteBtn.disabled = true;
      return;
    }
    const user = loadUserPresets().find((p) => p.id === value);
    if (user) {
      loadedUserPresetId = user.id;
      loadPreset(user);
      deleteBtn.disabled = false;
      return;
    }
  }

  rebuildPresetSelect();
  presetRow.appendChild(deleteBtn);
  presetWrap.appendChild(presetRow);
  root.appendChild(presetWrap);

  // ── Portrait section ──
  const portraitWrap = document.createElement('div');
  portraitWrap.style.cssText = 'display:flex;flex-direction:column;gap:6px;';
  const portraitHeader = document.createElement('div');
  portraitHeader.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;';
  const portraitLabel = document.createElement('span');
  portraitLabel.style.cssText =
    'font-size:9px;font-weight:600;color:rgba(224,224,224,0.3);' +
    'text-transform:uppercase;letter-spacing:0.5px;';
  portraitLabel.textContent = 'Portrait';
  const portraitSubtitle = document.createElement('span');
  portraitSubtitle.style.cssText =
    'font-size:9px;color:rgba(224,224,224,0.3);' +
    'text-transform:uppercase;letter-spacing:0.5px;';
  portraitSubtitle.textContent = 'Optional';
  portraitHeader.append(portraitLabel, portraitSubtitle);
  portraitWrap.appendChild(portraitHeader);

  const portrait: ImportInputsHandle = createImportInputs();
  portraitWrap.appendChild(portrait.root);
  root.appendChild(portraitWrap);
  cleanups.push(portrait.destroy);

  const unsubPortrait = portrait.onChange((_, error) => {
    if (error) notify({ feature: 'customCards', level: 'error', message: error });
  });
  cleanups.push(unsubPortrait);

  // ── Item card ──
  const itemCard = document.createElement('div');
  itemCard.style.cssText =
    'background:rgba(255,255,255,0.02);border:1px solid rgba(143,130,255,0.12);' +
    'border-radius:8px;padding:10px;display:flex;flex-direction:column;gap:10px;';
  itemCard.appendChild(createSectionHeader('Item', { size: 'compact' }).root);

  const OVERRIDES_EXPANDED_KEY = 'qpm.customCards.overridesExpanded.v1';
  const initiallyExpanded = storage.get<boolean>(OVERRIDES_EXPANDED_KEY, false);
  const itemForm: ItemFormHandle = createItemForm(undefined, {
    overridesInitiallyExpanded: initiallyExpanded,
    onOverridesExpandedChange: (open) => {
      storage.set(OVERRIDES_EXPANDED_KEY, open);
    },
  });
  itemCard.appendChild(itemForm.root);
  root.appendChild(itemCard);
  cleanups.push(itemForm.destroy);

  // ── Footer ──
  const footer = document.createElement('div');
  footer.style.cssText = 'display:flex;align-items:center;gap:8px;';
  const takeoverToggle = createToggle({
    label: 'Takeover',
    checked: false,
    size: 'compact',
    onChange: (checked) => { takeoverState = checked; },
  });
  takeoverToggle.root.title =
    'Full takeover hides the native card frame and shows only your portrait.';
  footer.appendChild(takeoverToggle.root);
  const spacer = document.createElement('div');
  spacer.style.flex = '1';
  footer.appendChild(spacer);

  let saveBtn: HTMLButtonElement | null = null;
  function refreshSaveBtn(): void {
    const newBtn = createButton(loadedUserPresetId ? 'Update' : 'Save', {
      variant: 'ghost',
      onClick: onSave,
    });
    if (saveBtn) saveBtn.replaceWith(newBtn);
    else footer.appendChild(newBtn);
    saveBtn = newBtn;
  }
  refreshSaveBtn();

  const openBtn = createButton('Open in game', {
    variant: 'tonal',
    onClick: onOpen,
  });
  footer.appendChild(openBtn);
  root.appendChild(footer);

  // ── Form-clear + preset-load helpers ──
  function clearForm(): void {
    itemForm.setItem({ name: '', petSpecies: '', mutations: [], abilities: [] });
    itemForm.setStats({ xp: 999999, hunger: 350, targetScale: 2.5 });
    itemForm.setOverrides(null);
    portrait.setResult(null);
    takeoverToggle.setChecked(false);
    takeoverState = false;
    refreshSaveBtn();
  }

  function loadPreset(preset: CustomCardPreset): void {
    const formInit: { name?: string; petSpecies?: string; mutations?: string[]; abilities?: string[] } = {
      name: preset.name,
      mutations: preset.item.mutations.slice(),
      abilities: preset.item.abilities.slice(),
    };
    if (preset.item.petSpecies) formInit.petSpecies = preset.item.petSpecies;
    itemForm.setItem(formInit);
    // Old presets (no `stats` field) get legacy defaults. New presets carry actual sliders.
    itemForm.setStats({
      xp: preset.stats?.xp ?? 999999,
      hunger: preset.stats?.hunger ?? 350,
      targetScale: preset.stats?.targetScale ?? 2.5,
    });
    itemForm.setOverrides(preset.overrides ?? null);
    takeoverState = !!preset.fullTakeover;
    takeoverToggle.setChecked(takeoverState);
    portrait.setResult(synthesizeImportResult(preset));
    refreshSaveBtn();
  }

  // ── Save / Open handlers ──
  function onSave(): void {
    const v = itemForm.validate();
    if (!v.ok) {
      notify({ feature: 'customCards', level: 'error', message: v.errors[0] ?? 'Form has errors.' });
      return;
    }
    const portraitResult = portrait.getResult();
    const item = itemForm.getItem();
    const stats = itemForm.getStats();
    const overrides = itemForm.getOverrides();
    const portraitFields = {
      ...(portraitResult?.portraitDataUrl !== undefined ? { portraitDataUrl: portraitResult.portraitDataUrl } : {}),
      ...(portraitResult?.portraitUrl !== undefined ? { portraitUrl: portraitResult.portraitUrl } : {}),
      ...(portraitResult?.videoUrl !== undefined ? { videoUrl: portraitResult.videoUrl } : {}),
    };
    if (loadedUserPresetId) {
      const result = updateUserPreset(loadedUserPresetId, {
        name: item.name,
        ...portraitFields,
        fullTakeover: takeoverState,
        item,
        stats,
        ...(Object.keys(overrides).length > 0 ? { overrides } : {}),
      });
      if (!result.ok) {
        notify({
          feature: 'customCards',
          level: 'error',
          message: `Update failed: ${result.validation?.error?.kind ?? result.reason ?? 'unknown'}`,
        });
        return;
      }
      rebuildPresetSelect();
      notify({ feature: 'customCards', level: 'success', message: `Updated "${item.name}".` });
      return;
    }
    const result = addUserPreset({
      name: item.name,
      source: portraitResult?.source ?? 'data-url',
      ...portraitFields,
      fullTakeover: takeoverState,
      item,
      stats,
      ...(Object.keys(overrides).length > 0 ? { overrides } : {}),
    });
    if (!result.ok) {
      const err = result.validation.error;
      const message =
        err?.kind === 'cap-exceeded' ? `Preset limit reached (${err.limit}). Delete one first.` :
        err?.kind === 'size-exceeded' ? `Preset is ${(err.bytes / 1024 / 1024).toFixed(2)} MB — exceeds the ${(err.limit / 1024 / 1024)} MB limit.` :
        'Save failed.';
      notify({ feature: 'customCards', level: 'error', message });
      return;
    }
    loadedUserPresetId = result.preset!.id;
    rebuildPresetSelect();
    deleteBtn.disabled = false;
    refreshSaveBtn();
    notify({ feature: 'customCards', level: 'success', message: `Saved "${item.name}".` });
  }

  function onOpen(): void {
    const v = itemForm.validate();
    if (!v.ok) {
      notify({ feature: 'customCards', level: 'error', message: v.errors[0] ?? 'Form has errors.' });
      return;
    }
    const portraitResult = portrait.getResult();
    const item = itemForm.getItem();
    const options: OpenNativeCardOptions = { fullTakeover: takeoverState };
    if (portraitResult?.videoUrl) options.videoUrl = portraitResult.videoUrl;
    const url = portraitResult?.portraitUrl ?? portraitResult?.portraitDataUrl;
    if (url) options.portraitUrl = url;
    const overrides = itemForm.getOverrides();
    if (Object.keys(overrides).length > 0) options.overrides = overrides;
    void openNativeCard(item, options).then((ok) => {
      if (!ok) {
        notify({ feature: 'customCards', level: 'error', message: 'Failed to open native card — is the game loaded?' });
      }
    });
  }

  // ── Cleanup on detach ──
  watchDetach(root, () => {
    for (const fn of cleanups) {
      try { fn(); } catch { /* best effort */ }
    }
    cleanups.length = 0;
  });
}

function synthesizeImportResult(preset: CustomCardPreset): PortraitImportResult | null {
  if (!preset.portraitDataUrl && !preset.portraitUrl && !preset.videoUrl) return null;
  const mimeMatch = preset.portraitDataUrl?.match(/^data:([^;,]+)/);
  const mimeType = mimeMatch ? mimeMatch[1]! : preset.videoUrl ? 'video/webm' : 'image/png';
  const result: PortraitImportResult = {
    source: preset.source === 'builtin' ? 'export-url' : preset.source,
    mimeType,
    width: 0,
    height: 0,
    bytes: preset.portraitDataUrl?.length ?? 0,
    softWarn: false,
  };
  if (preset.portraitDataUrl !== undefined) result.portraitDataUrl = preset.portraitDataUrl;
  if (preset.portraitUrl !== undefined) result.portraitUrl = preset.portraitUrl;
  if (preset.videoUrl !== undefined) result.videoUrl = preset.videoUrl;
  return result;
}

export { BUILT_IN_PRESETS };
export type { PhantomInventoryItem };
