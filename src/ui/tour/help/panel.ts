// src/ui/tour/help/panel.ts

import type { HelpPanelDefinition, HelpCard, HelpGroup } from '../types';
import { lookupHelp } from '../registry';
import { updateOverlayStep, destroyOverlay } from '../overlay';
import { logTourFailure } from '../engine';

// ── State ─────────────────────────────────────────────────────

let activePanel: HTMLElement | null = null;
let activeWindowBody: HTMLElement | null = null;

// ── Public API ────────────────────────────────────────────────

/**
 * Open the help panel for a window.
 * @param windowBody — the window's body element (panel overlays this)
 * @param getActiveWindowId — callback that returns the current tab's windowId
 */
export function openHelpPanel(
  windowBody: HTMLElement,
  getActiveWindowId: () => string,
): void {
  if (activePanel) closeHelpPanel();

  const windowId = getActiveWindowId();
  const definition = lookupHelp(windowId);
  if (!definition) return;

  activeWindowBody = windowBody;
  activePanel = renderPanel(definition, windowBody, getActiveWindowId);
  windowBody.style.position = 'relative';
  windowBody.appendChild(activePanel);
}

/** Close the help panel if open. */
export function closeHelpPanel(): void {
  if (activePanel) {
    activePanel.remove();
    activePanel = null;
    activeWindowBody = null;
  }
}

/** Check if the help panel is currently open. */
export function isHelpPanelOpen(): boolean {
  return activePanel !== null;
}

// ── Rendering ─────────────────────────────────────────────────

function renderPanel(
  definition: HelpPanelDefinition,
  windowBody: HTMLElement,
  getActiveWindowId: () => string,
): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'qpm-help-panel';

  const header = document.createElement('div');
  header.className = 'qpm-help-panel__header';

  const title = document.createElement('div');
  title.className = 'qpm-help-panel__title';
  title.textContent = 'Help & Tips';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'qpm-help-panel__close';
  closeBtn.textContent = '\u00d7';
  closeBtn.addEventListener('click', closeHelpPanel);

  header.appendChild(title);
  header.appendChild(closeBtn);
  panel.appendChild(header);

  const body = document.createElement('div');
  body.className = 'qpm-help-panel__body';

  for (const group of definition.groups) {
    body.appendChild(renderGroup(group, windowBody));
  }

  panel.appendChild(body);

  // Footer — replay link
  const replayLink = document.createElement('div');
  replayLink.className = 'qpm-help-panel__replay-link';
  replayLink.textContent = '\u21bb Replay intro tour';
  replayLink.addEventListener('click', () => {
    closeHelpPanel();
    const windowId = getActiveWindowId();
    import('../engine')
      .then(({ replayTour }) => {
        replayTour(windowId, windowBody);
      })
      .catch((err) => {
        logTourFailure('QPM-TOUR-001', { phase: 'helpPanelReplayImport', windowId }, err);
      });
  });
  panel.appendChild(replayLink);

  return panel;
}

function renderGroup(group: HelpGroup, windowBody: HTMLElement): HTMLElement {
  const container = document.createElement('div');

  const header = document.createElement('div');
  header.className = 'qpm-help-panel__group-header';

  const label = document.createElement('span');
  label.className = 'qpm-help-panel__group-label';
  label.textContent = `\u25be ${group.label}`;

  const count = document.createElement('span');
  count.className = 'qpm-help-panel__group-count';
  count.textContent = `${group.cards.length} tips`;

  header.appendChild(label);
  header.appendChild(count);
  container.appendChild(header);

  const cardsContainer = document.createElement('div');
  for (const card of group.cards) {
    cardsContainer.appendChild(renderCard(card, windowBody));
  }
  container.appendChild(cardsContainer);

  let collapsed = false;
  header.addEventListener('click', () => {
    collapsed = !collapsed;
    cardsContainer.style.display = collapsed ? 'none' : '';
    label.textContent = `${collapsed ? '\u25b8' : '\u25be'} ${group.label}`;
  });

  return container;
}

function renderCard(card: HelpCard, windowBody: HTMLElement): HTMLElement {
  const row = document.createElement('div');
  row.className = 'qpm-help-panel__card';

  const icon = document.createElement('div');
  icon.className = 'qpm-help-panel__card-icon';
  if (card.icon.kind === 'emoji') {
    icon.textContent = card.icon.value;
  } else {
    icon.textContent = '\u2728';
    import('../../../sprite-v2/compat')
      .then(({ renderBySpriteKey }) => {
        const canvas = renderBySpriteKey(card.icon.value);
        if (canvas) {
          icon.textContent = '';
          canvas.style.cssText = 'width:32px;height:32px;';
          icon.appendChild(canvas);
        }
      })
      .catch((err) => {
        // Sprite fetch failed — the ✨ fallback already painted above stays. Log so the bus
        // sees the failure instead of silently swallowing.
        logTourFailure('QPM-TOUR-001', { phase: 'helpPanelSpriteImport', icon: card.icon.value }, err);
      });
  }

  const content = document.createElement('div');
  content.className = 'qpm-help-panel__card-content';

  const titleEl = document.createElement('div');
  titleEl.className = 'qpm-help-panel__card-title';
  titleEl.textContent = card.title;

  const bodyEl = document.createElement('div');
  bodyEl.className = 'qpm-help-panel__card-body';
  bodyEl.textContent = card.body;

  content.appendChild(titleEl);
  content.appendChild(bodyEl);

  row.appendChild(icon);
  row.appendChild(content);

  if (card.showMeSelector) {
    const showMeBtn = document.createElement('button');
    showMeBtn.className = 'qpm-help-panel__show-me';
    showMeBtn.textContent = 'Show me';
    showMeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showMeSpotlight(card, windowBody);
    });
    row.appendChild(showMeBtn);
  }

  return row;
}

// ── "Show me" spotlight ───────────────────────────────────────

function showMeSpotlight(card: HelpCard, windowBody: HTMLElement): void {
  if (!card.showMeSelector) return;

  closeHelpPanel();

  const target = windowBody.querySelector<HTMLElement>(card.showMeSelector);
  if (!target) return;

  updateOverlayStep({
    target,
    step: {
      id: `help-show-me-${card.id}`,
      selector: card.showMeSelector,
      title: card.title,
      body: card.body,
      placement: 'auto',
    },
    stepIndex: 0,
    totalSteps: 1,
    isLastStep: true,
    onNext: () => { void destroyOverlay(); },
    onSkip: () => { void destroyOverlay(); },
  });
}
