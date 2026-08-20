const STYLE_ID = 'qpm-td-saves-styles';

// Separate sheet from ui/styles.ts (650 lines, near the cap) and because the
// launch-mode overlay mounts before injectStyles() runs.
const CSS = `
.qpm-td-saves-overlay {
  position: fixed;
  inset: 0;
  z-index: 2147483100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(6px);
  font-family: var(--qpm-font);
  color: var(--qpm-text);
  pointer-events: auto;
}

.qpm-td-saves-panel {
  position: relative;
  width: min(680px, calc(100vw - 32px));
  max-height: calc(100vh - 32px);
  display: flex;
  flex-direction: column;
  gap: var(--qpm-space-5);
  padding: var(--qpm-space-7);
  background: var(--qpm-surface-window);
  border: 1px solid var(--qpm-border);
  border-radius: var(--qpm-radius-lg);
  box-shadow: var(--qpm-shadow);
  overflow: hidden;
}

.qpm-td-saves-head {
  display: flex;
  flex-direction: column;
  gap: var(--qpm-space-2);
  padding-right: var(--qpm-space-7);
}

.qpm-td-saves-title {
  font-size: var(--qpm-font-title);
  font-weight: var(--qpm-weight-bold);
  letter-spacing: 0.2px;
}

.qpm-td-saves-hint {
  font-size: var(--qpm-font-body);
  color: var(--qpm-text-muted);
  line-height: 1.5;
}

.qpm-td-saves-close {
  position: absolute;
  top: var(--qpm-space-4);
  right: var(--qpm-space-4);
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--qpm-radius-sm);
  background: transparent;
  color: var(--qpm-text-muted);
  font-family: var(--qpm-font);
  font-size: var(--qpm-font-title);
  line-height: 1;
  cursor: pointer;
  transition: color 0.15s ease, background 0.15s ease, border-color 0.15s ease;
}

.qpm-td-saves-close:hover,
.qpm-td-saves-close:focus-visible {
  color: var(--qpm-text);
  background: var(--qpm-accent-subtle);
  border-color: var(--qpm-accent-border);
  outline: none;
}

.qpm-td-saves-body {
  display: flex;
  flex-direction: column;
  gap: var(--qpm-space-5);
  overflow-y: auto;
  padding-right: var(--qpm-space-3);
  margin-right: calc(var(--qpm-space-3) * -1);
}

.qpm-td-saves-auto[hidden] { display: none; }

.qpm-td-saves-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: var(--qpm-space-3);
}

.qpm-td-saves-more {
  display: flex;
  justify-content: center;
  margin-top: var(--qpm-space-2);
}

.qpm-td-saves-foot {
  display: flex;
  justify-content: flex-end;
  gap: var(--qpm-space-4);
}

.qpm-td-save-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--qpm-space-3);
  padding: var(--qpm-space-4);
  background: var(--qpm-surface-3);
  border: 1px solid var(--qpm-border);
  border-radius: var(--qpm-radius-md);
  outline: none;
  transition: border-color 0.15s ease, background 0.15s ease, transform 0.15s ease;
}

/* Hero autosave card — subtle accent-tint background + always-on accent border
   so "Continue" reads as the primary action, without competing with hover. */
.qpm-td-save-card--wide {
  flex-direction: row;
  align-items: center;
  gap: var(--qpm-space-5);
  padding: var(--qpm-space-5);
  background: var(--qpm-accent-tint);
  border-color: var(--qpm-accent-border);
}

.qpm-td-save-card--wide .qpm-td-save-card-meta { flex: 1; }

.qpm-td-save-card--actionable { cursor: pointer; }

.qpm-td-save-card--actionable:hover,
.qpm-td-save-card--actionable:focus-visible {
  border-color: var(--qpm-accent-focus);
  background: var(--qpm-accent-subtle);
}

.qpm-td-save-card--wide.qpm-td-save-card--actionable:hover,
.qpm-td-save-card--wide.qpm-td-save-card--actionable:focus-visible {
  background: var(--qpm-accent-subtle);
  border-color: var(--qpm-accent-emphasis);
}

.qpm-td-save-card--active { border-color: var(--qpm-accent-focus); }

.qpm-td-save-card--empty {
  background: transparent;
  border-style: dashed;
  border-color: var(--qpm-accent-border);
}

.qpm-td-save-card--empty:not(.qpm-td-save-card--actionable) { opacity: 0.6; }

.qpm-td-save-card-head {
  display: flex;
  align-items: center;
  gap: var(--qpm-space-2);
  min-height: 22px;
}

.qpm-td-save-card-label {
  flex: 1;
  font-size: var(--qpm-font-caption);
  font-weight: var(--qpm-weight-semibold);
  letter-spacing: 0.5px;
  text-transform: uppercase;
  color: var(--qpm-text-muted);
}

.qpm-td-save-badge {
  padding: 1px var(--qpm-space-2);
  font-size: var(--qpm-font-xs);
  font-weight: var(--qpm-weight-semibold);
  color: var(--qpm-accent);
  background: var(--qpm-accent-tint);
  border: 1px solid var(--qpm-accent-border);
  border-radius: var(--qpm-radius-pill);
  white-space: nowrap;
}

.qpm-td-save-delete {
  position: absolute;
  top: var(--qpm-space-3);
  right: var(--qpm-space-3);
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--qpm-radius-sm);
  background: transparent;
  color: var(--qpm-text-muted);
  font-family: var(--qpm-font);
  font-size: var(--qpm-font-subtitle);
  line-height: 1;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s ease, background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}

/* Reveal on card hover/focus so the delete affordance doesn't compete with
   the card's primary click target visually. */
.qpm-td-save-card:hover .qpm-td-save-delete,
.qpm-td-save-card:focus-within .qpm-td-save-delete { opacity: 0.75; }

.qpm-td-save-delete:hover,
.qpm-td-save-delete:focus-visible {
  opacity: 1;
  background: var(--qpm-danger);
  border-color: var(--qpm-danger);
  color: var(--qpm-text);
  outline: none;
}

.qpm-td-save-card-thumb {
  display: block;
  width: 100%;
  height: auto;
  border: 1px solid rgba(0, 0, 0, 0.35);
  border-radius: var(--qpm-radius-sm);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
}

.qpm-td-save-card--wide .qpm-td-save-card-thumb {
  width: 160px;
  flex-shrink: 0;
}

.qpm-td-save-card-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 23 / 12;
  border: 1px dashed var(--qpm-accent-border);
  border-radius: var(--qpm-radius-sm);
  font-size: var(--qpm-font-body);
  color: var(--qpm-accent);
  font-weight: var(--qpm-weight-semibold);
  letter-spacing: 0.3px;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

.qpm-td-save-card--actionable:hover .qpm-td-save-card-empty,
.qpm-td-save-card--actionable:focus-visible .qpm-td-save-card-empty {
  background: var(--qpm-accent-subtle);
  border-color: var(--qpm-accent-focus);
  color: var(--qpm-accent-hover);
}

.qpm-td-save-card-meta {
  display: flex;
  flex-direction: column;
  gap: var(--qpm-space-1);
}

.qpm-td-save-card-round {
  font-size: var(--qpm-font-body);
  font-weight: var(--qpm-weight-semibold);
}

.qpm-td-save-card-summary {
  font-size: var(--qpm-font-caption);
  color: var(--qpm-text-muted);
  font-variant-numeric: tabular-nums;
}

/* Match the in-game HUD stat colors (styles.ts:46-48). */
.qpm-td-save-card-cash { color: var(--qpm-gold); font-weight: var(--qpm-weight-semibold); }
.qpm-td-save-card-lives { color: var(--qpm-positive); font-weight: var(--qpm-weight-semibold); }
.qpm-td-save-card-lives--low { color: var(--qpm-danger); }

.qpm-td-save-card-foot {
  display: flex;
  justify-content: flex-end;
  margin-top: var(--qpm-space-1);
}
`;

export function injectSavesStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
}

export function removeSavesStyles(): void {
  const el = document.getElementById(STYLE_ID);
  if (el) el.remove();
}
