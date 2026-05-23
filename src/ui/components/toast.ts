import { ensureToastStyle } from '../panelStyles';

export interface ToastOptions {
  variant?: 'success' | 'error' | 'info';
  duration?: number;
}

const VARIANT_BORDER: Record<string, string> = {
  success: 'border-color:var(--qpm-positive);',
  error: 'border-color:var(--qpm-danger);',
  info: 'border-color:var(--qpm-accent);',
};

export function showToast(message: string, options: ToastOptions = {}): void {
  const { variant = 'info', duration = 2500 } = options;

  ensureToastStyle();

  const existing = document.querySelector('.qpm-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'qpm-toast';
  toast.textContent = message;

  const borderStyle = VARIANT_BORDER[variant] ?? VARIANT_BORDER.info;
  toast.style.cssText +=
    `${borderStyle}font-family:var(--qpm-font);`;

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.transition = 'opacity 0.3s ease';
    toast.style.opacity = '0';
    setTimeout(() => {
      try { toast.remove(); } catch { /* already removed */ }
    }, 300);
  }, duration);
}
