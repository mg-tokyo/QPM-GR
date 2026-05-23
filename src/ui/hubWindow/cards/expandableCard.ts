// src/ui/hubWindow/cards/expandableCard.ts

import type { ExpandableCardConfig } from './types';
import { buildIconBox } from './iconRenderer';
import { t } from '../../../i18n';

export interface ExpandableCardResult {
  element: HTMLElement;
  expand: () => void;
  collapse: () => void;
  isExpanded: () => boolean;
  cleanup: () => void;
}

export function renderExpandableCard(config: ExpandableCardConfig): ExpandableCardResult {
  const cleanups: Array<() => void> = [];
  let expanded = false;
  let expandedCleanup: (() => void) | null = null;

  const container = document.createElement('div');
  container.style.cssText = [
    'background:rgba(255,255,255,0.03)',
    'border:1px solid rgba(143,130,255,0.18)',
    'border-radius:10px',
    'transition:border-color 0.2s,box-shadow 0.2s,background 0.15s',
  ].join(';');

  // Header row
  const header = document.createElement('div');
  header.style.cssText = [
    'display:flex',
    'align-items:center',
    'gap:10px',
    'padding:14px 16px',
    'cursor:pointer',
    'user-select:none',
    'transition:background 0.15s',
    'border-radius:10px',
  ].join(';');
  header.addEventListener('mouseenter', () => {
    if (!expanded) container.style.background = 'rgba(143,130,255,0.06)';
  });
  header.addEventListener('mouseleave', () => {
    if (!expanded) container.style.background = 'rgba(255,255,255,0.03)';
  });

  // Icon
  const iconBox = buildIconBox(config.icon);

  // Info
  const info = document.createElement('div');
  info.style.cssText = 'flex:1;min-width:0;';

  const title = document.createElement('div');
  title.style.cssText = `font-size:14px;font-weight:600;color:${config.labelColor ?? '#e0e0e0'};`;
  title.textContent = config.label;

  const summaryEl = document.createElement('div');
  summaryEl.style.cssText = 'font-size:12px;color:rgba(224,224,224,0.45);margin-top:2px;';
  const summaryCleanup = config.renderSummary(summaryEl);
  if (summaryCleanup) cleanups.push(summaryCleanup);

  info.append(title, summaryEl);

  // Expand button (visible when collapsed, hidden when expanded)
  const expandBtn = document.createElement('button');
  expandBtn.type = 'button';
  expandBtn.textContent = t('hub.card.expand');
  expandBtn.style.cssText = [
    'background:rgba(143,130,255,0.12)',
    'color:#c8c0ff',
    'border:1px solid rgba(143,130,255,0.3)',
    'border-radius:6px',
    'padding:6px 12px',
    'font-size:12px',
    'font-weight:500',
    'cursor:pointer',
    'transition:background 0.15s,border-color 0.15s',
    'flex-shrink:0',
    'white-space:nowrap',
  ].join(';');
  expandBtn.addEventListener('mouseenter', () => {
    expandBtn.style.background = 'rgba(143,130,255,0.25)';
    expandBtn.style.borderColor = 'rgba(143,130,255,0.5)';
  });
  expandBtn.addEventListener('mouseleave', () => {
    expandBtn.style.background = 'rgba(143,130,255,0.12)';
    expandBtn.style.borderColor = 'rgba(143,130,255,0.3)';
  });
  expandBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    config.onBeforeExpand?.();
    expand();
  });

  // Detach button (hidden until expanded)
  const detachBtn = document.createElement('button');
  detachBtn.type = 'button';
  detachBtn.title = t('hub.card.detachTooltip');
  detachBtn.style.cssText = [
    'display:none',
    'background:var(--qpm-accent-tint)',
    'border:1px solid rgba(143,130,255,0.2)',
    'color:var(--qpm-accent)',
    'font-size:12px',
    'cursor:pointer',
    'padding:3px 6px',
    'border-radius:4px',
    'transition:background 0.15s,border-color 0.15s',
    'flex-shrink:0',
  ].join(';');
  detachBtn.textContent = '↗';
  detachBtn.addEventListener('mouseenter', () => {
    detachBtn.style.background = 'rgba(143,130,255,0.18)';
    detachBtn.style.borderColor = 'rgba(143,130,255,0.4)';
  });
  detachBtn.addEventListener('mouseleave', () => {
    detachBtn.style.background = 'rgba(143,130,255,0.08)';
    detachBtn.style.borderColor = 'rgba(143,130,255,0.2)';
  });
  if (config.onDetach) {
    detachBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      config.onDetach!();
    });
  }

  header.append(iconBox, info, expandBtn, detachBtn);

  // Expanded content area — no max-height so trackers/filters can fill naturally
  // overflow-y left to 'visible' so scroll events propagate to the hub's scroll container
  const body = document.createElement('div');
  body.setAttribute('data-card-body', '');
  body.style.cssText = [
    'display:none',
    'border-top:1px solid rgba(143,130,255,0.1)',
    'padding:12px 14px',
  ].join(';');

  container.append(header, body);

  const expand = () => {
    if (expanded) return;
    expanded = true;
    body.style.display = 'block';
    container.style.background = 'rgba(143,130,255,0.06)';
    container.style.borderColor = 'rgba(143,130,255,0.35)';
    container.style.boxShadow = '0 2px 12px rgba(143,130,255,0.08)';
    expandBtn.style.display = 'none';
    if (config.detachWindowId) detachBtn.style.display = 'block';

    // Render expanded content
    body.innerHTML = '';
    const cleanup = config.renderExpanded(body);
    if (cleanup) expandedCleanup = cleanup;
  };

  const collapse = () => {
    if (!expanded) return;
    expanded = false;
    body.style.display = 'none';
    container.style.background = 'rgba(255,255,255,0.03)';
    container.style.borderColor = 'rgba(143,130,255,0.18)';
    container.style.boxShadow = 'none';
    expandBtn.style.display = 'block';
    detachBtn.style.display = 'none';

    // Clean up expanded content
    if (expandedCleanup) {
      expandedCleanup();
      expandedCleanup = null;
    }
    body.innerHTML = '';
  };

  header.addEventListener('click', () => {
    if (expanded) {
      config.onBeforeCollapse?.();
      collapse();
    } else {
      config.onBeforeExpand?.();
      expand();
    }
  });

  return {
    element: container,
    expand,
    collapse,
    isExpanded: () => expanded,
    cleanup: () => {
      if (expandedCleanup) expandedCleanup();
      cleanups.forEach(fn => fn());
      cleanups.length = 0;
    },
  };
}
