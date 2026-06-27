// src/diagnostics/configCard.ts — Config-tab Diagnostics card (§8.1)
//
// Exposed as an ExpandableCardConfig so the existing configGroup can drop it
// into its `cards` array. Clicking the tile or opening the card both route
// to the Diagnostics window.

import type { ExpandableCardConfig } from '../ui/hub/cards/types';
import type { PerTileStatusProvider } from '../ui/panel/tileStatusTypes';
import { toggleWindow } from '../ui/core/modalWindow';
import { healthBus } from './healthBus';
import {
  DIAGNOSTICS_WINDOW_ID,
  DIAGNOSTICS_WINDOW_TITLE,
  renderDiagnosticsWindow,
} from './diagnosticsWindow';
import type { AggregateStatus } from './types';

function statusBlurb(status: AggregateStatus, subsystemCount: number, degradedCount: number, failedCount: number): string {
  if (status === 'ok') {
    return subsystemCount === 0
      ? 'All systems OK — no subsystems publishing yet'
      : 'All systems OK';
  }
  if (status === 'failed') {
    if (failedCount === 1) return '1 subsystem failed';
    return `${failedCount} subsystems failed`;
  }
  if (degradedCount === 1) return '1 subsystem degraded';
  return `${degradedCount} subsystems degraded`;
}

function aggregateColour(status: AggregateStatus): string {
  if (status === 'failed') return '#f44336';
  if (status === 'degraded') return '#ffb347';
  return '#4fd18b';
}

function aggregateBg(status: AggregateStatus): string {
  if (status === 'failed') return 'rgba(244, 67, 54, 0.18)';
  if (status === 'degraded') return 'rgba(255, 179, 71, 0.18)';
  return 'rgba(79, 209, 139, 0.18)';
}

function openDiagnosticsWindow(): void {
  toggleWindow(DIAGNOSTICS_WINDOW_ID, DIAGNOSTICS_WINDOW_TITLE, renderDiagnosticsWindow, '720px', '78vh');
}

export function getDiagnosticsCard(): ExpandableCardConfig {
  const tileStatusProvider: PerTileStatusProvider = (el, addLiveCleanup, version) => {
    const update = () => {
      const all = healthBus.readAll();
      const degraded = all.filter(h => h.status === 'degraded' || h.status === 'recovering').length;
      const failed = all.filter(h => h.status === 'failed').length;
      el.textContent = statusBlurb(healthBus.aggregate(), all.length, degraded, failed);
      const status = healthBus.aggregate();
      el.style.color = status === 'ok' ? '' : aggregateColour(status);
    };
    update();
    const unsub = healthBus.subscribe(() => { queueMicrotask(update); });
    addLiveCleanup(version, unsub);
  };

  return {
    key: 'qpm-diagnostics',
    label: 'Diagnostics',
    description: 'Subsystem health, recent errors, and Copy-for-Discord support payload.',
    icon: { kind: 'emoji', value: '🩺' },
    labelColor: '#4fd18b',
    tier: 'expandable',
    tile: {
      icon: '🩺',
      color: 'rgba(79, 209, 139, 0.28)',
      defaultStatus: 'All systems OK',
      statusProvider: tileStatusProvider,
      action: openDiagnosticsWindow,
    },
    renderSummary: (el) => {
      el.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:12px;margin-top:2px;';

      const pill = document.createElement('span');
      pill.style.cssText = [
        'display:inline-flex',
        'padding:2px 8px',
        'border-radius:9999px',
        'font-size:10px',
        'font-weight:600',
        'text-transform:uppercase',
        'letter-spacing:0.4px',
      ].join(';');

      const label = document.createElement('span');
      label.style.cssText = 'color:var(--qpm-text-muted);';

      el.append(pill, label);

      const update = () => {
        const status = healthBus.aggregate();
        const all = healthBus.readAll();
        const degraded = all.filter(h => h.status === 'degraded' || h.status === 'recovering').length;
        const failed = all.filter(h => h.status === 'failed').length;

        pill.textContent = status;
        pill.style.color = aggregateColour(status);
        pill.style.background = aggregateBg(status);
        pill.style.border = `1px solid ${aggregateColour(status)}55`;

        label.textContent = statusBlurb(status, all.length, degraded, failed);
      };
      update();
      const unsub = healthBus.subscribe(() => { queueMicrotask(update); });
      return unsub;
    },
    renderExpanded: (container) => {
      container.style.cssText = 'display:flex;flex-direction:column;gap:10px;';

      const status = document.createElement('div');
      status.style.cssText = 'font-size:12px;color:var(--qpm-text);';

      const desc = document.createElement('div');
      desc.style.cssText = 'font-size:11px;color:var(--qpm-text-muted);line-height:1.5;';
      desc.textContent = 'View per-subsystem health, recent errors, and copy a structured payload to share in Discord support.';

      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.textContent = 'Open Diagnostics window';
      openBtn.style.cssText = [
        'padding:8px 14px',
        'border-radius:8px',
        'border:1px solid var(--qpm-accent-emphasis)',
        'background:var(--qpm-accent-subtle)',
        'color:var(--qpm-text)',
        'font-size:12px',
        'font-weight:600',
        'cursor:pointer',
        'align-self:flex-start',
      ].join(';');
      openBtn.addEventListener('click', openDiagnosticsWindow);

      container.append(status, desc, openBtn);

      const update = () => {
        const aggregate = healthBus.aggregate();
        const all = healthBus.readAll();
        const degraded = all.filter(h => h.status === 'degraded' || h.status === 'recovering').length;
        const failed = all.filter(h => h.status === 'failed').length;
        status.textContent = statusBlurb(aggregate, all.length, degraded, failed);
        status.style.color = aggregate === 'ok' ? 'var(--qpm-text)' : aggregateColour(aggregate);
      };
      update();
      const unsub = healthBus.subscribe(() => { queueMicrotask(update); });
      return unsub;
    },
  };
}
