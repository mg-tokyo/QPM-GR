// src/ui/locker/lockerHarvestFilters.ts
// General tab content — global harvest filter settings rendered flat (no card wrapper).

import { getLockerConfig, updateLockerConfig, type LockerConfig } from '../../features/locker/index';
import type { HarvestFilterSettings } from '../../features/locker/types';
import {
  buildFilterModeControl,
  buildSizeSection,
  buildColorSection,
  buildWeatherSection,
} from './lockerFilterBuilder';

// ── Internal helper ─────────────────────────────────────────────────────────

function updateGlobalFilter(patch: Partial<HarvestFilterSettings>): void {
  const cur = getLockerConfig();
  updateLockerConfig({ harvestFilter: { ...cur.harvestFilter, ...patch } });
}

function getLiveGlobalSettings(): HarvestFilterSettings {
  return getLockerConfig().harvestFilter;
}

// ── Main export ─────────────────────────────────────────────────────────────

export function buildGeneralTabContent(config: LockerConfig): HTMLElement {
  const panel = document.createElement('div');
  panel.style.cssText = 'display:flex;flex-direction:column;gap:10px';

  const settings = config.harvestFilter;

  panel.appendChild(buildFilterModeControl(settings, updateGlobalFilter));
  panel.appendChild(buildSizeSection(settings, updateGlobalFilter, getLiveGlobalSettings));
  panel.appendChild(buildColorSection(settings, updateGlobalFilter, getLiveGlobalSettings));
  panel.appendChild(buildWeatherSection(settings, updateGlobalFilter, getLiveGlobalSettings));

  return panel;
}
