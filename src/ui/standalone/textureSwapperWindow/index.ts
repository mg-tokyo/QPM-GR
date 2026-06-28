import { toggleWindow } from '../../core/modalWindow';
import {
  TEXTURE_MANIPULATOR_ENABLED,
  getTextureSwapperState,
  addRule, updateRule, deleteRule, clearAllRules,
  parseAtlasKey,
  isTextureSwapperDebugEnabled, setTextureSwapperDebugEnabled,
} from '../../../features/standalone/textureSwapper';
import { notify } from '../../../core/notifications';
import { t } from '../../../i18n';
import { WINDOW_ID, defaultState } from './types';
import type { WindowState } from './types';
import { clearThumbnailCache } from './thumbnailCache';
import {
  buildSlideoutBrowser,
  buildSlideoutSwapPicker,
  buildMutationPickerOverlay,
} from './spriteGrid';
import { buildToolPanel, buildTileComponents } from './toolPanel';
import { createSlideoutPanel } from './slideoutPanel';
import { renderPickATilePanel } from './pickATilePanel';
import { createButton } from '../../components/button';
import { createToggle } from '../../components/toggle';
import { showConfirmDialog } from '../../components/confirmDialog';
import { renderGardenPainterPresetsBar } from './presetsBar';

const GRID_OPEN_STORAGE_KEY = 'qpm.gardenPainter.gridOpen.v1';

export function openTextureSwapperWindow(): void {
  if (!TEXTURE_MANIPULATOR_ENABLED) {
    notify({ feature: 'gardenPainter', level: 'warn', message: t('feature.gardenPainter.disabledNotice') });
    return;
  }
  toggleWindow(
    WINDOW_ID,
    t('feature.gardenPainter.title'),
    (root) => renderWindow(root),
    '560px',
    'min(820px, calc(100vh - 32px))',
  );
}

function renderWindow(root: HTMLElement): void {
  root.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:420px;overflow:hidden;position:relative;';

  const state: WindowState = defaultState();
  const cleanups: Array<() => void> = [];

  if (!document.getElementById('qpm-shimmer-style')) {
    const style = document.createElement('style');
    style.id = 'qpm-shimmer-style';
    style.textContent = '@keyframes qpm-shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}';
    document.head.appendChild(style);
    cleanups.push(() => style.remove());
  }

  // Build the editor (tool panel) directly inside the window.
  const tool = buildToolPanel(state, {
    onEnterSwapPick: (targetKey, editRuleId) => {
      state.pickerTargetKey = targetKey;
      state.editingRuleId = editRuleId;
      state.pickerSwapKey = '';
      state.gridMode = 'swap-pick';

      const pickerHandle = buildSlideoutSwapPicker(state, { onPicked: () => { /* state.pickerSwapKey already set */ } });
      slideout.setBanner(swapPickerBanner({
        targetKey,
        onConfirm: () => {
          const key = pickerHandle.getPickedKey();
          if (!key) return;
          if (key.startsWith('upload:')) handleSwapUploadConfirmed(key.slice(7));
          else handleSwapConfirmed(key);
        },
        onCancel: () => {
          state.gridMode = 'browse';
          state.editingRuleId = null;
          state.previewSwapKey = '';
          slideout.setBanner(null);
          slideout.setAssetBody(buildSlideoutBrowser(state, browserCallbacks));
          toolHandle.refresh();
        },
      }));
      slideout.setAssetBody(pickerHandle.element);
      slideout.open();
    },
    onEnterMutationPick: (targetKey, existingMutations, editRuleId) => {
      state.pickerTargetKey = targetKey;
      state.editingRuleId = editRuleId;
      state.pickerMutations = [...existingMutations];
      state.gridMode = 'mutation-pick';
      const overlay = buildMutationPickerOverlay(state, {
        onDone: (mutations) => {
          overlay.remove();
          handleMutationsDone(mutations);
        },
        onCancel: () => overlay.remove(),
      });
      root.appendChild(overlay);
    },
    onRulesChanged: () => {
      toolHandle.refresh();
      slideout.setAssetBody(buildSlideoutBrowser(state, browserCallbacks));
    },
    onCreateNewScope: () => {
      slideout.setActiveTab('pickATile');
      slideout.open();
    },
  });
  const toolHandle = tool;
  root.appendChild(tool.element);

  // Window footer with settings + reset all.
  const footerRow = document.createElement('div');
  footerRow.style.cssText = 'padding:6px 12px;border-top:1px solid var(--qpm-accent-tint);display:flex;align-items:center;gap:8px;flex-shrink:0;';

  // onClick is () => void — hoist a ref so the popover can use the button as its anchor.
  let settingsBtnRef!: HTMLButtonElement;
  const settingsBtn = createButton('⚙', { variant: 'ghost', size: 'sm', onClick: () => showSettingsPopover(settingsBtnRef) });
  settingsBtnRef = settingsBtn;
  settingsBtn.title = t('feature.gardenPainter.settings');

  const spacer = document.createElement('div');
  spacer.style.cssText = 'flex:1;';

  const resetAllBtn = createButton(t('feature.gardenPainter.resetAllLink'), {
    variant: 'ghost',
    size: 'sm',
    onClick: async () => {
      const count = getTextureSwapperState().rules.length;
      if (!count) return;
      const confirmed = await showConfirmDialog({
        title: t('feature.gardenPainter.resetAllRules'),
        message: t('feature.gardenPainter.resetAllConfirm', { count: String(count) }),
        confirmLabel: t('feature.gardenPainter.resetAllRules'),
        cancelLabel: t('feature.gardenPainter.cancel'),
        variant: 'danger',
      });
      if (!confirmed) return;
      clearAllRules();
      toolHandle.refresh();
    },
  });
  resetAllBtn.title = t('feature.gardenPainter.resetAllRules');
  footerRow.append(settingsBtn, spacer, resetAllBtn);
  root.appendChild(footerRow);

  // Build slide-out asset grid.
  const browserCallbacks = {
    onSpriteSelected: (key: string): void => {
      state.selectedSpriteKey = key;
      state.advancedSlotIndex = null;
      state.editorScope = { kind: 'all' };
      state.tileComponents = null;
      state.tileObjectType = null;
      state.tileLiveSlotCount = null;
      toolHandle.refresh();
    },
  };

  const windowEl = root.parentElement!;
  const slideout = createSlideoutPanel({
    anchorWindowEl: windowEl,
    storageKey: GRID_OPEN_STORAGE_KEY,
  });
  slideout.setAssetBody(buildSlideoutBrowser(state, browserCallbacks));
  slideout.setPickATileBody(renderPickATilePanel({
    onPickTile: (tileKey, species, objectType, liveSlotCount) => {
      state.editorScope = { kind: 'tile', tileKey, species };
      state.tileObjectType = objectType;
      state.tileLiveSlotCount = liveSlotCount > 0 ? liveSlotCount : null;
      const comps = buildTileComponents({
        species,
        objectType,
        liveSlotCount: state.tileLiveSlotCount,
      });
      state.tileComponents = comps;
      if (comps.length > 0) {
        const first = comps[0]!;
        state.selectedSpriteKey = first.spriteKey;
        state.advancedSlotIndex = first.slotIndex;
      } else {
        state.selectedSpriteKey = '';
        state.advancedSlotIndex = null;
      }
      toolHandle.refresh();
    },
    onPickPetSlot: (slotIndex, species) => {
      state.selectedSpriteKey = `sprite/pet/${species}`;
      state.editorScope = { kind: 'petSlot', slotIndex, species };
      state.advancedSlotIndex = null;
      state.tileComponents = null;
      state.tileObjectType = null;
      state.tileLiveSlotCount = null;
      toolHandle.refresh();
    },
  }));
  cleanups.push(() => slideout.destroy());

  const presetsBar = renderGardenPainterPresetsBar(windowEl);
  cleanups.push(() => presetsBar.destroy());

  // ── Handlers ────────────────────────────────────────────────────────────

  function handleSwapConfirmed(replacementKey: string): void {
    const { category, id } = parseAtlasKey(state.pickerTargetKey);
    if (state.editingRuleId) {
      const existing = getTextureSwapperState().rules.find(r => r.id === state.editingRuleId);
      if (existing) updateRule({ ...existing, source: { type: 'library', librarySpriteKey: replacementKey } });
    } else {
      addRule({
        enabled: true,
        targetSpriteKey: state.pickerTargetKey,
        targetCategory: category,
        displayLabel: id,
        source: { type: 'library', librarySpriteKey: replacementKey },
        params: {},
        scope: state.editorScope,
      });
    }
    finishSwapPicker();
  }

  function handleSwapUploadConfirmed(assetId: string): void {
    const { category, id } = parseAtlasKey(state.pickerTargetKey);
    if (state.editingRuleId) {
      const existing = getTextureSwapperState().rules.find(r => r.id === state.editingRuleId);
      if (existing) updateRule({ ...existing, source: { type: 'upload', uploadAssetId: assetId } });
    } else {
      addRule({
        enabled: true,
        targetSpriteKey: state.pickerTargetKey,
        targetCategory: category,
        displayLabel: id,
        source: { type: 'upload', uploadAssetId: assetId },
        params: {},
        scope: state.editorScope,
      });
    }
    finishSwapPicker();
  }

  function handleMutationsDone(mutations: string[]): void {
    const { category, id } = parseAtlasKey(state.pickerTargetKey);
    const noneOnly = mutations.length === 1 && mutations[0] === 'None';
    const cosmeticMutations = noneOnly ? [] : mutations.filter(m => m !== 'None');
    const forceNoMutations = noneOnly;
    if (state.editingRuleId) {
      const existing = getTextureSwapperState().rules.find(r => r.id === state.editingRuleId);
      if (existing) {
        if (!noneOnly && cosmeticMutations.length === 0) {
          deleteRule(existing.id);
        } else {
          updateRule({ ...existing, cosmeticMutations, forceNoMutations });
        }
      }
    } else if (noneOnly || cosmeticMutations.length) {
      addRule({
        enabled: true,
        targetSpriteKey: state.pickerTargetKey,
        targetCategory: category,
        displayLabel: id,
        source: { type: 'library' },
        cosmeticMutations,
        forceNoMutations,
        params: {},
        scope: state.editorScope,
      });
    }
    state.gridMode = 'browse';
    state.editingRuleId = null;
    toolHandle.refresh();
  }

  function finishSwapPicker(): void {
    state.gridMode = 'browse';
    state.editingRuleId = null;
    state.previewSwapKey = '';
    slideout.setBanner(null);
    slideout.setAssetBody(buildSlideoutBrowser(state, browserCallbacks));
    toolHandle.refresh();
  }

  let settingsPopover: HTMLElement | null = null;
  let settingsDocClick: ((e: MouseEvent) => void) | null = null;

  function closeSettingsPopover(): void {
    if (settingsDocClick) {
      document.removeEventListener('click', settingsDocClick, true);
      settingsDocClick = null;
    }
    if (settingsPopover) {
      settingsPopover.remove();
      settingsPopover = null;
    }
  }

  function showSettingsPopover(anchor: HTMLElement): void {
    if (settingsPopover) { closeSettingsPopover(); return; }

    const pop = document.createElement('div');
    pop.style.cssText = [
      'position:fixed',
      'background:var(--qpm-surface-2)',
      'border:1px solid var(--qpm-accent-emphasis)',
      'border-radius:var(--qpm-radius-md)',
      'padding:var(--qpm-space-4) var(--qpm-space-5)',
      'min-width:220px',
      'font-family:var(--qpm-font)',
      'font-size:var(--qpm-font-body)',
      'color:var(--qpm-text)',
      'z-index:2147483647',
      'box-shadow:var(--qpm-shadow)',
      'display:flex',
      'flex-direction:column',
      'gap:var(--qpm-space-3)',
    ].join(';');

    const header = document.createElement('div');
    header.textContent = t('feature.gardenPainter.settings');
    header.style.cssText = 'font-size:var(--qpm-font-caption);font-weight:var(--qpm-weight-bold);color:var(--qpm-text-muted);text-transform:uppercase;letter-spacing:0.5px;';
    pop.appendChild(header);

    const dbg = createToggle({
      size: 'compact',
      checked: isTextureSwapperDebugEnabled(),
      onChange: (checked) => setTextureSwapperDebugEnabled(checked),
      label: t('feature.gardenPainter.debugLogs'),
    });
    pop.appendChild(dbg.root);

    document.body.appendChild(pop);
    settingsPopover = pop;

    // Position above the anchor (flip below if no headroom). Clamp to viewport.
    const margin = 8;
    const popRect = pop.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    let top = anchorRect.top - popRect.height - 6;
    if (top < margin) top = anchorRect.bottom + 6;
    let left = anchorRect.left;
    if (left + popRect.width > window.innerWidth - margin) left = window.innerWidth - popRect.width - margin;
    if (left < margin) left = margin;
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;

    settingsDocClick = (e: MouseEvent): void => {
      if (!pop.contains(e.target as Node) && !anchor.contains(e.target as Node)) {
        closeSettingsPopover();
      }
    };
    setTimeout(() => {
      if (settingsDocClick) document.addEventListener('click', settingsDocClick, true);
    }, 0);
  }

  cleanups.push(closeSettingsPopover);

  function swapPickerBanner(opts: { targetKey: string; onConfirm: () => void; onCancel: () => void }): HTMLElement {
    const banner = document.createElement('div');
    banner.style.cssText = 'padding:8px 12px;background:var(--qpm-accent-subtle);border-bottom:1px solid var(--qpm-accent-border);display:flex;align-items:center;gap:8px;flex-shrink:0;';
    const label = document.createElement('span');
    label.style.cssText = 'font-size:12px;color:var(--qpm-accent-hover);font-weight:600;flex:1;';
    const { id: targetName } = parseAtlasKey(opts.targetKey);
    label.textContent = `${t('feature.gardenPainter.pickReplacement')} ${targetName}`;
    banner.appendChild(label);
    banner.appendChild(createButton(t('feature.gardenPainter.confirm'), { variant: 'confirm', onClick: opts.onConfirm }));
    banner.appendChild(createButton(`× ${t('feature.gardenPainter.cancel')}`, { variant: 'ghost', size: 'sm', onClick: opts.onCancel }));
    return banner;
  }

  // External rule change listener.
  const onExternalUpdate = (): void => {
    toolHandle.refresh();
    slideout.setAssetBody(buildSlideoutBrowser(state, browserCallbacks));
  };
  window.addEventListener('qpm:texture-manipulator-updated', onExternalUpdate);
  cleanups.push(() => window.removeEventListener('qpm:texture-manipulator-updated', onExternalUpdate));

  // Cleanup ONLY when the window is genuinely torn down (e.g. page nav or
  // global re-render removes the root from the DOM). Closing the modal sets
  // `display:none` on the frame but does NOT destroy it — modalWindow caches
  // it (modalWindow.ts:692-697 toggleWindow returns early when the window is
  // already in its Map). Destroying the slide-out on close would leave the
  // window without a slide-out the next time the user reopens, because
  // renderWindow() only runs on the FIRST open. The slide-out's own
  // reposition() detects `display:none` on the modal and hides itself.
  const obs = new MutationObserver(() => {
    if (!root.isConnected) {
      obs.disconnect();
      clearThumbnailCache();
      for (const fn of cleanups) fn();
      cleanups.length = 0;
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });
}
