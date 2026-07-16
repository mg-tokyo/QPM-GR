export const PANEL_CSS = `.qpm-panel {
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
    backdrop-filter: blur(6px);
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
  }`;
