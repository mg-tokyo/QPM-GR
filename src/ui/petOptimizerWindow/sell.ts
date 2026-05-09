import type { CollectedPet, PetComparison } from '../../features/petOptimizer';
import { executeSellPipeline } from '../../features/petSell';
import type { FamilyPetEntry, SellModalPetEntry } from './types';
import { getPetSprite } from './sprites';
import { t } from '../../i18n';

const SELL_CONFIRM_MODAL_ID = 'qpm-optimizer-sell-confirm';

function getStatusBadgeStyle(status: string): string {
  const styles: Record<string, string> = {
    keep: 'border:1px solid rgba(76,175,80,0.4);background:rgba(76,175,80,0.15);color:#8ed89a',
    sell: 'border:1px solid rgba(244,67,54,0.4);background:rgba(244,67,54,0.15);color:#ff9e95',
    review: 'border:1px solid rgba(255,193,7,0.4);background:rgba(255,193,7,0.15);color:#ffe08a',
  };
  const fallback = 'border:1px solid rgba(255,193,7,0.4);background:rgba(255,193,7,0.15);color:#ffe08a';
  return styles[status] ?? fallback;
}

function showSellConfirmModal(
  titleText: string,
  descText: string,
  petEntries: SellModalPetEntry[],
): Promise<CollectedPet[] | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve(null);
      return;
    }

    const existing = document.getElementById(SELL_CONFIRM_MODAL_ID);
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = SELL_CONFIRM_MODAL_ID;
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.62);';

    const card = document.createElement('div');
    card.style.cssText = 'min-width:340px;max-width:580px;max-height:min(80vh,720px);background:#0f1318;color:#ffffff;border:1px solid rgba(255,255,255,0.16);border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,0.45);padding:18px 20px;display:grid;gap:12px;';

    const title = document.createElement('div');
    title.textContent = titleText;
    title.style.cssText = 'font-size:18px;font-weight:800;';

    const desc = document.createElement('div');
    desc.textContent = descText;
    desc.style.cssText = 'font-size:13px;opacity:0.92;line-height:1.4;';

    const list = document.createElement('div');
    list.style.cssText = 'display:grid;gap:6px;max-height:400px;overflow-y:auto;padding-right:4px;';

    interface RowEntry {
      checkbox: HTMLInputElement | null;
      pet: CollectedPet;
    }
    const rowEntries: RowEntry[] = [];

    for (const entry of petEntries) {
      const { pet, status, checked, showCheckbox } = entry;

      const row = document.createElement('label');
      row.style.cssText = [
        'display:grid',
        showCheckbox ? 'grid-template-columns:24px 42px 1fr auto' : 'grid-template-columns:42px 1fr auto',
        'gap:10px',
        'align-items:center',
        'padding:6px 8px',
        'border:1px solid rgba(255,255,255,0.08)',
        'border-radius:10px',
        'background:rgba(255,255,255,0.03)',
        'cursor:pointer',
      ].join(';');

      let checkbox: HTMLInputElement | null = null;
      if (showCheckbox) {
        checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = checked;
        checkbox.style.cssText = 'cursor:pointer;width:16px;height:16px;';
        row.appendChild(checkbox);
      }

      const iconWrap = document.createElement('div');
      iconWrap.style.cssText = 'width:42px;height:42px;border-radius:10px;background:rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:center;overflow:hidden;';
      let hasSprite = false;
      try {
        const spriteUrl = getPetSprite(pet.species, pet.hasRainbow, pet.hasGold);
        if (spriteUrl) {
          const img = document.createElement('img');
          img.src = spriteUrl;
          img.alt = pet.species ?? 'Pet';
          img.style.cssText = 'width:42px;height:42px;image-rendering:pixelated;object-fit:contain;';
          iconWrap.appendChild(img);
          hasSprite = true;
        }
      } catch {
        // noop
      }
      if (!hasSprite) {
        const placeholder = document.createElement('span');
        placeholder.textContent = '•';
        placeholder.style.cssText = 'font-size:18px;color:rgba(255,255,255,0.45);line-height:1;';
        iconWrap.appendChild(placeholder);
      }

      const info = document.createElement('div');
      info.style.cssText = 'display:grid;gap:2px;min-width:0;';

      const nameEl = document.createElement('div');
      nameEl.style.cssText = 'font-size:13px;font-weight:700;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      nameEl.textContent = pet.name || pet.species || 'Pet';

      const meta = document.createElement('div');
      meta.style.cssText = 'font-size:11px;color:#aaa;';
      meta.textContent = `${pet.species ?? '?'} • STR ${pet.strength}${pet.maxStrength ? `/${pet.maxStrength}` : ''} • ${pet.location}`;

      info.append(nameEl, meta);

      const badgeStyle = getStatusBadgeStyle(status);
      const badge = document.createElement('span');
      badge.textContent = status;
      badge.style.cssText = `font-size:10px;padding:2px 8px;border-radius:999px;${badgeStyle};font-weight:600;text-transform:capitalize;white-space:nowrap;`;

      row.append(iconWrap, info, badge);
      list.appendChild(row);
      rowEntries.push({ checkbox, pet });
    }

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:8px;';

    const hasCheckboxes = petEntries.some((entry) => entry.showCheckbox);

    const selectInfo = document.createElement('span');
    selectInfo.style.cssText = 'font-size:12px;color:#888;';

    const sellBtn = document.createElement('button');
    sellBtn.type = 'button';
    sellBtn.style.cssText = 'padding:8px 14px;border-radius:10px;border:1px solid rgba(122,162,255,0.7);background:#1a2644;color:#ffffff;cursor:pointer;font-weight:700;font-size:13px;transition:opacity 0.15s;';

    const updateCounts = (): void => {
      if (hasCheckboxes) {
        const count = rowEntries.filter((entry) => entry.checkbox?.checked).length;
        selectInfo.textContent = t('feature.petOptimizer.selected', { count: String(count) });
        sellBtn.textContent = t('feature.petOptimizer.sellSelected', { count: String(count) });
        sellBtn.disabled = count === 0;
        sellBtn.style.opacity = count === 0 ? '0.4' : '1';
      } else {
        sellBtn.textContent = t('feature.petOptimizer.sell');
        selectInfo.textContent = '';
      }
    };
    updateCounts();

    if (hasCheckboxes) {
      list.addEventListener('change', updateCounts);
    }

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = t('feature.petOptimizer.cancel');
    cancelBtn.style.cssText = 'padding:8px 12px;border-radius:10px;border:1px solid rgba(255,255,255,0.22);background:transparent;color:#ffffff;cursor:pointer;font-size:13px;';

    let settled = false;
    const close = (result: CollectedPet[] | null): void => {
      if (settled) return;
      settled = true;
      try {
        overlay.remove();
      } catch {
        // noop
      }
      document.removeEventListener('keydown', onKeyDown, true);
      resolve(result);
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(null);
      }
    };

    cancelBtn.addEventListener('click', () => close(null));
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close(null);
    });
    sellBtn.addEventListener('click', () => {
      if (hasCheckboxes) {
        const selected = rowEntries
          .filter((entry) => entry.checkbox?.checked)
          .map((entry) => entry.pet);
        close(selected.length > 0 ? selected : null);
      } else {
        close(rowEntries.map((entry) => entry.pet));
      }
    });

    const btnWrap = document.createElement('div');
    btnWrap.style.cssText = 'display:flex;gap:8px;';
    btnWrap.append(cancelBtn, sellBtn);
    actions.append(selectInfo, btnWrap);

    card.append(title, desc, list, actions);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    document.addEventListener('keydown', onKeyDown, true);
    sellBtn.focus();
  });
}

function executeSellWithFeedback(
  card: HTMLElement,
  btn: HTMLElement,
  pet: CollectedPet,
  onAfterSell: () => void,
): void {
  btn.textContent = '⏳';
  btn.title = t('feature.petOptimizer.sellingStatus');
  btn.style.opacity = '1';
  (btn as HTMLButtonElement).style.pointerEvents = 'none';

  executeSellPipeline(pet).then((result) => {
    if (result.ok) {
      card.style.transition = 'opacity 0.4s, max-height 0.4s, margin 0.4s, padding 0.4s';
      card.style.opacity = '0';
      card.style.maxHeight = '0';
      card.style.margin = '0';
      card.style.padding = '0';
      card.style.overflow = 'hidden';
      setTimeout(() => {
        card.remove();
        onAfterSell();
      }, 450);
    } else {
      btn.textContent = '⚠️';
      btn.title = t('feature.petOptimizer.failedReason', { reason: result.reason ?? 'Unknown' });
      btn.style.background = 'rgba(244,67,54,0.3)';
      btn.style.borderColor = 'rgba(244,67,54,0.5)';
      btn.style.opacity = '1';
      (btn as HTMLButtonElement).style.pointerEvents = 'auto';
      setTimeout(() => {
        btn.textContent = '💰';
        btn.title = t('feature.petOptimizer.sellTooltip');
        btn.style.background = 'rgba(0,0,0,0.3)';
        btn.style.borderColor = 'rgba(255,255,255,0.12)';
        btn.style.opacity = '0.5';
      }, 4000);
    }
  }).catch(() => {
    btn.textContent = '⚠️';
    btn.style.opacity = '1';
    (btn as HTMLButtonElement).style.pointerEvents = 'auto';
  });
}

function executeBulkSell(pets: CollectedPet[], onDone: () => void): void {
  const existing = document.getElementById(SELL_CONFIRM_MODAL_ID);
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = SELL_CONFIRM_MODAL_ID;
  overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.62);';

  const card = document.createElement('div');
  card.style.cssText = 'min-width:300px;max-width:420px;background:#0f1318;color:#ffffff;border:1px solid rgba(255,255,255,0.16);border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,0.45);padding:24px;display:grid;gap:16px;text-align:center;';

  const title = document.createElement('div');
  title.textContent = t('feature.petOptimizer.sellingPets');
  title.style.cssText = 'font-size:18px;font-weight:800;';

  const progressText = document.createElement('div');
  progressText.style.cssText = 'font-size:14px;color:#42A5F5;font-weight:600;';
  progressText.textContent = `0 / ${pets.length}`;

  const progressBar = document.createElement('div');
  progressBar.style.cssText = 'height:6px;border-radius:3px;background:rgba(255,255,255,0.1);overflow:hidden;';
  const progressFill = document.createElement('div');
  progressFill.style.cssText = 'height:100%;border-radius:3px;background:#42A5F5;transition:width 0.2s;width:0%;';
  progressBar.appendChild(progressFill);

  card.append(title, progressText, progressBar);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  let soldCount = 0;
  let failCount = 0;

  (async () => {
    for (let i = 0; i < pets.length; i += 1) {
      const pet = pets[i];
      if (!pet) continue;
      progressText.textContent = `${i + 1} / ${pets.length}`;
      progressFill.style.width = `${((i + 1) / pets.length) * 100}%`;

      const result = await executeSellPipeline(pet);
      if (result.ok) {
        soldCount += 1;
      } else {
        failCount += 1;
        console.warn(`[Pet Optimizer] Failed to sell ${pet.name || pet.species}: ${result.reason}`);
      }
    }

    progressFill.style.width = '100%';
    if (failCount === 0) {
      title.textContent = t('feature.petOptimizer.done');
      progressText.textContent = soldCount === 1 ? t('feature.petOptimizer.soldPet', { count: '1' }) : t('feature.petOptimizer.soldPets', { count: String(soldCount) });
      progressText.style.color = '#4CAF50';
      progressFill.style.background = '#4CAF50';
    } else {
      title.textContent = t('feature.petOptimizer.completed');
      progressText.textContent = t('feature.petOptimizer.soldFailed', { sold: String(soldCount), failed: String(failCount) });
      progressText.style.color = '#FF9800';
      progressFill.style.background = '#FF9800';
    }

    setTimeout(() => {
      overlay.remove();
      onDone();
    }, 1500);
  })();
}

export function appendSellButton(
  container: HTMLElement,
  comparison: PetComparison,
  onAfterSell: () => void,
): void {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.title = t('feature.petOptimizer.sellTooltip');
  btn.textContent = t('feature.petOptimizer.sell');
  btn.style.cssText = [
    'padding:3px 8px',
    'border-radius:5px',
    'border:1px solid rgba(244,67,54,0.4)',
    'background:rgba(244,67,54,0.12)',
    'color:#ff9e95',
    'font-size:10px',
    'font-weight:600',
    'cursor:pointer',
    'white-space:nowrap',
    'line-height:1',
    'transition:opacity 0.15s, filter 0.15s',
  ].join(';');

  btn.addEventListener('mouseenter', () => { btn.style.filter = 'brightness(1.15)'; });
  btn.addEventListener('mouseleave', () => { btn.style.filter = 'none'; });
  btn.addEventListener('click', (event) => {
    event.stopPropagation();

    // Walk up to find the card element (the top-level position:relative container)
    const card = container.closest<HTMLElement>('[style*="position: relative"]')
      ?? container.parentElement
      ?? container;

    const pet = comparison.pet;
    showSellConfirmModal(
      t('feature.petOptimizer.confirmSell'),
      t('feature.petOptimizer.confirmSellDesc'),
      [{ pet, status: comparison.status, checked: true, showCheckbox: false }],
    ).then((confirmed) => {
      if (!confirmed || confirmed.length === 0) return;
      executeSellWithFeedback(card, btn, pet, onAfterSell);
    });
  });

  container.appendChild(btn);
}

export function showFamilySellModal(
  familyLabel: string,
  pets: FamilyPetEntry[],
  onDone: () => void,
): void {
  const petEntries: SellModalPetEntry[] = pets.map((entry) => ({
    pet: entry.comparison.pet,
    status: entry.comparison.status,
    checked: entry.comparison.status === 'sell',
    showCheckbox: true,
  }));

  showSellConfirmModal(
    t('feature.petOptimizer.sellFamilyPets', { family: familyLabel }),
    t('feature.petOptimizer.selectWhichToSell'),
    petEntries,
  ).then((confirmed) => {
    if (!confirmed || confirmed.length === 0) return;
    executeBulkSell(confirmed, onDone);
  });
}
