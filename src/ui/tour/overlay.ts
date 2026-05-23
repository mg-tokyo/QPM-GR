// src/ui/tour/overlay.ts

import type { TourPlacement, TourStep } from './types';
import { ensureTourStyles } from './styles';

// ── Constants ─────────────────────────────────────────────────

const OVERLAY_ID = 'qpm-tour-overlay';
const SVG_NS = 'http://www.w3.org/2000/svg';
const SPOTLIGHT_PADDING = 6;
const SPOTLIGHT_RADIUS = 8;
const TOOLTIP_GAP = 12;
const ARROW_SIZE = 12;

// ── Overlay DOM refs ──────────────────────────────────────────

interface OverlayRefs {
  root: HTMLElement;
  svg: SVGSVGElement;
  maskRect: SVGRectElement;
  dimRect: SVGRectElement;
  spotlightBorder: HTMLElement;
  tooltip: HTMLElement;
  arrow: HTMLElement;
  titleEl: HTMLElement;
  bodyEl: HTMLElement;
  dotsContainer: HTMLElement;
  skipBtn: HTMLElement;
  nextBtn: HTMLElement;
}

let refs: OverlayRefs | null = null;

// ── Spotlight rect tracking ───────────────────────────────────

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Get bounding rect of an element with spotlight padding. */
function getSpotlightRect(el: HTMLElement): Rect {
  const r = el.getBoundingClientRect();
  return {
    x: r.left - SPOTLIGHT_PADDING,
    y: r.top - SPOTLIGHT_PADDING,
    width: r.width + SPOTLIGHT_PADDING * 2,
    height: r.height + SPOTLIGHT_PADDING * 2,
  };
}

// ── Create overlay ────────────────────────────────────────────

/** Build the overlay DOM. Idempotent — returns existing refs if already mounted. */
export function createOverlay(): OverlayRefs {
  ensureTourStyles();

  if (refs && document.body.contains(refs.root)) return refs;

  // Root container
  const root = document.createElement('div');
  root.id = OVERLAY_ID;
  root.className = 'qpm-tour--entering';

  // SVG overlay with mask
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  svg.style.cssText = 'position:absolute;inset:0;';

  const defs = document.createElementNS(SVG_NS, 'defs');
  const mask = document.createElementNS(SVG_NS, 'mask');
  mask.id = 'qpm-tour-spotlight-mask';

  const whiteFill = document.createElementNS(SVG_NS, 'rect');
  whiteFill.setAttribute('fill', 'white');
  whiteFill.setAttribute('width', '100%');
  whiteFill.setAttribute('height', '100%');

  const maskRect = document.createElementNS(SVG_NS, 'rect');
  maskRect.setAttribute('fill', 'black');
  maskRect.setAttribute('rx', String(SPOTLIGHT_RADIUS));
  // Start offscreen
  maskRect.setAttribute('x', '-100');
  maskRect.setAttribute('y', '-100');
  maskRect.setAttribute('width', '0');
  maskRect.setAttribute('height', '0');

  mask.appendChild(whiteFill);
  mask.appendChild(maskRect);
  defs.appendChild(mask);
  svg.appendChild(defs);

  const dimRect = document.createElementNS(SVG_NS, 'rect');
  dimRect.setAttribute('fill', 'rgba(0,0,0,0.6)');
  dimRect.setAttribute('mask', 'url(#qpm-tour-spotlight-mask)');
  dimRect.setAttribute('width', '100%');
  dimRect.setAttribute('height', '100%');
  svg.appendChild(dimRect);

  root.appendChild(svg);

  // Spotlight accent border
  const spotlightBorder = document.createElement('div');
  spotlightBorder.className = 'qpm-tour-spotlight-border';
  root.appendChild(spotlightBorder);

  // Tooltip
  const tooltip = document.createElement('div');
  tooltip.className = 'qpm-tour-tooltip qpm-tour-tooltip--entering';

  const arrow = document.createElement('div');
  arrow.className = 'qpm-tour-arrow';

  const titleEl = document.createElement('div');
  titleEl.className = 'qpm-tour-title';

  const bodyEl = document.createElement('div');
  bodyEl.className = 'qpm-tour-body';

  const footer = document.createElement('div');
  footer.className = 'qpm-tour-footer';

  const dotsContainer = document.createElement('div');
  dotsContainer.className = 'qpm-tour-dots';

  const actions = document.createElement('div');
  actions.className = 'qpm-tour-actions';

  const skipBtn = document.createElement('span');
  skipBtn.className = 'qpm-tour-skip';
  skipBtn.textContent = 'Skip';

  const nextBtn = document.createElement('span');
  nextBtn.className = 'qpm-tour-next';
  nextBtn.textContent = 'Next \u2192';

  actions.appendChild(skipBtn);
  actions.appendChild(nextBtn);
  footer.appendChild(dotsContainer);
  footer.appendChild(actions);

  tooltip.appendChild(arrow);
  tooltip.appendChild(titleEl);
  tooltip.appendChild(bodyEl);
  tooltip.appendChild(footer);
  root.appendChild(tooltip);

  document.body.appendChild(root);

  refs = {
    root, svg, maskRect, dimRect, spotlightBorder,
    tooltip, arrow, titleEl, bodyEl, dotsContainer,
    skipBtn, nextBtn,
  };

  // Trigger entrance animation
  requestAnimationFrame(() => {
    root.classList.remove('qpm-tour--entering');
    root.classList.add('qpm-tour--visible');
  });

  return refs;
}

// ── Update overlay for a step ─────────────────────────────────

export interface UpdateStepParams {
  target: HTMLElement;
  step: TourStep;
  stepIndex: number;
  totalSteps: number;
  isLastStep: boolean;
  onNext: () => void;
  onSkip: () => void;
}

/**
 * Compute the best placement for the tooltip given the target rect.
 * Prefers the step's declared placement; falls back to whichever side has the most space.
 */
function computePlacement(targetRect: Rect, preferred: TourPlacement | undefined): Exclude<TourPlacement, 'auto'> {
  if (preferred && preferred !== 'auto') {
    return preferred;
  }

  const spaceTop = targetRect.y;
  const spaceBottom = window.innerHeight - (targetRect.y + targetRect.height);
  const spaceLeft = targetRect.x;
  const spaceRight = window.innerWidth - (targetRect.x + targetRect.width);

  const max = Math.max(spaceTop, spaceBottom, spaceLeft, spaceRight);
  if (max === spaceBottom) return 'bottom';
  if (max === spaceTop) return 'top';
  if (max === spaceRight) return 'right';
  return 'left';
}

/**
 * Position the tooltip relative to the target rect and placement.
 * Clamps to viewport. Adjusts arrow offset to maintain visual connection.
 */
function positionTooltip(
  tooltip: HTMLElement,
  arrow: HTMLElement,
  targetRect: Rect,
  placement: Exclude<TourPlacement, 'auto'>,
): void {
  tooltip.setAttribute('data-placement', placement);

  // Measure tooltip (needs to be visible for dimensions)
  const tw = tooltip.offsetWidth;
  const th = tooltip.offsetHeight;

  let left = 0;
  let top = 0;

  switch (placement) {
    case 'bottom':
      left = targetRect.x + targetRect.width / 2 - tw / 2;
      top = targetRect.y + targetRect.height + TOOLTIP_GAP;
      break;
    case 'top':
      left = targetRect.x + targetRect.width / 2 - tw / 2;
      top = targetRect.y - th - TOOLTIP_GAP;
      break;
    case 'right':
      left = targetRect.x + targetRect.width + TOOLTIP_GAP;
      top = targetRect.y + targetRect.height / 2 - th / 2;
      break;
    case 'left':
      left = targetRect.x - tw - TOOLTIP_GAP;
      top = targetRect.y + targetRect.height / 2 - th / 2;
      break;
  }

  // Clamp to viewport
  const margin = 8;
  const clampedLeft = Math.max(margin, Math.min(left, window.innerWidth - tw - margin));
  const clampedTop = Math.max(margin, Math.min(top, window.innerHeight - th - margin));

  tooltip.style.left = `${clampedLeft}px`;
  tooltip.style.top = `${clampedTop}px`;

  // Arrow position: centered on the target's edge, adjusted for tooltip clamping
  const arrowOffset = (placement === 'top' || placement === 'bottom')
    ? Math.max(16, Math.min(targetRect.x + targetRect.width / 2 - clampedLeft - ARROW_SIZE / 2, tw - 28))
    : Math.max(16, Math.min(targetRect.y + targetRect.height / 2 - clampedTop - ARROW_SIZE / 2, th - 28));

  if (placement === 'top' || placement === 'bottom') {
    arrow.style.left = `${arrowOffset}px`;
    arrow.style.top = '';
    arrow.style.right = '';
    arrow.style.bottom = '';
  } else {
    arrow.style.top = `${arrowOffset}px`;
    arrow.style.left = '';
    arrow.style.right = '';
    arrow.style.bottom = '';
  }
}

/** Update the overlay to show a specific step. */
export function updateOverlayStep(params: UpdateStepParams): void {
  const overlay = refs ?? createOverlay();
  const { target, step, stepIndex, totalSteps, isLastStep, onNext, onSkip } = params;

  const rect = getSpotlightRect(target);

  // Update SVG mask cutout
  overlay.maskRect.setAttribute('x', String(rect.x));
  overlay.maskRect.setAttribute('y', String(rect.y));
  overlay.maskRect.setAttribute('width', String(rect.width));
  overlay.maskRect.setAttribute('height', String(rect.height));

  // Update spotlight border
  overlay.spotlightBorder.style.left = `${rect.x - 1}px`;
  overlay.spotlightBorder.style.top = `${rect.y - 1}px`;
  overlay.spotlightBorder.style.width = `${rect.width + 2}px`;
  overlay.spotlightBorder.style.height = `${rect.height + 2}px`;

  // Update tooltip content
  overlay.titleEl.textContent = step.title;
  overlay.bodyEl.textContent = step.body;
  overlay.nextBtn.textContent = isLastStep ? 'Done \u2713' : 'Next \u2192';

  // Update dots
  overlay.dotsContainer.innerHTML = '';
  for (let i = 0; i < totalSteps; i++) {
    const dot = document.createElement('span');
    dot.className = `qpm-tour-dot${i === stepIndex ? ' qpm-tour-dot--active' : ''}`;
    overlay.dotsContainer.appendChild(dot);
  }

  // Position tooltip
  const placement = computePlacement(rect, step.placement);
  positionTooltip(overlay.tooltip, overlay.arrow, rect, placement);

  // Show tooltip with entrance animation
  overlay.tooltip.classList.remove('qpm-tour-tooltip--visible');
  overlay.tooltip.classList.add('qpm-tour-tooltip--entering');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      overlay.tooltip.classList.remove('qpm-tour-tooltip--entering');
      overlay.tooltip.classList.add('qpm-tour-tooltip--visible');
    });
  });

  // Rebind click handlers (clone-and-replace to remove old listeners)
  const newSkip = overlay.skipBtn.cloneNode(true) as HTMLElement;
  overlay.skipBtn.replaceWith(newSkip);
  overlay.skipBtn = newSkip;
  newSkip.addEventListener('click', (e) => { e.stopPropagation(); onSkip(); });

  const newNext = overlay.nextBtn.cloneNode(true) as HTMLElement;
  overlay.nextBtn.replaceWith(newNext);
  overlay.nextBtn = newNext;
  newNext.addEventListener('click', (e) => { e.stopPropagation(); onNext(); });
}

/** Update the SVG spotlight position (called from rAF loop). */
export function updateSpotlightPosition(target: HTMLElement): void {
  if (!refs) return;

  const rect = getSpotlightRect(target);

  refs.maskRect.setAttribute('x', String(rect.x));
  refs.maskRect.setAttribute('y', String(rect.y));
  refs.maskRect.setAttribute('width', String(rect.width));
  refs.maskRect.setAttribute('height', String(rect.height));

  refs.spotlightBorder.style.left = `${rect.x - 1}px`;
  refs.spotlightBorder.style.top = `${rect.y - 1}px`;
  refs.spotlightBorder.style.width = `${rect.width + 2}px`;
  refs.spotlightBorder.style.height = `${rect.height + 2}px`;
}

/** Remove the overlay from the DOM with exit animation. */
export function destroyOverlay(): Promise<void> {
  if (!refs) return Promise.resolve();

  const root = refs.root;
  refs = null;

  root.classList.remove('qpm-tour--visible');
  root.classList.add('qpm-tour--exiting');

  return new Promise((resolve) => {
    const onEnd = () => {
      root.remove();
      resolve();
    };
    root.addEventListener('transitionend', onEnd, { once: true });
    // Safety timeout in case transitionend doesn't fire
    setTimeout(onEnd, 300);
  });
}

/** Check if the overlay is currently mounted. */
export function isOverlayActive(): boolean {
  return refs !== null && document.body.contains(refs.root);
}
