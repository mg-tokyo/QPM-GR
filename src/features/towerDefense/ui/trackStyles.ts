const STYLE_ID = 'qpm-td-track-styles';

// Separate sheet from ui/styles.ts (650 lines, near the cap).
const CSS = `
.qpm-td-tracks-wrap {
  position: relative;
  display: inline-block;
}

.qpm-td-tracks-popover {
  position: absolute;
  top: calc(100% + var(--qpm-space-3));
  right: 0;
  width: 340px;
  max-height: 520px;
  overflow-y: auto;
  padding: var(--qpm-space-4);
  display: flex;
  flex-direction: column;
  gap: var(--qpm-space-3);
  background: var(--qpm-surface-window);
  border: 1px solid var(--qpm-border);
  border-radius: var(--qpm-radius-md);
  box-shadow: var(--qpm-shadow);
  z-index: 20;
  font-family: var(--qpm-font);
  color: var(--qpm-text);
}

.qpm-td-tracks-popover[hidden] { display: none; }

.qpm-td-tracks-title {
  font-size: var(--qpm-font-subtitle);
  font-weight: var(--qpm-weight-bold);
}

.qpm-td-tracks-hint {
  font-size: var(--qpm-font-caption);
  color: var(--qpm-text-muted);
}

.qpm-td-tracks-list {
  display: flex;
  flex-direction: column;
  gap: var(--qpm-space-2);
}

.qpm-td-track-row {
  display: flex;
  align-items: center;
  gap: var(--qpm-space-3);
  padding: var(--qpm-space-3);
  background: var(--qpm-surface-3);
  border: 1px solid var(--qpm-border);
  border-radius: var(--qpm-radius-sm);
  cursor: pointer;
  outline: none;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.qpm-td-track-row:hover,
.qpm-td-track-row:focus-visible {
  border-color: var(--qpm-accent-border);
}

.qpm-td-track-row--active {
  border-color: var(--qpm-accent);
  background: var(--qpm-accent-tint);
}

.qpm-td-tracks-popover--locked .qpm-td-track-row {
  cursor: default;
  opacity: 0.7;
}

.qpm-td-tracks-popover--locked .qpm-td-track-row:hover {
  border-color: var(--qpm-border);
}

.qpm-td-tracks-popover--locked .qpm-td-track-row--active {
  opacity: 1;
  border-color: var(--qpm-accent);
}

.qpm-td-track-thumb {
  flex-shrink: 0;
  width: 92px;
  height: auto;
  border-radius: 2px;
  display: block;
}

.qpm-td-track-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--qpm-space-1);
}

.qpm-td-track-head {
  display: flex;
  align-items: center;
  gap: var(--qpm-space-2);
}

.qpm-td-track-name {
  font-size: var(--qpm-font-body);
  font-weight: var(--qpm-weight-semibold);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.qpm-td-track-badge {
  padding: 1px var(--qpm-space-2);
  font-size: var(--qpm-font-xs);
  font-weight: var(--qpm-weight-semibold);
  color: var(--qpm-accent);
  background: var(--qpm-accent-tint);
  border: 1px solid var(--qpm-accent-border);
  border-radius: var(--qpm-radius-pill);
  white-space: nowrap;
}

.qpm-td-track-meta {
  display: flex;
  align-items: center;
  gap: var(--qpm-space-2);
  font-size: var(--qpm-font-caption);
  color: var(--qpm-text-muted);
  font-variant-numeric: tabular-nums;
}

.qpm-td-track-chip {
  padding: 0 var(--qpm-space-2);
  border-radius: var(--qpm-radius-pill);
  font-size: var(--qpm-font-xs);
  font-weight: var(--qpm-weight-semibold);
  border: 1px solid var(--qpm-border);
}

.qpm-td-track-chip--hard { color: var(--qpm-danger); border-color: var(--qpm-danger); }
.qpm-td-track-chip--normal { color: var(--qpm-info); border-color: var(--qpm-info); }
.qpm-td-track-chip--relaxed { color: var(--qpm-positive); border-color: var(--qpm-positive); }

.qpm-td-track-select-overlay {
  position: fixed;
  inset: 0;
  z-index: 10001;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--qpm-space-4);
  background: rgba(0, 0, 0, 0.65);
  font-family: var(--qpm-font);
  color: var(--qpm-text);
}

.qpm-td-track-select-panel {
  position: relative;
  width: min(720px, 100%);
  max-height: min(85vh, 720px);
  overflow-y: auto;
  padding: var(--qpm-space-5);
  display: flex;
  flex-direction: column;
  gap: var(--qpm-space-4);
  background: var(--qpm-surface-window);
  border: 1px solid var(--qpm-border);
  border-radius: var(--qpm-radius-md);
  box-shadow: var(--qpm-shadow);
}

.qpm-td-track-select-head {
  display: flex;
  flex-direction: column;
  gap: var(--qpm-space-1);
  padding-right: var(--qpm-space-6);
}

.qpm-td-track-select-title {
  font-size: var(--qpm-font-title);
  font-weight: var(--qpm-weight-bold);
}

.qpm-td-track-select-hint {
  font-size: var(--qpm-font-caption);
  color: var(--qpm-text-muted);
}

.qpm-td-track-select-close {
  position: absolute;
  top: var(--qpm-space-3);
  right: var(--qpm-space-3);
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--qpm-border);
  border-radius: var(--qpm-radius-sm);
  background: var(--qpm-surface-3);
  color: var(--qpm-text-muted);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
}

.qpm-td-track-select-close:hover {
  color: var(--qpm-text);
  border-color: var(--qpm-accent-border);
}

.qpm-td-track-select-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--qpm-space-3);
}

.qpm-td-track-select-card {
  display: flex;
  gap: var(--qpm-space-3);
  padding: var(--qpm-space-3);
  background: var(--qpm-surface-3);
  border: 1px solid var(--qpm-border);
  border-radius: var(--qpm-radius-sm);
  cursor: pointer;
  outline: none;
  transition: border-color 0.15s ease, transform 0.15s ease;
}

.qpm-td-track-select-card:hover,
.qpm-td-track-select-card:focus-visible {
  border-color: var(--qpm-accent-border);
  transform: translateY(-1px);
}

.qpm-td-track-select-card--recent {
  border-color: var(--qpm-accent);
}

.qpm-td-track-select-thumb {
  flex-shrink: 0;
  width: 140px;
  height: auto;
  border-radius: 2px;
  display: block;
}

.qpm-td-track-select-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--qpm-space-2);
  justify-content: center;
}

.qpm-td-track-select-name-row {
  display: flex;
  align-items: center;
  gap: var(--qpm-space-2);
}

.qpm-td-track-select-name {
  font-size: var(--qpm-font-subtitle);
  font-weight: var(--qpm-weight-bold);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.qpm-td-track-select-meta {
  display: flex;
  align-items: center;
  gap: var(--qpm-space-2);
  font-size: var(--qpm-font-caption);
  color: var(--qpm-text-muted);
  font-variant-numeric: tabular-nums;
}

.qpm-td-track-select-foot {
  display: flex;
  justify-content: flex-end;
  gap: var(--qpm-space-2);
}
`;

export function injectTrackStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
}

export function removeTrackStyles(): void {
  const el = document.getElementById(STYLE_ID);
  if (el) el.remove();
}
