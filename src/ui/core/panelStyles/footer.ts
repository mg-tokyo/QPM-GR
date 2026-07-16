export const FOOTER_CSS = `/* Shared panel footer */
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

  /* ── Footer icon button ── */
  .qpm-panel-footer__icon-btn {
    width: 24px;
    height: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: rgba(143, 130, 255, 0.055);
    border: 1px solid rgba(143, 130, 255, 0.22);
    border-radius: 6px;
    color: var(--qpm-accent);
    font-size: 18px;
    font-weight: 700;
    line-height: 1;
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
  }
  .qpm-panel-footer__icon-btn:hover {
    background: rgba(143, 130, 255, 0.11);
    border-color: rgba(143, 130, 255, 0.38);
    transform: translateY(-1px);
  }`;
