// src/ui/petPickerModal/styles.ts
// CSS styles for the pet picker modal.

const STYLES = `
.qpm-picker-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.55);
  z-index: 999998;
  display: flex; align-items: center; justify-content: center;
}
.qpm-picker {
  background: rgba(18,20,26,0.97);
  border: 1px solid rgba(143,130,255,0.45);
  border-radius: 10px;
  width: min(1020px, 97vw);
  height: min(620px, 92vh);
  display: flex; flex-direction: column;
  font-family: inherit;
  box-shadow: 0 8px 32px rgba(0,0,0,0.6);
  overflow: hidden;
}
.qpm-picker__header {
  padding: 10px 14px;
  border-bottom: 1px solid rgba(143,130,255,0.2);
  display: flex; align-items: center; gap: 8px;
  flex-shrink: 0; flex-wrap: wrap;
}
.qpm-picker__title {
  color: #8f82ff; font-weight: 600; font-size: 15px; flex: 1; min-width: 80px;
}
.qpm-picker__search {
  background: rgba(255,255,255,0.07);
  border: 1px solid rgba(143,130,255,0.3);
  border-radius: 6px;
  color: #e0e0e0; font-size: 13px;
  padding: 6px 10px; outline: none; width: 160px;
}
.qpm-picker__search:focus { border-color: rgba(143,130,255,0.7); }
.qpm-picker__filter {
  background: rgba(20,24,36,0.65);
  border: 1px solid rgba(143,130,255,0.3);
  border-radius: 8px;
  color: #e0e0e0; font-size: 11px;
  padding: 4px 8px; outline: none; cursor: pointer;
  color-scheme: dark;
}
.qpm-picker__filter:focus {
  border-color: #8f82ff;
  box-shadow: 0 0 0 2px rgba(143,130,255,0.18);
}
.qpm-picker__filter option {
  background: rgb(20,24,36);
  color: #e0e0e0;
}
.qpm-picker__species-wrap {
  position: relative;
}
.qpm-picker__species-btn {
  background: rgba(20,24,36,0.65);
  border: 1px solid rgba(143,130,255,0.3);
  border-radius: 8px;
  color: #e0e0e0;
  font-size: 11px;
  padding: 4px 8px;
  cursor: pointer;
  white-space: nowrap;
}
.qpm-picker__species-btn:hover {
  border-color: rgba(143,130,255,0.65);
}
.qpm-picker__species-popover {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  width: 220px;
  max-height: 260px;
  overflow-y: auto;
  background: rgba(14,16,22,0.98);
  border: 1px solid rgba(143,130,255,0.35);
  border-radius: 8px;
  padding: 6px;
  z-index: 3;
  box-shadow: 0 10px 28px rgba(0,0,0,0.55);
}
.qpm-picker__species-item {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 6px;
  border-radius: 6px;
  cursor: pointer;
}
.qpm-picker__species-item:hover {
  background: rgba(143,130,255,0.14);
}
.qpm-picker__species-icon {
  width: 18px;
  height: 18px;
  object-fit: contain;
  image-rendering: pixelated;
  flex-shrink: 0;
}
.qpm-picker__species-name {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 11px;
}
.qpm-picker__species-count {
  font-size: 10px;
  color: rgba(224,224,224,0.62);
  margin-left: 6px;
}
.qpm-picker__compare-btn {
  background: rgba(143,130,255,0.12);
  border: 1px solid rgba(143,130,255,0.35);
  border-radius: 6px;
  color: #c4beff; font-size: 12px;
  padding: 5px 10px; cursor: pointer; transition: background 0.15s;
  white-space: nowrap;
}
.qpm-picker__compare-btn:hover { background: rgba(143,130,255,0.25); }
.qpm-picker__compare-btn--active {
  background: rgba(143,130,255,0.28);
  border-color: rgba(143,130,255,0.7);
  color: #fff;
}
.qpm-picker__main {
  display: flex; flex: 1; overflow: hidden;
}
.qpm-picker__body {
  overflow-y: auto; flex: 1;
  padding: 10px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 8px;
  align-content: start;
}
.qpm-picker__empty {
  grid-column: 1 / -1;
  text-align: center; color: rgba(224,224,224,0.4);
  font-size: 13px; padding: 40px 0;
}
/* --- Pet card --- */
.qpm-pet-card {
  border-radius: 9px; padding: 10px 8px;
  cursor: pointer; transition: opacity 0.15s, box-shadow 0.15s, border-color 0.15s, background 0.15s;
  display: flex; flex-direction: column; align-items: center; gap: 5px;
  position: relative;
  border: 1px solid rgba(143,130,255,0.2);
  background: rgba(255,255,255,0.04);
}
.qpm-pet-card:hover { opacity: 0.85; }
.qpm-pet-card--active { box-shadow: 0 0 0 1px rgba(100,255,150,0.4) inset; }
.qpm-pet-card--compare-selected {
  box-shadow: 0 0 0 2px rgba(143,130,255,0.9), 0 0 10px rgba(143,130,255,0.35);
  outline: none;
}
.qpm-pet-card--compare-win {
  border-color: rgba(64,255,194,0.75) !important;
  box-shadow: 0 0 0 2px rgba(64,255,194,0.95), 0 0 12px rgba(64,255,194,0.28) !important;
  background: rgba(64,255,194,0.08);
}
.qpm-pet-card--compare-loss {
  border-color: rgba(255,107,107,0.7) !important;
  box-shadow: 0 0 0 2px rgba(255,107,107,0.9), 0 0 12px rgba(255,107,107,0.25) !important;
  background: rgba(255,107,107,0.08);
}
.qpm-pet-card__sprite {
  width: 48px; height: 48px;
  image-rendering: pixelated; object-fit: contain;
}
.qpm-pet-card__sprite--placeholder {
  width: 48px; height: 48px;
  background: rgba(143,130,255,0.1); border-radius: 4px;
  display: flex; align-items: center; justify-content: center;
  font-size: 22px;
}
.qpm-pet-card__name {
  font-size: 11px; color: #e0e0e0; text-align: center;
  max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.qpm-pet-card__str {
  font-size: 11px; color: rgba(224,224,224,0.65); text-align: center; font-family: monospace;
}
.qpm-pet-card__ability-dots {
  display: flex; gap: 3px; justify-content: center; flex-wrap: wrap;
}
.qpm-pet-card__dot {
  width: 8px; height: 8px; border-radius: 2px; flex-shrink: 0;
}
.qpm-pet-card__badge {
  position: absolute; top: 4px; right: 4px;
  font-size: 9px; padding: 1px 4px; border-radius: 3px;
  font-weight: 600;
}
.qpm-pet-card__badge--active    { background: rgba(100,255,150,0.2); color: #64ff96; }
.qpm-pet-card__badge--hutch     { background: rgba(143,130,255,0.2); color: #a899ff; }
.qpm-pet-card__badge--inventory { background: rgba(255,200,100,0.2); color: #ffc864; }
/* --- Hover / detail panel --- */
.qpm-picker__hover-panel {
  width: 280px; flex-shrink: 0;
  border-left: 1px solid rgba(143,130,255,0.2);
  background: rgba(12,14,20,0.6);
  overflow-y: auto; padding: 14px 13px;
  display: flex; flex-direction: column; gap: 10px;
}
.qpm-picker__hover-panel--empty {
  color: rgba(224,224,224,0.25); font-size: 12px;
  align-items: center; justify-content: center;
  text-align: center;
}
/* Redesigned hover panel elements */
.qpm-hover__sprite-section {
  display: flex; justify-content: center; align-items: center;
  padding: 8px 0 4px;
}
.qpm-hover__sprite {
  width: 72px; height: 72px;
  image-rendering: pixelated; object-fit: contain;
}
.qpm-hover__sprite-placeholder {
  width: 72px; height: 72px;
  background: rgba(143,130,255,0.1); border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  font-size: 34px;
}
.qpm-hover__id-row {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
}
.qpm-hover__name {
  font-size: 14px; font-weight: 600; color: #e0e0e0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  flex: 1; min-width: 0;
}
.qpm-hover__location-badge {
  font-size: 9px; padding: 2px 5px; border-radius: 3px; font-weight: 600;
  flex-shrink: 0;
}
.qpm-hover__location-badge--active    { background: rgba(100,255,150,0.2); color: #64ff96; }
.qpm-hover__location-badge--hutch     { background: rgba(143,130,255,0.2); color: #a899ff; }
.qpm-hover__location-badge--inventory { background: rgba(255,200,100,0.2); color: #ffc864; }
.qpm-hover__species-row {
  display: flex; align-items: center; gap: 5px;
  font-size: 11px; color: rgba(224,224,224,0.5); margin-top: 1px;
}
.qpm-hover__tier-badge {
  font-size: 10px;
}
/* Stat bars */
.qpm-hover__section { display: flex; flex-direction: column; gap: 5px; }
.qpm-hover__section-title {
  font-size: 10px; font-weight: 600; color: rgba(143,130,255,0.8);
  text-transform: uppercase; letter-spacing: 0.06em;
}
.qpm-hover__bar-row {
  display: flex; flex-direction: column; gap: 2px;
}
.qpm-hover__bar-label-row {
  display: flex; justify-content: space-between; font-size: 10px;
}
.qpm-hover__bar-label { color: rgba(224,224,224,0.5); }
.qpm-hover__bar-value { color: rgba(200,200,255,0.85); font-family: monospace; }
.qpm-hover__bar-track {
  height: 5px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden;
}
.qpm-hover__bar-fill { height: 100%; border-radius: 3px; }
.qpm-hover__xp-note { font-size: 10px; color: rgba(224,224,224,0.4); }
/* Mutation pills */
.qpm-hover__mutation-list {
  display: flex; flex-wrap: wrap; gap: 4px;
}
.qpm-hover__mutation-pill {
  font-size: 9px; padding: 2px 6px; border-radius: 10px;
  background: rgba(143,130,255,0.15); color: #c4beff;
  border: 1px solid rgba(143,130,255,0.25);
}
.qpm-hover__mutation-pill--rainbow {
  background: linear-gradient(135deg,rgba(255,0,0,0.2),rgba(0,255,0,0.2),rgba(0,0,255,0.2));
  color: #fff; border-color: rgba(255,255,255,0.3);
}
.qpm-hover__mutation-pill--gold {
  background: rgba(255,215,0,0.15); color: #ffd700;
  border-color: rgba(255,215,0,0.4);
}
/* Compact ability rows */
.qpm-hover__abil-row {
  display: flex; align-items: center; gap: 6px;
  font-size: 11px; padding: 3px 0;
}
.qpm-hover__abil-dot {
  width: 9px; height: 9px; border-radius: 2px; flex-shrink: 0;
}
.qpm-hover__abil-name { color: #d0d0ff; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qpm-hover__abil-metric { color: rgba(200,200,200,0.55); font-size: 10px; white-space: nowrap; flex-shrink: 0; }
/* Compare mode */
.qpm-picker__compare-banner {
  padding: 14px 13px;
  color: rgba(224,224,224,0.55); font-size: 12px;
  display: flex; flex-direction: column; align-items: center;
  justify-content: center; text-align: center; gap: 8px;
  flex: 1;
}
.qpm-picker__compare-banner-title {
  font-size: 14px; color: #c4beff; font-weight: 600;
}
.qpm-picker__compare-count {
  font-size: 18px; font-weight: 700; color: #8f82ff;
}
.qpm-picker__compare-clear {
  background: rgba(244,67,54,0.1);
  border: 1px solid rgba(244,67,54,0.3);
  border-radius: 5px; color: rgba(244,67,54,0.8);
  padding: 4px 12px; font-size: 11px; cursor: pointer;
  transition: background 0.15s;
}
.qpm-picker__compare-clear:hover { background: rgba(244,67,54,0.2); }
/* Compare panel */
.qpm-compare-panel {
  width: 360px; flex-shrink: 0;
  border-left: 1px solid rgba(143,130,255,0.2);
  background: rgba(12,14,20,0.6);
  overflow-y: auto; padding: 10px 12px;
  display: flex; flex-direction: column; gap: 8px;
}
.qpm-compare__header {
  display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;
}
.qpm-compare__title { font-size: 12px; font-weight: 600; color: rgba(143,130,255,0.8); text-transform: uppercase; letter-spacing: 0.06em; }
.qpm-compare__sprites {
  display: grid; grid-template-columns: 1fr auto 1fr; align-items: center;
  gap: 6px; margin-bottom: 6px;
}
.qpm-compare__sprite-col { display: flex; flex-direction: column; align-items: center; gap: 3px; }
.qpm-compare__sprite {
  width: 72px; height: 72px; image-rendering: pixelated; object-fit: contain;
}
.qpm-compare__sprite-placeholder {
  width: 72px; height: 72px; background: rgba(143,130,255,0.1); border-radius: 6px;
  display: flex; align-items: center; justify-content: center; font-size: 32px;
}
.qpm-compare__ability-filter {
  background: rgba(20,24,36,0.65);
  border: 1px solid rgba(143,130,255,0.3);
  border-radius: 8px;
  color: #e0e0e0; font-size: 11px;
  padding: 4px 8px; outline: none; cursor: pointer; width: 100%;
  color-scheme: dark;
}
.qpm-compare__ability-filter:focus {
  border-color: #8f82ff;
  box-shadow: 0 0 0 2px rgba(143,130,255,0.18);
}
.qpm-compare__ability-filter option {
  background: rgb(20,24,36);
  color: #e0e0e0;
}
.qpm-compare__pet-name { font-size: 10px; color: #d0d0d0; text-align: center; max-width: 80px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qpm-compare__vs { font-size: 12px; color: rgba(224,224,224,0.3); font-weight: 700; }
.qpm-compare__row {
  display: grid; grid-template-columns: minmax(0,1fr) 112px minmax(0,1fr);
  align-items: center; gap: 4px; font-size: 11px; padding: 3px 0;
  border-bottom: 1px solid rgba(255,255,255,0.04);
}
.qpm-compare__row:last-child { border-bottom: none; }
.qpm-compare__cell-a { text-align: right; font-family: monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.qpm-compare__cell-b { text-align: left; font-family: monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.qpm-compare__cell-label { text-align: center; font-size: 9px; color: rgba(224,224,224,0.4); text-transform: uppercase; letter-spacing: 0.05em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.qpm-compare__winner { color: rgba(64,255,194,0.9) !important; font-weight: 700; }
.qpm-compare__loser { color: rgba(224,224,224,0.3) !important; }
.qpm-compare__tie { color: rgba(224,224,224,0.65); }
/* --- Compare panel new classes --- */
.qpm-compare__section-title {
  font-size: 9px; font-weight: 600; color: rgba(143,130,255,0.6);
  text-transform: uppercase; letter-spacing: 0.07em;
  padding: 6px 0 3px; border-top: 1px solid rgba(143,130,255,0.12);
  margin-top: 2px;
}
.qpm-compare__stat-row {
  display: grid; grid-template-columns: minmax(0,1fr) 112px minmax(0,1fr);
  gap: 6px; align-items: center; font-size: 10px; padding: 1px 0;
}
.qpm-compare__stat-lbl {
  text-align: center;
  color: rgba(224,224,224,0.3);
  font-size: 9px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.qpm-compare__stat-a,
.qpm-compare__stat-b {
  font-family: monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.qpm-compare__stat-a { text-align: right; }
.qpm-compare__stat-b { text-align: left; }
.qpm-compare__abil-block {
  display: grid; grid-template-columns: 1fr 52px 1fr;
  gap: 3px; padding: 4px 0;
  border-bottom: 1px solid rgba(255,255,255,0.04);
}
.qpm-compare__abil-center {
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  justify-content: center;
}
.qpm-compare__abil-dot { width: 8px; height: 8px; border-radius: 2px; }
.qpm-compare__abil-label { font-size: 8px; color: rgba(224,224,224,0.3); text-align: center; word-break: break-word; }
.qpm-compare__abil-side {
  padding: 4px 5px; border-radius: 5px;
  border: 1px solid rgba(255,255,255,0.05);
  background: rgba(255,255,255,0.02);
  display: flex; flex-direction: column; gap: 2px;
}
.qpm-compare__abil-side--winner {
  border-color: rgba(64,255,194,0.4) !important;
  background: rgba(64,255,194,0.07) !important;
}
.qpm-compare__abil-metric { display: flex; justify-content: space-between; font-size: 9px; }
.qpm-compare__abil-metric-lbl { color: rgba(224,224,224,0.3); }
.qpm-compare__abil-metric-val { font-weight: 600; }
.qpm-compare__abil-none { font-size: 10px; color: rgba(224,224,224,0.2); text-align: center; padding: 6px 0; }
/* --- Footer --- */
.qpm-picker__footer {
  padding: 8px 16px;
  border-top: 1px solid rgba(143,130,255,0.2);
  display: flex; justify-content: flex-end;
  flex-shrink: 0;
}
.qpm-picker__cancel {
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 6px; color: #e0e0e0;
  padding: 7px 16px; font-size: 13px; cursor: pointer;
  transition: background 0.15s;
}
.qpm-picker__cancel:hover { background: rgba(255,255,255,0.14); }
`;

let stylesInjected = false;

export function ensureStyles(): void {
  if (stylesInjected) return;
  const el = document.createElement('style');
  el.id = 'qpm-picker-styles';
  el.textContent = STYLES;
  document.head.appendChild(el);
  stylesInjected = true;
}
