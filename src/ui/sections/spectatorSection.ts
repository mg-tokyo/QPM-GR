import {
  DIRECTOR_EVERY_RANGE, FLY_SPEED_RANGE, getSpectatorSettings, onSpectatorSettingsChange, resetSpectatorSettings, setSpectatorSetting,
  type SpectatorSettings,
} from '../../features/spectator';
import { t } from '../../i18n';
import { createButton, createSliderRowControl, createToggle } from '../components';
import type { CardIcon, ExpandableCardConfig } from '../hub/cards/types';
import { formatKeybind } from '../pets/petsWindow/helpers';
import { alignedRows, toggleDetachedSection, type SectionHandle } from './sectionLayout';
import { createSpectatorKeys } from './spectatorKeys';

const DETACH_ID = 'config-spectator';
const FLY_STEP = 0.25;
const EVERY_STEP = 5;

// eslint-disable-next-line qpm/no-emoji-in-ui -- CardConfig.icon renders via renderIcon; kind:'emoji' as the 3D camera card beside it (camera3dSection.ts:13-14).
const SPECTATOR_ICON: CardIcon = { kind: 'emoji', value: '👁️' };

// 1 → "1.0×", 1.25 → "1.25×" (PS4 shows 1.0×).
const flyLabel = (v: number): string => `${Number.isInteger(v) ? v.toFixed(1) : String(Math.round(v * 100) / 100)}×`;

/** PS4 (2026-10-10). Every control follows the stored settings, so Enable, Reset and a second open copy update it in place. */
export function createSpectatorSection(): SectionHandle {
  const root = document.createElement('div');
  root.dataset.qpmSection = 'spectator';
  root.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
  const s = getSpectatorSettings();

  const enable = createToggle({ checked: s.enabled, label: t('feature.spectator.settings.enable'), onChange: (v) => setSpectatorSetting('enabled', v) });
  const fly = createSliderRowControl({
    label: t('feature.spectator.settings.flySpeed'), ...FLY_SPEED_RANGE, step: FLY_STEP, value: s.flySpeed, disabled: !s.enabled,
    labelWidth: 'auto', onCommit: (v) => setSpectatorSetting('flySpeed', v), formatFn: flyLabel,
  });
  const every = createSliderRowControl({
    label: t('feature.spectator.settings.directorEvery'), ...DIRECTOR_EVERY_RANGE, step: EVERY_STEP, value: s.directorEverySec,
    disabled: !s.enabled, labelWidth: 'auto', onCommit: (v) => setSpectatorSetting('directorEverySec', v),
    formatFn: (v) => `${Math.round(v)} s`,
  });
  const early = createToggle({
    size: 'compact', checked: s.directorEarly, disabled: !s.enabled, label: t('feature.spectator.settings.directorEarly'),
    onChange: (v) => setSpectatorSetting('directorEarly', v),
  });
  const keys = createSpectatorKeys();
  const resetRow = document.createElement('div');
  resetRow.appendChild(createButton(t('feature.spectator.settings.reset'), { size: 'sm', onClick: resetSpectatorSettings }));
  root.append(enable.root, alignedRows([fly.root, every.root]), early.root, keys.root, resetRow);

  const sync = (n: SpectatorSettings): void => {
    enable.setChecked(n.enabled);
    fly.setValue(n.flySpeed);
    fly.setDisabled(!n.enabled);
    every.setValue(n.directorEverySec);
    every.setDisabled(!n.enabled);
    early.setChecked(n.directorEarly);
    early.setDisabled(!n.enabled);
    keys.render(n);
  };
  sync(s);
  const off = onSpectatorSettingsChange(sync);
  return { root, destroy: () => { off(); keys.destroy(); } };
}

export function getSpectatorCard(): ExpandableCardConfig {
  return {
    key: 'spectator',
    label: t('feature.spectator.settings.title'),
    description: t('feature.spectator.settings.caption'),
    icon: SPECTATOR_ICON,
    tier: 'expandable',
    renderSummary: (el) => {
      el.style.cssText = 'font-size:12px;color:var(--qpm-text-muted);margin-top:2px;';
      const paint = (n: SpectatorSettings): void => {
        el.textContent = n.enabled ? t('feature.spectator.settings.summaryOn', { key: formatKeybind(n.keys.toggle) }) : t('common.disabled');
      };
      paint(getSpectatorSettings());
      return onSpectatorSettingsChange(paint);
    },
    renderExpanded: (container) => {
      const section = createSpectatorSection();
      container.appendChild(section.root);
      return section.destroy;
    },
    detachWindowId: DETACH_ID,
    onDetach: () => { toggleDetachedSection(DETACH_ID, t('feature.spectator.settings.title'), createSpectatorSection, 'spectatorDetach'); },
  };
}
