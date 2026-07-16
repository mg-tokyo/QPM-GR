export const BUTTON_CSS = `.qpm-button {
    padding: 6px 10px;
    font-size: 12px;
    cursor: pointer;
    border: 1px solid var(--qpm-border);
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.06);
    color: var(--qpm-text);
    transition: background 0.2s ease, border-color 0.2s ease;
  }

  .qpm-button:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.12);
    border-color: var(--qpm-accent);
  }

  .qpm-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .qpm-button--accent {
    background: rgba(143, 130, 255, 0.24);
    border-color: var(--qpm-accent);
  }

  .qpm-button--positive {
    background: rgba(79, 209, 139, 0.28);
    border-color: rgba(79, 209, 139, 0.6);
  }

  .qpm-grid {
    display: grid;
    gap: 10px;
  }

  .qpm-grid--two {
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  }

  .qpm-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .qpm-input,
  .qpm-select {
    padding: var(--qpm-space-2) var(--qpm-space-4);
    border: 1px solid var(--qpm-border);
    border-radius: var(--qpm-radius-sm);
    background: var(--qpm-surface-3);
    color: var(--qpm-text);
    font-size: var(--qpm-font-body);
    font-family: var(--qpm-font);
    transition: border-color 0.2s ease, box-shadow 0.2s ease;
  }

  .qpm-input:focus,
  .qpm-select:focus {
    outline: none;
    border-color: var(--qpm-accent);
    box-shadow: 0 0 0 2px var(--qpm-accent-subtle);
  }

  .qpm-checkbox {
    accent-color: var(--qpm-accent);
  }

  .qpm-coming-grid {
    display: grid;
    gap: 10px;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  }

  .qpm-coming-card {
    background: var(--qpm-surface-3);
    border: 1px dashed rgba(143, 130, 255, 0.35);
    border-radius: 10px;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    color: var(--qpm-text-muted);
  }

  .qpm-coming-card strong {
    color: var(--qpm-text);
    font-size: 12px;
  }

  .qpm-coming-card span {
    color: var(--qpm-accent-strong);
    font-size: 11px;
    font-weight: 600;
  }

  .qpm-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 6px;
    border-radius: 999px;
    font-size: 10px;
    background: rgba(143, 130, 255, 0.22);
    color: var(--qpm-text);
    border: 1px solid rgba(143, 130, 255, 0.35);
  }`;
