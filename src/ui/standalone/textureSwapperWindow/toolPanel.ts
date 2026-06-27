import {
  getTextureSwapperState,
  updateRule,
  parseAtlasKey,
  scopeKey,
  type TextureOverrideRule,
} from '../../../features/standalone/textureSwapper';
import { getSlotOffsetsSafe, getFloraBlueprintSafe } from '../../../utils/game/catalogHelpers';
import { renderBySpriteKey } from '../../../sprite-v2/compat';
import type { TileComponent } from './types';
import { t } from '../../../i18n';
import type { WindowState } from './types';
import { createToggle } from '../../components/toggle';
import { createEmptyState } from '../../components/emptyState';
import { createPillTabs } from '../../components/pillTabs';
import { createTabBar, type TabDef } from '../../components/tabBar';
import { displaySpriteName } from './displayName';
import { renderPreviewHero } from './editor/previewHero';
import { renderTabMutations } from './editor/tabMutations';
import { renderTabTransparency } from './editor/tabTransparency';
import { renderTabTintSize } from './editor/tabTintSize';
import { renderScopeChip } from './editor/scopeChip';

export type ToolPanelCallbacks = {
  onEnterSwapPick: (targetKey: string, editRuleId: string | null) => void;
  onEnterMutationPick: (targetKey: string, existingMutations: string[], editRuleId: string | null) => void;
  onRulesChanged: () => void;
  onCreateNewScope?: () => void;
};

export type ToolPanelHandle = { element: HTMLElement; refresh: () => void };

export { resolveEffectiveSprite } from './editor/previewHero';

export function buildToolPanel(state: WindowState, callbacks: ToolPanelCallbacks): ToolPanelHandle {
  const container = document.createElement('div');
  container.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;overflow-y:auto;padding:12px;gap:12px;';

  function refresh(): void {
    container.innerHTML = '';
    if (!state.selectedSpriteKey) {
      const empty = createEmptyState(t('feature.gardenPainter.selectSprite'));
      empty.style.flex = '1';
      container.appendChild(empty);
      return;
    }
    renderEditor(container, state, callbacks, refresh);
  }
  refresh();
  return { element: container, refresh };
}

function renderEditor(
  container: HTMLElement,
  state: WindowState,
  callbacks: ToolPanelCallbacks,
  refresh: () => void,
): void {
  const spriteKey = state.selectedSpriteKey;
  const editorSk = scopeKey(state.editorScope);
  const rules = getTextureSwapperState().rules.filter(r =>
    r.targetSpriteKey === spriteKey && scopeKey(r.scope) === editorSk,
  );

  const refreshPreview = renderPreviewHero(container, spriteKey, rules, state.previewSwapKey || undefined);

  const header = document.createElement('div');
  header.style.cssText = 'text-align:center;display:flex;flex-direction:column;gap:2px;';
  const title = document.createElement('div');
  title.style.cssText = 'font-size:14px;font-weight:600;color:var(--qpm-text);';
  title.textContent = displaySpriteName(spriteKey);
  title.title = spriteKey;
  const sub = document.createElement('div');
  sub.style.cssText = 'font-size:10px;color:var(--qpm-text-muted);text-transform:uppercase;letter-spacing:0.4px;';
  const { category } = parseAtlasKey(spriteKey);
  sub.textContent = category;
  header.append(title, sub);
  container.appendChild(header);

  container.appendChild(renderScopeChip({
    targetSpriteKey: spriteKey,
    currentScope: state.editorScope,
    onSwitchScope: (sc) => {
      state.editorScope = sc;
      if (sc.kind !== 'tile') {
        state.tileComponents = null;
        state.tileObjectType = null;
        state.tileLiveSlotCount = null;
      }
      refresh();
    },
    onCreateNewScope: () => { callbacks.onCreateNewScope?.(); },
  }));

  const isTileScoped = state.editorScope.kind === 'tile';
  if (isTileScoped) {
    renderTileComponentTabs(container, state, refresh);
  } else {
    renderSlotPicker(container, spriteKey, state, refresh);
  }
  renderRiveStaticFallback(container, spriteKey, rules, callbacks);
  renderTabRow(container, state, rules, refresh);
  renderActiveTab(container, state, rules, callbacks, refreshPreview, refresh);
}

function renderTabRow(
  container: HTMLElement,
  state: WindowState,
  rules: TextureOverrideRule[],
  refresh: () => void,
): void {
  // Mutations tab is available for every category — the cosmetic mutation
  // overlay is a sprite-level effect that can be applied to anything.
  type TabId = WindowState['editorTab'];
  const tabsConfig: Array<{ id: TabId; label: string; hasRule: boolean }> = [
    {
      id: 'mutations', label: t('feature.gardenPainter.tabMutations'),
      hasRule: rules.some(r => (r.cosmeticMutations?.length ?? 0) > 0 || r.forceNoMutations === true),
    },
    {
      id: 'transparency', label: t('feature.gardenPainter.tabTransparency'),
      hasRule: rules.some(r => r.params.alpha != null && r.params.alpha !== 1),
    },
    {
      id: 'tintsize', label: t('feature.gardenPainter.tabTintSize'),
      hasRule: rules.some(r => r.params.tintColor != null || r.params.scaleX != null),
    },
  ];

  const tabDefs: TabDef[] = tabsConfig.map(c => ({
    id: c.id,
    label: c.label,
    ...(c.hasRule ? { badge: '●' } : {}),
  }));
  const bar = createTabBar(tabDefs, {
    defaultTab: state.editorTab,
    onChange: (id) => {
      state.editorTab = id as TabId;
      refresh();
    },
  });
  container.appendChild(bar.root);
}

function renderActiveTab(
  container: HTMLElement,
  state: WindowState,
  rules: TextureOverrideRule[],
  callbacks: ToolPanelCallbacks,
  refreshPreview: () => void,
  refresh: () => void,
): void {
  const tabBody = document.createElement('div');
  tabBody.style.cssText = 'display:flex;flex-direction:column;gap:10px;flex:1;';
  switch (state.editorTab) {
    case 'mutations': renderTabMutations(tabBody, state, rules, callbacks); break;
    case 'transparency': renderTabTransparency(tabBody, state, rules, callbacks, refreshPreview); break;
    case 'tintsize': renderTabTintSize(tabBody, state, rules, callbacks, refreshPreview, refresh); break;
  }
  container.appendChild(tabBody);
}

function hasAtlasKey(key: string): boolean {
  try {
    return renderBySpriteKey(key) != null;
  } catch {
    return false;
  }
}

export function buildTileComponents(opts: {
  species: string;
  objectType: string;
  liveSlotCount: number | null;
}): TileComponent[] {
  const { species, objectType, liveSlotCount } = opts;

  if (objectType === 'egg') {
    return [{ label: species, spriteKey: `sprite/pet/${species}`, slotIndex: null }];
  }

  if (objectType === 'decor') {
    return [{ label: species, spriteKey: `sprite/decor/${species}`, slotIndex: null }];
  }

  // Plant (default): resolve real atlas keys via the flora blueprint and
  // only emit tabs for keys that actually exist. For multi-harvest plants
  // (Squash, Tomato, …) only `sprite/plant/${species}` is registered — no
  // suffix variants — so a single "Crop N" tab per filled slot is shown.
  const components: TileComponent[] = [];
  const bp = getFloraBlueprintSafe(species);
  const plantKey = bp?.plantSpriteKey ?? null;
  const cropKey = bp?.cropSpriteKey ?? null;

  if (plantKey && hasAtlasKey(plantKey)) {
    components.push({
      label: t('feature.gardenPainter.componentPlant'),
      spriteKey: plantKey,
      slotIndex: null,
    });
  }

  if (cropKey && hasAtlasKey(cropKey)) {
    const blueprintSlotCount = bp?.slotOffsets?.length ?? 1;
    const cap = liveSlotCount != null && liveSlotCount > 0
      ? Math.min(liveSlotCount, blueprintSlotCount)
      : blueprintSlotCount;
    if (cap <= 1) {
      components.push({
        label: t('feature.gardenPainter.componentCrop'),
        spriteKey: cropKey,
        slotIndex: 0,
      });
    } else {
      for (let i = 0; i < cap; i++) {
        components.push({
          label: t('feature.gardenPainter.componentCropN', { n: String(i + 1) }),
          spriteKey: cropKey,
          slotIndex: i,
        });
      }
    }
  }

  // Fallback: no suffixed keys but a bare `sprite/plant/${species}` is
  // registered (some legacy species use this shape). Emit a single tab.
  if (components.length === 0) {
    const bareKey = `sprite/plant/${species}`;
    if (hasAtlasKey(bareKey)) {
      components.push({ label: species, spriteKey: bareKey, slotIndex: null });
    }
  }

  return components;
}

function renderTileComponentTabs(
  container: HTMLElement,
  state: WindowState,
  refresh: () => void,
): void {
  if (state.editorScope.kind !== 'tile') return;
  const { species } = state.editorScope;

  if (!state.tileComponents) {
    const objectType = state.tileObjectType
      ?? (getFloraBlueprintSafe(species) ? 'plant' : 'egg');
    state.tileComponents = buildTileComponents({
      species,
      objectType,
      liveSlotCount: state.tileLiveSlotCount,
    });
  }
  const comps = state.tileComponents;
  if (comps.length <= 1) return;

  const activeKey = state.selectedSpriteKey;
  const activeSlot = state.advancedSlotIndex;

  const tabDefs: TabDef[] = comps.map((c, i) => ({
    id: String(i),
    label: c.label,
  }));

  const activeIdx = comps.findIndex(c =>
    c.spriteKey === activeKey && c.slotIndex === activeSlot,
  );
  const defaultTab = String(activeIdx >= 0 ? activeIdx : 0);

  const bar = createTabBar(tabDefs, {
    defaultTab,
    onChange: (id) => {
      const idx = Number(id);
      const comp = comps[idx];
      if (!comp) return;
      state.selectedSpriteKey = comp.spriteKey;
      state.advancedSlotIndex = comp.slotIndex;
      refresh();
    },
  });
  container.appendChild(bar.root);
}

function renderSlotPicker(
  container: HTMLElement,
  spriteKey: string,
  state: WindowState,
  refresh: () => void,
): void {
  const { id: targetId, category } = parseAtlasKey(spriteKey);
  const isCropTarget = category === 'crop' || /crop$/i.test(targetId);
  if (!isCropTarget) { state.advancedSlotIndex = null; return; }
  const species = targetId.replace(/Crop$/i, '');
  const slotOffsets = getSlotOffsetsSafe(species);
  if (!slotOffsets || slotOffsets.length <= 1) { state.advancedSlotIndex = null; return; }

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;align-items:center;gap:8px;';
  const label = document.createElement('div');
  label.style.cssText = 'font-size:12px;color:var(--qpm-text-muted);';
  label.textContent = t('feature.gardenPainter.slotPickerLabel');
  row.appendChild(label);

  const slotCount = slotOffsets.length;
  const labels = [t('feature.gardenPainter.allSlots'), ...Array.from({ length: slotCount }, (_, i) => t('feature.gardenPainter.slotN', { n: String(i) }))];
  const activeIdx = state.advancedSlotIndex == null ? 0 : state.advancedSlotIndex + 1;
  const tabs = createPillTabs(labels, activeIdx, (i) => {
    state.advancedSlotIndex = i === 0 ? null : i - 1;
    refresh();
  });
  row.appendChild(tabs);
  container.appendChild(row);
}

const RIVE_DECOR_LOWER_PANEL = new Set([
  'woodwindmill', 'marblefountain', 'stonebirdbath', 'windspinner', 'windturner',
]);

function renderRiveStaticFallback(
  container: HTMLElement,
  spriteKey: string,
  rules: TextureOverrideRule[],
  callbacks: ToolPanelCallbacks,
): void {
  const targetIdLower = parseAtlasKey(spriteKey).id.toLowerCase();
  if (!RIVE_DECOR_LOWER_PANEL.has(targetIdLower)) return;
  if (rules.length === 0) return;

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--qpm-surface-2);border:1px solid var(--qpm-accent-subtle);border-radius:8px;font-size:12px;color:var(--qpm-text);';
  const isEnabled = rules.some(r => r.useStaticFallback);
  const toggle = createToggle({
    size: 'compact',
    checked: isEnabled,
    onChange: (checked) => {
      for (const r of rules) {
        if (!!r.useStaticFallback === checked) continue;
        updateRule({ ...r, useStaticFallback: checked }, { silent: true });
      }
      callbacks.onRulesChanged();
    },
  });
  row.appendChild(toggle.root);
  const lbl = document.createElement('span');
  lbl.textContent = t('feature.gardenPainter.useStaticFallback');
  lbl.style.cssText = 'flex:1;';
  row.appendChild(lbl);
  container.appendChild(row);
}
