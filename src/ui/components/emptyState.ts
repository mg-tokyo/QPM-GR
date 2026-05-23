export interface EmptyStateOptions {
  icon?: string;
  spriteKey?: string;
}

export function createEmptyState(message: string, _options: EmptyStateOptions = {}): HTMLElement {
  const container = document.createElement('div');
  container.style.cssText =
    'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
    'gap:8px;padding:24px 16px;text-align:center;' +
    'border:1px dashed var(--qpm-border);border-radius:var(--qpm-radius-md);';

  const text = document.createElement('div');
  text.textContent = message;
  text.style.cssText =
    'font-size:var(--qpm-font-body);color:var(--qpm-text-muted);' +
    'font-family:var(--qpm-font);line-height:1.5;';
  container.appendChild(text);

  return container;
}
