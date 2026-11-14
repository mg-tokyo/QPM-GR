// Matches the charged-abilities floating card (src/ui/chargedAbilities/styles.ts); tokens only.
const FORECAST_WIDGET_STYLES = `
.qpm-forecast-widget {
  background: var(--qpm-surface-window);
  border: 1px solid var(--qpm-accent-border);
  border-radius: 8px;
  width: 220px;
  box-shadow: var(--qpm-shadow-subtle);
  z-index: 999990;
  font-family: var(--qpm-font);
  color: var(--qpm-text);
  user-select: none;
  overflow: hidden;
}
.qpm-forecast-widget__header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  cursor: grab;
  background: var(--qpm-accent-tint);
  border-bottom: 1px solid var(--qpm-accent-subtle);
}
.qpm-forecast-widget__header:active { cursor: grabbing; }
.qpm-forecast-widget__title {
  flex: 1;
  font-size: var(--qpm-font-body);
  font-weight: var(--qpm-weight-semibold);
}
.qpm-forecast-widget__btn {
  background: none;
  border: none;
  color: var(--qpm-text-muted);
  font-size: var(--qpm-font-subtitle);
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
  transition: color 0.15s ease;
}
.qpm-forecast-widget__btn:hover { color: var(--qpm-text); }
.qpm-forecast-widget__expanded {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  max-height: 260px;
  overflow-y: auto;
  border-top: 1px solid var(--qpm-border);
  user-select: text;
}
.qpm-forecast-widget__expanded[hidden] { display: none; }
.qpm-forecast-widget__section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.qpm-forecast-widget__body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
}
.qpm-forecast-widget__row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--qpm-font-caption);
  min-height: 20px;
}
.qpm-forecast-widget__icon {
  width: 20px;
  height: 20px;
  flex: none;
  object-fit: contain;
}
.qpm-forecast-widget__label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.qpm-forecast-widget__time {
  color: var(--qpm-text-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.qpm-forecast-widget__row--active .qpm-forecast-widget__label { color: var(--qpm-accent); font-weight: var(--qpm-weight-semibold); }
.qpm-forecast-widget__row--active .qpm-forecast-widget__time { color: var(--qpm-text); }
.qpm-forecast-widget__empty {
  font-size: var(--qpm-font-caption);
  color: var(--qpm-text-muted);
  padding: 2px 0;
}
`;

let injected = false;
export function injectForecastWidgetStyles(): void {
  if (injected) return;
  const el = document.createElement('style');
  el.id = 'qpm-forecast-widget-styles';
  el.textContent = FORECAST_WIDGET_STYLES;
  document.head.appendChild(el);
  injected = true;
}
