export const SUPER_CLEANSE_STYLES = `
.qpm-super-cleanse {
  background: var(--qpm-surface-window);
  border: 1px solid var(--qpm-accent-border);
  border-radius: 9px;
  width: 200px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.55);
  z-index: 999990;
  font-family: var(--qpm-font);
  color: var(--qpm-text);
  user-select: none;
  overflow: hidden;
}
.qpm-super-cleanse__header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  cursor: grab;
  background: var(--qpm-accent-tint);
  border-bottom: 1px solid var(--qpm-accent-subtle);
}
.qpm-super-cleanse__header:active { cursor: grabbing; }
.qpm-super-cleanse__header-icon {
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.qpm-super-cleanse__header-icon canvas,
.qpm-super-cleanse__header-icon img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.qpm-super-cleanse__title {
  flex: 1;
  font-size: var(--qpm-font-body);
  font-weight: var(--qpm-weight-semibold);
  color: var(--qpm-text);
  letter-spacing: 0.2px;
}
.qpm-super-cleanse__close {
  background: none;
  border: none;
  color: var(--qpm-text-muted);
  font-size: var(--qpm-font-subtitle);
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
}
.qpm-super-cleanse__close:hover { color: var(--qpm-text); }

.qpm-super-cleanse__body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
}
.qpm-super-cleanse__toggle {
  display: block;
  width: 100%;
  padding: 12px 8px;
  font-family: var(--qpm-font);
  font-size: var(--qpm-font-body);
  font-weight: var(--qpm-weight-bold);
  text-align: center;
  border-radius: 8px;
  border: 1px solid var(--qpm-border);
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
  letter-spacing: 0.4px;
}
.qpm-super-cleanse__toggle--on {
  background: var(--qpm-positive);
  color: var(--qpm-surface-1);
  border-color: var(--qpm-positive);
}
.qpm-super-cleanse__toggle--off {
  background: var(--qpm-surface-2);
  color: var(--qpm-text);
}
.qpm-super-cleanse__toggle--off:hover {
  background: var(--qpm-surface-3);
}
.qpm-super-cleanse__caption {
  padding: 0 4px;
  font-size: var(--qpm-font-caption);
  color: var(--qpm-text-muted);
  text-align: center;
  line-height: 1.3;
}
.qpm-super-cleanse__slot-preview {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 4px;
  padding: 2px 0;
}
.qpm-super-cleanse__slot-preview-item {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  background: var(--qpm-surface-2);
  border: 1px solid var(--qpm-border);
}
.qpm-super-cleanse__slot-preview-item canvas,
.qpm-super-cleanse__slot-preview-item img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

/* Full window */
.qpm-super-cleanse__wroot {
  font-family: var(--qpm-font);
  color: var(--qpm-text);
  background: var(--qpm-surface-window);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.qpm-super-cleanse__section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.qpm-super-cleanse__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.qpm-super-cleanse__chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 9999px;
  border: 1px solid var(--qpm-border);
  background: var(--qpm-surface-2);
  color: var(--qpm-text-muted);
  font-family: var(--qpm-font);
  font-size: var(--qpm-font-caption);
  cursor: pointer;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
}
.qpm-super-cleanse__chip:hover {
  background: var(--qpm-surface-3);
  color: var(--qpm-text);
}
.qpm-super-cleanse__chip--on {
  background: var(--qpm-accent-tint);
  color: var(--qpm-text);
  border-color: var(--qpm-accent);
}
.qpm-super-cleanse__chip-icon {
  width: 14px;
  height: 14px;
  image-rendering: pixelated;
  object-fit: contain;
}
`;

let injected = false;
export function injectSuperCleanseStyles(): void {
  if (injected) return;
  injected = true;
  const el = document.createElement('style');
  el.id = 'qpm-super-cleanse-styles';
  el.textContent = SUPER_CLEANSE_STYLES;
  document.head.appendChild(el);
}
