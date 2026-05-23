import { createButton } from './button';

export interface ConfirmDialogOptions {
  title: string;
  message: string | HTMLElement;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'danger';
}

export function showConfirmDialog(options: ConfirmDialogOptions): Promise<boolean> {
  const {
    title,
    message,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    variant = 'default',
  } = options;

  return new Promise<boolean>((resolve) => {
    let settled = false;

    function close(accepted: boolean): void {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKeyDown, true);
      try { overlay.remove(); } catch { /* already removed */ }
      resolve(accepted);
    }

    // Overlay
    const overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:2147483647;' +
      'background:rgba(0,0,0,0.5);' +
      'display:flex;align-items:center;justify-content:center;' +
      'font-family:var(--qpm-font);';
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(false);
    });

    // Card
    const card = document.createElement('div');
    card.style.cssText =
      'background:var(--qpm-surface-window);' +
      'border-radius:var(--qpm-radius-lg);' +
      'box-shadow:var(--qpm-shadow);' +
      'border:1px solid var(--qpm-border);' +
      'padding:var(--qpm-space-7);' +
      'min-width:280px;max-width:400px;' +
      'display:flex;flex-direction:column;gap:var(--qpm-space-5);';

    // Title
    const titleEl = document.createElement('div');
    titleEl.textContent = title;
    titleEl.style.cssText =
      'font-size:var(--qpm-font-subtitle);' +
      'font-weight:var(--qpm-weight-bold);' +
      'color:var(--qpm-text);';
    card.appendChild(titleEl);

    // Message
    if (typeof message === 'string') {
      const msgEl = document.createElement('div');
      msgEl.textContent = message;
      msgEl.style.cssText =
        'font-size:var(--qpm-font-body);color:var(--qpm-text-muted);line-height:1.5;';
      card.appendChild(msgEl);
    } else {
      card.appendChild(message);
    }

    // Button row
    const btnRow = document.createElement('div');
    btnRow.style.cssText =
      'display:flex;justify-content:flex-end;gap:var(--qpm-space-4);';

    const cancelBtn = createButton(cancelLabel, {
      variant: 'secondary',
      onClick: () => close(false),
    });

    const confirmBtn = createButton(confirmLabel, {
      variant: variant === 'danger' ? 'danger' : 'primary',
      onClick: () => close(true),
    });

    btnRow.append(cancelBtn, confirmBtn);
    card.appendChild(btnRow);

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    // Keyboard support
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault();
        close(false);
      }
    }
    document.addEventListener('keydown', onKeyDown, true);

    // Focus confirm button
    confirmBtn.focus();
  });
}
