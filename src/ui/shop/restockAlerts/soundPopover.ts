// src/ui/shopRestockAlerts/soundPopover.ts
// Per-item sound configuration popover UI for the Shop Restock system.

import {
  BUILTIN_SOUNDS,
  BUILTIN_SOUND_IDS,
  DEFAULT_LOOP_INTERVAL_MS,
  getSoundConfig,
  setSoundConfig,
  removeSoundConfig,
  getCustomSounds,
  addCustomSound,
  removeCustomSound,
  normalizeSoundKey,
  type ItemSoundConfig,
} from './soundConfig';
import { previewSound, playSound, playCustomSound, startLoop, stopLoop, isBuiltinSound } from './soundEngine';
import { activeAlerts } from './alertState';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const POPOVER_ID = 'qpm-restock-sound-popover';
const POPOVER_STYLE_ID = 'qpm-restock-sound-popover-style';
const MAX_FILE_SIZE = 500 * 1024; // 500KB

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let currentPopover: HTMLDivElement | null = null;
let currentItemKey: string | null = null;
let outsideClickHandler: ((e: MouseEvent) => void) | null = null;

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

function ensurePopoverStyles(): void {
  if (document.getElementById(POPOVER_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = POPOVER_STYLE_ID;
  style.textContent = [
    `#${POPOVER_ID}{position:absolute;z-index:2147483601;min-width:280px;max-width:340px;background:rgba(18,20,26,0.97);border:1px solid rgba(143,130,255,0.5);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,0.45);padding:14px 16px;display:flex;flex-direction:column;gap:12px;font-size:13px;color:#e8e0ff;}`,
    `#${POPOVER_ID} .snd-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;color:rgba(200,192,255,0.72);margin-bottom:2px;}`,
    `#${POPOVER_ID} .snd-row{display:flex;align-items:center;gap:8px;}`,
    `#${POPOVER_ID} .snd-radio{display:flex;flex-direction:column;gap:4px;max-height:180px;overflow-y:auto;padding-right:4px;}`,
    `#${POPOVER_ID} .snd-radio-item{display:flex;align-items:center;gap:8px;padding:4px 8px;border-radius:6px;cursor:pointer;transition:background 0.12s;}`,
    `#${POPOVER_ID} .snd-radio-item:hover{background:rgba(143,130,255,0.1);}`,
    `#${POPOVER_ID} .snd-radio-item.selected{background:rgba(143,130,255,0.18);border:1px solid rgba(143,130,255,0.4);}`,
    `#${POPOVER_ID} .snd-radio-item:not(.selected){border:1px solid transparent;}`,
    `#${POPOVER_ID} .snd-radio-name{font-weight:600;font-size:13px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}`,
    `#${POPOVER_ID} .snd-del-btn{background:none;border:none;color:rgba(248,113,113,0.7);cursor:pointer;font-size:12px;padding:2px 4px;border-radius:3px;flex-shrink:0;}`,
    `#${POPOVER_ID} .snd-del-btn:hover{color:#f87171;background:rgba(248,113,113,0.1);}`,
    `#${POPOVER_ID} .snd-toggle{display:flex;gap:6px;}`,
    `#${POPOVER_ID} .snd-toggle-btn{flex:1;padding:5px 10px;font-size:12px;font-weight:600;border-radius:6px;cursor:pointer;border:1px solid rgba(143,130,255,0.3);background:rgba(255,255,255,0.04);color:rgba(232,224,255,0.6);transition:all 0.12s;}`,
    `#${POPOVER_ID} .snd-toggle-btn.active{background:rgba(143,130,255,0.2);color:#c8c0ff;border-color:rgba(143,130,255,0.55);}`,
    `#${POPOVER_ID} .snd-slider-row{display:flex;align-items:center;gap:8px;}`,
    `#${POPOVER_ID} .snd-slider{flex:1;accent-color:#8f82ff;cursor:pointer;}`,
    `#${POPOVER_ID} .snd-slider-val{font-size:12px;min-width:32px;text-align:right;font-variant-numeric:tabular-nums;color:rgba(232,224,255,0.7);}`,
    `#${POPOVER_ID} .snd-btn{padding:5px 12px;font-size:12px;font-weight:600;border-radius:6px;cursor:pointer;border:1px solid rgba(143,130,255,0.35);transition:all 0.12s;}`,
    `#${POPOVER_ID} .snd-btn-primary{background:rgba(143,130,255,0.2);color:#c8c0ff;}`,
    `#${POPOVER_ID} .snd-btn-primary:hover{background:rgba(143,130,255,0.32);}`,
    `#${POPOVER_ID} .snd-btn-ghost{background:rgba(255,255,255,0.04);color:rgba(232,224,255,0.6);border-color:rgba(229,231,235,0.18);}`,
    `#${POPOVER_ID} .snd-btn-ghost:hover{background:rgba(255,255,255,0.08);}`,
    `#${POPOVER_ID} .snd-btn-row{display:flex;gap:8px;justify-content:flex-end;}`,
    `#${POPOVER_ID} .snd-preview{background:none;border:1px solid rgba(143,130,255,0.3);color:rgba(232,224,255,0.7);border-radius:4px;padding:2px 6px;cursor:pointer;font-size:11px;flex-shrink:0;}`,
    `#${POPOVER_ID} .snd-preview:hover{color:#c8c0ff;border-color:rgba(143,130,255,0.5);}`,
    `#${POPOVER_ID} .snd-upload-row{display:flex;align-items:center;gap:8px;}`,
    `#${POPOVER_ID} .snd-upload-label{padding:4px 10px;font-size:11px;font-weight:600;border-radius:5px;cursor:pointer;border:1px dashed rgba(143,130,255,0.35);background:rgba(143,130,255,0.06);color:rgba(200,192,255,0.7);transition:background 0.12s;}`,
    `#${POPOVER_ID} .snd-upload-label:hover{background:rgba(143,130,255,0.14);}`,
    `#${POPOVER_ID} .snd-error{font-size:11px;color:#f87171;margin-top:-4px;}`,
    `#${POPOVER_ID} .snd-section{border-top:1px solid rgba(143,130,255,0.15);padding-top:10px;}`,
  ].join('\n');
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// Popover builder
// ---------------------------------------------------------------------------

function buildPopover(itemKey: string, onSave?: () => void): HTMLDivElement {
  const el = document.createElement('div');
  el.id = POPOVER_ID;

  const existing = getSoundConfig(itemKey);
  let selectedSoundId = existing?.soundId ?? BUILTIN_SOUNDS[0]!.id;
  let selectedMode: 'once' | 'loop' = existing?.mode ?? 'once';
  let selectedVolume = existing?.volume ?? 0.7;
  let selectedIntervalMs = existing?.intervalMs ?? DEFAULT_LOOP_INTERVAL_MS;

  // -- Title --
  const title = document.createElement('div');
  title.style.cssText = 'font-size:14px;font-weight:700;color:#e8e0ff;';
  title.textContent = 'Sound Alert';
  el.appendChild(title);

  // -- Sound selector --
  const soundLabel = document.createElement('div');
  soundLabel.className = 'snd-label';
  soundLabel.textContent = 'Sound';
  el.appendChild(soundLabel);

  const radioList = document.createElement('div');
  radioList.className = 'snd-radio';

  const rebuildRadioList = (): void => {
    radioList.innerHTML = '';
    // Built-in sounds
    for (const sound of BUILTIN_SOUNDS) {
      const item = document.createElement('div');
      item.className = `snd-radio-item${sound.id === selectedSoundId ? ' selected' : ''}`;
      item.dataset.soundId = sound.id;

      const nameEl = document.createElement('span');
      nameEl.className = 'snd-radio-name';
      nameEl.textContent = sound.name;

      const prevBtn = document.createElement('button');
      prevBtn.type = 'button';
      prevBtn.className = 'snd-preview';
      prevBtn.textContent = '\u25B6'; // ▶
      prevBtn.title = 'Preview';
      prevBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        previewSound(sound.id, selectedVolume);
      });

      item.append(nameEl, prevBtn);
      item.addEventListener('click', () => {
        selectedSoundId = sound.id;
        rebuildRadioList();
      });
      radioList.appendChild(item);
    }

    // Custom sounds
    const customs = getCustomSounds();
    for (const [id, entry] of Object.entries(customs)) {
      const item = document.createElement('div');
      item.className = `snd-radio-item${id === selectedSoundId ? ' selected' : ''}`;
      item.dataset.soundId = id;

      const nameEl = document.createElement('span');
      nameEl.className = 'snd-radio-name';
      nameEl.textContent = entry.name;

      const prevBtn = document.createElement('button');
      prevBtn.type = 'button';
      prevBtn.className = 'snd-preview';
      prevBtn.textContent = '\u25B6';
      prevBtn.title = 'Preview';
      prevBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        previewSound(id, selectedVolume, true, entry.dataUrl);
      });

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'snd-del-btn';
      delBtn.textContent = '\u2715'; // ✕
      delBtn.title = 'Delete custom sound';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeCustomSound(id);
        if (selectedSoundId === id) selectedSoundId = BUILTIN_SOUNDS[0]!.id;
        rebuildRadioList();
      });

      item.append(nameEl, prevBtn, delBtn);
      item.addEventListener('click', () => {
        selectedSoundId = id;
        rebuildRadioList();
      });
      radioList.appendChild(item);
    }
  };

  rebuildRadioList();
  el.appendChild(radioList);

  // -- Mode toggle --
  const modeLabel = document.createElement('div');
  modeLabel.className = 'snd-label';
  modeLabel.textContent = 'Mode';
  el.appendChild(modeLabel);

  const modeToggle = document.createElement('div');
  modeToggle.className = 'snd-toggle';

  const onceBtn = document.createElement('button');
  onceBtn.type = 'button';
  onceBtn.className = 'snd-toggle-btn';
  onceBtn.textContent = 'Play once';

  const loopBtn = document.createElement('button');
  loopBtn.type = 'button';
  loopBtn.className = 'snd-toggle-btn';
  loopBtn.textContent = 'Loop until purchased';

  // -- Speed slider (loop interval, only visible in loop mode) --
  const speedWrap = document.createElement('div');
  speedWrap.style.display = selectedMode === 'loop' ? '' : 'none';

  const speedLabel = document.createElement('div');
  speedLabel.className = 'snd-label';
  speedLabel.textContent = 'Repeat speed';

  const speedSliderRow = document.createElement('div');
  speedSliderRow.className = 'snd-slider-row';

  const speedSlider = document.createElement('input');
  speedSlider.type = 'range';
  speedSlider.className = 'snd-slider';
  speedSlider.min = '1';   // 1s
  speedSlider.max = '15';  // 15s
  speedSlider.value = String(Math.round(selectedIntervalMs / 1000));

  const speedValEl = document.createElement('span');
  speedValEl.className = 'snd-slider-val';
  speedValEl.textContent = `${Math.round(selectedIntervalMs / 1000)}s`;

  speedSlider.addEventListener('input', () => {
    selectedIntervalMs = Number(speedSlider.value) * 1000;
    speedValEl.textContent = `${speedSlider.value}s`;
  });

  speedSliderRow.append(speedSlider, speedValEl);
  speedWrap.append(speedLabel, speedSliderRow);

  const updateModeButtons = (): void => {
    onceBtn.className = `snd-toggle-btn${selectedMode === 'once' ? ' active' : ''}`;
    loopBtn.className = `snd-toggle-btn${selectedMode === 'loop' ? ' active' : ''}`;
    speedWrap.style.display = selectedMode === 'loop' ? '' : 'none';
  };
  updateModeButtons();

  onceBtn.addEventListener('click', () => { selectedMode = 'once'; updateModeButtons(); });
  loopBtn.addEventListener('click', () => { selectedMode = 'loop'; updateModeButtons(); });
  modeToggle.append(onceBtn, loopBtn);
  el.appendChild(modeToggle);
  el.appendChild(speedWrap);

  // -- Volume slider --
  const volLabel = document.createElement('div');
  volLabel.className = 'snd-label';
  volLabel.textContent = 'Volume';
  el.appendChild(volLabel);

  const sliderRow = document.createElement('div');
  sliderRow.className = 'snd-slider-row';

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.className = 'snd-slider';
  slider.min = '0';
  slider.max = '100';
  slider.value = String(Math.round(selectedVolume * 100));

  const valEl = document.createElement('span');
  valEl.className = 'snd-slider-val';
  valEl.textContent = `${Math.round(selectedVolume * 100)}%`;

  slider.addEventListener('input', () => {
    selectedVolume = Number(slider.value) / 100;
    valEl.textContent = `${slider.value}%`;
  });

  sliderRow.append(slider, valEl);
  el.appendChild(sliderRow);

  // -- Custom sound upload --
  const uploadSection = document.createElement('div');
  uploadSection.className = 'snd-section';

  const uploadLabel = document.createElement('div');
  uploadLabel.className = 'snd-label';
  uploadLabel.textContent = 'Custom sounds';
  uploadSection.appendChild(uploadLabel);

  const errorEl = document.createElement('div');
  errorEl.className = 'snd-error';
  errorEl.style.display = 'none';

  const uploadRow = document.createElement('div');
  uploadRow.className = 'snd-upload-row';

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'audio/*';
  fileInput.style.display = 'none';

  const fileLabelEl = document.createElement('label');
  fileLabelEl.className = 'snd-upload-label';
  fileLabelEl.textContent = '+ Upload sound';
  fileLabelEl.addEventListener('click', () => fileInput.click());

  const countEl = document.createElement('span');
  countEl.style.cssText = 'font-size:11px;color:rgba(232,224,255,0.45);';
  const updateCount = (): void => {
    const count = Object.keys(getCustomSounds()).length;
    countEl.textContent = `${count}/10`;
  };
  updateCount();

  fileInput.addEventListener('change', () => {
    errorEl.style.display = 'none';
    const file = fileInput.files?.[0];
    if (!file) return;

    if (file.size > MAX_FILE_SIZE) {
      errorEl.textContent = 'File too large (max 500KB)';
      errorEl.style.display = '';
      fileInput.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (): void => {
      const dataUrl = reader.result as string;
      try {
        const name = file.name.replace(/\.[^.]+$/, '').slice(0, 30) || 'Custom';
        const newId = addCustomSound(name, dataUrl);
        selectedSoundId = newId;
        rebuildRadioList();
        updateCount();
      } catch (err) {
        errorEl.textContent = err instanceof Error ? err.message : 'Failed to add sound';
        errorEl.style.display = '';
      }
      fileInput.value = '';
    };
    reader.readAsDataURL(file);
  });

  uploadRow.append(fileLabelEl, countEl);
  uploadSection.append(uploadRow, errorEl);
  el.appendChild(uploadSection);

  // -- Action buttons --
  const btnRow = document.createElement('div');
  btnRow.className = 'snd-btn-row';

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'snd-btn snd-btn-ghost';
  clearBtn.textContent = 'Clear';
  clearBtn.addEventListener('click', () => {
    const canonicalKey = normalizeSoundKey(itemKey);
    stopLoop(canonicalKey);
    removeSoundConfig(itemKey);
    hideSoundPopover();
    onSave?.();
  });

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'snd-btn snd-btn-primary';
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', () => {
    const config: ItemSoundConfig = {
      soundId: selectedSoundId,
      mode: selectedMode,
      volume: selectedVolume,
      intervalMs: selectedIntervalMs,
    };
    setSoundConfig(itemKey, config);

    // If an alert is already active for this item, trigger the sound now.
    // activeAlerts is keyed by canonical key (lowercase), so normalize.
    const canonicalKey = normalizeSoundKey(itemKey);
    if (activeAlerts.has(canonicalKey)) {
      stopLoop(canonicalKey);
      const isCustom = !isBuiltinSound(config.soundId);
      const customDataUrl = isCustom ? getCustomSounds()[config.soundId]?.dataUrl : undefined;
      if (isCustom && customDataUrl) {
        void playCustomSound(customDataUrl, config.volume);
      } else {
        void playSound(config.soundId, config.volume);
      }
      if (config.mode === 'loop') {
        startLoop(canonicalKey, config.soundId, config.volume, isCustom, customDataUrl, config.intervalMs);
      }
    }

    hideSoundPopover();
    onSave?.();
  });

  btnRow.append(clearBtn, saveBtn);
  el.appendChild(btnRow);

  return el;
}

// ---------------------------------------------------------------------------
// Positioning
// ---------------------------------------------------------------------------

function positionPopover(popover: HTMLDivElement, anchor: HTMLElement): void {
  const rect = anchor.getBoundingClientRect();
  const viewW = window.innerWidth;
  const viewH = window.innerHeight;

  // Default: below and aligned to the left of anchor
  let top = rect.bottom + 6;
  let left = rect.left;

  // Append first to measure
  popover.style.visibility = 'hidden';
  document.body.appendChild(popover);
  const popRect = popover.getBoundingClientRect();

  // Clamp right edge
  if (left + popRect.width > viewW - 12) {
    left = viewW - popRect.width - 12;
  }
  // Clamp left edge
  if (left < 12) left = 12;

  // If not enough space below, show above
  if (top + popRect.height > viewH - 12) {
    top = rect.top - popRect.height - 6;
  }
  // Clamp top edge
  if (top < 12) top = 12;

  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
  popover.style.visibility = '';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function showSoundPopover(anchorEl: HTMLElement, itemKey: string, onSave?: () => void): void {
  // Close existing popover if open
  hideSoundPopover();

  ensurePopoverStyles();
  currentItemKey = itemKey;
  currentPopover = buildPopover(itemKey, onSave);
  positionPopover(currentPopover, anchorEl);

  // Click-outside to dismiss
  outsideClickHandler = (e: MouseEvent): void => {
    if (!currentPopover) return;
    if (currentPopover.contains(e.target as Node)) return;
    if (anchorEl.contains(e.target as Node)) return;
    hideSoundPopover();
  };
  // Delay attachment to avoid the opening click dismissing immediately
  requestAnimationFrame(() => {
    if (outsideClickHandler) {
      document.addEventListener('mousedown', outsideClickHandler, true);
    }
  });
}

export function hideSoundPopover(): void {
  if (outsideClickHandler) {
    document.removeEventListener('mousedown', outsideClickHandler, true);
    outsideClickHandler = null;
  }
  currentPopover?.remove();
  currentPopover = null;
  currentItemKey = null;
}

export function isSoundPopoverOpen(): boolean {
  return currentPopover !== null;
}
