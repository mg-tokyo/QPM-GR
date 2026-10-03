import { getCamera3dSettings, setCamera3dSetting, type DetailPreset } from '../../features/camera3d';
import { t } from '../../i18n';
import { createPillTabs, createSliderRow, createToggle } from '../components';
import { toggleWindow, windowLog } from '../core/modalWindow';
import type { CardIcon, ExpandableCardConfig } from '../hub/cards/types';

const PRESETS: readonly DetailPreset[] = ['near', 'medium', 'far'];
// eslint-disable-next-line qpm/no-emoji-in-ui -- CardConfig.icon renders via renderIcon; kind:'emoji' is the path the NPC dialogue card uses (configGroup.ts:369-370).
const CAMERA3D_ICON: CardIcon = { kind: 'emoji', value: '🎥' };

export function createCamera3dSection(): HTMLElement {
  const root = document.createElement('div');
  root.dataset.qpmSection = 'camera3d';
  root.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
  const s = getCamera3dSettings();

  const sub = [
    createToggle({ size: 'compact', checked: s.firstPerson, disabled: !s.enabled, label: t('feature.camera3d.firstPerson'), onChange: (v) => setCamera3dSetting('firstPerson', v) }),
    createToggle({ size: 'compact', checked: s.camMove, disabled: !s.enabled, label: t('feature.camera3d.camMove'), onChange: (v) => setCamera3dSetting('camMove', v) }),
    createToggle({ size: 'compact', checked: s.invertY, disabled: !s.enabled, label: t('feature.camera3d.invertY'), onChange: (v) => setCamera3dSetting('invertY', v) }),
  ];
  root.appendChild(createToggle({
    checked: s.enabled,
    label: t('feature.camera3d.enable'),
    onChange: (v) => { setCamera3dSetting('enabled', v); for (const tg of sub) tg.input.disabled = !v; },
  }).root);
  for (const tg of sub) root.appendChild(tg.root);

  root.appendChild(createSliderRow({
    label: t('feature.camera3d.sensitivity'), min: 0.5, max: 2, step: 0.1, value: s.sensitivity,
    onChange: (v) => setCamera3dSetting('sensitivity', v),
    formatFn: (v) => `${v.toFixed(1)}×`,
  }));

  const detailLabel = document.createElement('div');
  detailLabel.style.cssText = 'font-size:12px;color:var(--qpm-text-muted);';
  detailLabel.textContent = t('feature.camera3d.detail');
  const detailHost = document.createElement('div');
  // createPillTabs does not restyle on select: re-create the row (memory: pill-tab gotcha).
  const renderTabs = (): void => {
    detailHost.replaceChildren(createPillTabs(
      PRESETS.map((p) => `feature.camera3d.detail.${p}`),
      PRESETS.indexOf(getCamera3dSettings().detail),
      (i) => { const p = PRESETS[i]; if (p) setCamera3dSetting('detail', p); renderTabs(); },
    ));
  };
  renderTabs();
  root.append(detailLabel, detailHost);

  const help = document.createElement('div');
  help.style.cssText = 'font-size:12px;color:var(--qpm-text-muted);line-height:1.4;';
  help.textContent = t('feature.camera3d.help');
  root.appendChild(help);
  return root;
}

export function getCamera3dCard(): ExpandableCardConfig {
  return {
    key: 'camera3d',
    label: t('feature.camera3d.title'),
    description: t('feature.camera3d.caption'),
    icon: CAMERA3D_ICON,
    tier: 'expandable',
    renderSummary: (el) => {
      el.style.cssText = 'font-size:12px;color:var(--qpm-text-muted);margin-top:2px;';
      el.textContent = getCamera3dSettings().enabled ? t('feature.camera3d.summaryOn') : t('common.disabled');
    },
    renderExpanded: (container) => { container.appendChild(createCamera3dSection()); },
    detachWindowId: 'config-camera3d',
    onDetach: () => {
      toggleWindow('config-camera3d', t('feature.camera3d.title'), (root) => {
        root.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;overflow-y:auto;padding:12px;';
        try { root.appendChild(createCamera3dSection()); } catch (e) { windowLog.warn('QPM-UI-002', { what: 'camera3dDetach' }, e); }
      }, '420px', '60vh');
    },
  };
}
