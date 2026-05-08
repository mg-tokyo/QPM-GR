export const TOAST_STYLE_ID = 'qpm-toast-style';

let qpmPanelStylesInjected = false;

export function ensurePanelStyles(): void {
  if (qpmPanelStylesInjected) {
    return;
  }
  const style = document.createElement('style');
  style.id = 'qpm-panel-styles';
  style.textContent = `:root {
    --qpm-surface-1: rgba(18, 21, 32, 0.95);
    --qpm-surface-2: rgba(32, 36, 52, 0.9);
    --qpm-surface-3: rgba(52, 58, 78, 0.85);
    --qpm-border: rgba(120, 130, 170, 0.28);
    --qpm-text: #eef0ff;
    --qpm-text-muted: #97a0c0;
    --qpm-accent: #8f82ff;
    --qpm-accent-strong: #b39cff;
    --qpm-positive: #4fd18b;
    --qpm-danger: #ff6f91;
    --qpm-warning: #ffb347;
    --qpm-shadow: 0 14px 32px rgba(15, 17, 28, 0.55);
    --qpm-divider: rgba(120, 130, 170, 0.2);
    --qpm-font: 'Inter', 'Segoe UI', 'Roboto', 'Helvetica Neue', Arial, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji', sans-serif;
  }

  .qpm-panel {
    position: fixed;
    right: 16px;
    bottom: 16px;
    z-index: 2147483647;
    background: var(--qpm-surface-1);
    color: var(--qpm-text);
    padding: 0;
    border-radius: 14px;
    font: 12px/1.55 var(--qpm-font);
    box-shadow: var(--qpm-shadow);
    min-width: min(340px, calc(100vw - 32px));
    width: min(560px, calc(100vw - 32px));
    max-width: calc(100vw - 32px);
    max-height: calc(100vh - 32px);
    overflow: hidden;
    backdrop-filter: blur(18px);
    border: 1px solid var(--qpm-border);
    contain: layout style;
  }

  .qpm-panel__titlebar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    font-size: 15px;
    font-weight: 600;
    background: linear-gradient(135deg, rgba(143, 130, 255, 0.28), rgba(32, 36, 52, 0.85));
    cursor: move;
    user-select: none;
  }

  .qpm-panel__titlebar button {
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.18);
    color: var(--qpm-text-muted);
    border-radius: 18px;
    font-size: 11px;
    padding: 4px 10px;
    cursor: pointer;
    transition: background 0.2s ease, color 0.2s ease;
  }

  .qpm-panel__titlebar button:hover {
    background: rgba(255, 255, 255, 0.16);
    color: var(--qpm-text);
  }

  .qpm-version-bubble {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 4px 10px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.3px;
    transition: all 0.2s ease;
    margin-left: auto;
    margin-right: 8px;
  }

  .qpm-version-bubble[data-status="up-to-date"] {
    background: rgba(76, 175, 80, 0.2);
    color: #4CAF50;
    border: 1px solid rgba(76, 175, 80, 0.4);
  }

  .qpm-version-bubble[data-status="outdated"] {
    background: rgba(244, 67, 54, 0.18);
    color: #F44336;
    border: 1px solid rgba(244, 67, 54, 0.55);
    animation: pulse-warning 2s ease-in-out infinite;
  }

  .qpm-version-bubble[data-status="checking"] {
    background: rgba(158, 158, 158, 0.2);
    color: #9E9E9E;
    border: 1px solid rgba(158, 158, 158, 0.4);
  }

  .qpm-version-bubble[data-status="error"] {
    background: rgba(244, 67, 54, 0.2);
    color: #F44336;
    border: 1px solid rgba(244, 67, 54, 0.4);
  }

  .qpm-version-bubble:hover[data-status="outdated"] {
    transform: scale(1.05);
    background: rgba(255, 193, 7, 0.3);
  }

  @keyframes pulse-warning {
    0%, 100% {
      opacity: 1;
    }
    50% {
      opacity: 0.7;
    }
  }

  .qpm-content {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px 16px 16px;
    overflow-y: auto;
    overflow-x: hidden;
    max-height: calc(100vh - 120px);
    overscroll-behavior: contain;
  }

  .qpm-nav {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 6px;
  }

  .qpm-nav__button {
    flex: 1 1 calc(33% - 8px);
    min-width: 120px;
    border: 1px solid var(--qpm-border);
    background: rgba(255, 255, 255, 0.04);
    color: var(--qpm-text-muted);
    border-radius: 10px;
    padding: 8px 10px;
    font-size: 12px;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    transition: all 0.25s ease;
  }

  .qpm-nav__button:hover {
    border-color: var(--qpm-accent-strong);
    color: var(--qpm-text);
    transform: translateY(-1px);
  }

  .qpm-nav__button--active {
    border-color: var(--qpm-accent);
    color: var(--qpm-text);
    /* Background, box-shadow, and glow set by JavaScript based on tab color */
  }

  .qpm-card {
    background: var(--qpm-surface-2);
    border: 1px solid var(--qpm-border);
    border-radius: 12px;
    padding: 12px 14px;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.03);
  }

  .qpm-table {
    width: 100%;
    border-collapse: collapse;
  }

  .qpm-table thead {
    background: rgba(255, 255, 255, 0.05);
    text-transform: uppercase;
    letter-spacing: 0.3px;
    font-size: 9px;
    color: var(--qpm-text-muted);
  }

  .qpm-table th,
  .qpm-table td {
    padding: 6px 8px;
    text-align: left;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  }

  .qpm-table tbody tr:nth-child(odd) {
    background: rgba(255, 255, 255, 0.02);
  }

  .qpm-table--compact th,
  .qpm-table--compact td {
    font-size: 10px;
  }

  .qpm-ability-divider td {
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }

  .qpm-ability-section td {
    background: rgba(255, 255, 255, 0.04);
    font-weight: 600;
    font-size: 11px;
    color: var(--qpm-text);
    padding: 7px 8px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }

  .qpm-ability-section__content {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }

  .qpm-ability-section__title {
    font-weight: 600;
  }

  .qpm-ability-section__meta {
    font-weight: 400;
    font-size: 10px;
    color: var(--qpm-text-muted);
  }

  .qpm-ability-total {
    font-weight: 600;
    background: rgba(255, 255, 255, 0.03);
  }

  .qpm-ability-total td {
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }

  .qpm-tracker-summary {
    font-size: 11px;
    color: var(--qpm-text-muted);
    line-height: 1.5;
  }

  .qpm-mutation-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
    font-size: 11px;
  }

  .qpm-mutation-meta__group {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .qpm-mutation-source {
    font-size: 10px;
    color: var(--qpm-text-muted);
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 999px;
    padding: 2px 8px;
  }

  .qpm-mutation-countdown {
    font-size: 11px;
    color: var(--qpm-text-muted);
    margin-top: 4px;
  }

  .qpm-mutation-countdown[data-state='active'] {
    color: #b3ffe0;
  }

  .qpm-mutation-countdown[data-state='expired'] {
    color: #ffcc80;
  }

  .qpm-mutation-totals {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
  }

  .qpm-mutation-chip {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 10px;
    padding: 6px 10px;
    min-width: 130px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .qpm-mutation-chip--active {
    border-color: rgba(143, 130, 255, 0.5);
    box-shadow: 0 0 0 1px rgba(143, 130, 255, 0.3);
  }

  .qpm-mutation-chip__label {
    font-size: 11px;
    font-weight: 600;
    color: var(--qpm-text);
  }

  .qpm-mutation-chip__meta {
    font-size: 10px;
    color: var(--qpm-text-muted);
  }

  .qpm-mutation-detail {
    margin-top: 8px;
  }

  .qpm-tracker-note {
    font-size: 10px;
    color: #90caf9;
    background: rgba(144, 202, 249, 0.08);
    border: 1px dashed rgba(144, 202, 249, 0.4);
    border-radius: 8px;
    padding: 8px;
  }

  .qpm-card__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
  }

  .qpm-card__title {
    font-size: 13px;
    font-weight: 600;
    color: var(--qpm-text);
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .qpm-section-muted {
    color: var(--qpm-text-muted);
    font-size: 11px;
  }

  .qpm-button {
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
    padding: 4px 8px;
    border: 1px solid var(--qpm-border);
    border-radius: 8px;
    background: rgba(20, 24, 36, 0.65);
    color: var(--qpm-text);
    font-size: 11px;
    transition: border-color 0.2s ease, box-shadow 0.2s ease;
  }

  .qpm-input:focus,
  .qpm-select:focus {
    outline: none;
    border-color: var(--qpm-accent);
    box-shadow: 0 0 0 2px rgba(143, 130, 255, 0.18);
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
  }

  .qpm-toast {
    position: fixed;
    bottom: 24px;
    right: 24px;
    background: rgba(20, 26, 40, 0.92);
    border: 1px solid rgba(143, 130, 255, 0.35);
    color: var(--qpm-text);
    padding: 10px 14px;
    border-radius: 12px;
    font-size: 12px;
    z-index: 2147483647;
    box-shadow: 0 10px 26px rgba(12, 16, 28, 0.55);
    animation: qpm-toast-in 0.25s ease;
  }

  @keyframes qpm-toast-in {
    from { opacity: 0; transform: translateY(12px); }
    to { opacity: 1; transform: translateY(0); }
  }

  /* Custom scrollbar for main panel content */
  .qpm-content::-webkit-scrollbar {
    width: 8px;
  }
  .qpm-content::-webkit-scrollbar-track {
    background: rgba(0, 0, 0, 0.2);
    border-radius: 4px;
  }
  .qpm-content::-webkit-scrollbar-thumb {
    background: rgba(143, 130, 255, 0.35);
    border-radius: 4px;
    transition: background 0.2s;
  }
  .qpm-content::-webkit-scrollbar-thumb:hover {
    background: rgba(143, 130, 255, 0.55);
  }

  /* ── Nav Sections ── */
  /* ── Status Tiles ── */
  .qpm-tile-grid {
    display: flex;
    flex-direction: column;
    gap: 6px;
    touch-action: pan-y;
  }
  .qpm-tile-row {
    display: flex;
    align-items: stretch;
    gap: 6px;
    width: 100%;
    transition: transform 0.16s ease, opacity 0.16s ease;
  }
  .qpm-tile-row--single .qpm-tile,
  .qpm-tile-row--single .qpm-tile-placeholder {
    flex-basis: 100%;
    min-width: 100%;
  }
  .qpm-tile-row--pair .qpm-tile,
  .qpm-tile-row--pair .qpm-tile-placeholder {
    flex-basis: 0;
    min-width: 0;
  }
  .qpm-tile-row--placeholder {
    animation: qpm-tile-row-in 0.14s ease;
  }
  @keyframes qpm-tile-row-in {
    from { opacity: 0; transform: scaleY(0.96); }
    to { opacity: 1; transform: scaleY(1); }
  }
  .qpm-tile {
    flex: 1 1 0;
    min-width: 0;
    max-width: 100%;
    box-sizing: border-box;
    border: 1px solid var(--qpm-border);
    background: rgba(255, 255, 255, 0.04);
    border-radius: 10px;
    padding: 8px 11px;
    cursor: grab;
    transition: background 0.16s ease, border-color 0.16s ease, transform 0.16s ease, box-shadow 0.16s ease, opacity 0.16s ease, outline-color 0.16s ease;
    display: flex;
    flex-direction: column;
    gap: 3px;
    text-align: left;
    will-change: transform, box-shadow;
  }
  .qpm-add-tile {
    flex: 0 0 auto;
    width: 100%;
    max-width: 100%;
  }
  .qpm-tile:hover {
    background: rgba(255, 255, 255, 0.07);
    border-color: rgba(143, 130, 255, 0.45);
    transform: translateY(-1px);
  }
  .qpm-tile:active,
  .qpm-tile--pressing {
    cursor: grabbing;
    transform: translateY(0) scale(0.985);
    outline: 1px solid rgba(143, 130, 255, 0.55);
    outline-offset: 2px;
  }
  .qpm-tile--dragging {
    cursor: grabbing;
    opacity: 0.92;
    transform: scale(1.03);
    box-shadow: 0 14px 32px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(143, 130, 255, 0.34);
  }
  .qpm-tile--delete-target {
    opacity: 0.46;
    transform: scale(0.92);
    filter: saturate(0.72);
  }
  .qpm-tile-placeholder {
    border: 2px dashed rgba(143, 130, 255, 0.42);
    border-radius: 10px;
    box-sizing: border-box;
    background: rgba(143, 130, 255, 0.055);
    animation: qpm-tile-placeholder-pulse 1.2s ease-in-out infinite;
  }
  @keyframes qpm-tile-placeholder-pulse {
    0%, 100% { border-color: rgba(143, 130, 255, 0.28); background: rgba(143, 130, 255, 0.035); }
    50% { border-color: rgba(143, 130, 255, 0.58); background: rgba(143, 130, 255, 0.075); }
  }
  .qpm-tile-delete-zone {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 600;
    color: rgba(244, 67, 54, 0.62);
    background: rgba(244, 67, 54, 0.06);
    border-top: 1px dashed rgba(244, 67, 54, 0.22);
    pointer-events: none;
    z-index: 10;
    opacity: 0;
    transform: translateY(8px);
    animation: qpm-delete-zone-in 0.16s ease forwards;
    transition: background 0.16s ease, color 0.16s ease, border-color 0.16s ease;
  }
  .qpm-tile-delete-zone--active {
    color: rgba(255, 112, 112, 1);
    background: rgba(244, 67, 54, 0.16);
    border-color: rgba(244, 67, 54, 0.42);
  }
  @keyframes qpm-delete-zone-in {
    to { opacity: 1; transform: translateY(0); }
  }
  .qpm-tile--active { color: var(--qpm-text); }
  .qpm-tile__label {
    font-size: 12px;
    font-weight: 600;
    color: var(--qpm-text-muted);
    display: flex;
    align-items: center;
    gap: 5px;
    transition: color 0.2s ease;
  }
  .qpm-tile--active .qpm-tile__label,
  .qpm-tile:hover .qpm-tile__label { color: var(--qpm-text); }
  .qpm-tile__status {
    font-size: 10px;
    font-weight: 400;
    color: rgba(var(--qpm-tile-status-rgb, 140, 150, 190), 0.9);
    min-height: 16px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.4;
    text-shadow: 0 0 8px rgba(var(--qpm-tile-status-rgb, 143, 130, 255), 0.42);
  }
  .qpm-tile__status--alert  {
    color: color-mix(in srgb, rgb(var(--qpm-tile-status-rgb, 255, 179, 71)) 58%, #ffcf66) !important;
    text-shadow: 0 0 10px rgba(255, 179, 71, 0.42), 0 0 8px rgba(var(--qpm-tile-status-rgb, 143, 130, 255), 0.24);
  }
  .qpm-tile__status--positive {
    color: color-mix(in srgb, rgb(var(--qpm-tile-status-rgb, 79, 209, 139)) 68%, #f0fff7) !important;
    text-shadow: 0 0 10px rgba(var(--qpm-tile-status-rgb, 79, 209, 139), 0.48);
  }
  .qpm-tile__status--muted {
    color: rgba(var(--qpm-tile-status-rgb, 140, 150, 190), 0.68) !important;
    text-shadow: 0 0 7px rgba(var(--qpm-tile-status-rgb, 143, 130, 255), 0.24);
  }
  .qpm-tile__status--rich {
    display: flex;
    align-items: center;
    gap: 5px;
    overflow: hidden;
    white-space: nowrap;
  }
  .qpm-tile-status-sprites {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    flex: 0 0 auto;
    min-width: 0;
  }
  .qpm-tile-status-sprite {
    width: 16px;
    height: 16px;
    flex: 0 0 16px;
    object-fit: contain;
    image-rendering: pixelated;
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.45));
  }
  .qpm-tile-status-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Shared panel footer */
  .qpm-panel-footer {
    flex: 0 0 auto;
    border-top: 1px solid rgba(143, 130, 255, 0.12);
    background: rgba(18, 21, 32, 0.72);
    padding: 7px 12px 9px;
    display: flex;
    flex-direction: column;
    gap: 7px;
  }
  .qpm-panel-footer__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .qpm-panel-footer__toggle,
  .qpm-panel-footer__button {
    height: 24px;
    border-radius: 6px;
    border: 1px solid rgba(143, 130, 255, 0.22);
    background: rgba(143, 130, 255, 0.055);
    color: rgba(200, 192, 255, 0.72);
    font-size: 10px;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease, transform 0.15s ease;
  }
  .qpm-panel-footer__toggle,
  .qpm-panel-footer__button {
    padding: 0 8px;
  }
  .qpm-panel-footer__toggle:hover,
  .qpm-panel-footer__button:hover {
    background: rgba(143, 130, 255, 0.11);
    border-color: rgba(143, 130, 255, 0.38);
    color: rgba(238, 240, 255, 0.92);
    transform: translateY(-1px);
  }
  .qpm-panel-footer__keybind-hint {
    font-size: 9px;
    color: #8f82ff;
    letter-spacing: 0.01em;
    text-shadow: 0 0 6px rgba(143, 130, 255, 0.4);
    text-align: center;
    flex: 1 1 0;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .qpm-panel-footer__actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 5px;
    margin-left: auto;
    flex-shrink: 0;
  }
  .qpm-panel-footer__changelog {
    max-height: 190px;
    overflow-y: auto;
    border-top: 1px solid rgba(143, 130, 255, 0.08);
    padding-top: 7px;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .qpm-panel-footer__changelog-item {
    font-size: 10px;
    line-height: 1.45;
    color: rgba(224, 224, 224, 0.62);
  }
  .qpm-panel-footer__changelog-item strong {
    color: var(--qpm-accent);
  }

  /* ── Resize handle ── */
  .qpm-panel__resize-handle {
    position: absolute;
    bottom: 0;
    right: 0;
    width: 20px;
    height: 20px;
    cursor: nwse-resize;
    z-index: 10;
    touch-action: none;
  }
  .qpm-panel__resize-handle::after {
    content: '';
    position: absolute;
    bottom: 4px;
    right: 4px;
    width: 9px;
    height: 9px;
    border-bottom: 2px solid rgba(143, 130, 255, 0.3);
    border-right: 2px solid rgba(143, 130, 255, 0.3);
    border-radius: 0 0 3px 0;
    transition: border-color 0.2s ease;
  }
  .qpm-panel__resize-handle:hover::after {
    border-color: rgba(143, 130, 255, 0.7);
  }

  @media (prefers-reduced-motion: reduce) {
    .qpm-tile,
    .qpm-tile-row,
    .qpm-tile-row--placeholder,
    .qpm-panel-footer__toggle,
    .qpm-panel-footer__button,
    .qpm-tile-delete-zone {
      transition: none;
      animation: none;
    }
    .qpm-tile-placeholder {
      animation: none;
    }
  }
  `;
  document.head.appendChild(style);
  qpmPanelStylesInjected = true;
}

export function ensureToastStyle(): void {
  if (document.getElementById(TOAST_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = TOAST_STYLE_ID;
  style.textContent = '@keyframes qpm-toast-in { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 0.95; } }';
  document.head.appendChild(style);
}
