export interface ProgressBarOptions {
  value: number;
  max: number;
  color?: string;
  gradient?: string;
  height?: number;
  label?: string;
  className?: string;
}

interface ProgressBarResult {
  root: HTMLElement;
  update: (value: number, max?: number) => void;
  setColor: (color: string) => void;
  setLabel: (label: string) => void;
}

export function createProgressBar(options: ProgressBarOptions): ProgressBarResult {
  const {
    value,
    max,
    color,
    gradient,
    height = 6,
    label,
    className,
  } = options;

  let currentValue = value;
  let currentMax = max;

  const root = document.createElement('div');
  if (className) root.className = className;
  root.style.cssText =
    'position:relative;width:100%;overflow:hidden;' +
    `height:${height}px;` +
    'background:var(--qpm-surface-3);' +
    'border-radius:var(--qpm-radius-pill);';

  const fill = document.createElement('div');
  fill.style.cssText =
    'height:100%;border-radius:inherit;' +
    'transition:width 0.3s ease;min-width:0;';
  applyFillColor(fill, color, gradient);
  applyWidth(fill, currentValue, currentMax);
  root.appendChild(fill);

  let labelEl: HTMLElement | null = null;
  if (label) {
    labelEl = createLabelEl(label);
    root.appendChild(labelEl);
    root.style.position = 'relative';
  }

  function update(newValue: number, newMax?: number): void {
    currentValue = newValue;
    if (newMax !== undefined) currentMax = newMax;
    applyWidth(fill, currentValue, currentMax);
  }

  function setColor(c: string): void {
    applyFillColor(fill, c, undefined);
  }

  function setLabel(l: string): void {
    if (!labelEl) {
      labelEl = createLabelEl(l);
      root.appendChild(labelEl);
    } else {
      labelEl.textContent = l;
    }
  }

  return { root, update, setColor, setLabel };
}

function applyWidth(fill: HTMLElement, value: number, max: number): void {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  fill.style.width = `${pct}%`;
}

function applyFillColor(fill: HTMLElement, color?: string, gradient?: string): void {
  if (gradient) {
    fill.style.background = gradient;
  } else if (color) {
    fill.style.background = color;
  } else {
    fill.style.background = 'var(--qpm-accent)';
  }
}

function createLabelEl(text: string): HTMLElement {
  const el = document.createElement('div');
  el.textContent = text;
  el.style.cssText =
    'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
    'font-size:var(--qpm-font-xs);color:var(--qpm-text);' +
    'font-family:var(--qpm-font);font-weight:var(--qpm-weight-semibold);' +
    'text-shadow:0 1px 2px rgba(0,0,0,0.5);pointer-events:none;';
  return el;
}
