import type { OptimizerAnalysis } from '../../features/petOptimizer';
import { getOptimizerAbilityFamilyInfo } from '../../features/petCompareEngine';
import { getAbilityColor } from '../../utils/petCardRenderer';
import { t } from '../../i18n';

function colorWithAlpha(color: string, alpha: number): string {
  if (color.includes('gradient') || color.includes('rgb')) {
    return `rgba(143,130,255,${alpha})`;
  }
  const hex = color.replace('#', '');
  if (hex.length >= 6) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
      return `rgba(${r},${g},${b},${alpha})`;
    }
  }
  return `rgba(143,130,255,${alpha})`;
}

interface BroadRoleEntry {
  broadKey: string;
  label: string;
  abilityName: string;
}

function collectBroadRoles(analysis: OptimizerAnalysis): BroadRoleEntry[] {
  const seen = new Map<string, BroadRoleEntry>();

  for (const comparison of analysis.comparisons) {
    const ranks = comparison.familyRanks;
    if (!Array.isArray(ranks)) continue;
    for (const rank of ranks) {
      if (seen.has(rank.broadRoleFamilyKey)) continue;
      seen.set(rank.broadRoleFamilyKey, {
        broadKey: rank.broadRoleFamilyKey,
        label: rank.broadRoleFamilyLabel,
        abilityName: rank.familyLabel || rank.familyKey,
      });
    }

    // Also look at ability IDs for pets without rank data
    for (let i = 0; i < comparison.pet.abilityIds.length; i++) {
      const abilityId = comparison.pet.abilityIds[i] ?? '';
      const abilityName = comparison.pet.abilities[i] ?? abilityId;
      if (!abilityId) continue;
      const info = getOptimizerAbilityFamilyInfo(abilityId, abilityName);
      if (!info || info.hidden) continue;
      if (seen.has(info.broadRoleFamilyKey)) continue;
      seen.set(info.broadRoleFamilyKey, {
        broadKey: info.broadRoleFamilyKey,
        label: info.broadRoleFamilyLabel,
        abilityName,
      });
    }
  }

  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export function renderFamilyNav(
  analysis: OptimizerAnalysis,
  resultsContainer: HTMLElement,
): HTMLElement {
  const wrapper = document.createElement('div');

  const roles = collectBroadRoles(analysis);
  if (roles.length === 0) return wrapper;

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.textContent = `${t('feature.petOptimizer.abilitiesExpand')} \u25B8`;
  toggle.style.cssText = [
    'padding:4px 10px',
    'border-radius:5px',
    'border:1px solid rgba(143,130,255,0.3)',
    'background:rgba(143,130,255,0.08)',
    'color:#d8d1ff',
    'font-size:11px',
    'font-weight:600',
    'cursor:pointer',
    'transition:all 0.15s',
  ].join(';');

  const pillsRow = document.createElement('div');
  pillsRow.style.cssText = 'display:none;flex-wrap:wrap;gap:4px;margin-top:6px;';

  for (const role of roles) {
    const color = getAbilityColor(role.abilityName);
    const isGradient = color.base.includes('gradient');
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.textContent = role.label;

    if (isGradient) {
      // Gradient abilities (Rainbow/Gold Granter): use the gradient directly
      pill.style.cssText = [
        'padding:3px 8px',
        'border-radius:4px',
        'border:1px solid rgba(255,255,255,0.35)',
        `background:${color.base}`,
        `color:${color.text || '#fff'}`,
        'font-size:10px',
        'font-weight:600',
        'cursor:pointer',
        'white-space:nowrap',
        'transition:all 0.12s',
        'opacity:0.75',
      ].join(';');

      pill.addEventListener('mouseenter', () => { pill.style.opacity = '1'; });
      pill.addEventListener('mouseleave', () => { pill.style.opacity = '0.75'; });
    } else {
      const borderColor = colorWithAlpha(color.base, 0.3);
      const bgColor = colorWithAlpha(color.base, 0.1);
      const hoverBg = colorWithAlpha(color.base, 0.2);
      const hoverBorder = colorWithAlpha(color.base, 0.5);

      pill.style.cssText = [
        'padding:3px 8px',
        'border-radius:4px',
        `border:1px solid ${borderColor}`,
        `background:${bgColor}`,
        `color:${color.text || '#e8e0ff'}`,
        'font-size:10px',
        'font-weight:500',
        'cursor:pointer',
        'white-space:nowrap',
        'transition:all 0.12s',
      ].join(';');

      pill.addEventListener('mouseenter', () => {
        pill.style.background = hoverBg;
        pill.style.borderColor = hoverBorder;
      });
      pill.addEventListener('mouseleave', () => {
        pill.style.background = bgColor;
        pill.style.borderColor = borderColor;
      });
    }
    pill.addEventListener('click', () => {
      // Find the first family header matching this broad role.
      // Family headers have data-family-key. The broad role key may be a
      // substring or prefix of exact family keys, so we try partial match.
      const headers = resultsContainer.querySelectorAll<HTMLElement>('[data-family-key]');
      for (const header of headers) {
        const fKey = header.dataset.familyKey ?? '';
        // Exact match or the family key starts with the broad role key
        if (fKey === role.broadKey || fKey.startsWith(role.broadKey)) {
          header.scrollIntoView({ behavior: 'smooth', block: 'start' });
          // Brief highlight
          const orig = header.style.outline;
          header.style.outline = `2px solid ${colorWithAlpha(color.base, 0.8)}`;
          setTimeout(() => { header.style.outline = orig; }, 1200);
          return;
        }
      }
      // Fallback: search by label text
      for (const header of headers) {
        if (header.textContent?.toLowerCase().includes(role.label.toLowerCase())) {
          header.scrollIntoView({ behavior: 'smooth', block: 'start' });
          return;
        }
      }
    });

    pillsRow.appendChild(pill);
  }

  let expanded = false;
  toggle.addEventListener('click', () => {
    expanded = !expanded;
    pillsRow.style.display = expanded ? 'flex' : 'none';
    toggle.textContent = expanded ? `${t('feature.petOptimizer.abilitiesExpand')} \u25BE` : `${t('feature.petOptimizer.abilitiesExpand')} \u25B8`;
  });

  wrapper.appendChild(toggle);
  wrapper.appendChild(pillsRow);
  return wrapper;
}
