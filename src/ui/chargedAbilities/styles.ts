// All colours come from CSS vars in panelStyles.ts — no hex literals here.

export const CHARGED_ABILITIES_STYLES = `
.qpm-charged-abilities {
  background: var(--qpm-surface-window);
  border: 1px solid var(--qpm-accent-border);
  border-radius: 9px;
  width: 280px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.55);
  z-index: 999990;
  font-family: var(--qpm-font);
  color: var(--qpm-text);
  user-select: none;
  overflow: hidden;
}
.qpm-charged-abilities__header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  cursor: grab;
  background: var(--qpm-accent-tint);
  border-bottom: 1px solid var(--qpm-accent-subtle);
}
.qpm-charged-abilities__header:active { cursor: grabbing; }
.qpm-charged-abilities__title {
  flex: 1;
  font-size: var(--qpm-font-body);
  font-weight: var(--qpm-weight-semibold);
  color: var(--qpm-text);
  letter-spacing: 0.2px;
}
.qpm-charged-abilities__close {
  background: none;
  border: none;
  color: var(--qpm-text-muted);
  font-size: var(--qpm-font-subtitle);
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
}
.qpm-charged-abilities__close:hover { color: var(--qpm-text); }

.qpm-charged-abilities__body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  max-height: 70vh;
  overflow-y: auto;
}
.qpm-charged-abilities__group-label {
  font-size: var(--qpm-font-caption);
  font-weight: var(--qpm-weight-semibold);
  color: var(--qpm-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.6px;
  padding: 2px 4px;
}
.qpm-charged-abilities__empty {
  font-size: var(--qpm-font-caption);
  color: var(--qpm-text-muted);
  text-align: center;
  padding: 12px 8px;
  line-height: 1.4;
}

.qpm-charged-abilities__card {
  background: var(--qpm-surface-2);
  border: 1px solid var(--qpm-border);
  border-radius: 8px;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  position: relative;
}
.qpm-charged-abilities__card--ready { border-color: var(--qpm-positive); }
.qpm-charged-abilities__card--cooling { border-color: var(--qpm-warning); }
.qpm-charged-abilities__card--mounted {
  border-color: var(--qpm-accent);
  box-shadow: 0 0 0 1px var(--qpm-accent-emphasis), 0 0 12px var(--qpm-accent-tint);
}

.qpm-charged-abilities__card-collapsed {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--qpm-surface-2);
  border: 1px solid var(--qpm-border);
  border-radius: 8px;
  padding: 6px 8px;
  cursor: pointer;
  transition: background 0.12s;
}
.qpm-charged-abilities__card-collapsed:hover { background: var(--qpm-surface-3); }

.qpm-charged-abilities__icon {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  background: var(--qpm-accent-tint);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.qpm-charged-abilities__icon--lg {
  width: 32px;
  height: 32px;
}
.qpm-charged-abilities__icon-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  image-rendering: pixelated;
}

.qpm-charged-abilities__card-name {
  flex: 1;
  font-size: var(--qpm-font-body);
  color: var(--qpm-text);
  font-weight: var(--qpm-weight-semibold);
}
.qpm-charged-abilities__card-substate {
  font-size: var(--qpm-font-caption);
  color: var(--qpm-text-muted);
}
.qpm-charged-abilities__chevron {
  color: var(--qpm-text-muted);
  font-size: var(--qpm-font-body);
  flex-shrink: 0;
}

.qpm-charged-abilities__top-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.qpm-charged-abilities__id-block {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.qpm-charged-abilities__pet-name {
  font-size: var(--qpm-font-body);
  font-weight: var(--qpm-weight-semibold);
  color: var(--qpm-text);
}
.qpm-charged-abilities__ability-name {
  font-size: var(--qpm-font-caption);
  color: var(--qpm-text-muted);
}
.qpm-charged-abilities__in-range {
  font-size: var(--qpm-font-caption);
  color: var(--qpm-text);
  margin-top: 2px;
}
.qpm-charged-abilities__projection {
  text-align: right;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}
.qpm-charged-abilities__projection-label {
  font-size: var(--qpm-font-xs);
  color: var(--qpm-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.6px;
}
.qpm-charged-abilities__projection-value {
  font-size: var(--qpm-font-subtitle);
  font-weight: var(--qpm-weight-bold);
  line-height: 1;
}
.qpm-charged-abilities__projection-value--coin {
  color: var(--qpm-gold);
}
.qpm-charged-abilities__projection-value--capsule {
  color: var(--qpm-dawn);
}
.qpm-charged-abilities__projection-value {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.qpm-charged-abilities__projection-icon {
  width: 14px;
  height: 14px;
  image-rendering: pixelated;
  flex-shrink: 0;
}

.qpm-charged-abilities__species-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 8px;
  margin-top: 4px;
}
.qpm-charged-abilities__species-list--inline {
  margin-top: 0;
}
.qpm-charged-abilities__species-item {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: var(--qpm-font-caption);
  color: var(--qpm-text);
}
.qpm-charged-abilities__species-count {
  font-weight: var(--qpm-weight-semibold);
}
.qpm-charged-abilities__species-sprite {
  width: 18px;
  height: 18px;
  image-rendering: pixelated;
  object-fit: contain;
}
.qpm-charged-abilities__species-fallback {
  font-size: var(--qpm-font-caption);
  color: var(--qpm-text-muted);
}

.qpm-charged-abilities__optimal {
  display: flex;
  justify-content: flex-end;
  font-size: var(--qpm-font-xs);
}
.qpm-charged-abilities__optimal-partial {
  background: var(--qpm-warning);
  color: var(--qpm-surface-1);
  padding: 2px 6px;
  border-radius: 9999px;
  font-weight: var(--qpm-weight-semibold);
  cursor: help;
}
.qpm-charged-abilities__optimal-full {
  font-weight: var(--qpm-weight-bold);
  letter-spacing: 1px;
  animation: qpm-charged-abilities-shimmer 2.2s linear infinite;
}
.qpm-charged-abilities__optimal-full--coin {
  color: var(--qpm-positive);
}
.qpm-charged-abilities__optimal-full--capsule {
  color: var(--qpm-dawn);
}

.qpm-charged-abilities__tooltip {
  position: fixed;
  background: var(--qpm-surface-1);
  border: 1px solid var(--qpm-accent-border);
  border-radius: 6px;
  padding: 6px 8px;
  font-size: var(--qpm-font-caption);
  color: var(--qpm-text);
  z-index: 999991;
  pointer-events: none;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
  max-width: 240px;
}
.qpm-charged-abilities__tooltip-row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  line-height: 1.4;
}
.qpm-charged-abilities__tooltip-label {
  color: var(--qpm-text-muted);
}

.qpm-charged-abilities__mount-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  background: var(--qpm-surface-3);
  border: 1px solid var(--qpm-accent-border);
  border-radius: 6px;
  padding: 6px 8px;
  cursor: pointer;
  color: var(--qpm-text);
  font-size: var(--qpm-font-body);
  font-weight: var(--qpm-weight-semibold);
  transition: background 0.12s, border-color 0.12s;
}
.qpm-charged-abilities__mount-btn:hover {
  background: var(--qpm-accent-subtle);
  border-color: var(--qpm-accent);
}
.qpm-charged-abilities__mount-btn--dismount {
  border-color: var(--qpm-warning);
  color: var(--qpm-warning);
}
.qpm-charged-abilities__mount-btn--dismount:hover {
  background: var(--qpm-accent-subtle);
}
.qpm-charged-abilities__mount-icon {
  width: 14px;
  height: 14px;
  image-rendering: pixelated;
}

.qpm-charged-abilities__mounted-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--qpm-font-xs);
  color: var(--qpm-accent-hover);
  background: var(--qpm-accent-tint);
  border-radius: 9999px;
  padding: 2px 6px;
  font-weight: var(--qpm-weight-semibold);
}
.qpm-charged-abilities__mounted-dot {
  width: 6px;
  height: 6px;
  background: var(--qpm-accent);
  border-radius: 9999px;
  animation: qpm-charged-abilities-pulse 1.5s ease-in-out infinite;
}

.qpm-charged-abilities__would-hit {
  font-size: var(--qpm-font-caption);
  color: var(--qpm-text-muted);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 6px;
}
.qpm-charged-abilities__would-hit-label {
  font-style: italic;
}
.qpm-charged-abilities__would-hit-gain {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: var(--qpm-text);
  font-weight: var(--qpm-weight-semibold);
}

/* Charge bar */
.qpm-charged-abilities__charge {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--qpm-font-caption);
}
.qpm-charged-abilities__charge-track {
  flex: 1;
  height: 8px;
  background: var(--qpm-surface-3);
  border-radius: 9999px;
  overflow: hidden;
}
.qpm-charged-abilities__charge-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--qpm-accent-subtle), var(--qpm-accent));
  transition: width 0.4s linear;
}
.qpm-charged-abilities__charge-label {
  font-variant-numeric: tabular-nums;
  color: var(--qpm-text-muted);
  min-width: 48px;
  text-align: right;
}
.qpm-charged-abilities__charge--ready .qpm-charged-abilities__charge-label {
  color: var(--qpm-positive);
  font-weight: var(--qpm-weight-bold);
  letter-spacing: 0.4px;
  text-align: left;
  animation: qpm-charged-abilities-shimmer 1.8s linear infinite;
}

/* Direction widget */
.qpm-charged-abilities__direction {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--qpm-font-caption);
  color: var(--qpm-text);
}
.qpm-charged-abilities__direction-label {
  color: var(--qpm-text-muted);
}
.qpm-charged-abilities__direction-arrow {
  display: inline-block;
  font-size: 16px;
  line-height: 1;
  color: var(--qpm-accent);
  transform-origin: center;
}
.qpm-charged-abilities__direction-here {
  color: var(--qpm-positive);
  font-weight: var(--qpm-weight-semibold);
}

/* Full window — layout */
.qpm-charged-abilities__wroot {
  font-family: var(--qpm-font);
  color: var(--qpm-text);
  background: var(--qpm-surface-window);
}
.qpm-charged-abilities__wtoolbar {
  padding: 8px 12px 0 12px;
  display: flex;
  align-items: center;
  gap: 12px;
}
.qpm-charged-abilities__autotoggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--qpm-font-caption);
  color: var(--qpm-text-muted);
  cursor: pointer;
  user-select: none;
}
.qpm-charged-abilities__autotoggle:hover { color: var(--qpm-text); }
.qpm-charged-abilities__autotoggle-input {
  width: 12px;
  height: 12px;
  margin: 0;
  accent-color: var(--qpm-accent);
  cursor: pointer;
}
.qpm-charged-abilities__autotoggle-label {
  line-height: 1;
}

.qpm-charged-abilities__gtotals-slot {
  padding: 8px 12px 0 12px;
}
.qpm-charged-abilities__gtotals-row--unavailable {
  opacity: 0.55;
}
.qpm-charged-abilities__gtotals-need {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 6px;
}
.qpm-charged-abilities__gtotals-need-label {
  color: var(--qpm-danger);
  font-style: italic;
  font-size: var(--qpm-font-xs);
  font-weight: var(--qpm-weight-bold);
  letter-spacing: 0.6px;
  text-transform: uppercase;
  transform: rotate(-4deg);
  transform-origin: left center;
}
.qpm-charged-abilities__gtotals-need-sprite {
  image-rendering: pixelated;
  object-fit: contain;
}
.qpm-charged-abilities__gtotals-mutations {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  font-size: var(--qpm-font-caption);
}
.qpm-charged-abilities__gtotals {
  background: var(--qpm-surface-2);
  border: 1px solid var(--qpm-border);
  border-radius: 8px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.qpm-charged-abilities__gtotals-heading {
  font-size: var(--qpm-font-xs);
  font-weight: var(--qpm-weight-semibold);
  color: var(--qpm-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.6px;
}
.qpm-charged-abilities__gtotals-empty {
  font-size: var(--qpm-font-caption);
  color: var(--qpm-text-muted);
  font-style: italic;
  padding: 2px 0;
}
.qpm-charged-abilities__gtotals-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.qpm-charged-abilities__gtotals-row {
  border-left: 3px solid var(--qpm-accent);
  padding: 4px 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.qpm-charged-abilities__gtotals-top {
  display: flex;
  align-items: center;
  gap: 8px;
}
.qpm-charged-abilities__gtotals-ability {
  flex: 1;
  font-size: var(--qpm-font-body);
  font-weight: var(--qpm-weight-semibold);
  color: var(--qpm-text);
}
.qpm-charged-abilities__gtotals-gain {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-weight: var(--qpm-weight-bold);
}
.qpm-charged-abilities__wlayout {
  display: grid;
  grid-template-columns: 1fr 200px;
  gap: 12px;
  padding: 12px;
  overflow: hidden;
  flex: 1;
  min-height: 0;
}
.qpm-charged-abilities__wroster {
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
  min-height: 0;
  padding-right: 4px;
}
.qpm-charged-abilities__wsidebar {
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--qpm-border);
  padding-left: 12px;
  overflow-y: auto;
  min-height: 0;
}
.qpm-charged-abilities__wempty {
  padding: 24px 16px;
  text-align: center;
  color: var(--qpm-text-muted);
}
.qpm-charged-abilities__wempty-heading {
  font-size: var(--qpm-font-subtitle);
  font-weight: var(--qpm-weight-semibold);
  color: var(--qpm-text);
  margin-bottom: 8px;
}
.qpm-charged-abilities__wempty-body {
  font-size: var(--qpm-font-caption);
  line-height: 1.5;
}

/* Full window — card */
.qpm-charged-abilities__wcard {
  background: var(--qpm-surface-2);
  border: 1px solid var(--qpm-border);
  border-radius: 8px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.qpm-charged-abilities__wcard--ready { border-color: var(--qpm-positive); }
.qpm-charged-abilities__wcard--cooling { border-color: var(--qpm-warning); }
.qpm-charged-abilities__wcard--mounted {
  border-color: var(--qpm-accent);
  box-shadow: 0 0 0 1px var(--qpm-accent-emphasis), 0 0 12px var(--qpm-accent-tint);
}
.qpm-charged-abilities__wcard-header {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}
.qpm-charged-abilities__wcard-id {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.qpm-charged-abilities__wcard-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.qpm-charged-abilities__wcard-name {
  font-size: var(--qpm-font-subtitle);
  font-weight: var(--qpm-weight-bold);
  color: var(--qpm-text);
}
.qpm-charged-abilities__wcard-count {
  font-size: var(--qpm-font-body);
  font-weight: var(--qpm-weight-semibold);
  color: var(--qpm-text-muted);
}
.qpm-charged-abilities__wcard-ability-name {
  font-size: var(--qpm-font-body);
  color: var(--qpm-accent);
  font-weight: var(--qpm-weight-semibold);
}
.qpm-charged-abilities__wcard-spacer {
  flex: 1;
}
.qpm-charged-abilities__wcard-row--empty {
  color: var(--qpm-text-muted);
  font-size: var(--qpm-font-body);
  text-align: center;
  padding: 4px 0;
}
.qpm-charged-abilities__card-count {
  font-size: var(--qpm-font-caption);
  font-weight: var(--qpm-weight-semibold);
  color: var(--qpm-text-muted);
  margin-left: 2px;
}
.qpm-charged-abilities__wcard-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.qpm-charged-abilities__wcard-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 8px;
  font-size: var(--qpm-font-caption);
}
.qpm-charged-abilities__wcard-row--gain {
  margin-top: 2px;
}
.qpm-charged-abilities__wcard-row-label {
  color: var(--qpm-text-muted);
  text-transform: uppercase;
  font-size: var(--qpm-font-xs);
  letter-spacing: 0.6px;
  font-weight: var(--qpm-weight-semibold);
}
.qpm-charged-abilities__wcard-row-value {
  color: var(--qpm-text);
}
.qpm-charged-abilities__wcard-empty-line {
  color: var(--qpm-text-muted);
  font-style: italic;
}
.qpm-charged-abilities__wcard-optimal {
  margin-left: auto;
}

/* Hutch sidebar */
.qpm-charged-abilities__hutch-sidebar {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.qpm-charged-abilities__hutch-heading {
  font-size: var(--qpm-font-caption);
  font-weight: var(--qpm-weight-semibold);
  color: var(--qpm-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.6px;
}
.qpm-charged-abilities__hutch-empty {
  font-size: var(--qpm-font-caption);
  color: var(--qpm-text-muted);
  line-height: 1.4;
}
.qpm-charged-abilities__hutch-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.qpm-charged-abilities__hutch-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px;
  background: var(--qpm-surface-2);
  border: 1px solid var(--qpm-border);
  border-radius: 6px;
}
.qpm-charged-abilities__hutch-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.qpm-charged-abilities__hutch-name {
  font-size: var(--qpm-font-body);
  color: var(--qpm-text);
  font-weight: var(--qpm-weight-semibold);
}
.qpm-charged-abilities__hutch-ability {
  font-size: var(--qpm-font-xs);
  color: var(--qpm-text-muted);
}

@keyframes qpm-charged-abilities-shimmer {
  0%   { opacity: 0.55; }
  50%  { opacity: 1; }
  100% { opacity: 0.55; }
}
@keyframes qpm-charged-abilities-pulse {
  0%   { opacity: 0.4; transform: scale(0.85); }
  50%  { opacity: 1; transform: scale(1.1); }
  100% { opacity: 0.4; transform: scale(0.85); }
}
`;

let injected = false;
export function injectChargedAbilitiesStyles(): void {
  if (injected) return;
  const el = document.createElement('style');
  el.id = 'qpm-charged-abilities-styles';
  el.textContent = CHARGED_ABILITIES_STYLES;
  document.head.appendChild(el);
  injected = true;
}
