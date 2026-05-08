import { t } from '../../i18n';
import { createCard } from '../panelHelpers';
import {
  getAutoReconnectConfig,
  updateAutoReconnectConfig,
  subscribeToAutoReconnectConfig,
  type AutoReconnectConfig,
} from '../../features/autoReconnect';

const MIN_DELAY_SECONDS = 0;
const MAX_DELAY_SECONDS = 300;
const DELAY_STEP_SECONDS = 30;

function clampDelaySeconds(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return MIN_DELAY_SECONDS;
  const rounded = Math.round(parsed);
  return Math.min(MAX_DELAY_SECONDS, Math.max(MIN_DELAY_SECONDS, rounded));
}

function formatDelayLabel(seconds: number): string {
  if (seconds <= 0) return '0s';
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const rem = seconds % 60;
  if (rem === 0) return `${mins}m`;
  return `${mins}m ${rem}s`;
}

export function createAutoReconnectSection(): HTMLElement {
  const { root, body } = createCard(t('hub.config.autoReconnect.label'));
  root.dataset.qpmSection = 'auto-reconnect';

  const toggleRow = document.createElement('label');
  toggleRow.style.cssText = [
    'display:flex',
    'align-items:center',
    'justify-content:space-between',
    'gap:10px',
    'padding:8px 10px',
    'border-radius:8px',
    'border:1px solid rgba(255,255,255,0.08)',
    'background:rgba(255,255,255,0.03)',
    'cursor:pointer',
  ].join(';');

  const toggleTextWrap = document.createElement('div');
  toggleTextWrap.style.cssText = 'display:flex;flex-direction:column;gap:2px;';

  const toggleTitle = document.createElement('div');
  toggleTitle.style.cssText = 'font-size:13px;font-weight:600;color:var(--qpm-text,#fff);';
  toggleTitle.textContent = t('feature.autoReconnect.enableToggle');

  toggleTextWrap.append(toggleTitle);

  const toggleInput = document.createElement('input');
  toggleInput.type = 'checkbox';
  toggleInput.style.cssText = 'width:18px;height:18px;cursor:pointer;accent-color:var(--qpm-accent,#8f82ff);';

  toggleRow.append(toggleTextWrap, toggleInput);
  body.appendChild(toggleRow);

  const delayWrap = document.createElement('div');
  delayWrap.style.cssText = [
    'display:flex',
    'flex-direction:column',
    'gap:6px',
    'padding:8px 10px',
    'border-radius:8px',
    'border:1px solid rgba(255,255,255,0.08)',
    'background:rgba(255,255,255,0.03)',
  ].join(';');

  const delayHeader = document.createElement('div');
  delayHeader.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;';

  const delayLabel = document.createElement('div');
  delayLabel.style.cssText = 'font-size:13px;font-weight:600;color:var(--qpm-text,#fff);';
  delayLabel.textContent = t('feature.autoReconnect.delayLabel');

  const delayValue = document.createElement('div');
  delayValue.style.cssText = [
    'font-size:12px',
    'color:var(--qpm-accent,#8f82ff)',
    'font-weight:600',
    'min-width:64px',
    'text-align:right',
    'white-space:nowrap',
  ].join(';');

  delayHeader.append(delayLabel, delayValue);
  delayWrap.appendChild(delayHeader);

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = String(MIN_DELAY_SECONDS);
  slider.max = String(MAX_DELAY_SECONDS);
  slider.step = String(DELAY_STEP_SECONDS);
  slider.style.cssText = 'width:100%;cursor:pointer;';
  delayWrap.appendChild(slider);

  const inputRow = document.createElement('div');
  inputRow.style.cssText = 'display:flex;align-items:center;gap:8px;';

  const delayInput = document.createElement('input');
  delayInput.type = 'number';
  delayInput.min = String(MIN_DELAY_SECONDS);
  delayInput.max = String(MAX_DELAY_SECONDS);
  delayInput.step = String(DELAY_STEP_SECONDS);
  delayInput.style.cssText = [
    'width:74px',
    'padding:5px 7px',
    'border-radius:6px',
    'border:1px solid rgba(255,255,255,0.18)',
    'background:rgba(0,0,0,0.22)',
    'color:var(--qpm-text,#fff)',
    'font-size:12px',
  ].join(';');

  const inputSuffix = document.createElement('span');
  inputSuffix.style.cssText = 'font-size:11px;color:var(--qpm-text-muted,rgba(255,255,255,0.65));';
  inputSuffix.textContent = t('feature.autoReconnect.delayHint');

  inputRow.append(delayInput, inputSuffix);
  delayWrap.appendChild(inputRow);
  body.appendChild(delayWrap);

  const applyDelayToConfig = (secondsRaw: unknown): void => {
    const clampedSeconds = clampDelaySeconds(secondsRaw);
    const snappedSeconds = Math.round(clampedSeconds / DELAY_STEP_SECONDS) * DELAY_STEP_SECONDS;
    const nextSeconds = Math.min(MAX_DELAY_SECONDS, Math.max(MIN_DELAY_SECONDS, snappedSeconds));
    updateAutoReconnectConfig({ delayMs: nextSeconds * 1000 });
  };

  const syncUi = (nextConfig: AutoReconnectConfig): void => {
    const delaySeconds = clampDelaySeconds(nextConfig.delayMs / 1000);
    toggleInput.checked = nextConfig.enabled;
    slider.value = String(delaySeconds);
    delayInput.value = String(delaySeconds);
    delayValue.textContent = formatDelayLabel(delaySeconds);
    slider.disabled = !nextConfig.enabled;
    delayInput.disabled = !nextConfig.enabled;
    delayWrap.style.opacity = nextConfig.enabled ? '1' : '0.65';
  };

  toggleInput.addEventListener('change', () => {
    updateAutoReconnectConfig({ enabled: toggleInput.checked });
  });

  slider.addEventListener('input', () => {
    const seconds = clampDelaySeconds(slider.value);
    delayInput.value = String(seconds);
    delayValue.textContent = formatDelayLabel(seconds);
  });
  slider.addEventListener('change', () => {
    applyDelayToConfig(slider.value);
  });

  const commitDelayInput = (): void => {
    applyDelayToConfig(delayInput.value);
  };
  delayInput.addEventListener('change', commitDelayInput);
  delayInput.addEventListener('blur', commitDelayInput);

  const unsubscribe = subscribeToAutoReconnectConfig(syncUi);
  const detachObserver = new MutationObserver(() => {
    if (!document.documentElement.contains(root)) {
      unsubscribe();
      detachObserver.disconnect();
    }
  });
  detachObserver.observe(document.documentElement, { childList: true, subtree: true });

  return root;
}
