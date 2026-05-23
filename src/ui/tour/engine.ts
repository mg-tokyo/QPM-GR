// src/ui/tour/engine.ts

import type { TourDefinition, TourStep } from './types';
import { readTourProgress, writeTourProgress } from './persistence';
import { createOverlay, updateOverlayStep, updateSpotlightPosition, destroyOverlay } from './overlay';
import { lookupTour } from './registry';
import { log } from '../../utils/logger';

// ── Types ─────────────────────────────────────────────────────

interface ActiveTour {
  definition: TourDefinition;
  windowBody: HTMLElement;
  currentStepIndex: number;
  currentTarget: HTMLElement | null;
  rafId: number | null;
  clickHandler: ((e: Event) => void) | null;
}

interface QueuedTour {
  windowId: string;
  windowBody: HTMLElement;
}

// ── State ─────────────────────────────────────────────────────

let activeTour: ActiveTour | null = null;
const queue: QueuedTour[] = [];

const WAIT_FOR_POLL_MS = 200;
const WAIT_FOR_TIMEOUT_MS = 5000;

// ── Helpers ───────────────────────────────────────────────────

/** Resolve the target element for a step. */
function resolveTarget(step: TourStep, windowBody: HTMLElement): HTMLElement | null {
  if (step.resolve) {
    return step.resolve(windowBody);
  }
  if (step.selector) {
    return windowBody.querySelector<HTMLElement>(step.selector);
  }
  return null;
}

/** Wait for an element to appear in the DOM (for lazy-rendered content). */
function waitForElement(
  step: TourStep,
  windowBody: HTMLElement,
): Promise<HTMLElement | null> {
  const waitFor = step.waitFor;
  if (!waitFor) {
    return Promise.resolve(resolveTarget(step, windowBody));
  }

  return new Promise((resolve) => {
    const start = Date.now();

    const poll = () => {
      // Check the waitFor condition
      let ready = false;
      if (typeof waitFor === 'string') {
        ready = windowBody.querySelector(waitFor) !== null;
      } else {
        ready = waitFor() !== null;
      }

      if (ready) {
        resolve(resolveTarget(step, windowBody));
        return;
      }

      if (Date.now() - start > WAIT_FOR_TIMEOUT_MS) {
        log(`[Tour] waitFor timed out for step "${step.id}", skipping`);
        resolve(null);
        return;
      }

      setTimeout(poll, WAIT_FOR_POLL_MS);
    };

    poll();
  });
}

/** Scroll the target into view within the window body if needed. */
function ensureVisible(target: HTMLElement, windowBody: HTMLElement): void {
  // Find the nearest scrollable ancestor within the window body
  let scrollParent: HTMLElement | null = target.parentElement;
  while (scrollParent && scrollParent !== windowBody) {
    if (scrollParent.scrollHeight > scrollParent.clientHeight) {
      break;
    }
    scrollParent = scrollParent.parentElement;
  }

  if (scrollParent) {
    target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

/** Check if the target element is still visible and in the DOM. */
function isTargetAlive(target: HTMLElement): boolean {
  if (!document.body.contains(target)) return false;
  const style = window.getComputedStyle(target);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  // Check parent window visibility
  const win = target.closest('.qpm-window, .qpm-panel');
  if (win) {
    const winStyle = window.getComputedStyle(win);
    if (winStyle.display === 'none') return false;
  }
  return true;
}

// ── rAF position tracking ─────────────────────────────────────

function startPositionTracking(): void {
  if (!activeTour) return;

  const track = () => {
    if (!activeTour) return;

    const target = activeTour.currentTarget;
    if (target && isTargetAlive(target)) {
      updateSpotlightPosition(target);
      activeTour.rafId = requestAnimationFrame(track);
    } else {
      // Target disappeared (window closed) — persist and teardown
      persistCurrentProgress();
      void teardown();
    }
  };

  activeTour.rafId = requestAnimationFrame(track);
}

function stopPositionTracking(): void {
  if (activeTour?.rafId != null) {
    cancelAnimationFrame(activeTour.rafId);
    activeTour.rafId = null;
  }
}

// ── Step progression ──────────────────────────────────────────

function persistCurrentProgress(): void {
  if (!activeTour) return;

  writeTourProgress(activeTour.definition.windowId, {
    version: activeTour.definition.version,
    lastCompletedStep: activeTour.currentStepIndex - 1,
    completed: false,
  });
}

function markCompleted(): void {
  if (!activeTour) return;

  writeTourProgress(activeTour.definition.windowId, {
    version: activeTour.definition.version,
    lastCompletedStep: activeTour.definition.steps.length - 1,
    completed: true,
  });
}

async function showStep(index: number): Promise<void> {
  if (!activeTour) return;

  const { definition, windowBody } = activeTour;
  const steps = definition.steps;

  if (index >= steps.length) {
    // Tour complete
    markCompleted();
    await teardown();
    return;
  }

  const step = steps[index]!;
  activeTour.currentStepIndex = index;

  // Remove previous click handler
  if (activeTour.clickHandler) {
    document.removeEventListener('click', activeTour.clickHandler, true);
    activeTour.clickHandler = null;
  }

  stopPositionTracking();

  // Resolve target (with waitFor if needed)
  const target = await waitForElement(step, windowBody);
  if (!target) {
    // Skip this step, try next
    log(`[Tour] Target not found for step "${step.id}", skipping`);
    await showStep(index + 1);
    return;
  }

  activeTour.currentTarget = target;
  ensureVisible(target, windowBody);

  // Small delay to let scroll settle
  await new Promise((r) => setTimeout(r, 100));

  const isLastStep = index === steps.length - 1;

  updateOverlayStep({
    target,
    step,
    stepIndex: index,
    totalSteps: steps.length,
    isLastStep,
    onNext: () => {
      writeTourProgress(definition.windowId, {
        version: definition.version,
        lastCompletedStep: index,
        completed: false,
      });
      void showStep(index + 1);
    },
    onSkip: () => {
      markCompleted();
      void teardown();
    },
  });

  // Set up advanceOn: 'click' handler
  if (step.advanceOn === 'click') {
    const handler = (e: Event) => {
      if (target.contains(e.target as Node)) {
        document.removeEventListener('click', handler, true);
        activeTour!.clickHandler = null;

        writeTourProgress(definition.windowId, {
          version: definition.version,
          lastCompletedStep: index,
          completed: false,
        });
        void showStep(index + 1);
      }
    };
    activeTour.clickHandler = handler;
    document.addEventListener('click', handler, true);
  }

  startPositionTracking();
}

// ── Public API ────────────────────────────────────────────────

/** Teardown the active tour overlay and clean up state. */
export async function teardown(): Promise<void> {
  if (!activeTour) return;

  stopPositionTracking();

  if (activeTour.clickHandler) {
    document.removeEventListener('click', activeTour.clickHandler, true);
  }

  activeTour = null;
  await destroyOverlay();

  // Process queue
  processQueue();
}

/** Start a specific tour. Used internally and by the replay button. */
export async function startTour(definition: TourDefinition, windowBody: HTMLElement, fromStep: number): Promise<void> {
  // If there's an active tour, queue this one
  if (activeTour) {
    // Don't queue duplicates
    if (!queue.some((q) => q.windowId === definition.windowId)) {
      queue.push({ windowId: definition.windowId, windowBody });
    }
    return;
  }

  activeTour = {
    definition,
    windowBody,
    currentStepIndex: fromStep,
    currentTarget: null,
    rafId: null,
    clickHandler: null,
  };

  createOverlay();
  await showStep(fromStep);
}

function processQueue(): void {
  if (activeTour) return;
  if (queue.length === 0) return;

  const next = queue.shift()!;
  const definition = lookupTour(next.windowId);
  if (!definition) return;

  // Re-check progress (it may have been completed while queued)
  const progress = readTourProgress(next.windowId);
  if (progress?.completed && progress.version === definition.version) return;

  const startStep = progress ? progress.lastCompletedStep + 1 : 0;
  void startTour(definition, next.windowBody, startStep);
}

/**
 * Check if a tour should start for a given window.
 * Called from window render callbacks. This is the main integration point.
 */
export function check(windowId: string, windowBody: HTMLElement): void {
  const definition = lookupTour(windowId);
  if (!definition) return;

  const progress = readTourProgress(windowId);

  // Already completed at current version
  if (progress?.completed && progress.version === definition.version) return;

  // Version changed — restart from beginning
  if (progress && progress.version !== definition.version) {
    void startTour(definition, windowBody, 0);
    return;
  }

  // Resume from where we left off
  const startStep = progress ? progress.lastCompletedStep + 1 : 0;
  if (startStep >= definition.steps.length) {
    // Edge case: progress says all steps done but not marked completed
    markCompleted();
    return;
  }

  void startTour(definition, windowBody, startStep);
}

/**
 * Reset a single tour's progress and restart it.
 * Used by the replay `?` button.
 */
export function replayTour(windowId: string, windowBody: HTMLElement): void {
  const definition = lookupTour(windowId);
  if (!definition) return;

  // If this tour is currently active, teardown first
  if (activeTour?.definition.windowId === windowId) {
    void teardown().then(() => {
      void startTour(definition, windowBody, 0);
    });
    return;
  }

  void startTour(definition, windowBody, 0);
}

/** Check if a tour is currently active. */
export function isActive(): boolean {
  return activeTour !== null;
}

/** Get the window ID of the currently active tour, if any. */
export function activeWindowId(): string | null {
  return activeTour?.definition.windowId ?? null;
}
