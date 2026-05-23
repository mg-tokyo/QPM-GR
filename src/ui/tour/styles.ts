// src/ui/tour/styles.ts

const STYLE_ID = 'qpm-tour-styles';

/** Inject tour CSS once. Idempotent. */
export function ensureTourStyles(): void {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    /* ── Tour overlay ───────────────────────────────────────── */
    #qpm-tour-overlay {
      position: fixed;
      inset: 0;
      z-index: 999998;
      pointer-events: auto;
      transition: opacity 200ms ease;
    }
    #qpm-tour-overlay.qpm-tour--entering {
      opacity: 0;
    }
    #qpm-tour-overlay.qpm-tour--visible {
      opacity: 1;
    }
    #qpm-tour-overlay.qpm-tour--exiting {
      opacity: 0;
      pointer-events: none;
    }

    /* ── Spotlight accent border ────────────────────────────── */
    .qpm-tour-spotlight-border {
      position: absolute;
      border: 2px solid rgba(143, 130, 255, 0.5);
      border-radius: 9px;
      pointer-events: none;
      transition: all 250ms ease;
    }

    /* ── Tooltip ────────────────────────────────────────────── */
    .qpm-tour-tooltip {
      position: absolute;
      background: var(--qpm-surface-1, rgba(18, 21, 32, 0.97));
      border: 1px solid rgba(143, 130, 255, 0.35);
      border-radius: 8px;
      padding: 12px 16px;
      max-width: 280px;
      min-width: 180px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
      font-family: var(--qpm-font, 'Inter', 'Segoe UI', sans-serif);
      z-index: 999999;
      pointer-events: auto;
      transition: opacity 200ms ease, transform 200ms ease;
    }
    .qpm-tour-tooltip.qpm-tour-tooltip--entering {
      opacity: 0;
      transform: translateY(8px);
    }
    .qpm-tour-tooltip.qpm-tour-tooltip--visible {
      opacity: 1;
      transform: translateY(0);
    }

    /* Arrow (rotated square) */
    .qpm-tour-arrow {
      position: absolute;
      width: 12px;
      height: 12px;
      background: var(--qpm-surface-1, rgba(18, 21, 32, 0.97));
      border-left: 1px solid rgba(143, 130, 255, 0.35);
      border-top: 1px solid rgba(143, 130, 255, 0.35);
      transform: rotate(45deg);
    }
    /* Arrow position variants — set by JS via data-placement */
    .qpm-tour-tooltip[data-placement="bottom"] .qpm-tour-arrow {
      top: -7px;
    }
    .qpm-tour-tooltip[data-placement="top"] .qpm-tour-arrow {
      bottom: -7px;
      transform: rotate(225deg);
    }
    .qpm-tour-tooltip[data-placement="left"] .qpm-tour-arrow {
      right: -7px;
      transform: rotate(135deg);
    }
    .qpm-tour-tooltip[data-placement="right"] .qpm-tour-arrow {
      left: -7px;
      transform: rotate(-45deg);
    }

    .qpm-tour-title {
      font-size: 12px;
      font-weight: 600;
      color: var(--qpm-text, #eef0ff);
      margin-bottom: 4px;
    }
    .qpm-tour-body {
      font-size: 11px;
      color: var(--qpm-text-muted, #97a0c0);
      line-height: 1.5;
    }
    .qpm-tour-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 10px;
      padding-top: 8px;
      border-top: 1px solid var(--qpm-divider, rgba(120, 130, 170, 0.2));
    }
    .qpm-tour-dots {
      display: flex;
      gap: 5px;
    }
    .qpm-tour-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: rgba(143, 130, 255, 0.25);
      transition: background 200ms ease;
    }
    .qpm-tour-dot--active {
      background: var(--qpm-accent, #8f82ff);
    }
    .qpm-tour-actions {
      display: flex;
      gap: 12px;
      align-items: center;
    }
    .qpm-tour-skip {
      font-size: 11px;
      color: var(--qpm-text-muted, #97a0c0);
      cursor: pointer;
      user-select: none;
    }
    .qpm-tour-skip:hover {
      color: var(--qpm-text, #eef0ff);
    }
    .qpm-tour-next {
      font-size: 11px;
      font-weight: 600;
      color: var(--qpm-accent, #8f82ff);
      cursor: pointer;
      user-select: none;
    }
    .qpm-tour-next:hover {
      color: var(--qpm-accent-strong, #b39cff);
    }

    /* ── Replay button (in window header) ──────────────────── */
    .qpm-tour-replay-btn {
      width: 26px;
      height: 26px;
      border: none;
      background: rgba(255, 255, 255, 0.08);
      color: #e0e0e0;
      font-size: 14px;
      font-weight: 300;
      line-height: 1;
      cursor: pointer;
      border-radius: 4px;
      transition: all 0.15s ease;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .qpm-tour-replay-btn:hover {
      background: rgba(143, 130, 255, 0.5);
      color: #fff;
    }
  `;
  document.head.appendChild(style);
}
