// src/ui/sections/inventoryCapacitySection.ts
// Config UI for Inventory Capacity in the Utility Hub.

import { createCard } from '../core/panelHelpers';
import { createToggle } from '../components/toggle';
import {
  getInventoryCapacityConfig,
  updateInventoryCapacityConfig,
  subscribeToInventoryCapacityConfig,
  getInvCapacityCustomSounds,
  addInvCapacityCustomSound,
  removeInvCapacityCustomSound,
  type InventoryCapacityConfig,
  type SoundAlertConfig,
} from '../../features/economy/inventoryCapacity';
import {
  BUILTIN_SOUNDS,
} from '../shop/restockAlerts/soundConfig';
import { previewSound } from '../shop/restockAlerts/soundEngine';
import { t } from '../../i18n';

const MIN_THRESHOLD = 1;
const MAX_THRESHOLD = 100;
const MAX_FILE_SIZE = 500 * 1024;
const STYLE_ID = 'qpm-inv-capacity-section-style';

function clampThreshold(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 85;
  return Math.min(MAX_THRESHOLD, Math.max(MIN_THRESHOLD, Math.round(n)));
}

// ---------------------------------------------------------------------------
// Scoped styles (injected once)
// ---------------------------------------------------------------------------

function ensureSectionStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = [
    `.qpm-ic-snd-label{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;color:rgba(200,192,255,0.72);margin-bottom:2px;}`,
    `.qpm-ic-snd-radio{display:flex;flex-direction:column;gap:4px;max-height:140px;overflow-y:auto;padding-right:4px;}`,
    `.qpm-ic-snd-radio-item{display:flex;align-items:center;gap:8px;padding:4px 8px;border-radius:8px;cursor:pointer;transition:background 0.12s;}`,
    `.qpm-ic-snd-radio-item:hover{background:rgba(143,130,255,0.1);}`,
    `.qpm-ic-snd-radio-item.selected{background:rgba(143,130,255,0.18);border:1px solid rgba(143,130,255,0.4);}`,
    `.qpm-ic-snd-radio-item:not(.selected){border:1px solid transparent;}`,
    `.qpm-ic-snd-radio-name{font-weight:600;font-size:12px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--qpm-text);}`,
    `.qpm-ic-snd-del-btn{background:none;border:none;color:rgba(244,67,54,0.7);cursor:pointer;font-size:12px;padding:2px 4px;border-radius:3px;flex-shrink:0;}`,
    `.qpm-ic-snd-del-btn:hover{color:var(--qpm-danger);background:rgba(244,67,54,0.1);}`,
    `.qpm-ic-snd-toggle{display:flex;gap:6px;}`,
    `.qpm-ic-snd-toggle-btn{flex:1;padding:4px 8px;font-size:12px;font-weight:600;border-radius:8px;cursor:pointer;border:1px solid rgba(143,130,255,0.3);background:rgba(255,255,255,0.04);color:rgba(232,224,255,0.6);transition:all 0.12s;}`,
    `.qpm-ic-snd-toggle-btn.active{background:rgba(143,130,255,0.2);color:#c8c0ff;border-color:rgba(143,130,255,0.55);}`,
    `.qpm-ic-snd-slider-row{display:flex;align-items:center;gap:8px;}`,
    `.qpm-ic-snd-slider{flex:1;accent-color:var(--qpm-accent, #8f82ff);cursor:pointer;}`,
    `.qpm-ic-snd-slider-val{font-size:12px;min-width:32px;text-align:right;font-variant-numeric:tabular-nums;color:rgba(232,224,255,0.7);}`,
    `.qpm-ic-snd-btn{padding:4px 8px;font-size:12px;font-weight:600;border-radius:8px;cursor:pointer;border:1px solid rgba(143,130,255,0.35);transition:all 0.12s;}`,
    `.qpm-ic-snd-btn-primary{background:rgba(143,130,255,0.2);color:#c8c0ff;}`,
    `.qpm-ic-snd-btn-primary:hover{background:rgba(143,130,255,0.32);}`,
    `.qpm-ic-snd-btn-ghost{background:rgba(255,255,255,0.04);color:rgba(232,224,255,0.6);border-color:rgba(229,231,235,0.18);}`,
    `.qpm-ic-snd-btn-ghost:hover{background:rgba(255,255,255,0.08);}`,
    `.qpm-ic-snd-preview{background:none;border:1px solid rgba(143,130,255,0.3);color:rgba(232,224,255,0.7);border-radius:4px;padding:2px 6px;cursor:pointer;font-size:12px;flex-shrink:0;}`,
    `.qpm-ic-snd-preview:hover{color:#c8c0ff;border-color:rgba(143,130,255,0.5);}`,
    `.qpm-ic-snd-upload-label{padding:4px 8px;font-size:12px;font-weight:600;border-radius:4px;cursor:pointer;border:1px dashed rgba(143,130,255,0.35);background:rgba(143,130,255,0.06);color:rgba(200,192,255,0.7);transition:background 0.12s;}`,
    `.qpm-ic-snd-upload-label:hover{background:rgba(143,130,255,0.14);}`,
    `.qpm-ic-snd-error{font-size:12px;color:var(--qpm-danger);margin-top:2px;}`,
  ].join('\n');
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// Inline sound config block builder
// ---------------------------------------------------------------------------

interface SoundBlockOps {
  getConfig: () => SoundAlertConfig | null;
  setConfig: (cfg: SoundAlertConfig | null) => void;
}

function buildSoundConfigBlock(label: string, ops: SoundBlockOps): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = [
    'display:flex',
    'flex-direction:column',
    'gap:8px',
    'padding:12px',
    'border-radius:8px',
    'border:1px solid rgba(255,255,255,0.08)',
    'background:rgba(255,255,255,0.03)',
  ].join(';');

  const existing = ops.getConfig();
  let selectedSoundId = existing?.soundId ?? BUILTIN_SOUNDS[0]!.id;
  let selectedMode: 'once' | 'loop' = existing?.mode ?? 'once';
  let selectedVolume = existing?.volume ?? 0.7;
  let selectedIntervalMs = existing?.intervalMs ?? 3000;
  let isEnabled = existing !== null;

  // -- Header with toggle --
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;';

  const headerLabel = document.createElement('div');
  headerLabel.style.cssText = 'font-size:14px;font-weight:600;color:var(--qpm-text,#fff);';
  headerLabel.textContent = label;

  const { root: headerToggleEl, setChecked: setHeaderToggleChecked } = createToggle({
    checked: isEnabled,
    size: 'compact',
    onChange: (checked) => {
      isEnabled = checked;
      updateVisibility();
      if (isEnabled) {
        save();
      } else {
        ops.setConfig(null);
      }
    },
  });

  header.append(headerLabel, headerToggleEl);
  wrap.appendChild(header);

  // -- Content (hidden when disabled) --
  const content = document.createElement('div');
  content.style.cssText = 'display:flex;flex-direction:column;gap:8px;';

  // -- Sound selector --
  const soundLabel = document.createElement('div');
  soundLabel.className = 'qpm-ic-snd-label';
  soundLabel.textContent = t('feature.soundConfig.sound');
  content.appendChild(soundLabel);

  const radioList = document.createElement('div');
  radioList.className = 'qpm-ic-snd-radio';

  const rebuildRadioList = (): void => {
    radioList.innerHTML = '';
    for (const sound of BUILTIN_SOUNDS) {
      const item = document.createElement('div');
      item.className = `qpm-ic-snd-radio-item${sound.id === selectedSoundId ? ' selected' : ''}`;

      const nameEl = document.createElement('span');
      nameEl.className = 'qpm-ic-snd-radio-name';
      nameEl.textContent = sound.name;

      const prevBtn = document.createElement('button');
      prevBtn.type = 'button';
      prevBtn.className = 'qpm-ic-snd-preview';
      prevBtn.textContent = '\u25B6';
      prevBtn.title = t('feature.soundConfig.preview');
      prevBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        previewSound(sound.id, selectedVolume);
      });

      item.append(nameEl, prevBtn);
      item.addEventListener('click', () => {
        selectedSoundId = sound.id;
        rebuildRadioList();
        save();
      });
      radioList.appendChild(item);
    }

    const customs = getInvCapacityCustomSounds();
    for (const [id, entry] of Object.entries(customs)) {
      const item = document.createElement('div');
      item.className = `qpm-ic-snd-radio-item${id === selectedSoundId ? ' selected' : ''}`;

      const nameEl = document.createElement('span');
      nameEl.className = 'qpm-ic-snd-radio-name';
      nameEl.textContent = entry.name;

      const prevBtn = document.createElement('button');
      prevBtn.type = 'button';
      prevBtn.className = 'qpm-ic-snd-preview';
      prevBtn.textContent = '\u25B6';
      prevBtn.title = t('feature.soundConfig.preview');
      prevBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        previewSound(id, selectedVolume, true, entry.dataUrl);
      });

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'qpm-ic-snd-del-btn';
      delBtn.textContent = '\u2715';
      delBtn.title = t('feature.soundConfig.deleteCustomSound');
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeInvCapacityCustomSound(id);
        if (selectedSoundId === id) selectedSoundId = BUILTIN_SOUNDS[0]!.id;
        rebuildRadioList();
        updateCount();
        save();
      });

      item.append(nameEl, prevBtn, delBtn);
      item.addEventListener('click', () => {
        selectedSoundId = id;
        rebuildRadioList();
        save();
      });
      radioList.appendChild(item);
    }
  };

  rebuildRadioList();
  content.appendChild(radioList);

  // -- Mode toggle --
  const modeLabel = document.createElement('div');
  modeLabel.className = 'qpm-ic-snd-label';
  modeLabel.textContent = t('feature.soundConfig.mode');
  content.appendChild(modeLabel);

  const modeToggle = document.createElement('div');
  modeToggle.className = 'qpm-ic-snd-toggle';

  const onceBtn = document.createElement('button');
  onceBtn.type = 'button';
  onceBtn.className = 'qpm-ic-snd-toggle-btn';
  onceBtn.textContent = t('feature.soundConfig.playOnce');

  const loopBtn = document.createElement('button');
  loopBtn.type = 'button';
  loopBtn.className = 'qpm-ic-snd-toggle-btn';
  loopBtn.textContent = t('feature.soundConfig.loop');

  // -- Speed slider --
  const speedWrap = document.createElement('div');
  speedWrap.style.display = selectedMode === 'loop' ? '' : 'none';

  const speedLabel = document.createElement('div');
  speedLabel.className = 'qpm-ic-snd-label';
  speedLabel.textContent = t('feature.soundConfig.repeatSpeed');

  const speedSliderRow = document.createElement('div');
  speedSliderRow.className = 'qpm-ic-snd-slider-row';

  const speedSlider = document.createElement('input');
  speedSlider.type = 'range';
  speedSlider.className = 'qpm-ic-snd-slider';
  speedSlider.min = '1';
  speedSlider.max = '15';
  speedSlider.value = String(Math.round(selectedIntervalMs / 1000));

  const speedValEl = document.createElement('span');
  speedValEl.className = 'qpm-ic-snd-slider-val';
  speedValEl.textContent = `${Math.round(selectedIntervalMs / 1000)}s`;

  speedSlider.addEventListener('input', () => {
    selectedIntervalMs = Number(speedSlider.value) * 1000;
    speedValEl.textContent = `${speedSlider.value}s`;
    save();
  });

  speedSliderRow.append(speedSlider, speedValEl);
  speedWrap.append(speedLabel, speedSliderRow);

  const updateModeButtons = (): void => {
    onceBtn.className = `qpm-ic-snd-toggle-btn${selectedMode === 'once' ? ' active' : ''}`;
    loopBtn.className = `qpm-ic-snd-toggle-btn${selectedMode === 'loop' ? ' active' : ''}`;
    speedWrap.style.display = selectedMode === 'loop' ? '' : 'none';
  };
  updateModeButtons();

  onceBtn.addEventListener('click', () => { selectedMode = 'once'; updateModeButtons(); save(); });
  loopBtn.addEventListener('click', () => { selectedMode = 'loop'; updateModeButtons(); save(); });
  modeToggle.append(onceBtn, loopBtn);
  content.appendChild(modeToggle);
  content.appendChild(speedWrap);

  // -- Volume slider --
  const volLabel = document.createElement('div');
  volLabel.className = 'qpm-ic-snd-label';
  volLabel.textContent = t('feature.soundConfig.volume');
  content.appendChild(volLabel);

  const sliderRow = document.createElement('div');
  sliderRow.className = 'qpm-ic-snd-slider-row';

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.className = 'qpm-ic-snd-slider';
  slider.min = '0';
  slider.max = '100';
  slider.value = String(Math.round(selectedVolume * 100));

  const valEl = document.createElement('span');
  valEl.className = 'qpm-ic-snd-slider-val';
  valEl.textContent = `${Math.round(selectedVolume * 100)}%`;

  slider.addEventListener('input', () => {
    selectedVolume = Number(slider.value) / 100;
    valEl.textContent = `${slider.value}%`;
    save();
  });

  sliderRow.append(slider, valEl);
  content.appendChild(sliderRow);

  // -- Custom sound upload --
  const uploadWrap = document.createElement('div');
  uploadWrap.style.cssText = 'display:flex;align-items:center;gap:8px;border-top:1px solid rgba(143,130,255,0.15);padding-top:8px;';

  const uploadLabel2 = document.createElement('div');
  uploadLabel2.className = 'qpm-ic-snd-label';
  uploadLabel2.textContent = t('feature.soundConfig.customSounds');
  uploadLabel2.style.marginBottom = '0';
  uploadLabel2.style.flex = '1';

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'audio/*';
  fileInput.style.display = 'none';

  const fileLabelEl = document.createElement('label');
  fileLabelEl.className = 'qpm-ic-snd-upload-label';
  fileLabelEl.textContent = t('feature.soundConfig.upload');
  fileLabelEl.addEventListener('click', () => fileInput.click());

  const countEl = document.createElement('span');
  countEl.style.cssText = 'font-size:11px;color:rgba(232,224,255,0.45);';

  const updateCount = (): void => {
    const count = Object.keys(getInvCapacityCustomSounds()).length;
    countEl.textContent = `${count}/10`;
  };
  updateCount();

  const errorEl = document.createElement('div');
  errorEl.className = 'qpm-ic-snd-error';
  errorEl.style.display = 'none';

  fileInput.addEventListener('change', () => {
    errorEl.style.display = 'none';
    const file = fileInput.files?.[0];
    if (!file) return;

    if (file.size > MAX_FILE_SIZE) {
      errorEl.textContent = t('feature.soundConfig.fileTooLarge');
      errorEl.style.display = '';
      fileInput.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (): void => {
      const dataUrl = reader.result as string;
      try {
        const name = file.name.replace(/\.[^.]+$/, '').slice(0, 30) || 'Custom';
        const newId = addInvCapacityCustomSound(name, dataUrl);
        selectedSoundId = newId;
        rebuildRadioList();
        updateCount();
        save();
      } catch (err) {
        errorEl.textContent = err instanceof Error ? err.message : t('feature.soundConfig.failedToAdd');
        errorEl.style.display = '';
      }
      fileInput.value = '';
    };
    reader.readAsDataURL(file);
  });

  uploadWrap.append(uploadLabel2, fileLabelEl, countEl);
  content.append(uploadWrap, errorEl);

  // -- Clear button --
  const clearRow = document.createElement('div');
  clearRow.style.cssText = 'display:flex;justify-content:flex-end;';

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'qpm-ic-snd-btn qpm-ic-snd-btn-ghost';
  clearBtn.textContent = t('feature.soundConfig.clearSound');
  clearBtn.addEventListener('click', () => {
    isEnabled = false;
    setHeaderToggleChecked(false);
    ops.setConfig(null);
    updateVisibility();
  });

  clearRow.appendChild(clearBtn);
  content.appendChild(clearRow);

  wrap.appendChild(content);

  // -- Visibility --
  const updateVisibility = (): void => {
    content.style.display = isEnabled ? '' : 'none';
    wrap.style.opacity = isEnabled ? '1' : '0.65';
  };
  updateVisibility();


  // -- Save helper --
  function save(): void {
    if (!isEnabled) return;
    ops.setConfig({
      soundId: selectedSoundId,
      mode: selectedMode,
      volume: selectedVolume,
      intervalMs: selectedIntervalMs,
    });
  }

  // -- Sync from external config changes --
  function syncFromConfig(cfg: SoundAlertConfig | null): void {
    const newEnabled = cfg !== null;
    if (newEnabled !== isEnabled) {
      isEnabled = newEnabled;
      setHeaderToggleChecked(isEnabled);
      updateVisibility();
    }
    if (cfg) {
      if (cfg.soundId !== selectedSoundId) {
        selectedSoundId = cfg.soundId;
        rebuildRadioList();
      }
      if (cfg.mode !== selectedMode) {
        selectedMode = cfg.mode;
        updateModeButtons();
      }
      if (Math.abs(cfg.volume - selectedVolume) > 0.01) {
        selectedVolume = cfg.volume;
        slider.value = String(Math.round(selectedVolume * 100));
        valEl.textContent = `${Math.round(selectedVolume * 100)}%`;
      }
      if (cfg.intervalMs !== selectedIntervalMs) {
        selectedIntervalMs = cfg.intervalMs;
        speedSlider.value = String(Math.round(selectedIntervalMs / 1000));
        speedValEl.textContent = `${Math.round(selectedIntervalMs / 1000)}s`;
      }
    }
  }

  (wrap as unknown as HTMLElement & { _syncFromConfig: typeof syncFromConfig })._syncFromConfig = syncFromConfig;

  return wrap;
}

// ---------------------------------------------------------------------------
// Main section
// ---------------------------------------------------------------------------

export function createInventoryCapacitySection(): HTMLElement {
  ensureSectionStyles();

  const { root, body } = createCard(t('feature.invCapacity.title'));
  root.dataset.qpmSection = 'inv-capacity';

  // -- Enable toggle --
  const toggleRow = document.createElement('div');
  toggleRow.style.cssText = [
    'display:flex',
    'align-items:center',
    'justify-content:space-between',
    'gap:8px',
    'padding:8px 12px',
    'border-radius:8px',
    'border:1px solid rgba(255,255,255,0.08)',
    'background:rgba(255,255,255,0.03)',
  ].join(';');

  const toggleTitle = document.createElement('div');
  toggleTitle.style.cssText = 'font-size:14px;font-weight:600;color:var(--qpm-text,#fff);';
  toggleTitle.textContent = t('feature.invCapacity.enableWarning');

  const { root: toggleEl, setChecked: setMainToggleChecked } = createToggle({
    onChange: (checked) => updateInventoryCapacityConfig({ enabled: checked }),
  });

  toggleRow.append(toggleTitle, toggleEl);
  body.appendChild(toggleRow);

  // -- Warning threshold --
  const thresholdWrap = document.createElement('div');
  thresholdWrap.style.cssText = [
    'display:flex',
    'align-items:center',
    'justify-content:space-between',
    'gap:8px',
    'padding:8px 12px',
    'border-radius:8px',
    'border:1px solid rgba(255,255,255,0.08)',
    'background:rgba(255,255,255,0.03)',
  ].join(';');

  const thresholdLabel = document.createElement('div');
  thresholdLabel.style.cssText = 'font-size:14px;font-weight:600;color:var(--qpm-text,#fff);';
  thresholdLabel.textContent = t('feature.invCapacity.warningThreshold');

  const thresholdRight = document.createElement('div');
  thresholdRight.style.cssText = 'display:flex;align-items:center;gap:6px;';

  const thresholdInput = document.createElement('input');
  thresholdInput.type = 'number';
  thresholdInput.min = String(MIN_THRESHOLD);
  thresholdInput.max = String(MAX_THRESHOLD);
  thresholdInput.step = '1';
  thresholdInput.style.cssText = [
    'width:56px',
    'padding:4px 8px',
    'border-radius:8px',
    'border:1px solid rgba(255,255,255,0.18)',
    'background:rgba(0,0,0,0.22)',
    'color:var(--qpm-text,#fff)',
    'font-size:12px',
    'text-align:center',
  ].join(';');

  const thresholdSuffix = document.createElement('span');
  thresholdSuffix.style.cssText = 'font-size:12px;color:var(--qpm-text-muted,rgba(255,255,255,0.65));';
  thresholdSuffix.textContent = t('feature.invCapacity.slotsMax');

  thresholdRight.append(thresholdInput, thresholdSuffix);
  thresholdWrap.append(thresholdLabel, thresholdRight);
  body.appendChild(thresholdWrap);

  // -- Warning color --
  const warningColorWrap = document.createElement('div');
  warningColorWrap.style.cssText = [
    'display:flex',
    'align-items:center',
    'justify-content:space-between',
    'gap:8px',
    'padding:8px 12px',
    'border-radius:8px',
    'border:1px solid rgba(255,255,255,0.08)',
    'background:rgba(255,255,255,0.03)',
  ].join(';');

  const warningColorLabel = document.createElement('div');
  warningColorLabel.style.cssText = 'font-size:14px;font-weight:600;color:var(--qpm-text,#fff);';
  warningColorLabel.textContent = t('feature.invCapacity.warningColor');

  const warningColorInput = document.createElement('input');
  warningColorInput.type = 'color';
  warningColorInput.style.cssText = 'width:36px;height:28px;border:none;background:none;cursor:pointer;padding:0;';

  warningColorWrap.append(warningColorLabel, warningColorInput);
  body.appendChild(warningColorWrap);

  // -- Full color --
  const fullColorWrap = document.createElement('div');
  fullColorWrap.style.cssText = [
    'display:flex',
    'align-items:center',
    'justify-content:space-between',
    'gap:8px',
    'padding:8px 12px',
    'border-radius:8px',
    'border:1px solid rgba(255,255,255,0.08)',
    'background:rgba(255,255,255,0.03)',
  ].join(';');

  const fullColorLabel = document.createElement('div');
  fullColorLabel.style.cssText = 'font-size:14px;font-weight:600;color:var(--qpm-text,#fff);';
  fullColorLabel.textContent = t('feature.invCapacity.fullColor');

  const fullColorInput = document.createElement('input');
  fullColorInput.type = 'color';
  fullColorInput.style.cssText = 'width:36px;height:28px;border:none;background:none;cursor:pointer;padding:0;';

  fullColorWrap.append(fullColorLabel, fullColorInput);
  body.appendChild(fullColorWrap);

  // -- Sound config blocks --
  const warningSoundBlock = buildSoundConfigBlock(t('feature.invCapacity.warningSound'), {
    getConfig: () => getInventoryCapacityConfig().warningSound,
    setConfig: (cfg) => updateInventoryCapacityConfig({ warningSound: cfg }),
  });
  body.appendChild(warningSoundBlock);

  const fullSoundBlock = buildSoundConfigBlock(t('feature.invCapacity.fullSound'), {
    getConfig: () => getInventoryCapacityConfig().fullSound,
    setConfig: (cfg) => updateInventoryCapacityConfig({ fullSound: cfg }),
  });
  body.appendChild(fullSoundBlock);

  // -- Sync UI from config --
  const configControls = [thresholdWrap, warningColorWrap, fullColorWrap, warningSoundBlock, fullSoundBlock];

  const syncUi = (cfg: InventoryCapacityConfig): void => {
    setMainToggleChecked(cfg.enabled);
    thresholdInput.value = String(cfg.warningThreshold);
    warningColorInput.value = cfg.warningColor;
    fullColorInput.value = cfg.fullColor;

    const disabled = !cfg.enabled;
    thresholdInput.disabled = disabled;
    warningColorInput.disabled = disabled;
    fullColorInput.disabled = disabled;
    for (const wrap of configControls) {
      wrap.style.opacity = disabled ? '0.65' : '1';
      wrap.style.pointerEvents = disabled ? 'none' : '';
    }

    // Sync sound blocks
    const warnSync = (warningSoundBlock as HTMLElement & { _syncFromConfig?: (cfg: SoundAlertConfig | null) => void })._syncFromConfig;
    const fullSync = (fullSoundBlock as HTMLElement & { _syncFromConfig?: (cfg: SoundAlertConfig | null) => void })._syncFromConfig;
    warnSync?.(cfg.warningSound);
    fullSync?.(cfg.fullSound);
  };

  // -- Event handlers --
  const commitThreshold = (): void => {
    updateInventoryCapacityConfig({ warningThreshold: clampThreshold(thresholdInput.value) });
  };
  thresholdInput.addEventListener('change', commitThreshold);
  thresholdInput.addEventListener('blur', commitThreshold);

  warningColorInput.addEventListener('input', () => {
    updateInventoryCapacityConfig({ warningColor: warningColorInput.value });
  });

  fullColorInput.addEventListener('input', () => {
    updateInventoryCapacityConfig({ fullColor: fullColorInput.value });
  });

  // -- Cleanup on detach --
  const unsubscribe = subscribeToInventoryCapacityConfig(syncUi);
  const detachObserver = new MutationObserver(() => {
    if (!document.documentElement.contains(root)) {
      unsubscribe();
      detachObserver.disconnect();
    }
  });
  detachObserver.observe(document.documentElement, { childList: true, subtree: true });

  return root;
}
