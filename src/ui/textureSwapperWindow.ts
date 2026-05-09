// src/ui/textureSwapperWindow.ts
// Texture Manipulator window — target picker, source picker, params, preview, active rules

import { toggleWindow } from './modalWindow';
import { invalidateWindow } from './lazyWindow';
import {
  getTextureSwapperState,
  getSvc,
  addRule,
  updateRule,
  deleteRule,
  addUploadedAsset,
  UPLOADS_ENABLED,
  TEXTURE_MANIPULATOR_ENABLED,
  buildPreviewCanvas,
  getOriginalSpriteCanvas,
  parseAtlasKey,
  isTextureSwapperDebugEnabled,
  setTextureSwapperDebugEnabled,
  type TextureOverrideRule,
} from '../features/textureSwapper';
import { notify } from '../core/notifications';
import { t } from '../i18n';
import type { SpriteCategory } from '../sprite-v2/types';

const WINDOW_ID = 'texture-swapper';

const CATEGORIES: SpriteCategory[] = [
  'plant',
  'tallplant',
  'crop',
  'pet',
  'seed',
  'item',
  'decor',
  'mutation',
  'mutation-overlay',
];
const CATEGORY_LABEL_KEYS: Record<string, string> = {
  plant: 'feature.textureSwapper.catPlant',
  tallplant: 'feature.textureSwapper.catTallPlant',
  crop: 'feature.textureSwapper.catCrop',
  pet: 'feature.textureSwapper.catPet',
  seed: 'feature.textureSwapper.catSeed',
  item: 'feature.textureSwapper.catItem',
  decor: 'feature.textureSwapper.catDecor',
  mutation: 'feature.textureSwapper.catMutation',
  'mutation-overlay': 'feature.textureSwapper.catMutationOverlay',
};

const TINT_BLENDS = [
  'multiply', 'screen', 'overlay', 'darken', 'lighten',
  'color-dodge', 'color-burn', 'hard-light', 'soft-light',
  'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity',
];

// ---------------------------------------------------------------------------
// Window state (local to window, rebuilt on each open)
// ---------------------------------------------------------------------------

interface WindowState {
  selectedCategory: SpriteCategory;
  // Currently editing
  editingRule: Partial<TextureOverrideRule> | null;
  editingRuleId: string | null; // null = new rule
  // Sprite picker state
  targetSpriteKey: string;
  targetSpriteFilter: string;
  // Source picker state
  sourceMode: 'tint-only' | 'library' | 'upload';
  librarySpriteKey: string;
  librarySpriteFilter: string;
  libraryCategory: SpriteCategory;
  uploadAssetId: string;
  // Params
  tintColor: string;
  tintAlpha: number;
  tintBlend: string;
  scaleX: number;
  scaleY: number;
  alpha: number;
  mutationBehavior: 'preserve' | 'replace';
}

function defaultState(): WindowState {
  return {
    selectedCategory: 'plant',
    editingRule: null,
    editingRuleId: null,
    targetSpriteKey: '',
    targetSpriteFilter: '',
    sourceMode: 'tint-only',
    librarySpriteKey: '',
    librarySpriteFilter: '',
    libraryCategory: 'plant',
    uploadAssetId: '',
    tintColor: '#ff8800',
    tintAlpha: 0.5,
    tintBlend: 'multiply',
    scaleX: 1,
    scaleY: 1,
    alpha: 1,
    mutationBehavior: 'preserve',
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function openTextureSwapperWindow(): void {
  if (!TEXTURE_MANIPULATOR_ENABLED) {
    notify({ feature: 'textureSwapper', level: 'warning', message: t('feature.textureSwapper.disabledNotice') });
    return;
  }
  toggleWindow(WINDOW_ID, t('feature.textureSwapper.title'), (root) => renderWindow(root), '920px', '88vh');
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function renderWindow(root: HTMLElement): void {
  root.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden;';

  const state = defaultState();
  const cleanups: Array<() => void> = [];
  let debugCheckboxEl: HTMLInputElement | null = null;

  // Listen for external rule changes (from other windows or feature updates)
  const onUpdate = () => {
    // Refresh rules list
    renderRulesList(rulesListContainer, state, cleanups);
    if (debugCheckboxEl) {
      debugCheckboxEl.checked = isTextureSwapperDebugEnabled();
    }
  };
  window.addEventListener('qpm:texture-manipulator-updated', onUpdate);
  cleanups.push(() => window.removeEventListener('qpm:texture-manipulator-updated', onUpdate));

  // Cleanup on window detach
  const obs = new MutationObserver(() => {
    if (!root.isConnected) {
      obs.disconnect();
      for (const fn of cleanups) fn();
      cleanups.length = 0;
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });

  // Header
  const header = document.createElement('div');
  header.style.cssText = [
    'padding:14px 18px 10px',
    'border-bottom:1px solid rgba(143,130,255,0.15)',
    'display:flex',
    'align-items:center',
    'gap:12px',
    'flex-shrink:0',
  ].join(';');

  const titleEl = document.createElement('div');
  titleEl.style.cssText = 'font-size:15px;font-weight:700;color:#e0e0e0;';
  titleEl.textContent = t('feature.textureSwapper.title');

  const descEl = document.createElement('div');
  descEl.style.cssText = 'font-size:11px;color:rgba(224,224,224,0.4);';
  descEl.textContent = t('feature.textureSwapper.description');

  const titleGroup = document.createElement('div');
  titleGroup.style.cssText = 'display:flex;flex-direction:column;gap:3px;flex:1;min-width:0;';
  titleGroup.append(titleEl, descEl);

  const debugToggle = document.createElement('label');
  debugToggle.style.cssText = [
    'display:flex',
    'align-items:center',
    'gap:6px',
    'cursor:pointer',
    'padding:4px 8px',
    'border:1px solid rgba(143,130,255,0.25)',
    'border-radius:6px',
    'background:rgba(143,130,255,0.08)',
    'flex-shrink:0',
    'user-select:none',
  ].join(';');
  const debugCheckbox = document.createElement('input');
  debugCheckbox.type = 'checkbox';
  debugCheckbox.checked = isTextureSwapperDebugEnabled();
  debugCheckbox.style.cssText = 'accent-color:#8f82ff;cursor:pointer;width:14px;height:14px;';
  debugCheckboxEl = debugCheckbox;
  const debugLabel = document.createElement('span');
  debugLabel.style.cssText = 'font-size:11px;color:rgba(224,224,224,0.78);';
  debugLabel.textContent = t('feature.textureSwapper.debugLogs');
  debugCheckbox.addEventListener('change', () => {
    setTextureSwapperDebugEnabled(debugCheckbox.checked);
  });
  debugToggle.append(debugCheckbox, debugLabel);

  header.append(titleGroup, debugToggle);
  root.appendChild(header);

  // Main body: two columns
  const body = document.createElement('div');
  body.style.cssText = [
    'display:flex',
    'flex:1',
    'min-height:0',
    'overflow:hidden',
    'gap:0',
  ].join(';');
  root.appendChild(body);

  // Left panel — editor
  const leftPanel = document.createElement('div');
  leftPanel.style.cssText = [
    'width:400px',
    'flex-shrink:0',
    'border-right:1px solid rgba(143,130,255,0.12)',
    'display:flex',
    'flex-direction:column',
    'overflow-y:auto',
    'padding:14px',
    'gap:14px',
  ].join(';');
  body.appendChild(leftPanel);

  // Right panel — active rules list
  const rightPanel = document.createElement('div');
  rightPanel.style.cssText = [
    'flex:1',
    'min-width:0',
    'display:flex',
    'flex-direction:column',
    'overflow:hidden',
  ].join(';');
  body.appendChild(rightPanel);

  // Right panel header
  const rightHeader = document.createElement('div');
  rightHeader.style.cssText = [
    'padding:10px 14px',
    'border-bottom:1px solid rgba(143,130,255,0.1)',
    'flex-shrink:0',
    'display:flex',
    'align-items:center',
    'justify-content:space-between',
  ].join(';');
  const rightTitle = document.createElement('div');
  rightTitle.style.cssText = 'font-size:12px;font-weight:600;color:rgba(224,224,224,0.7);text-transform:uppercase;letter-spacing:0.5px;';
  rightTitle.textContent = t('feature.textureSwapper.activeRules');
  const addBtn = buildAccentButton(t('feature.textureSwapper.addRule'), () => {
    openEditor(leftPanel, state, null, cleanups, () => renderRulesList(rulesListContainer, state, cleanups));
  });
  rightHeader.append(rightTitle, addBtn);
  rightPanel.appendChild(rightHeader);

  const rulesListContainer = document.createElement('div');
  rulesListContainer.style.cssText = 'flex:1;overflow-y:auto;padding:10px 14px;display:flex;flex-direction:column;gap:8px;';
  rightPanel.appendChild(rulesListContainer);

  renderRulesList(rulesListContainer, state, cleanups);

  // Left panel initial state: hint text
  buildEditorPlaceholder(leftPanel);
}

// ---------------------------------------------------------------------------
// Editor placeholder
// ---------------------------------------------------------------------------

function buildEditorPlaceholder(container: HTMLElement): void {
  container.innerHTML = '';
  const hint = document.createElement('div');
  hint.style.cssText = [
    'display:flex',
    'flex-direction:column',
    'align-items:center',
    'justify-content:center',
    'gap:10px',
    'height:100%',
    'color:rgba(224,224,224,0.3)',
    'text-align:center',
    'padding:20px',
  ].join(';');
  const icon = document.createElement('div');
  icon.style.cssText = 'font-size:32px;';
  icon.textContent = 'Tx';
  const text = document.createElement('div');
  text.style.cssText = 'font-size:13px;';
  text.textContent = t('feature.textureSwapper.addRuleHint');
  hint.append(icon, text);
  container.appendChild(hint);
}

// ---------------------------------------------------------------------------
// Rule editor panel
// ---------------------------------------------------------------------------

function openEditor(
  container: HTMLElement,
  state: WindowState,
  editRuleId: string | null,
  cleanups: Array<() => void>,
  onSaved: () => void,
): void {
  container.innerHTML = '';

  const swapState = getTextureSwapperState();
  const existingRule = editRuleId ? swapState.rules.find(r => r.id === editRuleId) : null;

  // Initialise editor fields from existing rule or defaults
  if (existingRule) {
    state.targetSpriteKey = existingRule.targetSpriteKey;
    state.selectedCategory = existingRule.targetCategory;
    const src = existingRule.source;
    if (src.type === 'library' && src.librarySpriteKey) {
      state.sourceMode = 'library';
      state.librarySpriteKey = src.librarySpriteKey;
      const parsed = parseAtlasKey(src.librarySpriteKey);
      state.libraryCategory = parsed.category;
    } else if (src.type === 'upload') {
      state.sourceMode = 'upload';
      state.uploadAssetId = src.uploadAssetId ?? '';
    } else {
      state.sourceMode = 'tint-only';
    }
    state.tintColor = existingRule.params.tintColor ?? '#ff8800';
    state.tintAlpha = existingRule.params.tintAlpha ?? 0.5;
    state.tintBlend = existingRule.params.tintBlend ?? 'multiply';
    state.scaleX = existingRule.params.scaleX ?? 1;
    state.scaleY = existingRule.params.scaleY ?? 1;
    state.alpha = existingRule.params.alpha ?? 1;
    state.mutationBehavior = existingRule.mutationBehavior ?? 'preserve';
  }

  const svc = getSvc();

  // Section heading
  const heading = document.createElement('div');
  heading.style.cssText = 'font-size:13px;font-weight:700;color:#c8c0ff;';
  heading.textContent = editRuleId ? t('feature.textureSwapper.editRule') : t('feature.textureSwapper.createRule');
  container.appendChild(heading);

  // --- Target picker ---
  container.appendChild(buildSectionLabel(t('feature.textureSwapper.targetSprite')));

  const targetSection = document.createElement('div');
  targetSection.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
  container.appendChild(targetSection);

  const catTabs = buildCategoryTabs(state.selectedCategory, (cat) => {
    state.selectedCategory = cat;
    rebuildTargetList();
  });
  targetSection.appendChild(catTabs);

  const filterInput = buildSearchInput(t('feature.textureSwapper.filterSprites'), state.targetSpriteFilter, (v) => {
    state.targetSpriteFilter = v;
    rebuildTargetList();
  });
  targetSection.appendChild(filterInput);

  const targetListEl = document.createElement('div');
  targetListEl.style.cssText = 'max-height:140px;overflow-y:auto;border:1px solid rgba(143,130,255,0.15);border-radius:6px;background:rgba(0,0,0,0.2);';
  targetSection.appendChild(targetListEl);

  const selectedTargetEl = buildSelectedLabel(t('feature.textureSwapper.targetLabel'), state.targetSpriteKey);
  targetSection.appendChild(selectedTargetEl);

  function rebuildTargetList(): void {
    targetListEl.innerHTML = '';
    if (!svc) {
      const msg = document.createElement('div');
      msg.style.cssText = 'padding:10px;font-size:11px;color:rgba(224,224,224,0.3);';
      msg.textContent = t('feature.textureSwapper.spriteNotReady');
      targetListEl.appendChild(msg);
      return;
    }
    const items = svc.list(state.selectedCategory);
    const filter = state.targetSpriteFilter.toLowerCase();
    const filtered = filter ? items.filter(it => it.key.toLowerCase().includes(filter)) : items;

    if (!filtered.length) {
      const msg = document.createElement('div');
      msg.style.cssText = 'padding:8px 10px;font-size:11px;color:rgba(224,224,224,0.3);';
      msg.textContent = t('feature.textureSwapper.noSpritesFound');
      targetListEl.appendChild(msg);
      return;
    }

    for (const item of filtered.slice(0, 200)) {
      const { id } = parseAtlasKey(item.key);
      const row = buildSpriteRow(item.key, id, item.key === state.targetSpriteKey, () => {
        state.targetSpriteKey = item.key;
        selectedTargetEl.textContent = `${t('feature.textureSwapper.targetLabel')} ${id}`;
        selectedTargetEl.title = item.key;
        // Mark active
        for (const r of targetListEl.querySelectorAll('.qpm-sprite-row')) {
          (r as HTMLElement).style.background = (r as HTMLElement).dataset.key === item.key
            ? 'rgba(143,130,255,0.18)' : '';
        }
        refreshPreview();
      });
      row.dataset.key = item.key;
      row.classList.add('qpm-sprite-row');
      targetListEl.appendChild(row);
    }
  }

  rebuildTargetList();

  // --- Source picker ---
  container.appendChild(buildSectionLabel(t('feature.textureSwapper.source')));

  const sourceModeRow = document.createElement('div');
  sourceModeRow.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;';
  container.appendChild(sourceModeRow);

  const sourceModes: Array<{ key: WindowState['sourceMode']; label: string }> = [
    { key: 'tint-only', label: t('feature.textureSwapper.tintOnly') },
    { key: 'library', label: t('feature.textureSwapper.gameAsset') },
    ...(UPLOADS_ENABLED ? [{ key: 'upload' as const, label: t('feature.textureSwapper.upload') }] : []),
  ];

  const sourcePanelContainer = document.createElement('div');
  sourcePanelContainer.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
  container.appendChild(sourcePanelContainer);

  function updateSourceMode(mode: WindowState['sourceMode']): void {
    state.sourceMode = mode;
    for (const btn of sourceModeRow.querySelectorAll('button')) {
      const isActive = (btn as HTMLElement).dataset.mode === mode;
      btn.style.background = isActive ? 'rgba(143,130,255,0.25)' : 'rgba(143,130,255,0.08)';
      btn.style.borderColor = isActive ? 'rgba(143,130,255,0.6)' : 'rgba(143,130,255,0.2)';
      btn.style.color = isActive ? '#c8c0ff' : 'rgba(224,224,224,0.5)';
    }
    buildSourcePanel();
    refreshPreview();
  }

  for (const sm of sourceModes) {
    const btn = buildModeButton(sm.label, sm.key === state.sourceMode, () => updateSourceMode(sm.key));
    btn.dataset.mode = sm.key;
    sourceModeRow.appendChild(btn);
  }

  function buildSourcePanel(): void {
    sourcePanelContainer.innerHTML = '';
    if (state.sourceMode === 'library') {
      const libCatTabs = buildCategoryTabs(state.libraryCategory, (cat) => {
        state.libraryCategory = cat;
        rebuildLibraryList();
      });
      sourcePanelContainer.appendChild(libCatTabs);

      const libFilterInput = buildSearchInput(t('feature.textureSwapper.filterLibrary'), state.librarySpriteFilter, (v) => {
        state.librarySpriteFilter = v;
        rebuildLibraryList();
      });
      sourcePanelContainer.appendChild(libFilterInput);

      const libListEl = document.createElement('div');
      libListEl.style.cssText = 'max-height:120px;overflow-y:auto;border:1px solid rgba(143,130,255,0.15);border-radius:6px;background:rgba(0,0,0,0.2);';
      sourcePanelContainer.appendChild(libListEl);

      const selectedLibEl = buildSelectedLabel(t('feature.textureSwapper.sourceLabel'), state.librarySpriteKey);
      sourcePanelContainer.appendChild(selectedLibEl);

      function rebuildLibraryList(): void {
        libListEl.innerHTML = '';
        if (!svc) return;
        const items = svc.list(state.libraryCategory);
        const filter = state.librarySpriteFilter.toLowerCase();
        const filtered = filter ? items.filter(it => it.key.toLowerCase().includes(filter)) : items;
        for (const item of filtered.slice(0, 200)) {
          const { id } = parseAtlasKey(item.key);
          const row = buildSpriteRow(item.key, id, item.key === state.librarySpriteKey, () => {
            state.librarySpriteKey = item.key;
            selectedLibEl.textContent = `${t('feature.textureSwapper.sourceLabel')} ${id}`;
            selectedLibEl.title = item.key;
            for (const r of libListEl.querySelectorAll('.qpm-lib-row')) {
              (r as HTMLElement).style.background = (r as HTMLElement).dataset.key === item.key
                ? 'rgba(143,130,255,0.18)' : '';
            }
            refreshPreview();
          });
          row.dataset.key = item.key;
          row.classList.add('qpm-lib-row');
          libListEl.appendChild(row);
        }
      }
      rebuildLibraryList();

    } else if (state.sourceMode === 'upload') {
      if (!UPLOADS_ENABLED) {
        const msg = document.createElement('div');
        msg.style.cssText = 'font-size:11px;color:rgba(224,224,224,0.3);padding:8px 0;';
        msg.textContent = t('feature.textureSwapper.uploadsDisabled');
        sourcePanelContainer.appendChild(msg);
        return;
      }
      buildUploadPanel(sourcePanelContainer, state, () => refreshPreview());
    } else {
      // Tint-only — no source panel, tint params are enough
      const note = document.createElement('div');
      note.style.cssText = 'font-size:11px;color:rgba(224,224,224,0.4);padding:4px 0;';
      note.textContent = t('feature.textureSwapper.tintOnlyNote');
      sourcePanelContainer.appendChild(note);
    }
  }

  buildSourcePanel();

  // --- Params ---
  container.appendChild(buildSectionLabel(t('feature.textureSwapper.tint')));
  const paramsContainer = document.createElement('div');
  paramsContainer.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
  container.appendChild(paramsContainer);
  buildTintParams(paramsContainer, state, () => refreshPreview());

  container.appendChild(buildSectionLabel(t('feature.textureSwapper.layerB')));
  const layerBContainer = document.createElement('div');
  layerBContainer.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
  container.appendChild(layerBContainer);
  buildLayerBParams(layerBContainer, state);

  container.appendChild(buildSectionLabel(t('feature.textureSwapper.mutationHandling')));
  const mutationContainer = document.createElement('div');
  mutationContainer.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
  container.appendChild(mutationContainer);
  buildMutationBehaviorParams(mutationContainer, state);

  // --- Preview ---
  container.appendChild(buildSectionLabel(t('feature.textureSwapper.preview')));
  const previewContainer = document.createElement('div');
  previewContainer.style.cssText = 'display:flex;gap:12px;align-items:flex-start;';
  container.appendChild(previewContainer);
  buildPreviewSection(previewContainer, state);

  let previewRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  function refreshPreview(): void {
    if (previewRefreshTimer !== null) clearTimeout(previewRefreshTimer);
    previewRefreshTimer = setTimeout(() => {
      buildPreviewSection(previewContainer, state);
    }, 200);
  }

  // --- Save / Cancel ---
  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:8px;padding-top:4px;flex-shrink:0;';

  const saveBtn = buildAccentButton(editRuleId ? t('feature.textureSwapper.updateRule') : t('feature.textureSwapper.saveRule'), async () => {
    if (!state.targetSpriteKey) {
      notify({ feature: 'textureSwapper', level: 'warn', message: t('feature.textureSwapper.selectTargetFirst') });
      return;
    }
    const { category: targetCat, id: targetId } = parseAtlasKey(state.targetSpriteKey);

    const source: TextureOverrideRule['source'] = state.sourceMode === 'library'
      ? { type: 'library', ...(state.librarySpriteKey ? { librarySpriteKey: state.librarySpriteKey } : {}) }
      : state.sourceMode === 'upload'
        ? { type: 'upload', ...(state.uploadAssetId ? { uploadAssetId: state.uploadAssetId } : {}) }
        : { type: 'library' }; // tint-only uses library type with no source key

    const params: TextureOverrideRule['params'] = {};
    if (state.tintColor) {
      params.tintColor = state.tintColor;
      params.tintAlpha = state.tintAlpha;
      params.tintBlend = state.tintBlend;
    }
    if (state.scaleX !== 1 || state.scaleY !== 1) {
      params.scaleX = state.scaleX;
      params.scaleY = state.scaleY;
    }
    if (state.alpha !== 1) params.alpha = state.alpha;

    const ruleData: Omit<TextureOverrideRule, 'id'> = {
      enabled: true,
      targetSpriteKey: state.targetSpriteKey,
      targetCategory: targetCat,
      displayLabel: targetId,
      mutationBehavior: state.mutationBehavior,
      source,
      params,
    };

    if (editRuleId) {
      updateRule({ ...ruleData, id: editRuleId });
    } else {
      addRule(ruleData);
    }

    onSaved();
    buildEditorPlaceholder(container);
    invalidateWindow(WINDOW_ID);
  });

  const cancelBtn = buildGhostButton(t('feature.textureSwapper.cancel'), () => buildEditorPlaceholder(container));
  btnRow.append(saveBtn, cancelBtn);
  container.appendChild(btnRow);
}

// ---------------------------------------------------------------------------
// Upload panel
// ---------------------------------------------------------------------------

function buildUploadPanel(
  container: HTMLElement,
  state: WindowState,
  onPreviewChange: () => void,
): void {
  const swapState = getTextureSwapperState();
  const uploadedAssets = Object.entries(swapState.uploadedAssets);

  if (uploadedAssets.length > 0) {
    const label = document.createElement('div');
    label.style.cssText = 'font-size:11px;color:rgba(224,224,224,0.5);margin-bottom:4px;';
    label.textContent = t('feature.textureSwapper.savedUploads');
    container.appendChild(label);

    const listEl = document.createElement('div');
    listEl.style.cssText = 'max-height:80px;overflow-y:auto;border:1px solid rgba(143,130,255,0.15);border-radius:6px;background:rgba(0,0,0,0.2);';
    for (const [id, dataUrl] of uploadedAssets) {
      const row = document.createElement('div');
      row.style.cssText = [
        'display:flex',
        'align-items:center',
        'gap:8px',
        'padding:5px 8px',
        'cursor:pointer',
        id === state.uploadAssetId ? 'background:rgba(143,130,255,0.18)' : '',
      ].join(';');
      const img = document.createElement('img');
      img.src = dataUrl;
      img.style.cssText = 'width:24px;height:24px;object-fit:contain;image-rendering:pixelated;';
      const nameEl = document.createElement('span');
      nameEl.style.cssText = 'font-size:11px;color:rgba(224,224,224,0.7);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      nameEl.textContent = id;
      row.append(img, nameEl);
      row.addEventListener('click', () => {
        state.uploadAssetId = id;
        for (const r of listEl.querySelectorAll('div')) {
          r.style.background = r === row ? 'rgba(143,130,255,0.18)' : '';
        }
        onPreviewChange();
      });
      listEl.appendChild(row);
    }
    container.appendChild(listEl);
  }

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.style.display = 'none';
  container.appendChild(fileInput);

  const uploadBtn = buildGhostButton(t('feature.textureSwapper.uploadImage'), () => fileInput.click());
  container.appendChild(uploadBtn);

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    uploadBtn.textContent = t('feature.textureSwapper.uploading');
    uploadBtn.setAttribute('disabled', 'true');
    const assetId = await addUploadedAsset(file);
    uploadBtn.textContent = t('feature.textureSwapper.uploadImage');
    uploadBtn.removeAttribute('disabled');
    if (assetId) {
      state.uploadAssetId = assetId;
      // Rebuild upload panel
      container.innerHTML = '';
      buildUploadPanel(container, state, onPreviewChange);
      onPreviewChange();
    }
  });
}

// ---------------------------------------------------------------------------
// Tint params
// ---------------------------------------------------------------------------

function buildTintParams(container: HTMLElement, state: WindowState, onChanged: () => void): void {
  // Tint color
  const colorRow = buildParamRow(t('feature.textureSwapper.color'), () => {
    const input = document.createElement('input');
    input.type = 'color';
    input.value = state.tintColor;
    input.style.cssText = 'width:48px;height:28px;border:none;background:none;cursor:pointer;padding:0;';
    input.addEventListener('input', () => { state.tintColor = input.value; onChanged(); });
    return input;
  });
  container.appendChild(colorRow);

  // Alpha
  container.appendChild(buildRangeRow(t('feature.textureSwapper.alpha'), 0, 1, 0.01, state.tintAlpha, (v) => {
    state.tintAlpha = v;
    onChanged();
  }));

  // Blend mode
  const blendRow = buildParamRow(t('feature.textureSwapper.blend'), () => {
    const sel = document.createElement('select');
    sel.style.cssText = 'background:rgba(0,0,0,0.3);border:1px solid rgba(143,130,255,0.2);color:#e0e0e0;border-radius:4px;padding:2px 6px;font-size:11px;';
    for (const blend of TINT_BLENDS) {
      const opt = document.createElement('option');
      opt.value = blend;
      opt.textContent = blend;
      if (blend === state.tintBlend) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', () => { state.tintBlend = sel.value; onChanged(); });
    return sel;
  });
  container.appendChild(blendRow);
}

// ---------------------------------------------------------------------------
// Layer B params
// ---------------------------------------------------------------------------

function buildLayerBParams(container: HTMLElement, state: WindowState): void {
  const note = document.createElement('div');
  note.style.cssText = 'font-size:10px;color:rgba(224,224,224,0.35);margin-bottom:4px;';
  note.textContent = t('feature.textureSwapper.layerBNote');
  container.appendChild(note);

  container.appendChild(buildRangeRow(t('feature.textureSwapper.scaleX'), 0.1, 3, 0.05, state.scaleX, (v) => { state.scaleX = v; }));
  container.appendChild(buildRangeRow(t('feature.textureSwapper.scaleY'), 0.1, 3, 0.05, state.scaleY, (v) => { state.scaleY = v; }));
  container.appendChild(buildRangeRow(t('feature.textureSwapper.alpha'), 0, 1, 0.05, state.alpha, (v) => { state.alpha = v; }));
}

function buildMutationBehaviorParams(container: HTMLElement, state: WindowState): void {
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;';
  container.appendChild(row);

  const options: Array<{ key: WindowState['mutationBehavior']; label: string }> = [
    { key: 'preserve', label: t('feature.textureSwapper.keepMutations') },
    { key: 'replace', label: t('feature.textureSwapper.replaceTexture') },
  ];

  const renderButtons = (): void => {
    row.innerHTML = '';
    for (const option of options) {
      const btn = buildModeButton(option.label, state.mutationBehavior === option.key, () => {
        state.mutationBehavior = option.key;
        renderButtons();
      });
      row.appendChild(btn);
    }
  };
  renderButtons();

  const note = document.createElement('div');
  note.style.cssText = 'font-size:10px;color:rgba(224,224,224,0.35);';
  note.textContent = t('feature.textureSwapper.mutationNote');
  container.appendChild(note);
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

function buildPreviewSection(container: HTMLElement, state: WindowState): void {
  container.innerHTML = '';

  if (!state.targetSpriteKey) {
    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:11px;color:rgba(224,224,224,0.3);';
    hint.textContent = t('feature.textureSwapper.selectToPreview');
    container.appendChild(hint);
    return;
  }

  const buildCanvasBox = (label: string, canvas: HTMLCanvasElement | null): HTMLElement => {
    const box = document.createElement('div');
    box.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:4px;';
    const labelEl = document.createElement('div');
    labelEl.style.cssText = 'font-size:10px;color:rgba(224,224,224,0.4);text-transform:uppercase;letter-spacing:0.3px;';
    labelEl.textContent = label;
    const frame = document.createElement('div');
    frame.style.cssText = [
      'width:80px;height:80px',
      'border:1px solid rgba(143,130,255,0.2)',
      'border-radius:6px',
      'background:rgba(0,0,0,0.3)',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'overflow:hidden',
    ].join(';');
    if (canvas) {
      canvas.style.cssText = 'max-width:76px;max-height:76px;image-rendering:pixelated;object-fit:contain;';
      frame.appendChild(canvas);
    } else {
      const empty = document.createElement('div');
      empty.style.cssText = 'font-size:10px;color:rgba(224,224,224,0.2);';
      empty.textContent = 'N/A';
      frame.appendChild(empty);
    }
    box.append(labelEl, frame);
    return box;
  };

  // Build async: original + custom
  void (async () => {
    const [origCanvas, customCanvas] = await Promise.all([
      getOriginalSpriteCanvas(state.targetSpriteKey),
      buildPreviewCanvas({
        targetSpriteKey: state.targetSpriteKey,
        targetCategory: (() => { const { category } = parseAtlasKey(state.targetSpriteKey); return category; })(),
        source: state.sourceMode === 'library'
          ? { type: 'library' as const, ...(state.librarySpriteKey ? { librarySpriteKey: state.librarySpriteKey } : {}) }
          : state.sourceMode === 'upload'
            ? { type: 'upload' as const, ...(state.uploadAssetId ? { uploadAssetId: state.uploadAssetId } : {}) }
            : { type: 'library' as const },
        params: {
          ...(state.tintColor ? { tintColor: state.tintColor } : {}),
          tintAlpha: state.tintAlpha,
          tintBlend: state.tintBlend,
        },
      }),
    ]);

    // Clear and re-fill container (async update)
    if (!container.isConnected) return;
    container.innerHTML = '';
    container.append(
      buildCanvasBox(t('feature.textureSwapper.original'), origCanvas),
      buildArrow(),
      buildCanvasBox(t('feature.textureSwapper.custom'), customCanvas),
    );
  })();

  // Show loading state while async resolves
  const loading = document.createElement('div');
  loading.style.cssText = 'font-size:11px;color:rgba(224,224,224,0.3);';
  loading.textContent = t('feature.textureSwapper.rendering');
  container.appendChild(loading);
}

function buildArrow(): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText = 'font-size:18px;color:rgba(224,224,224,0.4);align-self:center;margin-top:16px;';
  el.textContent = '\u2192';
  return el;
}

// ---------------------------------------------------------------------------
// Rules list
// ---------------------------------------------------------------------------

function renderRulesList(container: HTMLElement, state: WindowState, cleanups: Array<() => void>): void {
  container.innerHTML = '';

  const swapState = getTextureSwapperState();
  const rules = swapState.rules;

  if (!rules.length) {
    const hint = document.createElement('div');
    hint.style.cssText = [
      'display:flex',
      'flex-direction:column',
      'align-items:center',
      'justify-content:center',
      'height:100%',
      'color:rgba(224,224,224,0.3)',
      'text-align:center',
      'gap:8px',
    ].join(';');
    const icon = document.createElement('div');
    icon.style.cssText = 'font-size:28px;';
    icon.textContent = '\u{1F3A8}';
    const text = document.createElement('div');
    text.style.cssText = 'font-size:12px;';
    text.textContent = t('feature.textureSwapper.noRulesYet');
    hint.append(icon, text);
    container.appendChild(hint);
    return;
  }

  for (const rule of rules) {
    container.appendChild(buildRuleCard(rule, state, cleanups, () => renderRulesList(container, state, cleanups)));
  }
}

function buildRuleCard(
  rule: TextureOverrideRule,
  state: WindowState,
  cleanups: Array<() => void>,
  onChanged: () => void,
): HTMLElement {
  const card = document.createElement('div');
  card.style.cssText = [
    'border:1px solid rgba(143,130,255,0.15)',
    'background:rgba(255,255,255,0.03)',
    'border-radius:8px',
    'padding:10px 12px',
    'display:flex',
    'align-items:center',
    'gap:10px',
    'flex-shrink:0',
  ].join(';');

  // Enabled toggle
  const toggleEl = document.createElement('label');
  toggleEl.style.cssText = 'display:flex;align-items:center;gap:4px;cursor:pointer;flex-shrink:0;';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = rule.enabled;
  checkbox.style.cssText = 'accent-color:#8f82ff;cursor:pointer;width:14px;height:14px;';
  checkbox.addEventListener('change', () => {
    updateRule({ ...rule, enabled: checkbox.checked });
    onChanged();
  });
  toggleEl.appendChild(checkbox);
  card.appendChild(toggleEl);

  // Small sprite preview canvas (async)
  const previewFrame = document.createElement('div');
  previewFrame.style.cssText = 'width:32px;height:32px;border:1px solid rgba(143,130,255,0.15);border-radius:4px;background:rgba(0,0,0,0.3);flex-shrink:0;overflow:hidden;display:flex;align-items:center;justify-content:center;';
  void buildPreviewCanvas(rule).then(canvas => {
    if (!canvas || !card.isConnected) return;
    canvas.style.cssText = 'max-width:30px;max-height:30px;image-rendering:pixelated;';
    previewFrame.innerHTML = '';
    previewFrame.appendChild(canvas);
  });
  card.appendChild(previewFrame);

  // Info
  const info = document.createElement('div');
  info.style.cssText = 'flex:1;min-width:0;';
  const labelEl = document.createElement('div');
  labelEl.style.cssText = 'font-size:12px;font-weight:600;color:#e0e0e0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  labelEl.textContent = rule.displayLabel || rule.targetSpriteKey;
  labelEl.title = rule.targetSpriteKey;
  const detailEl = document.createElement('div');
  detailEl.style.cssText = 'font-size:10px;color:rgba(224,224,224,0.4);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  const parts: string[] = [`${rule.targetCategory}`];
  parts.push((rule.mutationBehavior ?? 'preserve') === 'preserve' ? t('feature.textureSwapper.keepMutsBadge') : t('feature.textureSwapper.replaceMutsBadge'));
  if (rule.params.tintColor) parts.push(`tint ${rule.params.tintColor}`);
  if (rule.source.librarySpriteKey) {
    const { id } = parseAtlasKey(rule.source.librarySpriteKey);
    parts.push(`→ ${id}`);
  } else if (rule.source.uploadAssetId) {
    parts.push(t('feature.textureSwapper.upload').toLowerCase());
  }
  detailEl.textContent = parts.join(' · ');
  info.append(labelEl, detailEl);
  card.appendChild(info);

  // Edit button
  const editBtn = buildIconButton('\u270F', t('feature.textureSwapper.editRuleTooltip'), () => {
    // Open editor in the left panel — find it via DOM traversal
    const leftPanel = card.closest('[style*="width:400px"]') as HTMLElement | null;
    if (!leftPanel) return;
    openEditor(leftPanel, state, rule.id, cleanups, onChanged);
  });
  card.appendChild(editBtn);

  // Delete button
  const deleteBtn = buildIconButton('\u{1F5D1}', t('feature.textureSwapper.deleteRuleTooltip'), () => {
    deleteRule(rule.id);
    onChanged();
  });
  deleteBtn.style.color = '#f87171';
  card.appendChild(deleteBtn);

  return card;
}

// ---------------------------------------------------------------------------
// Component helpers
// ---------------------------------------------------------------------------

function buildSectionLabel(text: string): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText = 'font-size:10px;font-weight:600;color:rgba(143,130,255,0.85);text-transform:uppercase;letter-spacing:0.5px;margin-top:2px;';
  el.textContent = text;
  return el;
}

function buildSelectedLabel(prefix: string, key: string): HTMLElement {
  const { id } = key ? parseAtlasKey(key) : { id: '' };
  const el = document.createElement('div');
  el.style.cssText = 'font-size:10px;color:rgba(224,224,224,0.45);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  el.textContent = key ? `${prefix} ${id}` : `${prefix} ${t('feature.textureSwapper.noneSelected')}`;
  el.title = key;
  return el;
}

function buildCategoryTabs(selected: SpriteCategory, onSelect: (cat: SpriteCategory) => void): HTMLElement {
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;';

  for (const cat of CATEGORIES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = CATEGORY_LABEL_KEYS[cat] ? t(CATEGORY_LABEL_KEYS[cat]) : cat;
    btn.style.cssText = [
      'padding:3px 8px',
      'font-size:10px',
      'border-radius:4px',
      'cursor:pointer',
      'border:1px solid',
      cat === selected
        ? 'background:rgba(143,130,255,0.25);border-color:rgba(143,130,255,0.55);color:#c8c0ff;'
        : 'background:rgba(143,130,255,0.06);border-color:rgba(143,130,255,0.18);color:rgba(224,224,224,0.5);',
    ].join(';');
    btn.addEventListener('click', () => {
      for (const b of row.querySelectorAll('button')) {
        b.style.background = 'rgba(143,130,255,0.06)';
        b.style.borderColor = 'rgba(143,130,255,0.18)';
        b.style.color = 'rgba(224,224,224,0.5)';
      }
      btn.style.background = 'rgba(143,130,255,0.25)';
      btn.style.borderColor = 'rgba(143,130,255,0.55)';
      btn.style.color = '#c8c0ff';
      onSelect(cat);
    });
    row.appendChild(btn);
  }
  return row;
}

function buildSearchInput(placeholder: string, initial: string, onChange: (v: string) => void): HTMLElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = placeholder;
  input.value = initial;
  input.style.cssText = [
    'width:100%',
    'box-sizing:border-box',
    'padding:5px 8px',
    'font-size:11px',
    'background:rgba(0,0,0,0.3)',
    'border:1px solid rgba(143,130,255,0.2)',
    'border-radius:5px',
    'color:#e0e0e0',
    'outline:none',
  ].join(';');
  input.addEventListener('input', () => onChange(input.value));
  return input;
}

function buildSpriteRow(key: string, displayId: string, selected: boolean, onClick: () => void): HTMLElement {
  const row = document.createElement('div');
  row.style.cssText = [
    'padding:5px 8px',
    'cursor:pointer',
    'font-size:11px',
    'color:rgba(224,224,224,0.75)',
    'white-space:nowrap',
    'overflow:hidden',
    'text-overflow:ellipsis',
    selected ? 'background:rgba(143,130,255,0.18);' : '',
  ].join(';');
  row.textContent = displayId;
  row.title = key;
  row.addEventListener('mouseenter', () => { if (!selected) row.style.background = 'rgba(143,130,255,0.08)'; });
  row.addEventListener('mouseleave', () => { if (!selected) row.style.background = ''; });
  row.addEventListener('click', onClick);
  return row;
}

function buildParamRow(label: string, buildControl: () => HTMLElement): HTMLElement {
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;align-items:center;gap:8px;';
  const labelEl = document.createElement('div');
  labelEl.style.cssText = 'font-size:11px;color:rgba(224,224,224,0.5);width:54px;flex-shrink:0;';
  labelEl.textContent = label;
  row.append(labelEl, buildControl());
  return row;
}

function buildRangeRow(
  label: string,
  min: number,
  max: number,
  step: number,
  initial: number,
  onChange: (v: number) => void,
): HTMLElement {
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;align-items:center;gap:8px;';

  const labelEl = document.createElement('div');
  labelEl.style.cssText = 'font-size:11px;color:rgba(224,224,224,0.5);width:54px;flex-shrink:0;';
  labelEl.textContent = label;

  const range = document.createElement('input');
  range.type = 'range';
  range.min = String(min);
  range.max = String(max);
  range.step = String(step);
  range.value = String(initial);
  range.style.cssText = 'flex:1;accent-color:#8f82ff;';

  const numEl = document.createElement('span');
  numEl.style.cssText = 'font-size:11px;color:#c8c0ff;width:36px;text-align:right;flex-shrink:0;';
  numEl.textContent = initial.toFixed(2);

  range.addEventListener('input', () => {
    const v = parseFloat(range.value);
    numEl.textContent = v.toFixed(2);
    onChange(v);
  });

  row.append(labelEl, range, numEl);
  return row;
}

function buildAccentButton(label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = label;
  btn.style.cssText = [
    'padding:6px 12px',
    'font-size:12px',
    'border:1px solid rgba(143,130,255,0.4)',
    'border-radius:6px',
    'background:rgba(143,130,255,0.18)',
    'color:#c8c0ff',
    'cursor:pointer',
    'flex-shrink:0',
  ].join(';');
  btn.addEventListener('click', onClick);
  return btn;
}

function buildGhostButton(label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = label;
  btn.style.cssText = [
    'padding:6px 12px',
    'font-size:12px',
    'border:1px solid rgba(255,255,255,0.1)',
    'border-radius:6px',
    'background:rgba(255,255,255,0.05)',
    'color:rgba(224,224,224,0.55)',
    'cursor:pointer',
    'flex:1',
  ].join(';');
  btn.addEventListener('click', onClick);
  return btn;
}

function buildModeButton(label: string, active: boolean, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = label;
  btn.style.cssText = [
    'padding:4px 10px',
    'font-size:11px',
    'border:1px solid',
    'border-radius:5px',
    'cursor:pointer',
    active
      ? 'background:rgba(143,130,255,0.25);border-color:rgba(143,130,255,0.6);color:#c8c0ff;'
      : 'background:rgba(143,130,255,0.08);border-color:rgba(143,130,255,0.2);color:rgba(224,224,224,0.5);',
  ].join(';');
  btn.addEventListener('click', onClick);
  return btn;
}

function buildIconButton(icon: string, title: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = icon;
  btn.title = title;
  btn.style.cssText = [
    'padding:3px 7px',
    'font-size:14px',
    'border:1px solid rgba(143,130,255,0.15)',
    'border-radius:5px',
    'background:rgba(143,130,255,0.06)',
    'color:rgba(224,224,224,0.6)',
    'cursor:pointer',
    'flex-shrink:0',
  ].join(';');
  btn.addEventListener('click', onClick);
  return btn;
}
