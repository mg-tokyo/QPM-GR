// src/ui/hubWindow/cards/launcherCard.ts

import type { LauncherCardConfig } from './types';

export interface LauncherCardResult {
  element: HTMLElement;
  cleanup: () => void;
}

export function renderLauncherCard(config: LauncherCardConfig): LauncherCardResult {
  const cleanups: Array<() => void> = [];

  const card = document.createElement('div');
  card.style.cssText = [
    'display:flex',
    'align-items:center',
    'gap:10px',
    'padding:10px 14px',
    'background:rgba(143,130,255,0.06)',
    'border:1px solid rgba(143,130,255,0.12)',
    'border-radius:8px',
    'transition:border-color 0.15s,background 0.15s',
  ].join(';');

  card.addEventListener('mouseenter', () => {
    card.style.borderColor = 'rgba(143,130,255,0.25)';
    card.style.background = 'rgba(143,130,255,0.09)';
  });
  card.addEventListener('mouseleave', () => {
    card.style.borderColor = 'rgba(143,130,255,0.12)';
    card.style.background = 'rgba(143,130,255,0.06)';
  });

  // Icon
  const iconBox = document.createElement('div');
  iconBox.style.cssText = [
    'width:28px',
    'height:28px',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'border-radius:6px',
    'background:linear-gradient(135deg, rgba(143,130,255,0.2), rgba(143,130,255,0.1))',
    'font-size:14px',
    'flex-shrink:0',
  ].join(';');
  iconBox.textContent = config.icon.value;

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

  // Open button
  const openBtn = document.createElement('button');
  openBtn.type = 'button';
  openBtn.textContent = 'Open →';
  openBtn.style.cssText = [
    'background:rgba(143,130,255,0.15)',
    'color:#8f82ff',
    'border:1px solid rgba(143,130,255,0.3)',
    'border-radius:6px',
    'padding:4px 10px',
    'font-size:11px',
    'font-weight:500',
    'cursor:pointer',
    'transition:background 0.15s,border-color 0.15s',
    'flex-shrink:0',
    'white-space:nowrap',
  ].join(';');
  openBtn.addEventListener('mouseenter', () => {
    openBtn.style.background = 'rgba(143,130,255,0.25)';
    openBtn.style.borderColor = 'rgba(143,130,255,0.5)';
  });
  openBtn.addEventListener('mouseleave', () => {
    openBtn.style.background = 'rgba(143,130,255,0.15)';
    openBtn.style.borderColor = 'rgba(143,130,255,0.3)';
  });
  openBtn.addEventListener('click', () => config.onOpen());

  card.append(iconBox, info, openBtn);

  return {
    element: card,
    cleanup: () => { cleanups.forEach(fn => fn()); cleanups.length = 0; },
  };
}
