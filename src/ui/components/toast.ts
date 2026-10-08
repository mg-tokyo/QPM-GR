import { ensureToastStyle } from '../core/panelStyles';
import { createButton } from './button';

/** A button under the message: a click closes the toast, then runs onClick once. */
export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  variant?: 'success' | 'error' | 'info';
  duration?: number;
  /** Wrap long text at this width (px); unset = no limit (callers before 2026-10-04 rely on that). */
  maxWidth?: number;
  action?: ToastAction;
}

const VARIANT_BORDER: Record<string, string> = {
  success: 'border-color:var(--qpm-positive);',
  error: 'border-color:var(--qpm-danger);',
  info: 'border-color:var(--qpm-accent);',
};

export function showToast(message: string, options: ToastOptions = {}): void {
  const { variant = 'info', duration = 2500, maxWidth, action } = options;

  ensureToastStyle();

  const existing = document.querySelector('.qpm-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'qpm-toast';
  toast.textContent = message;

  const borderStyle = VARIANT_BORDER[variant] ?? VARIANT_BORDER.info;
  toast.style.cssText +=
    `${borderStyle}font-family:var(--qpm-font);`;
  if (maxWidth !== undefined) toast.style.maxWidth = `${maxWidth}px`;
  if (action) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;justify-content:flex-end;margin-top:8px;';
    row.appendChild(createButton(action.label, {
      variant: 'primary',
      size: 'sm',
      onClick: () => {
        if (!toast.isConnected) return;
        toast.remove();
        action.onClick();
      },
    }));
    toast.appendChild(row);
  }

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.transition = 'opacity 0.3s ease';
    toast.style.opacity = '0';
    setTimeout(() => {
      try { toast.remove(); } catch { /* already removed */ }
    }, 300);
  }, duration);
}
