// src/ui/hubWindow/hubGroup.ts

import { t } from '../../i18n';
import type { HubGroupDef, CardConfig } from './cards/types';
import { renderInlineToggle } from './cards/inlineToggle';
import { renderExpandableCard, type ExpandableCardResult } from './cards/expandableCard';
import { renderLauncherCard } from './cards/launcherCard';
import { buildIconBox } from './cards/iconRenderer';
import { getExpandedCards, setExpandedCard, getHiddenCards, setCardHidden } from './state';

export interface HubGroupResult {
  element: HTMLElement;
  cleanup: () => void;
}

export function renderHubGroup(group: HubGroupDef): HubGroupResult {
  const cleanups: Array<() => void> = [];
  const expandableCards = new Map<string, ExpandableCardResult>();

  const container = document.createElement('div');
  container.style.cssText = 'display:flex;flex-direction:column;gap:8px;padding:16px;';

  // Group header
  const header = document.createElement('div');
  header.style.cssText = [
    'display:flex',
    'align-items:center',
    'gap:8px',
    'padding-bottom:8px',
  ].join(';');

  const headerLabel = document.createElement('span');
  headerLabel.style.cssText = [
    'font-size:12px',
    'font-weight:600',
    'letter-spacing:1px',
    'color:#8f82ff',
    'text-transform:uppercase',
  ].join(';');
  headerLabel.textContent = group.label;

  const countBadge = document.createElement('span');
  countBadge.style.cssText = 'font-size:10px;color:#776ea8;';
  countBadge.textContent = `${group.cards.length} ${t('common.features')}`;

  // Visibility toggle button (pushed right) — sliders icon
  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.title = t('common.showHideFeatures');
  toggleBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M2 4h5M11 4h3M9 2v4M2 8h1M7 8h7M5 6v4M2 12h7M13 12h1M11 10v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  </svg>`;
  toggleBtn.style.cssText = [
    'margin-left:auto',
    'background:none',
    'border:1px solid rgba(143,130,255,0.2)',
    'border-radius:4px',
    'cursor:pointer',
    'font-size:13px',
    'padding:3px 5px',
    'color:#776ea8',
    'transition:background 0.15s,border-color 0.15s',
    'line-height:0',
    'display:flex',
    'align-items:center',
    'justify-content:center',
  ].join(';');
  toggleBtn.addEventListener('mouseenter', () => {
    toggleBtn.style.background = 'rgba(143,130,255,0.12)';
    toggleBtn.style.borderColor = 'rgba(143,130,255,0.4)';
  });
  toggleBtn.addEventListener('mouseleave', () => {
    toggleBtn.style.background = 'none';
    toggleBtn.style.borderColor = 'rgba(143,130,255,0.2)';
  });

  header.append(headerLabel, countBadge, toggleBtn);
  container.appendChild(header);

  // Popover for visibility toggles
  let popover: HTMLElement | null = null;
  let closePopover: (() => void) | null = null;

  function buildMiniIcon(card: CardConfig): HTMLElement {
    const icon = card.icon;
    const box = buildIconBox(icon);
    // Scale down from 42px to 22px for the popover
    box.style.width = '22px';
    box.style.height = '22px';
    box.style.borderRadius = '4px';
    box.style.flexShrink = '0';
    // Scale the inner content
    const imgs = box.querySelectorAll('img');
    imgs.forEach(img => {
      (img as HTMLElement).style.width = '16px';
      (img as HTMLElement).style.height = '16px';
    });
    // If it's a bunched container, scale the inner div
    const inner = box.firstElementChild as HTMLElement | null;
    if (inner && inner.style.position === 'relative') {
      inner.style.width = '22px';
      inner.style.height = '22px';
      inner.style.transform = 'scale(0.52)';
      inner.style.transformOrigin = 'center center';
    }
    return box;
  }

  function openPopover(): void {
    if (popover) { closePopover?.(); return; }

    popover = document.createElement('div');
    popover.style.cssText = [
      'position:absolute',
      'top:100%',
      'right:0',
      'margin-top:4px',
      'background:#1e1b2e',
      'border:1px solid rgba(143,130,255,0.25)',
      'border-radius:8px',
      'padding:8px 0',
      'min-width:220px',
      'z-index:100',
      'box-shadow:0 8px 24px rgba(0,0,0,0.5)',
    ].join(';');

    // Title
    const title = document.createElement('div');
    title.style.cssText = 'padding:4px 12px 8px;font-size:11px;font-weight:600;color:#8f82ff;text-transform:uppercase;letter-spacing:0.5px;';
    title.textContent = 'Show/Hide Features';
    popover.appendChild(title);

    const hidden = getHiddenCards(group.id);

    for (const card of group.cards) {
      const row = document.createElement('label');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:5px 12px;cursor:pointer;transition:background 0.15s;font-size:12px;color:#e0dce8;';
      row.addEventListener('mouseenter', () => { row.style.background = 'rgba(143,130,255,0.08)'; });
      row.addEventListener('mouseleave', () => { row.style.background = 'transparent'; });

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !hidden.includes(card.key);
      cb.style.cssText = 'width:14px;height:14px;cursor:pointer;accent-color:#8f82ff;flex-shrink:0;';
      cb.addEventListener('change', () => {
        setCardHidden(group.id, card.key, !cb.checked);
        renderCards();
      });

      const miniIcon = buildMiniIcon(card);

      const lbl = document.createElement('span');
      lbl.textContent = card.label;
      if (card.labelColor) {
        lbl.style.color = card.labelColor;
      }

      row.append(cb, miniIcon, lbl);
      popover.appendChild(row);
    }

    // Position relative to toggle button
    header.style.position = 'relative';
    header.appendChild(popover);

    // Close on click outside or Esc
    const onClickOutside = (e: MouseEvent): void => {
      if (popover && !popover.contains(e.target as Node) && e.target !== toggleBtn && !toggleBtn.contains(e.target as Node)) {
        closePopover?.();
      }
    };
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closePopover?.();
    };
    // Delay listener attachment to avoid the click that opened the popover
    requestAnimationFrame(() => {
      document.addEventListener('click', onClickOutside, true);
      document.addEventListener('keydown', onEsc, true);
    });

    closePopover = () => {
      document.removeEventListener('click', onClickOutside, true);
      document.removeEventListener('keydown', onEsc, true);
      popover?.remove();
      popover = null;
      closePopover = null;
    };
  }

  toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openPopover();
  });

  // Cards container (separate from header so we can re-render)
  const cardsContainer = document.createElement('div');
  cardsContainer.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
  container.appendChild(cardsContainer);

  function renderCards(): void {
    // Clean up previous card renders
    cleanups.forEach(fn => fn());
    cleanups.length = 0;
    expandableCards.clear();
    cardsContainer.innerHTML = '';

    const hidden = getHiddenCards(group.id);

    // Render cards by tier order: inline-toggle, expandable, launcher
    const sortOrder: Record<CardConfig['tier'], number> = {
      'inline-toggle': 0,
      'expandable': 1,
      'launcher': 2,
    };
    const sorted = [...group.cards]
      .filter(c => !hidden.includes(c.key))
      .sort((a, b) => sortOrder[a.tier] - sortOrder[b.tier]);

    // Update count badge
    countBadge.textContent = t('common.featuresCount', { visible: sorted.length, total: group.cards.length });

    for (const card of sorted) {
      if (card.tier === 'inline-toggle') {
        const result = renderInlineToggle(card);
        cardsContainer.appendChild(result.element);
        cleanups.push(result.cleanup);
      } else if (card.tier === 'expandable') {
        const cardWithCallbacks: typeof card = {
          ...card,
          onBeforeExpand: () => {
            setExpandedCard(group.id, card.key, true);
          },
          onBeforeCollapse: () => {
            setExpandedCard(group.id, card.key, false);
          },
        };
        const result = renderExpandableCard(cardWithCallbacks);
        expandableCards.set(card.key, result);
        cardsContainer.appendChild(result.element);
        cleanups.push(result.cleanup);
      } else if (card.tier === 'launcher') {
        const result = renderLauncherCard(card);
        cardsContainer.appendChild(result.element);
        cleanups.push(result.cleanup);
      }
    }

    // Restore persisted expanded state — expand all persisted cards
    const persistedKeys = getExpandedCards(group.id);
    for (const key of persistedKeys) {
      const cardToExpand = expandableCards.get(key);
      if (cardToExpand) cardToExpand.expand();
    }
  }

  renderCards();

  return {
    element: container,
    cleanup: () => {
      closePopover?.();
      cleanups.forEach(fn => fn());
      cleanups.length = 0;
      expandableCards.clear();
    },
  };
}
