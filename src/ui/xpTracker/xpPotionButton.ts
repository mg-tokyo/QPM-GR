// src/ui/xpTracker/xpPotionButton.ts — XP Potion button with projection overlay

import type { ActivePetInfo } from '../../store/pets';
import { projectXpPotion, sendUseXpPotion } from '../../features/xpPotion';
import { formatCoins } from '../../features/economy/valueCalculator';
import { getAnySpriteDataUrl } from '../../sprite-v2/compat';
import { t } from '../../i18n';

// ============================================================================
// POTION PROJECTION COLORS
// ============================================================================

export const POTION_COLOR = '#64d2ff';
export const POTION_GLOW = 'rgba(100,210,255,0.45)';
const POTION_BG = 'rgba(100,210,255,0.12)';
const POTION_BORDER = 'rgba(100,210,255,0.35)';

/** Shared mutable flag — set by any card's potion hover to suppress re-renders. */
export interface HoverGuard { hovering: boolean; pendingRender: boolean }

// ============================================================================
// POTION BUTTON
// ============================================================================

export function createPotionButton(
  pet: ActivePetInfo,
  potionCount: number,
  xpPerLevel: number,
  maxStr: number,
  currentPct: number,
  xpToNext: number,
  projectionFill: HTMLElement | null,
  strProjection: HTMLElement | null,
  barLbl: HTMLElement | null,
  barLblOrigHtml: string,
  hoverGuard: HoverGuard,
): HTMLElement {
  const btn = document.createElement('button');
  btn.style.cssText = [
    'display:inline-flex',
    'align-items:center',
    'gap:4px',
    'padding:2px 8px 2px 5px',
    'font-size:10px',
    'border-radius:10px',
    'cursor:pointer',
    `background:${POTION_BG}`,
    `color:${POTION_COLOR}`,
    `border:1px solid ${POTION_BORDER}`,
    'font-weight:600',
    'white-space:nowrap',
    'transition:background 0.15s ease,box-shadow 0.15s ease',
    'flex-shrink:0',
  ].join(';');

  // Potion sprite
  const potionUrl = getAnySpriteDataUrl('sprite/item/XPPotion');
  if (potionUrl) {
    const img = document.createElement('img');
    img.src = potionUrl;
    img.alt = 'XP Potion';
    img.style.cssText = 'width:14px;height:14px;object-fit:contain;image-rendering:pixelated;flex-shrink:0;';
    btn.appendChild(img);
  }

  const label = document.createElement('span');
  label.textContent = `×${potionCount}`;
  btn.appendChild(label);

  // Hover glow
  btn.addEventListener('mouseenter', () => {
    btn.style.boxShadow = `0 0 8px ${POTION_GLOW}`;
    btn.style.background = 'rgba(100,210,255,0.2)';
  });
  btn.addEventListener('mouseleave', () => {
    btn.style.boxShadow = 'none';
    btn.style.background = POTION_BG;
  });

  // Projection — compute once, toggle on hover
  const proj = projectXpPotion(pet.xp!, pet.strength!, xpPerLevel, maxStr);
  const projPct = proj.reachesMax ? 100 : proj.pctOfLevel;
  const projBarWidth = proj.levelsGained > 0
    ? (100 - currentPct)
    : Math.max(0, projPct - currentPct);

  const showProjection = () => {
    hoverGuard.hovering = true;
    if (projectionFill) {
      projectionFill.style.left = `${currentPct.toFixed(1)}%`;
      projectionFill.style.width = `${projBarWidth.toFixed(1)}%`;
      projectionFill.style.opacity = '0.7';
    }
    if (strProjection) {
      strProjection.textContent = ` → ${proj.newStrength}`;
      strProjection.style.display = 'inline';
    }
    if (barLbl) {
      if (proj.levelsGained > 0) {
        barLbl.innerHTML = `<span style="color:${POTION_COLOR};text-shadow:0 0 4px ${POTION_GLOW}">${formatCoins(proj.xpIntoLevel)} / ${formatCoins(xpPerLevel)}</span><span style="color:${POTION_COLOR};text-shadow:0 0 4px ${POTION_GLOW}">${projPct.toFixed(1)}% (${proj.reachesMax ? 'MAX' : `+${proj.levelsGained} STR`})</span>`;
      } else {
        barLbl.innerHTML = `<span>${formatCoins(xpToNext)} <span style="color:${POTION_COLOR};text-shadow:0 0 4px ${POTION_GLOW}">→ ${formatCoins(proj.xpIntoLevel)}</span> / ${formatCoins(xpPerLevel)}</span><span>${currentPct.toFixed(1)}% <span style="color:${POTION_COLOR};text-shadow:0 0 4px ${POTION_GLOW}">→ ${projPct.toFixed(1)}%</span></span>`;
      }
    }
  };

  const hideProjection = () => {
    hoverGuard.hovering = false;
    if (projectionFill) {
      projectionFill.style.width = '0';
      projectionFill.style.opacity = '0';
    }
    if (strProjection) {
      strProjection.style.display = 'none';
    }
    if (barLbl) {
      barLbl.innerHTML = barLblOrigHtml;
    }
    // Flush any render that was deferred while hovering
    if (hoverGuard.pendingRender) {
      hoverGuard.pendingRender = false;
      // Dispatch async so mouseleave finishes first
      queueMicrotask(() => {
        if (!hoverGuard.hovering) {
          window.dispatchEvent(new CustomEvent('qpm:xptracker-deferred-render'));
        }
      });
    }
  };

  btn.addEventListener('mouseenter', showProjection);
  btn.addEventListener('mouseleave', hideProjection);

  // Click handler
  btn.addEventListener('click', async () => {
    if (!pet.slotId) return;
    btn.disabled = true;
    hideProjection();
    const origChildren = Array.from(btn.childNodes);
    btn.textContent = t('feature.xpTracker.potionUsing');
    btn.style.opacity = '0.6';

    const result = await sendUseXpPotion(pet.slotId);
    if (result.ok) {
      btn.textContent = t('feature.xpTracker.potionUsed');
      btn.style.color = 'var(--qpm-accent)';
    } else {
      btn.textContent = t('feature.xpTracker.potionFailed');
      btn.style.color = 'var(--qpm-danger)';
    }

    setTimeout(() => {
      btn.textContent = '';
      for (const child of origChildren) btn.appendChild(child);
      btn.style.opacity = '1';
      btn.style.color = POTION_COLOR;
      btn.disabled = false;
    }, 1500);
  });

  return btn;
}
