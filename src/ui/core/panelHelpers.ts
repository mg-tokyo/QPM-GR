import type { ShopCategoryKey } from '../../store/stats';
import type { ActivePetInfo } from '../../store/pets';
import { clearManualOverride, setManualOverride } from '../../features/pets/turtleTimer';
import { ensureToastStyle } from './panelStyles';

// ---- Interfaces ----

export interface ShopCountdownView {
  summaryEl: HTMLElement;
  values: Record<ShopCategoryKey, HTMLElement>;
}

export type CheckboxChangeHandler = (checked: boolean) => void;

export interface NumberOptionConfig {
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  onChange: (value: number) => void;
}

// ---- Card types (needed by createCard) ----

export interface CardComponents {
  root: HTMLElement;
  header: HTMLElement;
  body: HTMLElement;
  indicator: HTMLElement | null;
  subtitleEl: HTMLElement | null;
}

export interface CardOptions {
  collapsible?: boolean;
  startCollapsed?: boolean;
  subtitle?: string;
  subtitleElement?: HTMLElement;
  headerActions?: HTMLElement[];
}

// ---- Constants ----

export const FOCUS_KEY_SEPARATOR = '::';

// ---- Functions ----

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatRestockCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function formatDurationPretty(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) {
    return '—';
  }
  if (ms <= 0) {
    return 'Ready';
  }
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (totalMinutes < 60) {
    return seconds > 0 ? `${totalMinutes}m ${seconds}s` : `${totalMinutes}m`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours}h ${minutes.toString().padStart(2, '0')}m` : `${hours}h`;
}

export function formatMinutesPretty(minutes: number | null): string {
  if (minutes == null || !Number.isFinite(minutes)) {
    return '0m';
  }
  const safe = Math.max(0, minutes);
  if (safe >= 60) {
    const hours = Math.floor(safe / 60);
    const mins = Math.round(safe % 60);
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }
  if (safe >= 1) {
    return `${Math.round(safe)}m`;
  }
  return `${Math.max(1, Math.round(safe * 60))}s`;
}

export function formatRatePretty(rate: number | null): string {
  if (rate == null || !Number.isFinite(rate)) {
    return '1.00×';
  }
  return `${rate.toFixed(2)}×`;
}

export function formatHungerPretty(pct: number | null): string {
  if (pct == null || !Number.isFinite(pct)) {
    return '—';
  }
  return `${Math.round(pct)}%`;
}

export function createEditablePetValue(
  petInfo: { species: string | null; slotIndex: number; petId?: string | null },
  field: 'xp' | 'targetScale',
  currentValue: number | null,
  formatFn: (val: number | null) => string,
): HTMLSpanElement {
  const span = document.createElement('span');
  span.style.cssText = 'cursor:pointer;text-decoration:underline dotted;';
  span.title = `Click to manually set ${field} value (leave empty to clear)`;
  span.textContent = formatFn(currentValue);

  span.addEventListener('click', (e) => {
    e.stopPropagation();

    const input = document.createElement('input');
    input.type = 'number';
    input.style.cssText = 'width:60px;font-size:9px;padding:2px;border:1px solid #4CAF50;background:#1a1a1a;color:#fff;';
    input.value = currentValue != null ? String(currentValue) : '';
    input.placeholder = field === 'xp' ? 'XP' : 'Scale';
    input.step = field === 'targetScale' ? '0.01' : '1';

    const save = () => {
      const val = input.value.trim();
      const minimalPet = {
        species: petInfo.species,
        slotIndex: petInfo.slotIndex,
        petId: petInfo.petId ?? null,
        slotId: null,
        hungerPct: null,
        hungerValue: null,
        hungerMax: null,
        hungerRaw: null,
        name: null,
        targetScale: field === 'targetScale' && val ? Number(val) : null,
        mutations: [],
        abilities: [],
        xp: field === 'xp' && val ? Number(val) : null,
        level: null,
        levelRaw: null,
        strength: null,
        position: null,
        chargedAbilityId: null,
        updatedAt: Date.now(),
        raw: null,
      } as ActivePetInfo;

      if (val === '') {
        clearManualOverride(minimalPet, field);
      } else {
        const num = Number(val);
        if (Number.isFinite(num) && num >= 0) {
          setManualOverride(minimalPet, { [field]: num });
        }
      }
      input.remove();
      span.style.display = '';
    };

    input.addEventListener('blur', () => setTimeout(save, 100));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        save();
      } else if (event.key === 'Escape') {
        span.style.display = '';
        input.remove();
      }
    });

    span.style.display = 'none';
    span.parentElement?.insertBefore(input, span.nextSibling);
    input.focus();
    input.select();
  });

  return span;
}

export function buildFocusTargetKey(tileId: string, slotIndex: number): string {
  return `${tileId}${FOCUS_KEY_SEPARATOR}${slotIndex}`;
}

export function parseFocusTargetKey(value: string): { tileId: string | null; slotIndex: number | null } {
  if (!value) {
    return { tileId: null, slotIndex: null };
  }
  const [tileId, slotRaw] = value.split(FOCUS_KEY_SEPARATOR);
  const slotIndex = Number.parseInt(slotRaw ?? '', 10);
  if (!tileId || !Number.isFinite(slotIndex)) {
    return { tileId: null, slotIndex: null };
  }
  return { tileId, slotIndex };
}

export function createCard(title: string, options: CardOptions = {}): CardComponents {
  const root = document.createElement('div');
  root.className = 'qpm-card';
  root.style.display = 'flex';
  root.style.flexDirection = 'column';
  root.style.gap = '10px';

  const header = document.createElement('div');
  header.className = 'qpm-card__header';
  if (options.collapsible) {
    header.style.cursor = 'pointer';
  }

  const titleEl = document.createElement('div');
  titleEl.className = 'qpm-card__title';
  titleEl.textContent = title;
  header.appendChild(titleEl);

  const rightFragments: HTMLElement[] = [];
  let subtitleEl: HTMLElement | null = null;
  if (options.subtitleElement) {
    subtitleEl = options.subtitleElement;
    rightFragments.push(subtitleEl);
  } else if (options.subtitle) {
    subtitleEl = document.createElement('span');
    subtitleEl.className = 'qpm-section-muted';
    subtitleEl.textContent = options.subtitle;
    rightFragments.push(subtitleEl);
  }

  if (Array.isArray(options.headerActions) && options.headerActions.length > 0) {
    rightFragments.push(...options.headerActions);
  }

  let indicator: HTMLElement | null = null;
  if (options.collapsible) {
    indicator = document.createElement('span');
    indicator.className = 'qpm-section-muted';
    indicator.textContent = options.startCollapsed ? '▲' : '▼';
    rightFragments.push(indicator);
  }

  if (rightFragments.length > 0) {
    const right = document.createElement('div');
    right.className = 'qpm-row';
    right.style.justifyContent = 'flex-end';
    right.style.gap = '6px';
    right.style.flexWrap = 'nowrap';
    for (const fragment of rightFragments) {
      right.appendChild(fragment);
    }
    header.appendChild(right);
  }

  root.appendChild(header);

  const body = document.createElement('div');
  body.style.display = options.startCollapsed ? 'none' : 'flex';
  body.style.flexDirection = 'column';
  body.style.gap = '10px';
  root.appendChild(body);

  if (options.collapsible) {
    let collapsed = !!options.startCollapsed;
    const setCollapsed = (value: boolean) => {
      collapsed = value;
      body.style.display = collapsed ? 'none' : 'flex';
      if (indicator) {
        indicator.textContent = collapsed ? '▲' : '▼';
      }
    };
    setCollapsed(collapsed);
    header.addEventListener('click', () => {
      setCollapsed(!collapsed);
    });
  }

  return { root, header, body, indicator, subtitleEl };
}

export function createHeaderSegment(row: HTMLElement, label: string): HTMLElement {
  const segment = document.createElement('div');
  segment.style.cssText = 'flex:1;min-width:120px;background:rgba(143,130,255,0.08);border:1px solid rgba(143,130,255,0.25);border-radius:10px;padding:8px 10px;display:flex;flex-direction:column;gap:4px';

  const title = document.createElement('div');
  title.style.cssText = 'font-size:10px;color:var(--qpm-text-muted);text-transform:uppercase;letter-spacing:0.4px';
  title.textContent = label;

  const value = document.createElement('div');
  value.style.cssText = 'font-size:12px;color:var(--qpm-text);line-height:1.25;font-weight:600;word-break:break-word';
  value.textContent = '—';

  segment.append(title, value);
  row.appendChild(segment);
  return value;
}

export function btn(text: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = text;
  b.style.cssText = 'padding:6px 10px;font-size:12px;cursor:pointer;border:none;border-radius:4px;background:#555;color:#fff;transition:background 0.2s';

  b.onmouseover = () => {
    if (!b.disabled) b.style.background = '#777';
  };

  b.onmouseout = () => {
    if (b.disabled) return;
    if (b.textContent?.includes('✓')) b.style.background = '#4CAF50';
    else b.style.background = '#555';
  };

  b.onclick = onClick;
  return b;
}

export function showToast(message: string): void {
  ensureToastStyle();
  const toast = document.createElement('div');
  toast.textContent = message;
  toast.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#2e7d32;color:#fff;padding:8px 12px;border-radius:6px;font-size:12px;z-index:2147483647;opacity:0.95;animation:qpm-toast-in 0.3s ease';
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}

export function createToggleOption(
  label: string,
  description: string,
  initialValue: boolean,
  onChange: (enabled: boolean) => void,
): HTMLElement {
  const container = document.createElement('div');
  container.style.cssText = 'display: flex; align-items: center; gap: 10px; padding: 8px; background: rgba(0, 0, 0, 0.2); border-radius: 4px;';

  const labelContainer = document.createElement('div');
  labelContainer.style.cssText = 'flex: 1; display: flex; flex-direction: column; gap: 2px;';

  const labelText = document.createElement('div');
  labelText.textContent = label;
  labelText.style.cssText = 'font-size: 12px; color: rgba(255, 255, 255, 0.9); font-weight: 500;';
  labelContainer.appendChild(labelText);

  const descText = document.createElement('div');
  descText.textContent = description;
  descText.style.cssText = 'font-size: 11px; color: rgba(255, 255, 255, 0.6);';
  labelContainer.appendChild(descText);

  container.appendChild(labelContainer);

  const toggle = document.createElement('button');
  toggle.style.cssText = `
    width: 48px;
    height: 24px;
    border-radius: 12px;
    border: none;
    cursor: pointer;
    position: relative;
    transition: background 0.2s;
    background: ${initialValue ? 'var(--qpm-accent)' : 'rgba(255, 255, 255, 0.2)'};
  `;

  const toggleKnob = document.createElement('div');
  toggleKnob.style.cssText = `
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: white;
    position: absolute;
    top: 3px;
    left: ${initialValue ? '27px' : '3px'};
    transition: left 0.2s;
  `;
  toggle.appendChild(toggleKnob);

  let enabled = initialValue;
  toggle.addEventListener('click', () => {
    enabled = !enabled;
    toggle.style.background = enabled ? 'var(--qpm-accent)' : 'rgba(255, 255, 255, 0.2)';
    toggleKnob.style.left = enabled ? '27px' : '3px';
    onChange(enabled);
  });

  container.appendChild(toggle);
  return container;
}

export function createCheckboxOption(label: string, checked: boolean, onChange: CheckboxChangeHandler): HTMLElement {
  const wrapper = document.createElement('label');
  wrapper.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:11px;color:#ddd';

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.style.cssText = 'width:14px;height:14px;cursor:pointer';
  input.addEventListener('click', event => event.stopPropagation());
  input.addEventListener('change', () => {
    onChange(input.checked);
  });

  const text = document.createElement('span');
  text.textContent = label;
  text.style.cssText = 'flex:1';

  wrapper.append(input, text);
  wrapper.addEventListener('click', event => event.stopPropagation());
  return wrapper;
}

export function createNumberOption(label: string, value: number, config: NumberOptionConfig): HTMLElement {
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:11px;color:#ddd';

  const text = document.createElement('span');
  text.textContent = label;
  text.style.cssText = 'flex:1';

  const input = document.createElement('input');
  input.type = 'number';
  if (config.min != null) input.min = String(config.min);
  if (config.max != null) input.max = String(config.max);
  if (config.step != null) input.step = String(config.step);
  input.value = String(value);
  input.style.cssText = 'width:70px;padding:3px 6px;border:1px solid #555;background:#333;color:#fff;border-radius:4px';
  input.addEventListener('keydown', event => event.stopPropagation());
  input.addEventListener('click', event => event.stopPropagation());
  input.addEventListener('input', () => {
    const parsed = parseFloat(input.value);
    if (Number.isNaN(parsed)) return;
    const result = config.onChange(parsed);
    if (typeof result === 'number' && !Number.isNaN(result) && result !== parsed) {
      input.value = String(result);
    }
  });

  row.append(text, input);

  if (config.suffix) {
    const suffix = document.createElement('span');
    suffix.textContent = config.suffix;
    suffix.style.cssText = 'color:#aaa;font-size:10px';
    row.appendChild(suffix);
  }

  row.addEventListener('click', event => event.stopPropagation());
  return row;
}

export function capitalizeWord(value: string | null | undefined): string {
  if (!value) return '—';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function formatWeatherLabel(kind: string | null | undefined): string {
  if (!kind) return 'Unknown';
  return kind
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function formatDuration(ms: number): string {
  const safeMs = Math.max(0, Math.floor(ms));
  const totalSeconds = Math.floor(safeMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
  }
  return `${seconds}s`;
}

export function formatPercentPretty(pct: number | null, decimals = 0): string {
  if (pct == null || !Number.isFinite(pct)) {
    return '0%';
  }
  return `${pct.toFixed(decimals)}%`;
}

export function formatFeedsPerHour(pctPerHour: number | null, decimals = 1): string {
  if (pctPerHour == null || !Number.isFinite(pctPerHour) || pctPerHour <= 0) {
    return '0.0 feeds/hr';
  }
  const feeds = pctPerHour / 100;
  return `${feeds.toFixed(decimals)} feeds/hr`;
}

export function formatMinutesWithUnit(minutes: number | null): string {
  if (minutes == null || !Number.isFinite(minutes)) {
    return '—';
  }
  if (minutes < 1) {
    const seconds = Math.max(1, Math.round(minutes * 60));
    return `${seconds}s`;
  }
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }
  return `${Math.round(minutes)}m`;
}

export function formatMinutesPerHour(minutes: number | null): string {
  if (minutes == null || !Number.isFinite(minutes) || minutes === 0) {
    return '0m per hour';
  }
  const sign = minutes >= 0 ? '-' : '+';
  const absMinutes = Math.abs(minutes);
  const rounded = Math.max(0, Math.round(absMinutes));
  const hours = Math.floor(rounded / 60);
  const mins = rounded % 60;
  const parts: string[] = [];
  if (hours > 0) {
    parts.push(`${hours}hr`);
  }
  if (mins > 0 || parts.length === 0) {
    parts.push(`${mins}m`);
  }
  return `${sign}${parts.join(' ')} per hour`;
}

export function formatCompletionTime(msRemaining: number | null): string {
  if (msRemaining == null || !Number.isFinite(msRemaining)) return '';
  const completionTime = new Date(Date.now() + msRemaining);
  const hours = completionTime.getHours();
  const minutes = completionTime.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  const displayMinutes = minutes.toString().padStart(2, '0');
  return ` • ${displayHours}:${displayMinutes} ${ampm}`;
}
