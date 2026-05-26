// src/ui/tour/discovery/engine.ts

import type { DiscoveryDefinition } from '../types';
import { lookupDiscovery, lookupTour } from '../registry';
import { readDiscoveredIds, markDiscovered, areToursEnabled, readTourProgress } from '../persistence';

// ── Types ─────────────────────────────────────────────────────

interface ActiveDot {
  itemId: string;
  element: HTMLElement;
  targetSelector: string;
}

interface DiscoverySession {
  windowId: string;
  windowBody: HTMLElement;
  definition: DiscoveryDefinition;
  activeDots: ActiveDot[];
  rafId: number | null;
  clickHandler: ((e: Event) => void) | null;
}

// ── State ─────────────────────────────────────────────────────

const sessions = new Map<string, DiscoverySession>();

// ── Public API ────────────────────────────────────────────────

/**
 * Start discovery dots for a window. Call after the auto-tour completes
 * or if the tour is already completed. Idempotent — won't double-init.
 */
export function startDiscovery(windowId: string, windowBody: HTMLElement): void {
  if (!areToursEnabled()) return;
  if (sessions.has(windowId)) return;

  // Only start after the auto-tour for this window is completed
  const tourDef = lookupTour(windowId);
  if (tourDef) {
    const progress = readTourProgress(windowId);
    if (!progress?.completed) return;
  }

  const definition = lookupDiscovery(windowId);
  if (!definition) return;

  const session: DiscoverySession = {
    windowId,
    windowBody,
    definition,
    activeDots: [],
    rafId: null,
    clickHandler: null,
  };

  sessions.set(windowId, session);
  renderDots(session);
  startTracking(session);

  // Listen for clicks on dotted elements
  const handler = (e: Event) => {
    const target = e.target as HTMLElement;
    for (const dot of session.activeDots) {
      const targetEl = session.windowBody.querySelector(dot.targetSelector);
      if (targetEl && targetEl.contains(target)) {
        markDiscovered(windowId, dot.itemId);
        removeDot(session, dot);
        renderDots(session);
        break;
      }
    }
  };
  document.addEventListener('click', handler, true);
  session.clickHandler = handler;
}

/** Stop discovery dots for a window. Call when the window closes. */
export function stopDiscovery(windowId: string): void {
  const session = sessions.get(windowId);
  if (!session) return;

  if (session.rafId != null) cancelAnimationFrame(session.rafId);
  if (session.clickHandler) document.removeEventListener('click', session.clickHandler, true);

  for (const dot of session.activeDots) dot.element.remove();
  sessions.delete(windowId);
}

// ── Internal ──────────────────────────────────────────────────

function renderDots(session: DiscoverySession): void {
  const { definition, windowBody, windowId } = session;
  const discovered = readDiscoveredIds(windowId);

  const undiscovered = definition.items.filter((item) => !discovered.includes(item.id));
  const slotsAvailable = definition.maxVisible - session.activeDots.length;
  if (slotsAvailable <= 0) return;

  const shownIds = new Set(session.activeDots.map((d) => d.itemId));
  const toShow = undiscovered.filter((item) => !shownIds.has(item.id)).slice(0, slotsAvailable);

  for (const item of toShow) {
    const targetEl = windowBody.querySelector<HTMLElement>(item.selector);
    if (!targetEl) continue;

    const dot = document.createElement('div');
    dot.className = 'qpm-discovery-dot';
    dot.dataset.discoveryId = item.id;
    document.body.appendChild(dot);
    positionDot(dot, targetEl);

    session.activeDots.push({ itemId: item.id, element: dot, targetSelector: item.selector });
  }
}

function positionDot(dot: HTMLElement, target: HTMLElement): void {
  const rect = target.getBoundingClientRect();
  dot.style.left = `${rect.right - 4}px`;
  dot.style.top = `${rect.top - 4}px`;
}

function removeDot(session: DiscoverySession, dot: ActiveDot): void {
  dot.element.classList.add('qpm-discovery-dot--fading');
  setTimeout(() => dot.element.remove(), 200);
  session.activeDots = session.activeDots.filter((d) => d !== dot);
}

function startTracking(session: DiscoverySession): void {
  const track = () => {
    if (!sessions.has(session.windowId)) return;

    if (!document.body.contains(session.windowBody)) {
      stopDiscovery(session.windowId);
      return;
    }

    // Collect stale dots, apply removals after iteration
    const toRemove: ActiveDot[] = [];
    for (const dot of session.activeDots) {
      const targetEl = session.windowBody.querySelector<HTMLElement>(dot.targetSelector);
      if (targetEl) {
        positionDot(dot.element, targetEl);
      } else {
        dot.element.remove();
        toRemove.push(dot);
      }
    }
    if (toRemove.length > 0) {
      session.activeDots = session.activeDots.filter((d) => !toRemove.includes(d));
    }

    session.rafId = requestAnimationFrame(track);
  };

  session.rafId = requestAnimationFrame(track);
}
