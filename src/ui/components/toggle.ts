export interface ToggleOptions {
  size?: 'large' | 'default' | 'compact';
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
}

interface ToggleResult {
  root: HTMLElement;
  input: HTMLButtonElement;
  setChecked: (value: boolean) => void;
}

const SIZES = {
  large:   { track: [48, 24], knob: 20, travel: 24 },
  default: { track: [36, 20], knob: 16, travel: 16 },
  compact: { track: [28, 16], knob: 12, travel: 12 },
} as const;

export function createToggle(options: ToggleOptions = {}): ToggleResult {
  const {
    size = 'default',
    checked = false,
    onChange,
    label,
    disabled = false,
  } = options;

  const dims = SIZES[size];
  let state = checked;

  const root = document.createElement('label');
  root.style.cssText =
    'display:inline-flex;align-items:center;gap:8px;' +
    `cursor:${disabled ? 'not-allowed' : 'pointer'};` +
    `opacity:${disabled ? '0.5' : '1'};` +
    'user-select:none;';

  const track = document.createElement('button');
  track.type = 'button';
  track.setAttribute('role', 'switch');
  track.setAttribute('aria-checked', String(state));
  track.disabled = disabled;
  track.style.cssText =
    `width:${dims.track[0]}px;height:${dims.track[1]}px;` +
    `border-radius:${dims.track[1]}px;` +
    'border:none;padding:0;cursor:inherit;position:relative;' +
    'transition:background 0.2s ease;flex-shrink:0;';

  const knob = document.createElement('div');
  knob.style.cssText =
    `width:${dims.knob}px;height:${dims.knob}px;` +
    'border-radius:50%;position:absolute;top:50%;' +
    'transform:translateY(-50%);' +
    'transition:left 0.2s ease,background 0.2s ease;' +
    'pointer-events:none;';

  track.appendChild(knob);
  root.appendChild(track);

  if (label) {
    const labelEl = document.createElement('span');
    labelEl.textContent = label;
    labelEl.style.cssText =
      'font-size:var(--qpm-font-body);color:var(--qpm-text);' +
      'font-family:var(--qpm-font);';
    root.appendChild(labelEl);
  }

  function applyState(): void {
    track.setAttribute('aria-checked', String(state));
    if (state) {
      track.style.background = 'var(--qpm-accent)';
      knob.style.background = '#fff';
      knob.style.left = `${dims.travel + 2}px`;
    } else {
      track.style.background = 'var(--qpm-surface-3)';
      knob.style.background = 'var(--qpm-text-muted)';
      knob.style.left = '2px';
    }
  }

  applyState();

  track.addEventListener('click', (e) => {
    e.preventDefault();
    if (disabled) return;
    state = !state;
    applyState();
    onChange?.(state);
  });

  function setChecked(value: boolean): void {
    state = value;
    applyState();
  }

  return { root, input: track, setChecked };
}
