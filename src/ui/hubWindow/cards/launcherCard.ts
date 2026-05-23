// src/ui/hubWindow/cards/launcherCard.ts

import type { LauncherCardConfig } from './types';
import { buildIconBox } from './iconRenderer';
import { t } from '../../../i18n';

export interface LauncherCardResult {
  element: HTMLElement;
  cleanup: () => void;
}

export function renderLauncherCard(config: LauncherCardConfig): LauncherCardResult {
  const cleanups: Array<() => void> = [];

  const card = document.createElement('div');
  card.setAttribute('role', 'button');
  card.tabIndex = 0;
  card.setAttribute('aria-label', t('hub.card.openLabel', { label: config.label }));
  card.style.cssText = [
    'display:flex',
    'align-items:center',
    'gap:10px',
    'padding:14px 16px',
    'background:rgba(255,255,255,0.03)',
    'border:1px solid rgba(143,130,255,0.18)',
    'border-radius:10px',
    'cursor:pointer',
    'transition:border-color 0.15s,background 0.15s,box-shadow 0.15s,transform 0.15s',
    'outline:none',
  ].join(';');

  card.addEventListener('mouseenter', () => {
    card.style.borderColor = 'rgba(143,130,255,0.35)';
    card.style.background = 'rgba(143,130,255,0.06)';
    card.style.boxShadow = '0 2px 12px rgba(143,130,255,0.08)';
  });
  card.addEventListener('mouseleave', () => {
    card.style.borderColor = 'rgba(143,130,255,0.18)';
    card.style.background = 'rgba(255,255,255,0.03)';
    card.style.boxShadow = '';
  });
  card.addEventListener('pointerdown', () => {
    card.style.transform = 'translateY(1px)';
  });
  card.addEventListener('pointerup', () => {
    card.style.transform = '';
  });
  card.addEventListener('pointercancel', () => {
    card.style.transform = '';
  });
  card.addEventListener('blur', () => {
    card.style.transform = '';
    card.style.boxShadow = '';
    card.style.borderColor = 'rgba(143,130,255,0.18)';
  });
  card.addEventListener('focus', () => {
    card.style.borderColor = 'rgba(143,130,255,0.45)';
    card.style.boxShadow = '0 0 0 2px rgba(143,130,255,0.18), 0 2px 12px rgba(143,130,255,0.08)';
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

  // Open button
  const openBtn = document.createElement('button');
  openBtn.type = 'button';
  openBtn.textContent = t('hub.card.open');
  openBtn.style.cssText = [
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
  openBtn.addEventListener('mouseenter', () => {
    openBtn.style.background = 'rgba(143,130,255,0.25)';
    openBtn.style.borderColor = 'rgba(143,130,255,0.5)';
  });
  openBtn.addEventListener('mouseleave', () => {
    openBtn.style.background = 'rgba(143,130,255,0.12)';
    openBtn.style.borderColor = 'rgba(143,130,255,0.3)';
  });
  const activate = (): void => {
    config.onOpen();
  };

  openBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    activate();
  });
  card.addEventListener('click', () => activate());
  card.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    activate();
  });

  card.append(iconBox, info, openBtn);

  return {
    element: card,
    cleanup: () => { cleanups.forEach(fn => fn()); cleanups.length = 0; },
  };
}
