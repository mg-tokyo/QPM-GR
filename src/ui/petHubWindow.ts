// src/ui/petHubWindow.ts
// Pet Hub - compact team selector with QPM priority and Aries fallback.

import { log } from '../utils/logger';
import { readTeamsFromLocalStorage, type AriesBridgeTeam } from '../integrations/ariesBridge';
import { importAriesTeams } from '../utils/ariesTeamImport';
import { applyTeam, getTeamsConfig } from '../store/petTeams';
import { storage } from '../utils/storage';
import { t } from '../i18n';

const ARIES_IMPORT_ONCE_KEY = 'petHub:ariesImportOnce.v1';

type TeamOption = {
  key: string;
  label: string;
  source: 'qpm' | 'aries';
  qpmTeamId?: string;
  ariesTeam?: AriesBridgeTeam;
  filledSlots: number;
};

function slotsFingerprint(slots: Array<string | null>): string {
  return slots.slice(0, 3).map(s => (s ?? '').trim()).join('|');
}

async function applyAriesPreset(
  team: AriesBridgeTeam,
  onDone: (msg: string, type: 'success' | 'error' | 'info') => void,
): Promise<void> {
  importAriesTeams();
  const qpmConfig = getTeamsConfig();
  const ariesFp = slotsFingerprint(team.slotIds);
  const qpmTeam = qpmConfig.teams.find(t =>
    slotsFingerprint(t.slots) === ariesFp || t.name === team.name,
  );
  if (!qpmTeam) {
    onDone(t('feature.petHub.mapError'), 'error');
    return;
  }

  const result = await applyTeam(qpmTeam.id);
  if (result.errors.length > 0) {
    onDone(`Error: ${result.errors[0]}`, 'error');
  } else if (result.applied === 0) {
    onDone(t('feature.petHub.teamActive'), 'info');
  } else {
    onDone(t('feature.petHub.applied', { name: qpmTeam.name }), 'success');
  }
}

function buildTeamOptions(): TeamOption[] {
  const options: TeamOption[] = [];

  // Priority: QPM teams first
  const qpmTeams = getTeamsConfig().teams;
  const qpmFingerprints = new Set<string>();
  for (const team of qpmTeams) {
    const fp = slotsFingerprint(team.slots);
    qpmFingerprints.add(fp);
    const filledSlots = team.slots.filter(Boolean).length;
    options.push({
      key: `qpm:${team.id}`,
      label: `QPM • ${team.name}`,
      source: 'qpm',
      qpmTeamId: team.id,
      filledSlots,
    });
  }

  // Aries-only teams next (skip duplicates that already exist in QPM)
  const ariesTeams = readTeamsFromLocalStorage().filter(t => t.source !== 'activePets');
  for (const team of ariesTeams) {
    const fp = slotsFingerprint(team.slotIds);
    if (qpmFingerprints.has(fp)) continue;
    options.push({
      key: `aries:${team.id}:${fp}`,
      label: `Aries • ${team.name}`,
      source: 'aries',
      ariesTeam: team,
      filledSlots: team.slotIds.filter(Boolean).length,
    });
  }

  return options;
}

export function renderPetHubWindow(root: HTMLElement): void {
  root.innerHTML = '';
  root.style.cssText = 'display:flex;flex-direction:column;gap:10px;flex:1;min-height:0;padding:10px 12px;';

  const controls = document.createElement('div');
  controls.style.cssText = 'display:grid;grid-template-columns:1fr auto auto auto;gap:8px;align-items:center;';
  root.appendChild(controls);

  const select = document.createElement('select');
  select.style.cssText = [
    'height:32px',
    'padding:0 10px',
    'border-radius:6px',
    'border:1px solid rgba(143,130,255,0.3)',
    'background:rgba(255,255,255,0.06)',
    'color:#e0e0e0',
    'font-size:12px',
    'outline:none',
    'min-width:0',
  ].join(';');
  controls.appendChild(select);

  const refreshBtn = document.createElement('button');
  refreshBtn.type = 'button';
  refreshBtn.textContent = t('feature.petHub.refresh');
  refreshBtn.style.cssText = [
    'height:32px',
    'padding:0 10px',
    'font-size:12px',
    'border:1px solid rgba(143,130,255,0.3)',
    'border-radius:6px',
    'background:rgba(143,130,255,0.1)',
    'color:#c8c0ff',
    'cursor:pointer',
  ].join(';');
  controls.appendChild(refreshBtn);

  const importBtn = document.createElement('button');
  importBtn.type = 'button';
  importBtn.textContent = '⬇';
  importBtn.style.cssText = [
    'height:32px',
    'width:32px',
    'padding:0',
    'font-size:14px',
    'line-height:1',
    'border:1px solid rgba(143,130,255,0.3)',
    'border-radius:6px',
    'background:rgba(143,130,255,0.1)',
    'color:#c8c0ff',
    'cursor:pointer',
  ].join(';');
  controls.appendChild(importBtn);

  const applyBtn = document.createElement('button');
  applyBtn.type = 'button';
  applyBtn.textContent = t('feature.petHub.apply');
  applyBtn.style.cssText = [
    'height:32px',
    'padding:0 12px',
    'font-size:12px',
    'border:1px solid rgba(143,130,255,0.38)',
    'border-radius:6px',
    'background:rgba(143,130,255,0.16)',
    'color:#e0e0ff',
    'cursor:pointer',
  ].join(';');
  controls.appendChild(applyBtn);

  const metaEl = document.createElement('div');
  metaEl.style.cssText = 'font-size:11px;color:rgba(224,224,224,0.55);min-height:16px;';
  root.appendChild(metaEl);

  const statusEl = document.createElement('div');
  statusEl.style.cssText = 'font-size:12px;color:rgba(224,224,224,0.45);min-height:18px;';
  root.appendChild(statusEl);

  let statusTimer: number | null = null;
  const setStatus = (msg: string, type: 'success' | 'error' | 'info'): void => {
    statusEl.textContent = msg;
    statusEl.style.color =
      type === 'success' ? '#4caf50' :
      type === 'error' ? '#f87171' :
      'rgba(224,224,224,0.45)';
    if (statusTimer !== null) window.clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => {
      statusTimer = null;
      statusEl.textContent = '';
    }, 2800);
  };

  let options: TeamOption[] = [];
  const updateMeta = (): void => {
    const selected = options.find(o => o.key === select.value);
    if (!selected) {
      metaEl.textContent = '';
      return;
    }
    metaEl.textContent = `${selected.label} • ${t('feature.petHub.slotsInfo', { slots: String(selected.filledSlots) })}`;
  };

  const renderOptions = (preserveSelection: boolean): void => {
    const previous = preserveSelection ? select.value : '';
    options = buildTeamOptions();
    select.innerHTML = '';

    if (options.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = t('feature.petHub.noTeams');
      select.appendChild(opt);
      select.disabled = true;
      applyBtn.disabled = true;
      metaEl.textContent = t('feature.petHub.noTeamsHint');
      return;
    }

    for (const option of options) {
      const opt = document.createElement('option');
      opt.value = option.key;
      opt.textContent = option.label;
      select.appendChild(opt);
    }

    select.disabled = false;
    applyBtn.disabled = false;
    const next = options.some(o => o.key === previous) ? previous : options[0]!.key;
    select.value = next;
    updateMeta();
  };

  const refreshImportBtn = (): void => {
    const imported = storage.get<boolean>(ARIES_IMPORT_ONCE_KEY, false);
    importBtn.title = imported ? t('feature.petHub.importDone') : t('feature.petHub.importAries');
    importBtn.style.opacity = imported ? '0.62' : '1';
  };

  select.addEventListener('change', updateMeta);

  refreshBtn.addEventListener('click', () => {
    renderOptions(true);
    setStatus(t('feature.petHub.refreshed'), 'info');
  });

  importBtn.addEventListener('click', () => {
    const result = importAriesTeams();
    if (!result.available) {
      setStatus(t('feature.petHub.noAriesTeams'), 'info');
      return;
    }
    storage.set(ARIES_IMPORT_ONCE_KEY, true);
    renderOptions(true);
    refreshImportBtn();
    if (result.imported > 0) {
      setStatus(result.imported > 1 ? t('feature.petHub.importedTeams', { count: String(result.imported) }) : t('feature.petHub.importedTeam', { count: String(result.imported) }), 'success');
    } else {
      setStatus(t('feature.petHub.alreadyImported'), 'info');
    }
  });

  applyBtn.addEventListener('click', async () => {
    const selected = options.find(o => o.key === select.value);
    if (!selected) return;

    applyBtn.disabled = true;
    applyBtn.textContent = t('feature.petHub.applying');
    try {
      if (selected.source === 'qpm' && selected.qpmTeamId) {
        const result = await applyTeam(selected.qpmTeamId);
        if (result.errors.length > 0) {
          setStatus(`Error: ${result.errors[0]}`, 'error');
        } else if (result.applied === 0) {
          setStatus(t('feature.petHub.teamActive'), 'info');
        } else {
          setStatus(t('feature.petHub.applied', { name: selected.label.replace(/^QPM • /, '') }), 'success');
        }
      } else if (selected.source === 'aries' && selected.ariesTeam) {
        await applyAriesPreset(selected.ariesTeam, setStatus);
      }
    } catch (err) {
      log('⚠️ Apply team failed', err);
      setStatus(t('feature.petHub.applyFailed'), 'error');
    } finally {
      applyBtn.disabled = false;
      applyBtn.textContent = t('feature.petHub.apply');
      renderOptions(true);
    }
  });

  renderOptions(false);
  refreshImportBtn();
}
