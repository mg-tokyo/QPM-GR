export interface ButtonOptions {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'default' | 'sm';
  pill?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}

interface VariantStyle {
  base: string;
  hover: string;
  active: string;
}

type ButtonVariant = NonNullable<ButtonOptions['variant']>;
type ButtonSize = NonNullable<ButtonOptions['size']>;

const VARIANT_STYLES: Record<ButtonVariant, VariantStyle> = {
  primary: {
    base: 'background:var(--qpm-accent);color:#fff;border:none;',
    hover: 'background:#a396ff;',
    active: 'background:#7a6de6;',
  },
  secondary: {
    base: 'background:var(--qpm-surface-3);color:var(--qpm-text);border:1px solid var(--qpm-accent-border);',
    hover: 'background:rgba(52,58,78,1);border-color:var(--qpm-accent-focus);',
    active: 'background:rgba(42,48,68,1);',
  },
  danger: {
    base: 'background:var(--qpm-danger);color:#fff;border:none;',
    hover: 'background:#e53935;',
    active: 'background:#c62828;',
  },
  ghost: {
    base: 'background:transparent;color:var(--qpm-accent);border:none;',
    hover: 'background:var(--qpm-accent-tint);',
    active: 'background:var(--qpm-accent-subtle);',
  },
};

const SIZE_STYLES: Record<ButtonSize, string> = {
  default: 'padding:6px 12px;font-size:var(--qpm-font-body);',
  sm: 'padding:4px 8px;font-size:var(--qpm-font-caption);',
};

export function createButton(label: string, options: ButtonOptions = {}): HTMLButtonElement {
  const {
    variant = 'secondary',
    size = 'default',
    pill = false,
    onClick,
    disabled = false,
    className,
  } = options;

  const btn = document.createElement('button');
  btn.textContent = label;
  if (className) btn.className = className;

  const vs = VARIANT_STYLES[variant];
  const sizeStyle = SIZE_STYLES[size];
  const radius = pill ? 'border-radius:var(--qpm-radius-pill);' : 'border-radius:var(--qpm-radius-sm);';
  const baseStyle =
    `${vs.base}${sizeStyle}${radius}` +
    'font-family:var(--qpm-font);font-weight:var(--qpm-weight-semibold);' +
    'cursor:pointer;transition:background 0.15s ease,border-color 0.15s ease,opacity 0.15s ease;' +
    'line-height:1.4;display:inline-flex;align-items:center;justify-content:center;gap:4px;';

  btn.style.cssText = baseStyle;
  btn.disabled = disabled;

  if (disabled) {
    btn.style.opacity = '0.5';
    btn.style.cursor = 'not-allowed';
  }

  btn.addEventListener('mouseover', () => {
    if (!btn.disabled) applyHover(btn, vs, baseStyle);
  });
  btn.addEventListener('mouseout', () => {
    if (!btn.disabled) btn.style.cssText = baseStyle;
  });
  btn.addEventListener('mousedown', () => {
    if (!btn.disabled) applyActive(btn, vs, baseStyle);
  });
  btn.addEventListener('mouseup', () => {
    if (!btn.disabled) applyHover(btn, vs, baseStyle);
  });

  if (onClick) btn.addEventListener('click', onClick);

  return btn;
}

function applyHover(
  btn: HTMLButtonElement,
  vs: { base: string; hover: string },
  baseStyle: string,
): void {
  btn.style.cssText = baseStyle + vs.hover;
}

function applyActive(
  btn: HTMLButtonElement,
  vs: { base: string; active: string },
  baseStyle: string,
): void {
  btn.style.cssText = baseStyle + vs.active;
}
