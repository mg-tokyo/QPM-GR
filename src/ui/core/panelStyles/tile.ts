export const TILE_CSS = `/* ── Nav Sections ── */
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
    will-change: transform, box-shadow;
  }
  .qpm-tile--dragging {
    cursor: grabbing;
    opacity: 0.92;
    transform: scale(1.03);
    box-shadow: 0 14px 32px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(143, 130, 255, 0.34);
    will-change: transform, box-shadow;
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
    0%, 100% { opacity: 0.55; }
    50% { opacity: 1; }
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
  }`;
