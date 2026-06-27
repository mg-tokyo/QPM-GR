// src/diagnostics/panelBadge.ts — invisible-when-ok titlebar health dot (§8.1)

import { toggleWindow } from '../ui/core/modalWindow';
import { healthBus } from './healthBus';
import {
  DIAGNOSTICS_WINDOW_ID,
  DIAGNOSTICS_WINDOW_TITLE,
  renderDiagnosticsWindow,
} from './diagnosticsWindow';

let badgeEl: HTMLElement | null = null;
let unsubscribe: (() => void) | null = null;

function open(): void {
  toggleWindow(DIAGNOSTICS_WINDOW_ID, DIAGNOSTICS_WINDOW_TITLE, renderDiagnosticsWindow, '720px', '78vh');
}

function applyAggregateState(): void {
  if (!badgeEl) return;
  const status = healthBus.aggregate();
  if (status === 'ok') {
    badgeEl.style.display = 'none';
    badgeEl.title = '';
    return;
  }
  badgeEl.style.display = 'inline-block';
  if (status === 'failed') {
    badgeEl.style.background = '#f44336';
    badgeEl.style.boxShadow = '0 0 3px rgba(244, 67, 54, 0.55)';
    badgeEl.title = 'QPM diagnostics: a subsystem has failed. Click to view.';
  } else {
    // degraded (covers recovering)
    badgeEl.style.background = '#ffb347';
    badgeEl.style.boxShadow = '0 0 3px rgba(255, 179, 71, 0.55)';
    badgeEl.title = 'QPM diagnostics: a subsystem is degraded. Click to view.';
  }
}

/**
 * Inserts the badge into the QPM panel titlebar. Idempotent — safe to call
 * multiple times.
 */
export function mountPanelBadge(): void {
  if (badgeEl && badgeEl.isConnected) return;

  const titleBar = document.querySelector('.qpm-panel__titlebar');
  if (!titleBar) return;

  const dot = document.createElement('button');
  dot.type = 'button';
  dot.setAttribute('data-qpm-diagnostics-dot', 'true');
  dot.style.cssText = [
    'display:none', // invisible-when-ok
    'width:6px',
    'height:6px',
    'min-width:6px',
    'padding:0',
    'border:none',
    'border-radius:9999px',
    'cursor:pointer',
    'margin-left:8px',
    'opacity:0.75',
    'flex-shrink:0',
  ].join(';');

  dot.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    open();
  });

  // Mount at the far right of the titlebar — after the collapse button so
  // it sits as an unobtrusive trailing indicator rather than crowding the
  // QPM title text.
  titleBar.appendChild(dot);

  badgeEl = dot;
  applyAggregateState();

  if (!unsubscribe) {
    unsubscribe = healthBus.subscribe(() => {
      queueMicrotask(applyAggregateState);
    });
  }
}

export function unmountPanelBadge(): void {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  if (badgeEl) {
    badgeEl.remove();
    badgeEl = null;
  }
}

export function isPanelBadgeMounted(): boolean {
  return badgeEl !== null && badgeEl.isConnected;
}
