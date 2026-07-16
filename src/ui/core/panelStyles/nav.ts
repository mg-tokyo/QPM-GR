export const NAV_CSS = `.qpm-content {
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
  }`;
