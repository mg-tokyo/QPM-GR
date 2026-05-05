// src/ui/hubWindow/cards/expandableCard.ts

import type { ExpandableCardConfig } from './types';
import { buildIconBox } from './iconRenderer';

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
    'background:rgba(143,130,255,0.06)',
    'border:1px solid rgba(143,130,255,0.12)',
    'border-radius:8px',
    'transition:border-color 0.2s,box-shadow 0.2s',
  ].join(';');

  // Header row
  const header = document.createElement('div');
  header.style.cssText = [
    'display:flex',
    'align-items:center',
    'gap:10px',
    'padding:10px 14px',
    'cursor:pointer',
    'user-select:none',
    'transition:background 0.15s',
    'border-radius:8px',
  ].join(';');
  header.addEventListener('mouseenter', () => {
    if (!expanded) header.style.background = 'rgba(143,130,255,0.04)';
  });
  header.addEventListener('mouseleave', () => {
    header.style.background = 'transparent';
  });

  // Icon
  const iconBox = buildIconBox(config.icon);

  // Info
  const info = document.createElement('div');
  info.style.cssText = 'flex:1;min-width:0;';

  const title = document.createElement('div');
  title.style.cssText = 'font-size:13px;font-weight:500;color:#e8e0ff;';
  title.textContent = config.label;

  const summaryEl = document.createElement('div');
  summaryEl.style.cssText = 'font-size:10px;color:#776ea8;margin-top:2px;';
  const summaryCleanup = config.renderSummary(summaryEl);
  if (summaryCleanup) cleanups.push(summaryCleanup);

  info.append(title, summaryEl);

  // Chevron
  const chevron = document.createElement('span');
  chevron.style.cssText = 'font-size:11px;color:#776ea8;transition:color 0.15s,transform 0.2s;flex-shrink:0;';
  chevron.textContent = '▸';

  // Detach button (hidden until expanded)
  const detachBtn = document.createElement('button');
  detachBtn.type = 'button';
  detachBtn.title = 'Open in separate window';
  detachBtn.style.cssText = [
    'display:none',
    'background:rgba(143,130,255,0.08)',
    'border:1px solid rgba(143,130,255,0.2)',
    'color:#8f82ff',
    'font-size:13px',
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

  header.append(iconBox, info, detachBtn, chevron);

  // Expanded content area — no max-height so trackers/filters can fill naturally
  const body = document.createElement('div');
  body.style.cssText = [
    'display:none',
    'border-top:1px solid rgba(143,130,255,0.1)',
    'padding:12px 14px',
    'overflow-y:auto',
  ].join(';');

  container.append(header, body);

  const expand = () => {
    if (expanded) return;
    expanded = true;
    body.style.display = 'block';
    chevron.textContent = '▾';
    chevron.style.color = '#8f82ff';
    container.style.borderColor = 'rgba(143,130,255,0.3)';
    container.style.boxShadow = '0 2px 12px rgba(143,130,255,0.08)';
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
    chevron.textContent = '▸';
    chevron.style.color = '#776ea8';
    container.style.borderColor = 'rgba(143,130,255,0.12)';
    container.style.boxShadow = 'none';
    detachBtn.style.display = 'none';

    // Clean up expanded content
    if (expandedCleanup) {
      expandedCleanup();
      expandedCleanup = null;
    }
    body.innerHTML = '';
  };

  header.addEventListener('click', () => {
    if (expanded) collapse();
    else expand();
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
