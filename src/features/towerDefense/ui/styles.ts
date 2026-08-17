const STYLE_ID = 'qpm-td-styles';

const CSS = `
.qpm-td-root {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  pointer-events: none;
  font-family: var(--qpm-font);
  color: var(--qpm-text);
}

.qpm-td-root > * {
  pointer-events: auto;
}

.qpm-td-hud {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  gap: var(--qpm-space-5);
  padding: var(--qpm-space-4) var(--qpm-space-6);
  background: var(--qpm-surface-2);
  border-bottom: 1px solid var(--qpm-border);
}

.qpm-td-hud-stat {
  display: inline-flex;
  align-items: center;
  gap: var(--qpm-space-2);
  font-size: var(--qpm-font-subtitle);
  font-weight: var(--qpm-weight-semibold);
}

.qpm-td-hud-stat-label {
  font-size: var(--qpm-font-caption);
  font-weight: var(--qpm-weight-medium);
  color: var(--qpm-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.qpm-td-hud-stat-value--cash { color: var(--qpm-gold); }
.qpm-td-hud-stat-value--lives { color: var(--qpm-positive); }
.qpm-td-hud-stat-value--lives-low { color: var(--qpm-danger); }

.qpm-td-hud-spacer { flex: 1; }

.qpm-td-hud-speeds {
  display: inline-flex;
  gap: var(--qpm-space-2);
  align-items: center;
}

.qpm-td-speed-btn {
  min-width: 32px;
  padding: var(--qpm-space-2) var(--qpm-space-4);
  font-family: var(--qpm-font);
  font-size: var(--qpm-font-body);
  font-weight: var(--qpm-weight-semibold);
  color: var(--qpm-text-muted);
  background: var(--qpm-surface-3);
  border: 1px solid var(--qpm-border);
  border-radius: var(--qpm-radius-sm);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}

.qpm-td-speed-btn:hover:not(:disabled) {
  background: var(--qpm-accent-subtle);
  color: var(--qpm-text);
}

.qpm-td-speed-btn.qpm-td-active {
  background: var(--qpm-accent);
  color: #fff;
  border-color: var(--qpm-accent);
}

.qpm-td-speed-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.qpm-td-bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: stretch;
  gap: var(--qpm-space-4);
  padding: var(--qpm-space-5) var(--qpm-space-6);
  background: var(--qpm-surface-2);
  border-top: 1px solid var(--qpm-border);
}

.qpm-td-tower-btn {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: var(--qpm-space-1);
  min-width: 88px;
  padding: var(--qpm-space-2) var(--qpm-space-3);
  font-family: var(--qpm-font);
  color: var(--qpm-text);
  background: var(--qpm-surface-3);
  border: 1px solid var(--qpm-border);
  border-radius: var(--qpm-radius-md);
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, opacity 0.15s ease;
}

.qpm-td-tower-btn:hover:not(:disabled) {
  background: var(--qpm-accent-subtle);
  border-color: var(--qpm-accent-focus);
}

.qpm-td-tower-btn.qpm-td-active {
  border-color: var(--qpm-accent);
  background: var(--qpm-accent-subtle);
}

.qpm-td-tower-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.qpm-td-tower-icon {
  width: 64px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.qpm-td-tower-icon-canvas {
  display: block;
}

.qpm-td-tower-name {
  font-size: var(--qpm-font-caption);
  font-weight: var(--qpm-weight-semibold);
  text-align: center;
  line-height: 1.1;
}

.qpm-td-tower-cost {
  display: inline-flex;
  align-items: center;
  gap: var(--qpm-space-1);
  font-size: var(--qpm-font-caption);
  line-height: 1.1;
  color: var(--qpm-gold);
  font-weight: var(--qpm-weight-semibold);
}

.qpm-td-tower-cost-icon {
  width: 12px;
  height: 12px;
}

.qpm-td-tower-btn {
  position: relative;
}

.qpm-td-tower-tip {
  position: absolute;
  left: 50%;
  bottom: calc(100% + var(--qpm-space-3));
  transform: translateX(-50%);
  min-width: 220px;
  max-width: 280px;
  padding: var(--qpm-space-4);
  display: none;
  flex-direction: column;
  gap: var(--qpm-space-3);
  background: var(--qpm-surface-window);
  border: 1px solid var(--qpm-border);
  border-radius: var(--qpm-radius-md);
  box-shadow: var(--qpm-shadow);
  pointer-events: none;
  z-index: 10;
  text-align: left;
  color: var(--qpm-text);
  white-space: normal;
}

.qpm-td-tower-btn:hover .qpm-td-tower-tip,
.qpm-td-tower-btn:focus-visible .qpm-td-tower-tip {
  display: flex;
}

.qpm-td-tip-title {
  font-size: var(--qpm-font-subtitle);
  font-weight: var(--qpm-weight-bold);
  color: var(--qpm-text);
}

.qpm-td-tip-desc {
  font-size: var(--qpm-font-caption);
  color: var(--qpm-text-muted);
  line-height: 1.4;
}

.qpm-td-tip-stats {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--qpm-space-1) var(--qpm-space-3);
  font-size: var(--qpm-font-caption);
}

.qpm-td-tip-stat-label {
  color: var(--qpm-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: var(--qpm-weight-medium);
}

.qpm-td-tip-stat-value {
  color: var(--qpm-text);
  font-variant-numeric: tabular-nums;
  font-weight: var(--qpm-weight-semibold);
}

.qpm-td-tip-cost {
  color: var(--qpm-gold);
  font-weight: var(--qpm-weight-bold);
}

.qpm-td-bar-spacer { flex: 1; }

.qpm-td-next-round {
  min-width: 160px;
  padding: var(--qpm-space-4) var(--qpm-space-6);
  font-family: var(--qpm-font);
  font-size: var(--qpm-font-subtitle);
  font-weight: var(--qpm-weight-bold);
  color: #fff;
  background: var(--qpm-accent);
  border: 1px solid var(--qpm-accent);
  border-radius: var(--qpm-radius-md);
  cursor: pointer;
  transition: background 0.15s ease;
}

.qpm-td-next-round:hover:not(:disabled) {
  background: var(--qpm-accent-hover);
}

.qpm-td-next-round[hidden] { display: none; }

.qpm-td-tower-panel {
  position: absolute;
  top: 64px;
  right: var(--qpm-space-5);
  width: 260px;
  padding: var(--qpm-space-5);
  display: flex;
  flex-direction: column;
  gap: var(--qpm-space-4);
  background: var(--qpm-surface-2);
  border: 1px solid var(--qpm-border);
  border-radius: var(--qpm-radius-md);
}

.qpm-td-tower-panel[hidden] { display: none; }

.qpm-td-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--qpm-space-3);
}

.qpm-td-panel-title {
  font-size: var(--qpm-font-subtitle);
  font-weight: var(--qpm-weight-semibold);
  color: var(--qpm-text);
}

.qpm-td-panel-close {
  padding: var(--qpm-space-1) var(--qpm-space-3);
  font-family: var(--qpm-font);
  font-size: var(--qpm-font-body);
  color: var(--qpm-text-muted);
  background: transparent;
  border: none;
  border-radius: var(--qpm-radius-sm);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.qpm-td-panel-close:hover {
  background: var(--qpm-surface-3);
  color: var(--qpm-text);
}

.qpm-td-panel-stats {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--qpm-space-2) var(--qpm-space-4);
  padding: var(--qpm-space-4);
  background: var(--qpm-surface-3);
  border-radius: var(--qpm-radius-sm);
}

.qpm-td-panel-stat-label {
  font-size: var(--qpm-font-caption);
  font-weight: var(--qpm-weight-medium);
  color: var(--qpm-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.qpm-td-panel-stat-value {
  font-size: var(--qpm-font-body);
  font-weight: var(--qpm-weight-semibold);
  color: var(--qpm-text);
  font-variant-numeric: tabular-nums;
}

.qpm-td-panel-priority {
  display: flex;
  align-items: center;
  gap: var(--qpm-space-2);
  padding: var(--qpm-space-2) var(--qpm-space-3);
  background: var(--qpm-surface-3);
  border-radius: var(--qpm-radius-sm);
}

.qpm-td-panel-priority-value {
  flex: 1;
  text-align: center;
  font-size: var(--qpm-font-body);
  font-weight: var(--qpm-weight-semibold);
  color: var(--qpm-text);
}

.qpm-td-panel-priority-arrow {
  min-width: 24px;
  padding: var(--qpm-space-1) var(--qpm-space-3);
  font-family: var(--qpm-font);
  font-size: var(--qpm-font-body);
  color: var(--qpm-text);
  background: transparent;
  border: 1px solid var(--qpm-border);
  border-radius: var(--qpm-radius-sm);
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.qpm-td-panel-priority-arrow:hover {
  background: var(--qpm-accent-subtle);
  border-color: var(--qpm-accent-focus);
}

.qpm-td-panel-upgrade {
  display: flex;
  flex-direction: column;
  gap: var(--qpm-space-2);
  padding: var(--qpm-space-4);
  background: var(--qpm-surface-3);
  border-radius: var(--qpm-radius-sm);
}

.qpm-td-panel-upgrade-header {
  font-size: var(--qpm-font-caption);
  font-weight: var(--qpm-weight-medium);
  color: var(--qpm-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.qpm-td-panel-upgrade-current {
  font-size: var(--qpm-font-body);
  color: var(--qpm-text);
}

.qpm-td-panel-upgrade-btn {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--qpm-space-1);
  padding: var(--qpm-space-3) var(--qpm-space-4);
  font-family: var(--qpm-font);
  font-size: var(--qpm-font-body);
  font-weight: var(--qpm-weight-semibold);
  color: var(--qpm-text);
  background: var(--qpm-surface-2);
  border: 1px solid var(--qpm-border);
  border-radius: var(--qpm-radius-sm);
  cursor: pointer;
  text-align: left;
  transition: background 0.15s ease, border-color 0.15s ease, opacity 0.15s ease;
}

.qpm-td-panel-upgrade-btn:hover:not(:disabled) {
  background: var(--qpm-accent-subtle);
  border-color: var(--qpm-accent-focus);
}

.qpm-td-panel-upgrade-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.qpm-td-panel-upgrade-btn.qpm-td-panel-upgrade-locked {
  opacity: 0.5;
  cursor: not-allowed;
  background: var(--qpm-surface-3);
  color: var(--qpm-text-muted);
}

.qpm-td-panel-upgrade-cost {
  font-size: var(--qpm-font-caption);
  font-weight: var(--qpm-weight-semibold);
  color: var(--qpm-gold);
}

.qpm-td-panel-upgrade-maxed {
  padding: var(--qpm-space-3) var(--qpm-space-4);
  font-size: var(--qpm-font-caption);
  text-align: center;
  color: var(--qpm-text-muted);
  background: var(--qpm-surface-2);
  border: 1px solid var(--qpm-border);
  border-radius: var(--qpm-radius-sm);
}

.qpm-td-panel-sell {
  padding: var(--qpm-space-3) var(--qpm-space-4);
  font-family: var(--qpm-font);
  font-size: var(--qpm-font-body);
  font-weight: var(--qpm-weight-semibold);
  color: #fff;
  background: var(--qpm-danger);
  border: 1px solid var(--qpm-danger);
  border-radius: var(--qpm-radius-sm);
  cursor: pointer;
  transition: opacity 0.15s ease;
}

.qpm-td-panel-sell:hover { opacity: 0.85; }

.qpm-td-next-round-panel {
  position: absolute;
  top: 64px;
  left: var(--qpm-space-5);
  min-width: 200px;
  max-width: 260px;
  padding: var(--qpm-space-4);
  display: flex;
  flex-direction: column;
  gap: var(--qpm-space-3);
  background: var(--qpm-surface-2);
  border: 1px solid var(--qpm-border);
  border-radius: var(--qpm-radius-md);
}

.qpm-td-next-round-panel[hidden] { display: none; }

.qpm-td-next-round-title {
  font-size: var(--qpm-font-caption);
  font-weight: var(--qpm-weight-medium);
  color: var(--qpm-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.qpm-td-next-round-list {
  display: flex;
  flex-direction: column;
  gap: var(--qpm-space-2);
}

.qpm-td-next-round-row {
  display: flex;
  align-items: center;
  gap: var(--qpm-space-3);
  font-size: var(--qpm-font-body);
  color: var(--qpm-text);
}

.qpm-td-next-round-icon {
  width: 24px;
  height: 24px;
  display: block;
  flex-shrink: 0;
}

.qpm-td-next-round-name {
  flex: 1;
  font-weight: var(--qpm-weight-semibold);
}

.qpm-td-next-round-count {
  color: var(--qpm-text-muted);
  font-variant-numeric: tabular-nums;
}

.qpm-td-gameover-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(6px);
}

.qpm-td-gameover-overlay[hidden] { display: none; }

.qpm-td-gameover-card {
  min-width: 320px;
  max-width: 420px;
  padding: var(--qpm-space-7);
  display: flex;
  flex-direction: column;
  gap: var(--qpm-space-5);
  background: var(--qpm-surface-window);
  border: 1px solid var(--qpm-border);
  border-radius: var(--qpm-radius-lg);
  box-shadow: var(--qpm-shadow);
}

.qpm-td-gameover-title {
  font-size: var(--qpm-font-title);
  font-weight: var(--qpm-weight-bold);
  color: var(--qpm-text);
  text-align: center;
}

.qpm-td-gameover-body {
  font-size: var(--qpm-font-body);
  color: var(--qpm-text-muted);
  line-height: 1.5;
  text-align: center;
}

.qpm-td-gameover-buttons {
  display: flex;
  justify-content: center;
  gap: var(--qpm-space-4);
}

.qpm-td-enemies-wrap {
  position: relative;
  display: inline-block;
}

.qpm-td-enemies-popover {
  position: absolute;
  top: calc(100% + var(--qpm-space-3));
  right: 0;
  min-width: 260px;
  max-width: 320px;
  max-height: 480px;
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
}

.qpm-td-enemies-popover[hidden] { display: none; }

.qpm-td-enemies-title {
  font-size: var(--qpm-font-subtitle);
  font-weight: var(--qpm-weight-bold);
  color: var(--qpm-text);
}

.qpm-td-enemies-list {
  display: flex;
  flex-direction: column;
  gap: var(--qpm-space-3);
}

.qpm-td-enemies-row {
  display: flex;
  align-items: flex-start;
  gap: var(--qpm-space-3);
  padding: var(--qpm-space-3);
  background: var(--qpm-surface-3);
  border-radius: var(--qpm-radius-sm);
}

.qpm-td-enemies-icon {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.qpm-td-enemies-icon-canvas {
  max-width: 40px;
  max-height: 40px;
  display: block;
}

.qpm-td-enemies-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--qpm-space-1);
}

.qpm-td-enemies-name {
  font-size: var(--qpm-font-body);
  font-weight: var(--qpm-weight-semibold);
  color: var(--qpm-text);
}

.qpm-td-enemies-stats {
  font-size: var(--qpm-font-caption);
  color: var(--qpm-text-muted);
  font-variant-numeric: tabular-nums;
}

.qpm-td-enemies-meta {
  font-size: var(--qpm-font-caption);
  color: var(--qpm-text-muted);
  font-style: italic;
}
`;

export function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
}

export function removeStyles(): void {
  const el = document.getElementById(STYLE_ID);
  if (el) el.remove();
}
