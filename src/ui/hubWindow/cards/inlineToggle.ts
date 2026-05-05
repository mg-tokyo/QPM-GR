// src/ui/hubWindow/cards/inlineToggle.ts

import type { InlineToggleConfig } from './types';

export interface InlineToggleResult {
  element: HTMLElement;
  cleanup: () => void;
}

export function renderInlineToggle(config: InlineToggleConfig): InlineToggleResult {
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

  const desc = document.createElement('div');
  desc.style.cssText = 'font-size:10px;color:#776ea8;margin-top:2px;';
  desc.textContent = config.description;

  info.append(title, desc);

  // Toggle switch
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.setAttribute('role', 'switch');
  toggle.style.cssText = [
    'width:36px',
    'height:20px',
    'border-radius:10px',
    'border:none',
    'cursor:pointer',
    'position:relative',
    'transition:background 0.2s',
    'flex-shrink:0',
    'outline:none',
  ].join(';');

  const knob = document.createElement('div');
  knob.style.cssText = [
    'width:16px',
    'height:16px',
    'border-radius:50%',
    'background:#fff',
    'position:absolute',
    'top:2px',
    'transition:left 0.2s',
    'box-shadow:0 1px 3px rgba(0,0,0,0.3)',
  ].join(';');
  toggle.appendChild(knob);

  const syncToggle = () => {
    const enabled = config.getEnabled();
    toggle.setAttribute('aria-checked', String(enabled));
    toggle.style.background = enabled ? '#4ade80' : 'rgba(143,130,255,0.2)';
    knob.style.left = enabled ? '18px' : '2px';
  };
  syncToggle();

  toggle.addEventListener('click', () => {
    config.setEnabled(!config.getEnabled());
    syncToggle();
  });

  card.append(iconBox, info, toggle);

  // Settings expansion (optional)
  let settingsContainer: HTMLElement | null = null;
  if (config.renderSettings) {
    settingsContainer = document.createElement('div');
    settingsContainer.style.cssText = 'padding:8px 14px 4px 52px;display:none;';
    const settingsCleanup = config.renderSettings(settingsContainer);
    if (settingsCleanup) cleanups.push(settingsCleanup);
  }

  // Wrapper for card + optional settings
  const wrapper = document.createElement('div');
  wrapper.appendChild(card);
  if (settingsContainer) wrapper.appendChild(settingsContainer);

  return {
    element: wrapper,
    cleanup: () => { cleanups.forEach(fn => fn()); cleanups.length = 0; },
  };
}
