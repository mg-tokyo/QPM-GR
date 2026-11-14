// Garden tab ETA lines above "Remaining" (ALR-5.4). The element outlives renderContent's
// innerHTML reset, so it keeps its own subscription and is re-appended on each render.

import { t } from '../../../i18n';
import { getGardenSnapshot } from '../../../features/garden/bridge';
import { countActionableFruits, extractTiles, mutsMatch } from '../../../features/garden/gardenTiles';
import {
  getMutationEtaSnapshot,
  subscribeMutationEta,
  type MutationEtaSnapshot,
} from '../../../features/garden/mutationEta';
import { describeEta } from '../mutationEtaText';
import { getBelledMutations, onMutationBellsChange, setMutationBell } from '../../../features/garden/mutationEtaBell';
import { createToggle } from '../../components';
import { areAlertsWipEnabled } from '../../../utils/wipFeatures';

export interface GardenEtaStrip {
  el: HTMLElement;
  setSelected(selected: readonly string[]): void;
  destroy(): void;
}

export function createGardenEtaStrip(): GardenEtaStrip {
  const el = document.createElement('div');
  el.style.cssText = 'display:none;flex-direction:column;gap:2px;font-size:12px;color:var(--qpm-text-muted);';
  let selected: readonly string[] = [];
  let snapshot: MutationEtaSnapshot = getMutationEtaSnapshot();

  function buildBell(mutation: string): HTMLElement {
    const toggle = createToggle({
      size: 'compact',
      checked: getBelledMutations().includes(mutation),
      label: t('feature.mutationEta.bellLabel'),
      onChange: (on) => { setMutationBell(mutation, on); },
    });
    toggle.root.title = t('feature.mutationEta.bellHint', { mutation });
    return toggle.root;
  }

  function describeRow(mutation: string): { text: string; title: string } {
    const entry = snapshot.entries.find((e) => mutsMatch(e.mutation, mutation));
    let text: string;
    let count: number;
    if (entry) {
      count = entry.remaining;
      text = entry.etaHours === null || entry.etaHours === 0
        ? t('feature.mutationEta.gardenRowPlain', { mutation, state: describeEta(entry) })
        : t('feature.mutationEta.gardenRow', { mutation, eta: describeEta(entry), rate: entry.procsPerHour.toFixed(1) });
    } else {
      count = countActionableFruits(extractTiles(getGardenSnapshot()), [mutation]);
      const state = count === 0 ? t('feature.mutationEta.done') : t('feature.mutationEta.noGranter');
      text = t('feature.mutationEta.gardenRowPlain', { mutation, state });
    }
    return { text, title: t('feature.mutationEta.gardenTooltip', { count: String(count) }) };
  }

  // The ETA snapshot refreshes on every garden tick (about 1/s); rebuilding unchanged rows
  // would replace the Alert switch under the cursor.
  let lastSignature = '';

  function render(): void {
    const belled = getBelledMutations();
    const rows = selected.map((mutation) => ({ mutation, ...describeRow(mutation), on: belled.includes(mutation) }));
    const signature = JSON.stringify(rows);
    if (signature === lastSignature) return;
    lastSignature = signature;
    el.replaceChildren(...rows.map(({ mutation, text, title }) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;';
      const label = document.createElement('span');
      label.textContent = text;
      label.title = title;
      row.append(label);
      if (areAlertsWipEnabled()) row.append(buildBell(mutation));
      return row;
    }));
    el.style.display = selected.length > 0 ? 'flex' : 'none';
  }

  const unsubscribe = subscribeMutationEta((next) => {
    snapshot = next;
    if (selected.length > 0) render();
  }, false);
  const unsubscribeBells = onMutationBellsChange(() => { if (selected.length > 0) render(); });

  return {
    el,
    setSelected(next) {
      selected = [...next];
      render();
    },
    destroy() {
      unsubscribe();
      unsubscribeBells();
    },
  };
}
