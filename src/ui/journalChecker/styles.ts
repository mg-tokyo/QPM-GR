/**
 * Scoped styles for the journal checker section.
 * Appended to root (auto-cleaned when root is removed).
 */
export function injectJournalStyles(root: HTMLElement): HTMLStyleElement {
  const style = document.createElement('style');
  style.textContent = `
    div[data-qpm-section="journal-checker"] ::-webkit-scrollbar {
      width: 8px;
    }
    div[data-qpm-section="journal-checker"] ::-webkit-scrollbar-track {
      background: var(--qpm-surface-2);
      border-radius: var(--qpm-radius-sm);
    }
    div[data-qpm-section="journal-checker"] ::-webkit-scrollbar-thumb {
      background: var(--qpm-surface-3);
      border-radius: var(--qpm-radius-sm);
    }
    div[data-qpm-section="journal-checker"] ::-webkit-scrollbar-thumb:hover {
      background: var(--qpm-surface-3);
    }

    .qpm-rainbow-complete {
      border-width: 2px !important;
      border-color: var(--qpm-gold) !important;
      background: linear-gradient(
        135deg,
        #ff0000 0%,
        #ff8800 16.67%,
        #ffff00 33.33%,
        #00ff00 50%,
        #0088ff 66.67%,
        #8800ff 83.33%,
        #ff0000 100%
      );
    }

    .qpm-rainbow-complete strong {
      color: #000 !important;
      text-shadow: 0 0 2px rgba(255, 255, 255, 0.5);
    }

    .qpm-rainbow-complete span[style*="color"] {
      color: #000 !important;
    }
  `;
  root.appendChild(style);
  return style;
}
