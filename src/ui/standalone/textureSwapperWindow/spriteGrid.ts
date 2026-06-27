import {
  getTextureSwapperState,
  getSvc,
  parseAtlasKey,
  UPLOADS_ENABLED,
  addUploadedAsset,
} from '../../../features/standalone/textureSwapper';
import type { TextureOverrideRule } from '../../../features/standalone/textureSwapper';
import { stripRenderState } from '../../../features/standalone/textureSwapper/matcher/state';
import type { SpriteService, SpriteCategory } from '../../../sprite-v2/types';
import { t } from '../../../i18n';
import {
  CATEGORY_TABS,
  MUTATION_GROUPS,
  MUTATION_COLORS,
  getRuleType,
} from './types';
import type { WindowState, RuleType } from './types';
import { getCachedThumbnail, getCachedThumbnailWithMutations, buildShimmerPlaceholder } from './thumbnailCache';
import { createPillTabs } from '../../components/pillTabs';
import { createTabBar, type TabDef } from '../../components/tabBar';
import { createSearchInput } from '../../components/searchInput';
import { createButton } from '../../components/button';
import { buildRuleBadge } from './ruleBadge';
import { buildMutationToggle } from './editor/mutationChip';
import { mountTileSwapButtons } from './editor/tileSwapButtons';
import { resolveEffectiveSprite } from './toolPanel';
import { displaySpriteName } from './displayName';
import { sortSpriteList, type SpriteListItem } from './sort';
import { isSpeciesUnlocked, isMutationUnlocked } from './gating';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GridCallbacks = {
  onSpriteSelected: (spriteKey: string) => void;
  onSwapConfirmed: (replacementKey: string) => void;
  onSwapUploadConfirmed: (uploadAssetId: string) => void;
  onSwapPreview: (replacementKey: string) => void;
  onMutationsDone: (mutations: string[]) => void;
  onPickerCancelled: () => void;
};

export type GridHandle = {
  element: HTMLElement;
  refresh: () => void;
};

const THUMB_SIZE = 64;

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

export function buildSpriteGrid(state: WindowState, callbacks: GridCallbacks): GridHandle {
  const container = document.createElement('div');
  container.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden;';

  function refresh(): void {
    container.innerHTML = '';

    const svc = getSvc();
    if (!svc) {
      const msg = document.createElement('div');
      msg.style.cssText = 'padding:20px;font-size:12px;color:var(--qpm-text-muted);text-align:center;';
      msg.textContent = t('feature.gardenPainter.spriteNotReady');
      container.appendChild(msg);
      return;
    }
    if (state.gridMode === 'swap-pick') {
      renderSwapPicker(container, state, callbacks, svc);
    } else if (state.gridMode === 'mutation-pick') {
      void renderMutationPicker(container, state, callbacks, svc);
    } else {
      renderBrowseGrid(container, state, callbacks, svc, refresh);
    }
  }

  refresh();
  return { element: container, refresh };
}

// ---------------------------------------------------------------------------
// Browse mode
// ---------------------------------------------------------------------------

function renderBrowseGrid(
  container: HTMLElement,
  state: WindowState,
  callbacks: GridCallbacks,
  svc: SpriteService,
  _fullRefresh: () => void,
): void {
  const browseTabDefs: TabDef[] = CATEGORY_TABS.map((tab, i) => ({
    id: String(i),
    label: t(tab.label),
  }));
  const browseBar = createTabBar(browseTabDefs, {
    defaultTab: String(state.activeTabIndex),
    onChange: (id) => {
      state.activeTabIndex = Number(id);
      state.searchFilter = '';
      void rebuildGrid();
    },
  });
  const browseTabsWrap = document.createElement('div');
  browseTabsWrap.style.cssText = 'padding:8px 12px 6px;flex-shrink:0;';
  browseTabsWrap.appendChild(browseBar.root);
  container.appendChild(browseTabsWrap);

  const { root: searchRoot } = createSearchInput({
    placeholder: t('feature.gardenPainter.filterSprites'),
    value: state.searchFilter,
    onInput: (v) => { state.searchFilter = v; void rebuildGrid(); },
    debounceMs: 0,
  });
  const searchWrap = document.createElement('div');
  searchWrap.style.cssText = 'padding:0 12px 8px;flex-shrink:0;';
  searchWrap.appendChild(searchRoot);
  container.appendChild(searchWrap);

  const grid = document.createElement('div');
  grid.style.cssText = 'flex:1;overflow-y:auto;padding:4px 12px 12px;';
  container.appendChild(grid);

  async function rebuildGrid(): Promise<void> {
    grid.innerHTML = '';
    const innerGrid = document.createElement('div');
    innerGrid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(86px,1fr));gap:8px;';

    const tab = CATEGORY_TABS[state.activeTabIndex];
    if (!tab) return;
    const tabKind: 'plants-merged' | 'pets' | 'seeds' | 'items' | 'decor' =
      state.activeTabIndex === 0 ? 'plants-merged'
        : state.activeTabIndex === 1 ? 'pets'
        : state.activeTabIndex === 2 ? 'seeds'
        : state.activeTabIndex === 3 ? 'items'
        : 'decor';
    const items = await collectItems(svc, tab.categories, state.searchFilter, tabKind);
    const rules = getTextureSwapperState().rules;

    for (const item of items) {
      const badges = getBadgesForSprite(item.key, rules);
      const cell = buildThumbnailCell(
        item.key,
        svc,
        item.key === state.selectedSpriteKey,
        badges,
        item.isLocked,
        () => {
          state.selectedSpriteKey = item.key;
          callbacks.onSpriteSelected(item.key);
          void rebuildGrid();
        },
      );
      innerGrid.appendChild(cell);
    }

    if (!items.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'grid-column:1/-1;padding:20px;text-align:center;font-size:12px;color:var(--qpm-text-muted);';
      empty.textContent = t('feature.gardenPainter.noSpritesFound');
      innerGrid.appendChild(empty);
    }

    grid.appendChild(innerGrid);
  }

  void rebuildGrid();
}

// ---------------------------------------------------------------------------
// Swap picker mode
// ---------------------------------------------------------------------------

function renderSwapPicker(
  container: HTMLElement,
  state: WindowState,
  callbacks: GridCallbacks,
  svc: SpriteService,
): void {
  const { id: targetName } = parseAtlasKey(state.pickerTargetKey);

  const banner = buildPickerBanner(
    `${t('feature.gardenPainter.pickReplacement')} ${targetName}`,
    state.pickerSwapKey
      ? () => {
        if (state.pickerSwapKey.startsWith('upload:')) {
          callbacks.onSwapUploadConfirmed(state.pickerSwapKey.slice(7));
        } else {
          callbacks.onSwapConfirmed(state.pickerSwapKey);
        }
      }
      : null,
    () => callbacks.onPickerCancelled(),
  );
  container.appendChild(banner);

  const subTabs = createPillTabs(
    [t('feature.gardenPainter.gameAsset'), t('feature.gardenPainter.upload')],
    state.pickerSwapTab === 'game' ? 0 : 1,
    (i) => {
      state.pickerSwapTab = i === 0 ? 'game' : 'upload';
      refresh();
    },
  );
  subTabs.style.cssText += ';padding:8px 12px 4px;flex-shrink:0;';
  container.appendChild(subTabs);

  const body = document.createElement('div');
  body.style.cssText = 'flex:1;overflow-y:auto;padding:4px 12px 12px;';
  container.appendChild(body);

  function refresh(): void {
    container.innerHTML = '';
    renderSwapPicker(container, state, callbacks, svc);
  }

  if (state.pickerSwapTab === 'game') {
    const pickerTabDefs: TabDef[] = CATEGORY_TABS.map((tab, i) => ({
      id: String(i),
      label: t(tab.label),
    }));
    const pickerBar = createTabBar(pickerTabDefs, {
      defaultTab: String(state.pickerSwapCategory),
      onChange: (id) => {
        state.pickerSwapCategory = Number(id);
        void rebuildPickerGrid();
      },
    });
    const pickerTabsWrap = document.createElement('div');
    pickerTabsWrap.style.cssText = 'padding:4px 0 8px;';
    pickerTabsWrap.appendChild(pickerBar.root);
    body.appendChild(pickerTabsWrap);

    const pickerGrid = document.createElement('div');
    body.appendChild(pickerGrid);

    async function rebuildPickerGrid(): Promise<void> {
      pickerGrid.innerHTML = '';
      const innerGrid = document.createElement('div');
      innerGrid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(86px,1fr));gap:8px;';

      const tab = CATEGORY_TABS[state.pickerSwapCategory];
      if (!tab) return;
      const tabKind: 'plants-merged' | 'pets' | 'seeds' | 'items' | 'decor' =
        state.pickerSwapCategory === 0 ? 'plants-merged'
          : state.pickerSwapCategory === 1 ? 'pets'
          : state.pickerSwapCategory === 2 ? 'seeds'
          : state.pickerSwapCategory === 3 ? 'items'
          : 'decor';
      const items = await collectItems(svc, tab.categories, '', tabKind);

      for (const item of items) {
        const isTarget = item.key === state.pickerTargetKey;
        const cell = buildThumbnailCell(
          item.key,
          svc,
          item.key === state.pickerSwapKey,
          [],
          item.isLocked,
          () => {
            if (isTarget) return;
            state.pickerSwapKey = item.key;
            callbacks.onSwapPreview(item.key);
            refresh();
          },
        );
        if (isTarget) cell.style.opacity = '0.3';
        innerGrid.appendChild(cell);
      }
      pickerGrid.appendChild(innerGrid);
    }

    void rebuildPickerGrid();
  } else {
    renderUploadPanel(body, state, callbacks);
  }
}

// ---------------------------------------------------------------------------
// Upload panel (inside swap picker)
// ---------------------------------------------------------------------------

function renderUploadPanel(
  container: HTMLElement,
  state: WindowState,
  callbacks: GridCallbacks,
): void {
  if (!UPLOADS_ENABLED) {
    const msg = document.createElement('div');
    msg.style.cssText = 'font-size:12px;color:var(--qpm-text-muted);padding:12px 0;';
    msg.textContent = t('feature.gardenPainter.uploadsDisabled');
    container.appendChild(msg);
    return;
  }

  const swapState = getTextureSwapperState();
  const uploads = Object.entries(swapState.uploadedAssets);

  if (uploads.length) {
    const listWrap = document.createElement('div');
    listWrap.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(68px,1fr));gap:6px;margin-bottom:12px;';

    for (const [assetId, dataUrl] of uploads) {
      const uploadKey = `upload:${assetId}`;
      const isSelected = state.pickerSwapKey === uploadKey;
      const cell = document.createElement('div');
      cell.style.cssText = [
        'display:flex;flex-direction:column;align-items:center;gap:4px',
        'padding:6px',
        'border-radius:8px',
        `border:${isSelected ? '2px' : '1px'} solid ${isSelected ? 'var(--qpm-accent-emphasis)' : 'var(--qpm-accent-subtle)'}`,
        'cursor:pointer',
        'transition:all 0.12s',
        `background:${isSelected ? 'var(--qpm-accent-subtle)' : 'rgba(0,0,0,0.2)'}`,
      ].join(';');

      const img = document.createElement('img');
      img.src = dataUrl;
      // 8px label below — micro-typography for thumbnail tile context, below
      // the documented type scale; no clean replacement available.
      img.style.cssText = `width:${THUMB_SIZE}px;height:${THUMB_SIZE}px;object-fit:contain;image-rendering:pixelated;border-radius:8px;`;
      const label = document.createElement('div');
      label.style.cssText = 'font-size:8px;color:var(--qpm-text-muted);max-width:60px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center;';
      label.textContent = assetId.slice(0, 12);
      cell.append(img, label);

      cell.addEventListener('click', () => {
        state.pickerSwapKey = uploadKey;
        callbacks.onSwapPreview(uploadKey);
        container.innerHTML = '';
        renderUploadPanel(container, state, callbacks);
      });
      listWrap.appendChild(cell);
    }
    container.appendChild(listWrap);
  }

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.style.display = 'none';
  container.appendChild(fileInput);

  const uploadBtn = createButton(t('feature.gardenPainter.uploadImage'), { variant: 'ghost', onClick: () => fileInput.click() });
  container.appendChild(uploadBtn);

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    uploadBtn.textContent = t('feature.gardenPainter.uploading');
    uploadBtn.setAttribute('disabled', 'true');
    const assetId = await addUploadedAsset(file);
    uploadBtn.textContent = t('feature.gardenPainter.uploadImage');
    uploadBtn.removeAttribute('disabled');
    if (assetId) {
      const uploadKey = `upload:${assetId}`;
      state.pickerSwapKey = uploadKey;
      callbacks.onSwapPreview(uploadKey);
      container.innerHTML = '';
      renderUploadPanel(container, state, callbacks);
    }
  });
}

// ---------------------------------------------------------------------------
// Mutation picker mode
// ---------------------------------------------------------------------------

async function renderMutationPicker(
  container: HTMLElement,
  state: WindowState,
  callbacks: GridCallbacks,
  svc: SpriteService,
): Promise<void> {
  const { id: targetName } = parseAtlasKey(state.pickerTargetKey);
  const spriteRules = getTextureSwapperState().rules.filter(r => r.targetSpriteKey === state.pickerTargetKey);
  const effective = resolveEffectiveSprite(state.pickerTargetKey, spriteRules);
  const effectiveSpriteKey = `sprite/${effective.category}/${effective.id}`;

  const banner = buildPickerBanner(
    `${t('feature.gardenPainter.addMutationsTo')} ${targetName}`,
    null,
    () => {
      callbacks.onMutationsDone(state.pickerMutations);
    },
    t('feature.gardenPainter.done'),
  );
  container.appendChild(banner);

  const body = document.createElement('div');
  body.style.cssText = 'flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:16px;';
  container.appendChild(body);

  const allMutations = MUTATION_GROUPS.flatMap(g => g.mutations);
  const unlockMap = new Map<string, boolean>();
  for (const m of allMutations) {
    unlockMap.set(m, await isMutationUnlocked(state.pickerTargetKey, m));
  }

  for (const group of MUTATION_GROUPS) {
    const section = document.createElement('div');

    const header = document.createElement('div');
    header.style.cssText = 'font-size:9px;color:var(--qpm-text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;';
    header.textContent = t(group.label);
    section.appendChild(header);

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;';

    for (const mutation of group.mutations) {
      const isUnlocked = unlockMap.get(mutation) ?? true;
      const isActive = state.pickerMutations.includes(mutation);
      // Fallback hex matches `--qpm-accent` (#8f82ff). Stays as a hex literal
      // because the surrounding code concatenates 2-digit alpha suffixes
      // (`${color}80`/`18`/`20`) — a CSS var would break the alpha pattern.
      const color = MUTATION_COLORS[mutation] ?? '#8f82ff';
      const toggle = buildMutationToggle(mutation, effectiveSpriteKey, svc, isActive, color, () => {
        if (mutation === 'None') {
          if (isActive) {
            const i = state.pickerMutations.indexOf('None');
            if (i >= 0) state.pickerMutations.splice(i, 1);
          } else {
            state.pickerMutations.length = 0;
            state.pickerMutations.push('None');
          }
        } else {
          const noneIdx = state.pickerMutations.indexOf('None');
          if (noneIdx >= 0) state.pickerMutations.splice(noneIdx, 1);
          const idx = state.pickerMutations.indexOf(mutation);
          if (idx >= 0) {
            state.pickerMutations.splice(idx, 1);
          } else {
            state.pickerMutations.push(mutation);
          }
        }
        container.innerHTML = '';
        void renderMutationPicker(container, state, callbacks, svc);
      });
      if (!isUnlocked) {
        toggle.style.pointerEvents = 'none';
        toggle.style.opacity = '0.5';
        const labelEl = toggle.querySelector('span');
        if (labelEl) {
          labelEl.textContent = t('feature.gardenPainter.lockedName');
          labelEl.title = t('feature.gardenPainter.lockedJournal');
        }
      }
      row.appendChild(toggle);
    }

    section.appendChild(row);
    body.appendChild(section);
  }
}

// ---------------------------------------------------------------------------
// Picker banner
// ---------------------------------------------------------------------------

function buildPickerBanner(
  text: string,
  onConfirm: (() => void) | null,
  onCancel: () => void,
  cancelLabel?: string,
): HTMLElement {
  const banner = document.createElement('div');
  banner.style.cssText = [
    'padding:8px 12px',
    'background:var(--qpm-accent-subtle)',
    'border-bottom:1px solid var(--qpm-accent-border)',
    'display:flex',
    'align-items:center',
    'gap:8px',
    'flex-shrink:0',
  ].join(';');

  const label = document.createElement('span');
  label.style.cssText = 'font-size:12px;color:var(--qpm-accent-hover);font-weight:600;flex:1;';
  label.textContent = text;
  banner.appendChild(label);

  if (onConfirm) {
    banner.appendChild(createButton(t('feature.gardenPainter.confirm'), { variant: 'confirm', onClick: onConfirm }));
  }

  const cancelBtn = createButton(cancelLabel ?? `× ${t('feature.gardenPainter.cancel')}`, { variant: 'ghost', size: 'sm', onClick: onCancel });
  banner.appendChild(cancelBtn);

  return banner;
}

// ---------------------------------------------------------------------------
// Thumbnail cell
// ---------------------------------------------------------------------------

function buildThumbnailCell(
  spriteKey: string,
  svc: SpriteService,
  isSelected: boolean,
  ruleBadges: RuleType[],
  isLocked: boolean,
  onClick: () => void,
): HTMLElement {
  const cell = document.createElement('div');
  const dominantBadge = ruleBadges[0];
  const borderColour = ruleBadges.length > 1
    ? 'transparent'
    : dominantBadge === 'swap'
      ? '#64c8ff'
      : dominantBadge === 'mutation'
        ? '#c084fc'
        : dominantBadge === 'transparency'
          ? '#ffc864'
          : 'var(--qpm-accent-tint)';

  const baseStyles: string[] = [
    'display:flex;flex-direction:column;align-items:center;gap:6px',
    'padding:8px 6px',
    'border-radius:12px',
    'border:2px solid ' + (isSelected ? 'var(--qpm-accent-emphasis)' : borderColour),
    'cursor:' + (isLocked ? 'not-allowed' : 'pointer'),
    'transition:all 0.12s',
    'position:relative',
  ];

  if (isSelected) {
    baseStyles.push('background:var(--qpm-accent-subtle)');
    baseStyles.push('box-shadow:0 0 18px var(--qpm-accent-subtle)');
  } else if (ruleBadges.length === 1) {
    baseStyles.push(`box-shadow:0 0 14px ${borderColour}88`);
  } else if (ruleBadges.length > 1) {
    baseStyles.push('box-shadow:0 0 22px rgba(143,130,255,0.6)');
    baseStyles.push('background-image:linear-gradient(var(--qpm-surface-window),var(--qpm-surface-window)),linear-gradient(135deg,#64c8ff 0%,#c084fc 50%,#ffc864 100%)');
    baseStyles.push('background-origin:border-box');
    baseStyles.push('background-clip:padding-box,border-box');
  }

  cell.style.cssText = baseStyles.join(';');

  if (isLocked) {
    cell.style.pointerEvents = 'none';
    cell.style.opacity = '0.5';
  } else {
    cell.addEventListener('mouseenter', () => {
      if (!isSelected) {
        cell.style.background = 'var(--qpm-accent-tint)';
      }
    });
    cell.addEventListener('mouseleave', () => {
      if (!isSelected) {
        cell.style.background = '';
      }
    });
    cell.addEventListener('click', onClick);
  }

  const thumbFrame = document.createElement('div');
  thumbFrame.style.cssText = `width:${THUMB_SIZE}px;height:${THUMB_SIZE}px;display:flex;align-items:center;justify-content:center;position:relative;`;
  const thumb = getCachedThumbnail(spriteKey, svc, THUMB_SIZE);
  if (thumb) {
    const clone = document.createElement('canvas');
    clone.width = thumb.width;
    clone.height = thumb.height;
    clone.getContext('2d')!.drawImage(thumb, 0, 0);
    clone.style.cssText = `width:${THUMB_SIZE}px;height:${THUMB_SIZE}px;image-rendering:pixelated;border-radius:8px;`;
    thumbFrame.appendChild(clone);
  } else {
    thumbFrame.appendChild(buildShimmerPlaceholder(THUMB_SIZE));
  }

  if (isLocked) {
    const mask = document.createElement('div');
    mask.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.9);border-radius:8px;';
    thumbFrame.appendChild(mask);
  }

  cell.appendChild(thumbFrame);

  {
    const family = stripRenderState(spriteKey);
    const allRules = getTextureSwapperState().rules;
    const scopedCount = allRules.filter(r =>
      stripRenderState(r.targetSpriteKey) === family
      && (r.scope?.kind === 'tile' || r.scope?.kind === 'petSlot'),
    ).length;
    const hasBadges = ruleBadges.length > 0 || scopedCount > 0;
    if (hasBadges) {
      const badgeStack = document.createElement('div');
      badgeStack.style.cssText = 'position:absolute;top:5px;right:5px;display:flex;flex-direction:column;gap:3px;';
      for (const bt of ruleBadges.slice(0, 3)) {
        badgeStack.appendChild(buildRuleBadge(bt as 'swap' | 'mutation' | 'transparency'));
      }
      if (scopedCount > 0) {
        const scopeBadge = document.createElement('div');
        scopeBadge.style.cssText = 'width:22px;height:22px;border-radius:6px;background:rgba(100,200,255,0.85);color:#001830;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;border:1px solid rgba(0,0,0,0.35);box-shadow:0 1px 3px rgba(0,0,0,0.4);';
        scopeBadge.textContent = `+${scopedCount}`;
        scopeBadge.title = t('feature.gardenPainter.editor.scopeBadgeCount', { count: scopedCount });
        badgeStack.appendChild(scopeBadge);
      }
      cell.appendChild(badgeStack);
    }
  }

  const nameEl = document.createElement('div');
  nameEl.style.cssText = 'font-size:10px;line-height:1.25;color:rgba(255,255,255,0.85);text-align:center;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;max-width:80px;';
  nameEl.textContent = isLocked ? t('feature.gardenPainter.lockedName') : displaySpriteName(spriteKey);
  nameEl.title = isLocked ? t('feature.gardenPainter.lockedJournal') : spriteKey;
  cell.appendChild(nameEl);

  // Mount the Blobling-style per-tile swap affordances (upload / download /
  // active star badge) on unlocked tiles only. Locked tiles have no swap UI.
  if (!isLocked) {
    mountTileSwapButtons(cell, spriteKey);
  }

  return cell;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function collectItems(
  svc: SpriteService,
  categories: SpriteCategory[],
  filter: string,
  tabKind: 'plants-merged' | 'pets' | 'seeds' | 'items' | 'decor',
): Promise<Array<SpriteListItem & { isLocked: boolean }>> {
  const lcFilter = filter.toLowerCase();
  const raw: SpriteListItem[] = [];
  for (const cat of categories) {
    for (const it of svc.list(cat)) {
      if (lcFilter && !it.key.toLowerCase().includes(lcFilter)) continue;
      const { id } = parseAtlasKey(it.key);
      raw.push({ key: it.key, displayId: id });
    }
  }
  const sorted = sortSpriteList(tabKind, raw);
  const out: Array<SpriteListItem & { isLocked: boolean }> = [];
  for (const item of sorted) {
    const isLocked = !(await isSpeciesUnlocked(item.key));
    out.push({ ...item, isLocked });
  }
  return out;
}

function getBadgesForSprite(spriteKey: string, rules: TextureOverrideRule[]): RuleType[] {
  const matching = rules.filter(r => r.targetSpriteKey === spriteKey && r.enabled);
  if (!matching.length) return [];
  const types = new Set<RuleType>();
  for (const r of matching) {
    const rt = getRuleType(r);
    if (rt !== 'legacy') types.add(rt);
  }
  return Array.from(types);
}

// ---------------------------------------------------------------------------
// Slide-out integrations (Task 11)
// ---------------------------------------------------------------------------
export type SlideoutBrowserCallbacks = { onSpriteSelected: (spriteKey: string) => void };

export function buildSlideoutBrowser(state: WindowState, callbacks: SlideoutBrowserCallbacks): HTMLElement {
  const container = document.createElement('div');
  container.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden;';
  const svc = getSvc();
  if (!svc) {
    const msg = document.createElement('div');
    msg.style.cssText = 'padding:20px;font-size:12px;color:var(--qpm-text-muted);text-align:center;';
    msg.textContent = t('feature.gardenPainter.spriteNotReady');
    container.appendChild(msg);
    return container;
  }
  const adapter: GridCallbacks = {
    onSpriteSelected: callbacks.onSpriteSelected,
    onSwapConfirmed: () => {},
    onSwapUploadConfirmed: () => {},
    onSwapPreview: () => {},
    onMutationsDone: () => {},
    onPickerCancelled: () => {},
  };
  renderBrowseGrid(container, state, adapter, svc, () => {});
  return container;
}
export type SlideoutSwapPickerCallbacks = { onPicked: (spriteOrUploadKey: string) => void };

export function buildSlideoutSwapPicker(state: WindowState, callbacks: SlideoutSwapPickerCallbacks): { element: HTMLElement; getPickedKey: () => string } {
  const container = document.createElement('div');
  container.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden;';
  const svc = getSvc();
  if (!svc) {
    const msg = document.createElement('div');
    msg.style.cssText = 'padding:20px;font-size:12px;color:var(--qpm-text-muted);text-align:center;';
    msg.textContent = t('feature.gardenPainter.spriteNotReady');
    container.appendChild(msg);
    return { element: container, getPickedKey: () => '' };
  }
  const adapter: GridCallbacks = {
    onSpriteSelected: () => {},
    onSwapConfirmed: (key) => callbacks.onPicked(key),
    onSwapUploadConfirmed: (id) => callbacks.onPicked(`upload:${id}`),
    onSwapPreview: (key) => { state.pickerSwapKey = key; callbacks.onPicked(key); },
    onMutationsDone: () => {},
    onPickerCancelled: () => {},
  };
  renderSwapPicker(container, state, adapter, svc);
  const banner = container.firstElementChild as HTMLElement | null;
  if (banner) banner.style.display = 'none';
  return { element: container, getPickedKey: () => state.pickerSwapKey };
}

export type MutationPickerOverlayCallbacks = {
  onDone: (mutations: string[]) => void;
  onCancel: () => void;
};

export function buildMutationPickerOverlay(state: WindowState, callbacks: MutationPickerOverlayCallbacks): HTMLElement {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:absolute;inset:0;background:rgba(18,20,26,0.96);display:flex;flex-direction:column;z-index:5;';
  const svc = getSvc();
  if (!svc) {
    const msg = document.createElement('div');
    msg.style.cssText = 'padding:20px;font-size:12px;color:var(--qpm-text-muted);text-align:center;flex:1;';
    msg.textContent = t('feature.gardenPainter.spriteNotReady');
    overlay.appendChild(msg);
    return overlay;
  }
  const adapter: GridCallbacks = {
    onSpriteSelected: () => {},
    onSwapConfirmed: () => {},
    onSwapUploadConfirmed: () => {},
    onSwapPreview: () => {},
    onMutationsDone: (mutations) => callbacks.onDone(mutations),
    onPickerCancelled: () => callbacks.onCancel(),
  };
  void renderMutationPicker(overlay, state, adapter, svc);
  return overlay;
}
