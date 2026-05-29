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
      z-index: 2147483647;
      pointer-events: none;
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
      padding: 14px 18px;
      max-width: 340px;
      min-width: 220px;
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
      font-size: 15px;
      font-weight: 600;
      color: var(--qpm-text, #eef0ff);
      margin-bottom: 4px;
    }
    .qpm-tour-body {
      font-size: 13px;
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
      font-size: 12px;
      color: var(--qpm-text-muted, #97a0c0);
      cursor: pointer;
      user-select: none;
    }
    .qpm-tour-skip:hover {
      color: var(--qpm-text, #eef0ff);
    }
    .qpm-tour-next {
      font-size: 12px;
      font-weight: 600;
      color: var(--qpm-accent, #8f82ff);
      cursor: pointer;
      user-select: none;
    }
    .qpm-tour-next:hover {
      color: var(--qpm-accent-strong, #b39cff);
    }

    /* ── Replay / help button (in window header) ──────────────── */
    .qpm-tour-replay-btn {
      width: 28px;
      height: 28px;
      border: 1px solid rgba(143, 130, 255, 0.3);
      background: rgba(143, 130, 255, 0.12);
      color: var(--qpm-accent, #8f82ff);
      font-size: 14px;
      font-weight: 600;
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

    /* ── Discovery dots ───────────────────────────────────────── */
    .qpm-discovery-dot {
      position: absolute;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: rgba(143, 130, 255, 0.6);
      pointer-events: none;
      z-index: 999990;
      animation: qpm-discovery-pulse 2.5s ease-in-out infinite;
    }
    @keyframes qpm-discovery-pulse {
      0%, 100% { transform: scale(1); opacity: 0.6; }
      50% { transform: scale(1.3); opacity: 1; }
    }
    .qpm-discovery-dot--fading {
      animation: none;
      opacity: 0;
      transition: opacity 200ms ease;
    }

    /* ── Help panel ───────────────────────────────────────────── */
    .qpm-help-panel {
      position: absolute;
      inset: 0;
      background: var(--qpm-surface-2, rgba(22, 25, 38, 0.98));
      border-radius: 0 0 8px 8px;
      z-index: 100;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .qpm-help-panel__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      border-bottom: 1px solid var(--qpm-divider, rgba(120, 130, 170, 0.2));
    }
    .qpm-help-panel__title {
      font-size: 14px;
      font-weight: 600;
      color: var(--qpm-text, #eef0ff);
    }
    .qpm-help-panel__close {
      width: 24px;
      height: 24px;
      border: none;
      background: rgba(255,255,255,0.08);
      color: var(--qpm-text-muted, #97a0c0);
      font-size: 14px;
      cursor: pointer;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s ease;
    }
    .qpm-help-panel__close:hover {
      background: rgba(255,255,255,0.15);
      color: var(--qpm-text, #eef0ff);
    }
    .qpm-help-panel__body {
      flex: 1;
      overflow-y: auto;
      padding: 12px 16px;
    }
    .qpm-help-panel__group-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 0;
      cursor: pointer;
      user-select: none;
    }
    .qpm-help-panel__group-label {
      font-size: 12px;
      font-weight: 600;
      color: var(--qpm-text-muted, #97a0c0);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .qpm-help-panel__group-count {
      font-size: 11px;
      color: rgba(224, 224, 224, 0.4);
    }
    .qpm-help-panel__card {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 10px;
      border-radius: 6px;
      margin-bottom: 4px;
      transition: background 0.15s ease;
    }
    .qpm-help-panel__card:hover {
      background: rgba(143, 130, 255, 0.06);
    }
    .qpm-help-panel__card-icon {
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      flex-shrink: 0;
    }
    .qpm-help-panel__card-content {
      flex: 1;
      min-width: 0;
    }
    .qpm-help-panel__card-title {
      font-size: 12px;
      font-weight: 600;
      color: var(--qpm-text, #eef0ff);
    }
    .qpm-help-panel__card-body {
      font-size: 11px;
      color: var(--qpm-text-muted, #97a0c0);
      line-height: 1.4;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .qpm-help-panel__show-me {
      padding: 4px 10px;
      font-size: 11px;
      font-weight: 600;
      color: var(--qpm-accent, #8f82ff);
      background: rgba(143, 130, 255, 0.1);
      border: 1px solid rgba(143, 130, 255, 0.25);
      border-radius: 12px;
      cursor: pointer;
      white-space: nowrap;
      flex-shrink: 0;
      transition: all 0.15s ease;
    }
    .qpm-help-panel__show-me:hover {
      background: rgba(143, 130, 255, 0.2);
      border-color: rgba(143, 130, 255, 0.4);
    }
    .qpm-help-panel__replay-link {
      padding: 12px 16px;
      border-top: 1px solid var(--qpm-divider, rgba(120, 130, 170, 0.2));
      font-size: 11px;
      color: var(--qpm-accent, #8f82ff);
      cursor: pointer;
      text-align: center;
      user-select: none;
    }
    .qpm-help-panel__replay-link:hover {
      color: var(--qpm-accent-strong, #b39cff);
    }
  `;
  document.head.appendChild(style);
}
