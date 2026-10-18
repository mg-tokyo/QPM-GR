import {
  DETAIL_PRESETS, FAR_ANIM_MODES, FOV_RANGE, GRAPHICS_PRESET_NAMES, GROUND_LEVELS, SENSITIVITY_RANGE, WEATHER3D_MODES, applyGraphicsPreset,
  getCamera3dSettings, getCamera3dView, graphicsPresetOf, onCamera3dSettingsChange, onCamera3dViewChange, resetCamera3dSettings,
  retryCamera3d, setCamera3dSetting, type Camera3dSettings, type FarAnim, type GraphicsRows,
} from '../../features/camera3d';
import { t } from '../../i18n';
import { createButton, createPillTabs, createSliderRowControl, createToggle } from '../components';
import type { CardIcon, ExpandableCardConfig } from '../hub/cards/types';
import { alignedRows, muted, toggleDetachedSection } from './sectionLayout';

const DETACH_ID = 'config-camera3d';

// eslint-disable-next-line qpm/no-emoji-in-ui -- CardConfig.icon renders via renderIcon; kind:'emoji' is the path the NPC dialogue card uses (configGroup.ts:369-370).
const CAMERA3D_ICON: CardIcon = { kind: 'emoji', value: '🎥' };

type SubKey = 'firstPerson' | 'camMove' | 'invertY';
const GRAPHICS_PILLS = [...GRAPHICS_PRESET_NAMES, 'custom'] as const;
const FAR_ANIM_LABEL: Readonly<Record<FarAnim, string>> = { off: 'common.off', full: 'common.on' };

interface PillRow { root: HTMLElement; render: (cur: Camera3dSettings) => void }

/** One graphics row for `alignedRows`: label in the shared column, pills across the rest. */
function pillRow<K extends keyof GraphicsRows>(
  label: string, key: K, values: readonly Camera3dSettings[K][], labelOf: (v: Camera3dSettings[K]) => string,
): PillRow {
  const host = document.createElement('div');
  host.style.gridColumn = '2 / -1';
  const root = document.createElement('div');
  root.style.alignItems = 'center';
  root.append(muted(label), host);
  // createPillTabs does not restyle on select: re-create the row (memory: pill-tab gotcha).
  const render = (cur: Camera3dSettings): void => {
    host.replaceChildren(createPillTabs(
      values.map(labelOf),
      values.indexOf(cur[key]),
      (i) => { const v = values[i]; if (v !== undefined) setCamera3dSetting(key, v); },
      { disabled: !cur.enabled },
    ));
  };
  return { root, render };
}

/** Every control follows the stored settings, so Enable, Reset and a second open copy update it in place. */
export function createCamera3dSection(): { root: HTMLElement; destroy: () => void } {
  const root = document.createElement('div');
  root.dataset.qpmSection = 'camera3d';
  root.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
  const s = getCamera3dSettings();

  const paused = document.createElement('div');
  paused.style.cssText = 'display:none;align-items:center;gap:8px;';
  const pausedText = document.createElement('span');
  pausedText.style.cssText = 'font-size:12px;color:var(--qpm-warning);';
  pausedText.textContent = t('feature.camera3d.paused');
  paused.append(pausedText, createButton(t('feature.camera3d.retry'), { size: 'sm', onClick: retryCamera3d }));
  const showPaused = (on: boolean): void => { paused.style.display = on ? 'flex' : 'none'; };

  const enable = createToggle({ checked: s.enabled, label: t('feature.camera3d.enable'), onChange: (v) => setCamera3dSetting('enabled', v) });
  const sub = (key: SubKey, label: string): { key: SubKey; toggle: ReturnType<typeof createToggle> } => ({
    key,
    toggle: createToggle({ size: 'compact', checked: s[key], disabled: !s.enabled, label, onChange: (v) => setCamera3dSetting(key, v) }),
  });
  const subs = [
    sub('firstPerson', t('feature.camera3d.firstPerson')),
    sub('camMove', t('feature.camera3d.camMove')),
    sub('invertY', t('feature.camera3d.invertY')),
  ];

  const sensitivity = createSliderRowControl({
    label: t('feature.camera3d.sensitivity'), ...SENSITIVITY_RANGE, value: s.sensitivity, disabled: !s.enabled, labelWidth: 'auto',
    onCommit: (v) => setCamera3dSetting('sensitivity', v),
    formatFn: (v) => `${v.toFixed(1)}×`,
  });
  const fov = createSliderRowControl({
    label: t('feature.camera3d.fov'), ...FOV_RANGE, value: s.fov, disabled: !s.enabled, labelWidth: 'auto',
    onCommit: (v) => setCamera3dSetting('fov', v),
    formatFn: (v) => `${Math.round(v)}°`,
  });

  const graphicsHost = document.createElement('div');
  const graphicsCaption = muted('');
  const renderGraphics = (cur: Camera3dSettings): void => {
    const lit = graphicsPresetOf(cur);
    graphicsHost.replaceChildren(createPillTabs(
      GRAPHICS_PILLS.map((p) => `feature.camera3d.graphics.${p}`),
      GRAPHICS_PILLS.indexOf(lit),
      // Custom only shows that no preset matches (D3): it has no rows of its own, so its index applies nothing.
      (i) => { const p = GRAPHICS_PRESET_NAMES[i]; if (p) applyGraphicsPreset(p); },
      { disabled: !cur.enabled },
    ));
    graphicsCaption.textContent = t(`feature.camera3d.graphicsCaption.${lit}`);
  };

  const distance = pillRow(t('feature.camera3d.detail'), 'detail', DETAIL_PRESETS, (p) => `feature.camera3d.detail.${p}`);
  const rows = [
    distance,
    pillRow(t('feature.camera3d.farAnim'), 'farAnim', FAR_ANIM_MODES, (m) => FAR_ANIM_LABEL[m]),
    pillRow(t('feature.camera3d.ground'), 'ground', GROUND_LEVELS, (g) => `feature.camera3d.ground.${g}`),
    pillRow(t('feature.camera3d.weather3d'), 'weather3d', WEATHER3D_MODES, (w) => `feature.camera3d.weather3d.${w}`),
  ];
  const rowsGrid = alignedRows(rows.map((r) => r.root));
  const detailCaption = muted(t('feature.camera3d.detailCaption'));
  detailCaption.style.gridColumn = '1 / -1';
  distance.root.after(detailCaption);
  const renderGfx = (cur: Camera3dSettings): void => {
    renderGraphics(cur);
    for (const r of rows) r.render(cur);
  };
  renderGfx(s);

  const resetRow = document.createElement('div');
  resetRow.appendChild(createButton(t('feature.camera3d.reset'), { size: 'sm', onClick: resetCamera3dSettings }));

  root.append(
    paused, enable.root, ...subs.map((x) => x.toggle.root), alignedRows([sensitivity.root, fov.root]),
    muted(t('feature.camera3d.graphics')), graphicsHost, graphicsCaption, rowsGrid,
    muted(t('feature.camera3d.help')), resetRow,
  );

  const sync = (n: Camera3dSettings): void => {
    enable.setChecked(n.enabled);
    for (const { key, toggle } of subs) { toggle.setChecked(n[key]); toggle.setDisabled(!n.enabled); }
    sensitivity.setValue(n.sensitivity);
    sensitivity.setDisabled(!n.enabled);
    fov.setValue(n.fov);
    fov.setDisabled(!n.enabled);
    renderGfx(n);
  };
  showPaused(getCamera3dView().paused);
  const offs = [onCamera3dSettingsChange(sync), onCamera3dViewChange((v) => showPaused(v.paused))];
  return { root, destroy: () => { for (const off of offs.splice(0)) off(); } };
}

export function getCamera3dCard(): ExpandableCardConfig {
  return {
    key: 'camera3d',
    label: t('feature.camera3d.title'),
    description: t('feature.camera3d.caption'),
    icon: CAMERA3D_ICON,
    tier: 'expandable',
    tile: {
      icon: CAMERA3D_ICON.value,
      // eslint-disable-next-line qpm/no-hardcoded-colors -- TileMeta.color is a per-feature rgba tint applied at render time (src/ui/panel/tileGrid.ts:127-129); no design token for tile tints exists — matches the expandable tiles in configGroup.ts.
      color: 'rgba(143, 130, 255, 0.28)',
      defaultStatus: '—',
    },
    renderSummary: (el) => {
      el.style.cssText = 'font-size:12px;color:var(--qpm-text-muted);margin-top:2px;';
      const paint = (on: boolean): void => { el.textContent = on ? t('feature.camera3d.summaryOn') : t('common.disabled'); };
      paint(getCamera3dSettings().enabled);
      return onCamera3dSettingsChange((n) => paint(n.enabled));
    },
    renderExpanded: (container) => {
      const section = createCamera3dSection();
      container.appendChild(section.root);
      return section.destroy;
    },
    detachWindowId: DETACH_ID,
    onDetach: () => { toggleDetachedSection(DETACH_ID, t('feature.camera3d.title'), createCamera3dSection, 'camera3dDetach'); },
  };
}
